"""Twilio outbound call orchestration with per-question iteration.

Flow:
  1. POST /api/call-restaurant — caller picks question keys + custom question.
     We dial Twilio; questions get stored in _call_state keyed by CallSid.
  2. Twilio dials the restaurant. When picked up, Twilio POSTs to
     /api/twilio/voice → returns TwiML asking the FIRST question.
  3. Restaurant speaks. Twilio POSTs to /api/twilio/gather?step=N with
     SpeechResult. We LLM-parse that one answer for that one question, then
     return TwiML for question N+1 — or hang up if it was the last.
  4. /api/twilio/status receives lifecycle events for terminal failures.
  5. Frontend polls /api/call-result/{sid} and gets answers as they accumulate
     plus a status string ("asking 2/4" → "completed").
"""

import re
import urllib.parse
from typing import Any

from fastapi import APIRouter, Form, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from catalog import QUESTION_CATALOG
from config import (
    NGROK_URL,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER,
    TWILIO_TEST_TO,
)
from llm import generate_json, generate_text

router = APIRouter()

# In-memory call state keyed by Twilio CallSid. Production would back this
# with Redis or a DB; for the demo, process memory is fine.
_call_state: dict[str, dict[str, Any]] = {}


# ── Models ───────────────────────────────────────────────────────────────────

class CallRestaurantRequest(BaseModel):
    restaurant_name: str
    phone: str
    party_size: int = 2
    time_preference: str = "as soon as possible"
    questions: list[str] = []      # keys from QUESTION_CATALOG
    custom_question: str = ""      # freeform extra question (any language)


class CallRestaurantResponse(BaseModel):
    call_sid: str
    status: str


class QuestionAnswer(BaseModel):
    value: bool | None = None       # True=yes, False=no, None=unaddressed
    details: str = ""
    wait_minutes: int | None = None # only meaningful for "reservation"


class CallResultResponse(BaseModel):
    call_sid: str
    # initiated | asking N/M | parsing | completed | failed | busy | no-answer | canceled
    status: str
    answers: dict[str, QuestionAnswer] = {}
    raw_speech: str = ""
    # Legacy fields for the single-call RestaurantPanel — derived from
    # answers["reservation"] if present.
    can_reserve: bool | None = None
    wait_minutes: int | None = None
    notes: str = ""


# ── Helpers ──────────────────────────────────────────────────────────────────

def _xml_escape(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
              .replace('"', "&quot;").replace("'", "&apos;"))


def _step_say(step: int, question_text: str) -> str:
    """The line Joanna speaks for one question. First step adds a greeting."""
    if step == 0:
        return (
            f"Hi, I'm calling on behalf of a customer. I have a few quick questions. "
            f"First, {question_text}?"
        )
    return f"Got it, thank you. Next, {question_text}?"


