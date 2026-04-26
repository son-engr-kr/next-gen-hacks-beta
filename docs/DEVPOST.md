# MotZip — Devpost Submission

## Inspiration

Anyone who's tried to plan dinner in a busy city knows the friction: you spend 20 minutes scrolling Yelp, copy a phone number, call to ask if there's a wait, get put on hold, and then do it again for the next place. Restaurants under-share live operational info — wait times, walk-in availability, dietary options — because keeping it updated is impossible. We wanted to collapse that 20-minute loop into 90 seconds: speak what you want, see only the buildings that match, and let an AI agent make the phone calls for you in parallel.

## What it does

**MotZip** is a 3D voice-driven restaurant discovery app for Boston.

- **Voice or text search** — say *"quiet romantic spot for date night, korean food, under $40, with cocktails"* (English or Korean) and a Gemini LLM extracts structured filters (cuisine, price, vibe, accessibility, parking, dogs, alcohol).
- **Cinematic 3D filter** — non-matching buildings sink into the ground and disappear; a spotlight highlights the survivors on a Three.js + MapLibre 3D Boston map.
- **AI phone agent** — pick the candidates and our Twilio + ElevenLabs agent calls them. You choose which questions to ask (reservations, vegetarian options, wheelchair access, outdoor seating, parking, live music, dogs allowed) plus your own custom question. The agent asks **one question at a time** in a chained Gather flow, transcribes each answer with Scribe STT, and parses it with Gemini for higher per-question accuracy.
- **Live result cards** — answers stream into a side panel as each call progresses (✓ / ✗ / ? per question with details).
- **Signature dishes** — Gemini reads the actual Google reviews on demand and extracts what people are actually ordering.

## How we built it

- **Frontend** — Next.js 16 (Turbopack) + React 19 + TypeScript + Tailwind 4. MapLibre GL for the 2D base, Three.js for the 3D buildings, custom GLSL spotlight shader, TRELLIS-generated GLB food icons loaded with DRACOLoader.
- **Backend** — FastAPI with a modular APIRouter architecture (places / voice_search / twilio_calls / llm / speech / catalog). Pydantic for the API contracts.
- **LLM** — Gemini 2.0 Flash via Vertex AI for natural-language filter extraction, signature dish extraction, and phone-response parsing. Local Ollama (Gemma 3 4B) wired up as automatic fallback so the demo survives a wifi drop.
- **Speech** — ElevenLabs Scribe (STT) + Turbo v2.5 (TTS), multilingual (en + ko).
- **Phone calls** — Twilio Voice with chained `<Gather>` — one question per turn, status state-machine `initiated → asking N/M → parsing → completed`, ngrok reserved domain for webhooks.
- **Restaurant data** — Google Places API (New) `searchNearby`, split into 7 type groups to bypass the hard 20-result cap (39 → 98 restaurants).

## Challenges we ran into

- **The 20-result cap.** Google Places caps `searchNearby` at 20 — we initially had 39 restaurants total. Split the query into 7 cuisine type groups, deduped by place_id, got to 98.
- **Twilio multi-turn flow.** Asking 5 questions in one `<Gather>` and parsing the wall of speech was unreliable. We rebuilt it as a chained one-question-at-a-time flow with per-step state in memory and per-step LLM parsing — much higher accuracy.
- **WebM corruption.** `MediaRecorder.start(200)` with a timeslice produced incomplete WebM containers on short button presses; ElevenLabs rejected them. Switched to a single chunk per recording.
- **Race condition.** Status was flipping to `completed` before LLM parsing finished, so the frontend would grab an empty result. Added a `parsing` intermediate status.
- **LLM accuracy with a small local model.** Gemma 3 4B kept dropping JSON fields and missing synonyms ("korean bbq" never matched anything). Migrated the LLM layer to Gemini via Vertex AI with `response_mime_type=application/json` for schema-enforced output, kept Ollama as auto-fallback.
- **Building footprint after sinking.** Filtered buildings left a flat square on the map. Fixed by setting target scale to 0 and toggling `group.visible = false` below threshold.

## Accomplishments that we're proud of

- An AI phone agent that holds a structured multi-turn conversation and returns clean ✓/✗/? answers per question — not just a transcript dump.
- 3D filter animation that actually feels cinematic instead of like a checkbox list — buildings sink, the survivor gets a spotlight.
- A graceful **degradation chain** at every step: Gemini → Ollama → keyword heuristics; ElevenLabs → no-audio mode; LLM JSON parse fail → field-level defaults. Nothing in the demo is a single point of failure.
- Voice → filter → phone call → answer cards working end-to-end in under 90 seconds for a query of 4 candidate restaurants.
- Bilingual from day one — English and Korean queries both work, including for the phone agent's TTS.

## What we learned

- **One LLM call per question beats one LLM call for the whole transcript.** Accuracy went up dramatically when we stopped asking the model to disentangle five answers from one blob of speech.
- **Schema-enforced JSON output is a game-changer** for production reliability. Switching to Gemini's `response_mime_type=application/json` made our `_strip_codefence` and keyword fallbacks almost never trigger.
- **3D visualizations carry information weight.** Having buildings physically vanish communicates "this is no longer a candidate" faster than greying out a list row.
- **Always have an offline path for a live demo.** The Ollama fallback wasn't a feature we planned; it was a lesson from the first time wifi flickered during a test run.

## What's next for MotZip

- **Reservation booking, not just info.** Once the agent knows there's a table, let it actually book.
- **Two-way negotiation.** "If there's a 30+ min wait, ask if they can suggest a sister restaurant nearby."
- **Crowd-sourced live state.** Cache the call results and reuse them for nearby users for the next 15 minutes — no need to call the same restaurant 50 times.
- **Beyond Boston.** The map + 3D pipeline is city-agnostic; we just need to plug in another set of building tiles.
- **Voice wakeword on mobile.** "Hey MotZip, I'm hungry" → instant search with current location.
- **More languages.** Spanish, Mandarin, Japanese — Gemini and ElevenLabs both support them; it's mostly UI strings and prompt translations.
