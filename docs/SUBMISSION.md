# Devpost Submission — motzip

Copy/paste-ready text for the [NextGenHacks](https://nextgenhacks.devpost.com/)
submission form. Trim or expand per Devpost's character limits.

---

## Project Title

**motzip — your AI restaurant concierge**

(Alt: "motzip — voice-search Boston in 3D, then let AI call ahead")

## Tagline (one-liner)

Discover restaurants by voice on a 3D Boston map, then send an AI to call
ahead and answer the questions you'd actually ask — wheelchair access,
vegetarian options, current wait time — all at once.

---

## Problem Statement

Finding a restaurant is easy. Finding the *right* restaurant for *your* needs
is brutal. Imagine you're traveling in Boston with a wheelchair-using parent,
a vegetarian friend, and a small dog. To plan dinner you need:

1. A place that's actually open right now
2. Wheelchair-accessible
3. With vegetarian options
4. That allows dogs
5. With a table free for 4 in the next 30 minutes

No single app surfaces all of that. Google Maps gives you reviews; Yelp gives
you photos; OpenTable gives you reservations — but you end up calling
restaurants anyway. And calling is the hardest part: it's awkward, it's slow,
and if you're not a native English speaker, it's a real barrier.

Three groups feel this acutely:
- **Travelers** crossing a language barrier on every restaurant call.
- **Gen Z** with documented [phone-call anxiety](https://www.bbc.com/worklife/article/20231215-the-gen-z-phone-call-anxiety) — 60%+ avoid calls when possible.
- **Accessibility-needs diners** (wheelchair users, dietary restrictions,
  service-animal owners) who currently re-call every place to verify.

## Solution Overview

**motzip** is a 3D restaurant discovery app where you:

1. **See Boston in 3D** with real Google Places data layered on every building.
2. **Search by voice** in English or Korean — "wheelchair-accessible vegetarian
   spots that allow dogs" — and watch non-matching buildings sink into the map.
3. **Pick the candidates** you're curious about (checkbox or click on the map).
4. **Pick the questions** you actually want answered (Reservation, Wheelchair,
   Vegetarian, Outdoor seating, Dogs, Parking, Live music — or write your own
   in any language).
5. **Send AI to call** all of them. Our AI dials each restaurant, asks each
   question one at a time, listens to the response, and returns a structured
   checklist — ✓ wheelchair access, ✗ vegetarian options, ✓ reservation
   available with 15 min wait — straight on the card. No phone anxiety, no
   language barrier, all answers in parallel.

## Key Features

- **3D Boston map** — real buildings via MapLibre + Three.js, with food-icon
  markers generated from a TRELLIS text-to-3D pipeline.
- **Bilingual voice search** — ElevenLabs Scribe STT recognizes English and
  Korean; local Ollama+Gemma extracts structured filters from natural-language
  queries; ElevenLabs TTS speaks the result back.
- **Voice-driven 3D filter** — buildings that don't match the search smoothly
  sink into the ground; matches get a spotlight beam. Magical, not just useful.
- **AI batch phone calls** with per-question iteration — instead of asking
  everything in one mashed-up question, the AI walks through your checklist
  one question at a time on the call. Each answer is parsed in tight
  single-question context, then streamed back live.
- **Map ↔ panel sync** — clicking a building on the map toggles its checkbox
  in the call panel. Two views, one selection.
- **Accessibility-first filters** — wheelchair access, dog-friendly, parking
  type are first-class fields, not buried in reviews.

## Technologies Used

| Layer | Stack |
|---|---|
| Frontend | Next.js 16 (Turbopack), React 19, MapLibre GL, Three.js, Tailwind 4 |
| Backend | FastAPI (Python 3.11), modular routers, async httpx |
| Local LLM | Ollama serving Gemma 3 (4B) — runs on-device, $0 inference cost |
| Voice | ElevenLabs Scribe (STT, multilingual) + ElevenLabs Turbo v2.5 (TTS) |
| Telephony | Twilio Voice API with multi-step `<Gather>` chaining; ngrok webhook tunnel |
| Restaurant data | Google Places API (New) — `searchNearby` with field-mask projection for accessibility, parking, opening hours, phone |
| 3D assets | TRELLIS text-to-3D for food-icon GLBs, Draco-compressed |

## Target Users

- **International travelers** who don't want to navigate phone calls in a
  second language.
- **Diners with accessibility needs** (mobility, dietary, service animals)
  who currently re-call every restaurant to verify.
- **Anyone with phone-call anxiety** — let the AI handle the awkward part.

## What's Genuinely Hard About This

- **Multi-turn voice agents are a research-grade problem.** Stitching Twilio
  `<Gather>` chains with per-turn LLM parsing, while staying within Twilio's
  webhook timeout budget, took several iterations. We solved it by parsing
  one question's response per webhook turn (tight LLM context = much higher
  accuracy than asking 5 questions and letting one big LLM call untangle).
- **The TwiML race condition.** We initially set the call status to
  "completed" before the LLM finished parsing, so the frontend grabbed an
  empty result and moved on. Fix: introduce a `parsing` intermediate status,
  flip to `completed` only after parsed fields are written.
- **Robust audio capture.** The browser's `MediaRecorder.start(timeslice)`
  produces concatenated chunks that ElevenLabs rejects as corrupted on short
  presses. We dropped the timeslice — single-chunk capture is always a valid
  WebM container.
- **Local LLM as a no-cloud-cost backbone.** Every LLM call (filter
  extraction, custom-question translation, per-answer parsing) runs on
  Ollama. Zero per-request API cost, no rate limits, works offline.

## Repository

https://github.com/son-engr-kr/next-gen-hacks-beta (branch: `feat/google-places`)

## Team

- Jun (full-stack, voice pipeline, Twilio multi-step orchestration)
- _add teammate names + roles here_