def _gather_twiml(step: int, say_text: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="{NGROK_URL}/api/twilio/gather?step={step}" method="POST"
          speechTimeout="auto" timeout="10" language="en-US">
    <Say voice="Polly.Joanna-Neural">{_xml_escape(say_text)}</Say>
  </Gather>
  <Say voice="Polly.Joanna-Neural">I did not receive a response. Goodbye.</Say>
</Response>"""


def _hangup_twiml(message: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">{_xml_escape(message)}</Say>
  <Hangup/>
</Response>"""


async def _translate_to_english(text: str) -> str:
    """Translate a non-English custom question to a polite English phone question."""
    try:
        out = await generate_text(
            text,
            system=(
                "Translate the user's question into a polite, natural English "
                "question that one would ask a restaurant on the phone. "
                "Output ONLY the translated question — one sentence, no quotes, "
                "no preamble, no explanation."
            ),
            temperature=0.2, num_predict=100, timeout=15,
        )
        return out.strip().strip('"“”‘’\'`')
    except Exception as e:
        print(f"[twilio] translation error: {e}, using original text")
        return text


# ── Keyword fallback ─────────────────────────────────────────────────────────

_POS_WORDS = [
    "yes", "yeah", "yep", "sure", "of course", "absolutely", "available",
    "we have", "we can", "open table", "no wait", "right away", "come in",
    "네", "예", "가능", "있어요", "있습니다", "예약돼", "오세요", "환영",
]
_NEG_WORDS = [
    "no", "sorry", "can't", "cannot", "fully booked", "full", "no reservations",
    "walk-in only", "walk in only", "first come", "no availability",
    "안 돼", "안돼", "불가", "예약 안", "워크인", "꽉 찼",
]


def _keyword_parse(speech: str) -> dict:
    """Heuristic answer parse when the LLM is unavailable. EN/KO."""
    text = speech.lower()
    m = re.search(r"(\d+)\s*(?:to\s*\d+\s*)?(?:minutes?|min|mins|분)", text)
    wait = int(m.group(1)) if m else 0
    pos = any(w in text for w in _POS_WORDS)
    neg = any(w in text for w in _NEG_WORDS)
    value = True if pos and not neg else False if neg and not pos else None
    return {"value": value, "wait_minutes": wait, "details": speech[:120]}


async def _parse_single_answer(key: str, question_text: str, speech: str) -> dict:
    """LLM-parse one restaurant utterance against one specific question.
    Returns {value, details} (+ wait_minutes for reservation)."""
    if not speech:
        return {"value": None, "details": ""}

    extra_field = (
        ", \"wait_minutes\": <integer if a wait time was mentioned, otherwise omit>"
        if key == "reservation" else ""
    )
    system_prompt = (
        "You are parsing a restaurant staff member's spoken reply to ONE question.\n"
        f"Question that was asked: \"{question_text}\"\n\n"
        "Respond ONLY with a JSON object — no markdown, no preamble:\n"
        "{ \"value\": true|false|null, \"details\": \"short factual phrase or empty string\""
        + extra_field + " }\n\n"
        "Rules:\n"
        "- value: true = yes/affirmative/available, false = no/negative/unavailable, null = ambiguous or unrelated.\n"
        "- details: ONE short factual phrase the staff said (e.g. \"15 min wait\", \"only one veg dish\"). Empty string if nothing useful.\n"
        "- No invented facts. Use only what the staff actually said."
    )

    try:
        parsed = await generate_json(
            speech, system_prompt,
            temperature=0.1, num_predict=150, timeout=20,
        )
        out: dict = {
            "value": parsed.get("value"),
            "details": parsed.get("details") or "",
        }
        if key == "reservation" and isinstance(parsed.get("wait_minutes"), (int, float)):
            out["wait_minutes"] = int(parsed["wait_minutes"])
        return out
    except Exception as e:
        print(f"[twilio] single-answer parse failed for {key}: {e}, using keyword fallback")
        kw = _keyword_parse(speech)
        out = {"value": kw["value"], "details": kw["details"]}
        if key == "reservation":
            out["wait_minutes"] = kw["wait_minutes"]
        return out


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/api/call-restaurant", response_model=CallRestaurantResponse)
async def call_restaurant(body: CallRestaurantRequest):
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER):
        raise HTTPException(status_code=503, detail="Twilio credentials not configured")

    from twilio.rest import Client as TwilioClient  # type: ignore
    client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

    # Resolve question keys to (key, prompt_text) pairs in the order the user picked.
    ordered: list[tuple[str, str]] = []
    asked_keys: list[str] = []
    for k in body.questions:
        spec = QUESTION_CATALOG.get(k)
        if not spec:
            continue
        ordered.append((k, spec["prompt"].format(party_size=body.party_size)))
        asked_keys.append(k)

    # Append custom question (translated if non-ASCII).
    raw_extra = body.custom_question.strip()
    if raw_extra:
        if any(ord(c) > 127 for c in raw_extra):
            custom_en = await _translate_to_english(raw_extra)
            print(f"[twilio] translated custom: {custom_en}")
        else:
            custom_en = raw_extra
        custom_en = custom_en.rstrip(".?!").strip()
        ordered.append(("custom", custom_en))
        asked_keys.append("custom")

    # Default to reservation if nothing was asked — keeps single-call panels working.
    if not ordered:
        ordered.append(("reservation",
                        QUESTION_CATALOG["reservation"]["prompt"].format(party_size=body.party_size)))
        asked_keys.append("reservation")

    print(f"[twilio] questions for call: {asked_keys}")
    twiml_url = f"{NGROK_URL}/api/twilio/voice?step=0"
    to_number = TWILIO_TEST_TO if TWILIO_TEST_TO else body.phone

    call = client.calls.create(
        to=to_number,
        from_=TWILIO_PHONE_NUMBER,
        url=twiml_url,
        status_callback=f"{NGROK_URL}/api/twilio/status",
        status_callback_method="POST",
        timeout=30,
    )

    _call_state[call.sid] = {
        "restaurant_name": body.restaurant_name,
        "status": "initiated",
        "asked_keys": asked_keys,
        "asked_questions": dict(ordered),
        "answers": {},
        "raw_speech": "",
    }
    return CallRestaurantResponse(call_sid=call.sid, status="initiated")


def _resolve_questions(call_info: dict) -> tuple[list[str], dict[str, str]]:
    """Pull asked keys + question text out of call_state, defaulting to a single
    reservation question if nothing was stored (e.g. webhook fired before we
    populated state, or for legacy flows)."""
    asked_keys = call_info.get("asked_keys") or ["reservation"]
    asked_questions = call_info.get("asked_questions") or {
        "reservation": QUESTION_CATALOG["reservation"]["prompt"].format(party_size=2)
    }
    return asked_keys, asked_questions


