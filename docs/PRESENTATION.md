# Demo Video Presentation Script — motzip

Verbatim narration script for a ~3-minute submission video, with section
timing, camera/cursor cues, and what to say if you're presenting live.

**Total target length: 2:45–3:15.** Devpost video pages auto-loop short
videos and judges typically scan 30–60s before deciding to keep watching, so
the **first 20 seconds matter most**. Lead with the problem and the
3D-map reveal, not with credits.

---

## Pre-flight checklist (before recording)

- [ ] Ollama is up: `ollama serve` (otherwise the AI call falls back to
      keyword parsing and looks dumber than it is).
- [ ] FastAPI server up: `cd motzip-server && uv run uvicorn main:app --reload`
- [ ] Next.js dev: `cd motzip-app && npm run dev`
- [ ] ngrok tunnel: `ngrok http --url=mooing-cake-thumping.ngrok-free.dev 8000`
      (Twilio needs to reach the webhook)
- [ ] Twilio test number in `.env` (`TWILIO_TEST_TO`) is verified — check
      that you can receive a call to it before recording.
- [ ] Browser at http://localhost:3000, camera centered on Boston Common.
- [ ] Phone in airplane mode OFF, ringer ON, near the mic.
- [ ] Quiet room, mic gain calibrated.

---

## Section-by-section script

### 0:00 – 0:15 · Hook + problem

> *(On-screen: split-screen montage — Yelp page, Google Maps page, OpenTable
> page; cursor jumping between tabs in frustration.)*

> "You're traveling in Boston. You want a restaurant that's wheelchair
> accessible, has vegetarian options, allows your dog, and has a table
> open right now."

> "No app gives you all of that. So you end up calling — in a second
> language, one restaurant at a time."

### 0:15 – 0:30 · Reveal

> *(Cut to motzip — 3D Boston view, slow camera pan over downtown buildings
> with food icons floating above them.)*

> "Meet motzip. Discover Boston in 3D, search by voice, and let AI call
> ahead for you."

### 0:30 – 1:00 · Voice search

> *(Cursor moves to the mic button at the bottom. Hold-to-record.)*

> "Watch this. I'm going to ask for restaurants that are wheelchair
> accessible AND have vegetarian options."

> *(Voice into the mic, naturally:)*
> "Find me wheelchair accessible vegetarian restaurants near here."

> *(Release. Buildings without those features sink into the ground;
> matching ones get a glowing spotlight beam. Cards slide in on the right.
> A friendly AI voice says: "Found 5 restaurants matching your filters.
> Top picks: …")*

> "It transcribed me, extracted structured filters with a local LLM,
> queried Google Places, filtered the matches, and spoke the answer back —
> end-to-end on my own machine."

### 1:00 – 1:15 · Map ↔ panel sync

> *(Cursor clicks two of the highlighted buildings on the map. The
> corresponding cards on the right panel get checkboxes ticked.)*

> "I can pick the candidates I'm interested in straight from the map, or
> from the cards — they stay in sync."

### 1:15 – 2:15 · The killer feature — AI batch calls

> *(Cursor opens the question checklist on the right panel.)*

> "Now here's the part that didn't exist before: I pick the questions I
> actually want answered."

> *(Click checkboxes: Reservation. Wheelchair. Vegetarian.)*

> "And if I have something specific —"

> *(Type into the custom question input, in Korean:)*
> "유아 의자 있어요?"

> "I can ask in any language — the AI translates it for the call."

> *(Click "Call 3 selected".)*

> *(Cut to phone ringing. AI on speaker:)*
>   - "Hi, I'm calling on behalf of a customer. I have a few quick
>     questions. First, is a reservation available for a party of 2 right
>     now, or what is the current wait time?"
>   - *(You answer as the restaurant: "Yeah, we can seat you in about 15
>     minutes.")*
>   - "Got it, thank you. Next, is the restaurant wheelchair accessible?"
>   - *("Yes, fully accessible.")*
>   - "Got it, thank you. Next, do you offer vegetarian options?"
>   - *("Just one or two vegetarian dishes.")*
>   - "Got it. And finally, do you have a high chair available?"
>   - *("Yes, we do.")*
>   - "Thank you so much for all the information! Have a great day."

> *(Cut back to the panel. The card fills in live as each answer comes back:
> ✓ Reservation ~15 min wait, ✓ Wheelchair access, ✗ Vegetarian options
> "only 1-2 dishes", ✓ Your question "yes, available".)*

> "It asked one question at a time, parsed each answer with tight LLM
> context, and gave me a structured checklist — exactly the answers I'd
> have spent ten minutes on the phone collecting."

### 2:15 – 2:35 · Tech credibility (fast)

> *(B-roll collage: terminal showing `ollama serve`, the FastAPI uvicorn
> log streaming gather webhook hits, ngrok dashboard, Twilio call log.)*

> "Under the hood: a local Gemma 3 LLM via Ollama, ElevenLabs for speech
> in and out, Twilio multi-step `<Gather>` chains for the conversation,
> Google Places New for live restaurant data, and a Three.js custom layer
> on top of MapLibre for the 3D map. Frontend is Next.js 16 with React 19."

> "Every LLM call runs on-device — zero per-call cost, no rate limits."

### 2:35 – 2:50 · Outro

> *(Cut to the motzip logo over the 3D map.)*

> "motzip — your AI restaurant concierge. It finds the place. It makes
> the call. You just show up."

> *(Lower-third caption: GitHub URL + team names.)*

---

## Talking points for live Q&A or hackathon judging

If a judge asks one of these, here's the punchy answer:

**Q: What's the hardest technical part?**
> Multi-turn voice agents are surprisingly subtle. Naively asking "ask all
> the questions and parse the response" gives you a salad — the LLM either
> drops questions or invents answers. We chain Twilio `<Gather>`s
> per-question and parse each turn in isolation. Higher accuracy, more
> natural conversation, and the user sees answers stream in live.

**Q: Why a local LLM?**
> $0 inference cost, no rate limits, no data leaving the device. We
> hit the LLM 4–6 times per call (translation, per-answer parsing,
> filter extraction) — that would be expensive and slow over a cloud API.

**Q: What's the social-good angle?**
> Two real groups benefit: people with accessibility needs who currently
> re-verify every restaurant by phone, and non-native speakers who avoid
> calls because of the language barrier. The AI handles the call; they
> get the answers.

**Q: Why 3D? Isn't that just eye candy?**
> The 3D view encodes information: building height = popularity, sinking
> = filtered out, spotlight = match, food icons = category. It's a
> spatial reasoning tool, not a screensaver.

**Q: What would you build next?**
> Real concurrent calls (currently the demo serializes since we share one
> Twilio test phone), reservation booking (not just availability checks),
> and a "remember what I always ask" preference layer.

---

## Recording tips

- **Use OBS** with a single 1920×1080 scene that crops the browser window,
  and a separate audio track for the phone speaker. Sync in post.
- **Record voice and screen separately.** Voiceover with a real mic in
  post sounds 10× more confident than narrating live during recording.
- **Speed up the silences.** Twilio call latency is real (~3–5s gather +
  LLM round trip). Cut or 2× speed the dead air between AI turns.
- **Captions matter.** Hackathon judges often watch on mute first.
  Burn-in subtitles for every spoken line.
- **Show the result, not the build process.** Don't show terminal output
  for more than 2 seconds at a time.
