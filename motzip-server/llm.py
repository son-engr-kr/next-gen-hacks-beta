"""LLM wrapper with two backends:

  • Primary: Gemini via Vertex AI (cloud, much higher quality, JSON-schema
    enforced output → ~zero parse errors).
  • Fallback: local Ollama (offline-capable, used if Gemini call fails or if
    LLM_PROVIDER=ollama).

Public API stays the same — `generate_json(prompt, system, ...)` returns a
dict, `generate_text(...)` returns a str. Callers don't need to know which
backend served the request.
"""

import asyncio
import json

import httpx
from google import genai
from google.genai import types as genai_types

from config import (
    GCP_LOCATION,
    GCP_PROJECT,
    GEMINI_MODEL,
    LLM_PROVIDER,
    MODEL,
    OLLAMA_POLL_INTERVAL_SECONDS,
    OLLAMA_URL,
)

# ── Gemini client (lazy-init so import doesn't crash if creds are missing) ──

_gemini_client: genai.Client | None = None
_gemini_init_failed = False


def _get_gemini_client() -> genai.Client | None:
    """Return a cached Vertex AI client. Returns None if init fails so callers
    can fall through to Ollama."""
    global _gemini_client, _gemini_init_failed
    if _gemini_client is not None:
        return _gemini_client
    if _gemini_init_failed:
        return None
    try:
        _gemini_client = genai.Client(
            vertexai=True, project=GCP_PROJECT, location=GCP_LOCATION
        )
        return _gemini_client
    except Exception as e:
        print(f"[motzip-server] Gemini init failed ({e}); will use Ollama fallback.")
        _gemini_init_failed = True
        return None


# ── Startup probe (called from main.py lifespan) ────────────────────────────


async def wait_for_ollama() -> None:
    """Probe both backends. We don't BLOCK on Ollama anymore — Gemini is
    primary. Ollama is just a fallback, so we just log its status."""
    if LLM_PROVIDER == "gemini":
        client = _get_gemini_client()
        if client is not None:
            print(
                f"[motzip-server] Gemini OK (project={GCP_PROJECT}, model={GEMINI_MODEL})."
            )
        else:
            print("[motzip-server] WARNING: Gemini unavailable, will use Ollama.")

    # Probe Ollama too (useful as fallback). Don't block forever — single check.
    try:
        async with httpx.AsyncClient(timeout=2) as c:
            r = await c.get(f"{OLLAMA_URL}/api/tags")
            r.raise_for_status()
            models = [m["name"] for m in r.json().get("models", [])]
            if MODEL in models:
                print(f"[motzip-server] Ollama fallback ready (model={MODEL}).")
            else:
                print(
                    f"[motzip-server] Ollama running but '{MODEL}' missing "
                    f"(pull with: ollama pull {MODEL})."
                )
    except Exception:
        print(
            "[motzip-server] Ollama not reachable — fallback unavailable. "
            "Voice search relies on Gemini + keyword fallback."
        )
    # Hush asyncio.sleep import warning if unused
    _ = OLLAMA_POLL_INTERVAL_SECONDS


# ── JSON / text generation ──────────────────────────────────────────────────


def _strip_codefence(raw: str) -> str:
    """Some prompts make models wrap JSON in ```json fences. Strip them."""
    raw = raw.strip()
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


async def _gemini_generate_json(
    prompt: str, system: str, *, temperature: float, num_predict: int
) -> dict:
    client = _get_gemini_client()
    if client is None:
        raise RuntimeError("Gemini client unavailable")

    def _call() -> str:
        resp = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                system_instruction=system,
                temperature=temperature,
                max_output_tokens=num_predict,
                response_mime_type="application/json",
            ),
        )
        return resp.text or ""

    raw = await asyncio.to_thread(_call)
    return json.loads(_strip_codefence(raw))


async def _gemini_generate_text(
    prompt: str, system: str, *, temperature: float, num_predict: int
) -> str:
    client = _get_gemini_client()
    if client is None:
        raise RuntimeError("Gemini client unavailable")

    def _call() -> str:
        resp = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                system_instruction=system,
                temperature=temperature,
                max_output_tokens=num_predict,
            ),
        )
        return resp.text or ""

    raw = await asyncio.to_thread(_call)
    return raw.strip()


async def _ollama_generate_json(
    prompt: str, system: str, *, temperature: float, num_predict: int, timeout: float
) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": MODEL,
                "prompt": prompt,
                "system": system,
                "stream": False,
                "options": {"temperature": temperature, "num_predict": num_predict},
            },
            timeout=timeout,
        )
        r.raise_for_status()
    return json.loads(_strip_codefence(r.json()["response"]))


async def _ollama_generate_text(
    prompt: str, system: str, *, temperature: float, num_predict: int, timeout: float
) -> str:
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": MODEL,
                "prompt": prompt,
                "system": system,
                "stream": False,
                "options": {"temperature": temperature, "num_predict": num_predict},
            },
            timeout=timeout,
        )
        r.raise_for_status()
    return r.json()["response"].strip()


async def generate_json(
    prompt: str,
    system: str,
    *,
    temperature: float = 0.1,
    num_predict: int = 200,
    timeout: float = 20,
) -> dict:
    """Generate a JSON object. Tries Gemini first, falls back to Ollama on
    any failure (network, init, parse). Callers handle final fallback (e.g.
    keyword matching for voice search)."""
    if LLM_PROVIDER == "gemini":
        try:
            return await _gemini_generate_json(
                prompt, system, temperature=temperature, num_predict=num_predict
            )
        except Exception as e:
            print(f"[llm] Gemini JSON failed ({e}); falling back to Ollama.")
    return await _ollama_generate_json(
        prompt, system, temperature=temperature, num_predict=num_predict, timeout=timeout
    )


async def generate_text(
    prompt: str,
    system: str,
    *,
    temperature: float = 0.3,
    num_predict: int = 150,
    timeout: float = 15,
) -> str:
    """Freeform text generation. Same Gemini-first → Ollama fallback flow."""
    if LLM_PROVIDER == "gemini":
        try:
            return await _gemini_generate_text(
                prompt, system, temperature=temperature, num_predict=num_predict
            )
        except Exception as e:
            print(f"[llm] Gemini text failed ({e}); falling back to Ollama.")
    return await _ollama_generate_text(
        prompt, system, temperature=temperature, num_predict=num_predict, timeout=timeout
    )