@router.post("/api/twilio/voice")
async def twilio_voice(step: int = Query(0), CallSid: str = Form("")):
    """First TwiML the called party hears. Subsequent steps are chained from /gather."""
    info = _call_state.get(CallSid) or {}
    asked_keys, asked_questions = _resolve_questions(info)

    if step >= len(asked_keys):
        return PlainTextResponse(_hangup_twiml("Sorry, no questions configured. Goodbye."),
                                 media_type="application/xml")

    info["status"] = f"asking 1/{len(asked_keys)}"
    _call_state[CallSid] = info

    key = asked_keys[step]
    return PlainTextResponse(
        _gather_twiml(step, _step_say(step, asked_questions[key])),
        media_type="application/xml",
    )


@router.post("/api/twilio/gather")
async def twilio_gather(
    step: int = Query(0),
    CallSid: str = Form(""),
    SpeechResult: str = Form(""),
):
    """Save the answer to question `step`, then chain to question step+1 (or
    hang up if no more questions)."""
    raw_speech = SpeechResult.strip()
    call_info = _call_state.get(CallSid, {})
    asked_keys, asked_questions = _resolve_questions(call_info)

    if step >= len(asked_keys):
        return PlainTextResponse(_hangup_twiml("Goodbye."), media_type="application/xml")

    cur_key = asked_keys[step]
    print(f"[twilio] gather step={step+1}/{len(asked_keys)} key={cur_key} speech={raw_speech!r}")

    answer = await _parse_single_answer(cur_key, asked_questions[cur_key], raw_speech)
    print(f"[twilio] parsed [{cur_key}]: {answer}")

    answers = call_info.setdefault("answers", {})
    answers[cur_key] = answer

    # Append per-step transcript to the legacy raw_speech blob for the panel.
    raw_log: list = call_info.setdefault("raw_speech_log", [])
    raw_log.append({"key": cur_key, "speech": raw_speech})
    call_info["raw_speech"] = " | ".join(f"[{r['key']}] {r['speech']}" for r in raw_log)

    next_step = step + 1
    if next_step < len(asked_keys):
        # Chain another <Gather>
        call_info["status"] = f"asking {next_step + 1}/{len(asked_keys)}"
        _call_state[CallSid] = call_info
        next_key = asked_keys[next_step]
        return PlainTextResponse(
            _gather_twiml(next_step, _step_say(next_step, asked_questions[next_key])),
            media_type="application/xml",
        )

    # Last question answered — populate legacy fields, mark completed.
    res_ans = answers.get("reservation")
    if isinstance(res_ans, dict):
        call_info["can_reserve"] = res_ans.get("value")
        call_info["wait_minutes"] = int(res_ans.get("wait_minutes") or 0)
        call_info["notes"] = res_ans.get("details") or call_info.get("raw_speech", "")
    else:
        call_info["can_reserve"] = None
        call_info["wait_minutes"] = 0
        call_info["notes"] = call_info.get("raw_speech", "")
    call_info["status"] = "completed"
    _call_state[CallSid] = call_info

    return PlainTextResponse(
        _hangup_twiml("Thank you so much for all the information! Have a great day. Goodbye."),
        media_type="application/xml",
    )


@router.post("/api/twilio/status")
async def twilio_status(CallSid: str = Form(""), CallStatus: str = Form("")):
    """Twilio lifecycle webhook — only used to mark terminal failures."""
    if CallSid in _call_state and CallStatus in ("failed", "busy", "no-answer", "canceled"):
        _call_state[CallSid]["status"] = CallStatus
    return {"ok": True}


@router.get("/api/call-result/{call_sid}", response_model=CallResultResponse)
async def call_result(call_sid: str):
    info = _call_state.get(call_sid)
    if not info:
        raise HTTPException(status_code=404, detail="Call not found")

    raw_answers = info.get("answers") or {}
    answers = {
        k: QuestionAnswer(
            value=v.get("value") if isinstance(v, dict) else None,
            details=(v.get("details") or "") if isinstance(v, dict) else "",
            wait_minutes=v.get("wait_minutes") if isinstance(v, dict) else None,
        )
        for k, v in raw_answers.items()
    }
    return CallResultResponse(
        call_sid=call_sid,
        status=info.get("status", "initiated"),
        answers=answers,
        raw_speech=info.get("raw_speech", ""),
        can_reserve=info.get("can_reserve"),
        wait_minutes=info.get("wait_minutes"),
        notes=info.get("notes", ""),
    )
