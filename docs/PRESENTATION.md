# Demo Video Presentation Script — MotZip

Verbatim narration script for a ~3-minute submission video.

**Target length: 2:45–3:15.** Devpost auto-loops short videos and judges
typically scan 30–60s before deciding to keep watching, so the **first
20 seconds matter most**.

**Live demo URL** (lower-third + final frame):
[https://motzip.vercel.app](https://motzip.vercel.app)

---

## The two-point story (read this before writing the voiceover)

Everything in the script is in service of these two beats:

1. **Find candidates by saying what you actually want.** Natural-language
   voice search → 3D map filter. ("I want X" → buildings light up.)
2. **Verify each candidate by phone, automatically and in parallel.** AI
   agent calls each restaurant, asks your questions in any language,
   parses the answers into a checklist.

The hook frames *why these two things together* matter. The closing
emphasizes *who this changes things for* — non-native speakers and people
with accessibility needs, for whom the phone call has always been the
gatekeeper to eating out.

---

## Pre-flight checklist (recording locally)

- [ ] FastAPI server up:
      `cd motzip-server && uv run uvicorn main:app --reload`
- [ ] Next.js dev:
      `cd motzip-app && npm run dev`
- [ ] ngrok tunnel for Twilio webhooks:
      `ngrok http --url=mooing-cake-thumping.ngrok-free.dev 8000`
- [ ] `.env` populated (`GOOGLE_PLACES_API_KEY`, `ELEVENLABS_API_KEY`,
      `TWILIO_*`) and `gcloud auth application-default login` for
      Vertex AI + Cloud Speech.
- [ ] `TWILIO_TEST_TO` is your verified phone — make a test call first.
- [ ] Browser at http://localhost:3000, camera centered on Boston Common.
- [ ] Phone ringer ON, near the mic, airplane mode OFF.
- [ ] Run one warm-up voice search to prime caches before any real take.

---

## Section-by-section script

### 0:00 – 0:20 · Hook (the information gap)

> *(Split-screen montage — Yelp tab, Google Maps tab, OpenTable tab; cursor
> jumping between them, never finding the answer.)*

> "Star ratings. Reviews. Photos. Almost everything about a restaurant is
> online — except the one thing you actually need to decide tonight."

> *(Cut to a phone screen: a half-typed question in a notes app —
> "wheelchair accessible? high chair? wait time?")*

> "Real-time, personal answers. Wait time right now. Vegetarian options.
> Whether your kid's stroller fits. That information lives in the head of
> one person at the restaurant."

> "So you call. One restaurant. Then the next. In a language that may not
> be your first."

### 0:20 – 0:35 · Reveal + frame

> *(Cut to MotZip — 3D Boston view, slow camera pan, food icons floating
> above buildings.)*

> "Meet MotZip. We do two things no other app does."

> "First — find candidates by saying what you actually want."

> "Second — call them all, ask your questions, get the answers back as a
> checklist."

### 0:35 – 1:10 · Point 1 — natural-language candidate discovery

> *(Cursor moves to the mic button. Press and speak.)*

> "Watch this."

> *(Voice into the mic, naturally:)*
> "Find me a wheelchair accessible Korean restaurant with parking,
> under forty dollars per person."

> *(Release. Buildings without those features sink into the ground and
> vanish; matching ones get a glowing spotlight beam. Result cards slide
> in on the right. A friendly voice replies: "Found 4 restaurants matching
> your filters. Top picks: …")*

> "I didn't pick from a dropdown. I just said it. Gemini extracted the
> filters — cuisine, price, wheelchair access, parking — and only the
> buildings that match are still standing."

### 1:10 – 1:30 · Cards, map sync, signature dishes

> *(Click a card to expand it. Show the panel: rating, hours, price, a
> few amber pills under "🍽 Signature dishes".)*

> "Each card shows what people actually order — Gemini reads the reviews
> on demand and pulls out the signature dishes. No more guessing what to
> get."

> *(Click a building on the map — its card opens. Click another card —
> its building lights up. Show the bidirectional sync.)*

> "Map and cards stay in sync — pick from either."

### 1:30 – 2:25 · Point 2 — automating the phone verification

> *(Cursor opens the question checklist on the right panel.)*

> "Now the part that didn't exist before MotZip. I pick the questions I
> actually want answered."

> *(Click checkboxes: Reservation. Vegetarian.)*

> "And if I have something specific that's not on the list —"

> *(Type into the custom question input, in Korean:)*
> "유아 의자 있어요?"

> "I can ask in any language. The AI translates it before the call."

> *(Click "Call 3 selected".)*

> *(Cut to phone ringing. AI on speaker:)*
>   - "Hi, I'm calling on behalf of a customer. I have a few quick
>     questions. First — is a reservation available for two right now,
>     or what's the current wait time?"
>   - *(You answer as the restaurant: "Yeah, we can seat you in about 15
>     minutes.")*
>   - "Got it. Next — do you offer vegetarian options?"
>   - *("Just one or two vegetarian dishes.")*
>   - "Got it. And finally — do you have a high chair available?"
>   - *("Yes.")*
>   - "Thank you so much. Have a great day."

> *(Cut back to the panel. Each card fills in live as answers arrive:
> ✓ Reservation ~15 min wait, ✗ Vegetarian "only 1–2 dishes",
> ✓ High chair "yes, available".)*

> "One question at a time, parsed into a structured checklist. Across
> three restaurants, I'd just done what would take me twenty minutes on
> the phone. In a language I didn't even speak."

### 2:25 – 2:40 · Tech credibility (fast, ~15s)

> *(B-roll collage: Cloud Run logs streaming gather webhook hits, Vertex
> AI dashboard, Twilio call log.)*

> "Gemini 2.0 Flash on Vertex AI for filter extraction and per-answer
> parsing. Google Cloud Speech for STT and TTS. Twilio multi-step Gather
> chains for the conversation. Three.js over MapLibre for the 3D map.
> Live now on Cloud Run and Vercel."

### 2:40 – 2:55 · Emotional landing (who this is really for)

> *(Slow zoom on the 3D map. Soft B-roll: a wheelchair user at a
> restaurant entrance; someone using sign language; a tourist holding
> up their phone in a foreign city. Quick cuts, 1–2s each.)*

> "For most of us, calling a restaurant is friction. For some people,
> it's a wall."

> "Non-native speakers who avoid calls because of the language. People
> who are deaf or hard of hearing, who can't easily make a phone call at
> all. Wheelchair users who have to verify every doorway, every bathroom,
> before deciding where to eat."

> "MotZip makes the call for them. In their language. With their
> questions. So the answer is just there."

### 2:55 – 3:05 · Outro

> *(Cut to MotZip logo over the 3D map. URL on screen, held for 3s.)*

> "MotZip. Find it. Ask it. Show up."

> *(Lower-third: motzip.vercel.app · GitHub · team names.)*

---

## Talking points for Q&A or live judging

**Q: What's the hardest technical part?**
> Multi-turn voice agents are surprisingly subtle. Naively asking the
> LLM "ask all the questions and parse the response" returns a salad —
> dropped questions, invented answers. We chain Twilio Gathers per
> question and parse each turn with focused LLM context. Higher accuracy,
> more natural conversation, and the user sees answers stream in live.

**Q: Why Gemini over a local model?**
> We started on local Ollama Gemma 3 — zero cost is appealing — but the
> 4B model dropped JSON fields and missed natural-language synonyms like
> "korean bbq". Gemini 2.0 Flash with `response_mime_type=application/json`
> gives schema-enforced output: parse errors went to nearly zero. Ollama
> stays in as automatic fallback for offline resilience.

**Q: Why two speech providers?**
> Google Cloud Speech is primary because it works reliably from a Cloud
> Run datacenter IP. ElevenLabs is the local-dev fallback because its
> voices are warmer for recording. Same interface either way.

**Q: Isn't AI calling restaurants kind of intrusive for the staff?**
> Real concern. We mitigate by: keeping the call short (≤4 questions),
> identifying as an assistant up front, and structuring questions so the
> staff can answer in one short sentence each. Long-term, restaurants
> publish answers themselves and we stop calling — MotZip becomes the
> demand signal that proves the data is worth maintaining.

**Q: Why 3D? Isn't that just eye candy?**
> The 3D view encodes information: building height = popularity,
> sinking = filtered out, spotlight = match. Judges grasp the result
> spatially before the cards even render — no list-reading.

**Q: What about state when calls span multiple webhooks on Cloud Run?**
> Cloud Run scales to zero, so we worried briefly about state loss
> between Twilio webhooks. In practice, the first request warms the
> instance and all subsequent webhooks within a single call land on
> the same warm instance. For multi-call durability we'd move state
> to Firestore — for hackathon scale, in-process is fine.

**Q: What would you build next?**
> Real reservation booking (not just availability checks). Crowd-sourced
> caching of recent call results so we don't re-call the same place 50
> times. And a "remember what I always ask" preference layer — vegan,
> stroller, wheelchair — set once, apply forever.

---

## Recording tips

- **OBS** at 1920×1080, single browser-cropped scene, separate audio
  track for the phone speaker. Sync in post.
- **Record voice and screen separately.** Voiceover with a real mic in
  post sounds 10× more confident than narrating during the take.
- **Speed up the silences.** Twilio call latency is real (~3–5s gather +
  LLM). Cut or 2× speed the dead air between AI turns.
- **Burn in captions.** Judges often watch on mute first.
- **Show the result, not the build process.** Terminal output for no
  more than 2 seconds at a time — the one exception is the Twilio
  webhook log shot, which sells "this is real, not faked".
- **End on the URL.** Last frame: motzip.vercel.app, held 3 seconds, so
  any judge who liked the demo can type it in immediately.
