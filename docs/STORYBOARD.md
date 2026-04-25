# Demo Video Storyboard (콘티) — motzip

Scene-by-scene shot list. Each scene has duration, visual content, audio
(VO + sfx), on-screen text, and recording instructions. Built to be
shootable as-is by anyone with OBS, a phone, and a Mac.

**Aspect ratio:** 16:9 (1920×1080) — Devpost auto-letterboxes anything else.
**Total runtime:** ~2:50.

---

## Scene index

| # | Time | Title | Type |
|---|---|---|---|
| 1 | 0:00 – 0:08 | Hook — "Try finding this restaurant" | Screen + VO |
| 2 | 0:08 – 0:18 | Problem montage | Screen + VO |
| 3 | 0:18 – 0:28 | Reveal — motzip 3D map | Screen + VO |
| 4 | 0:28 – 0:40 | Voice search input | Screen + live mic |
| 5 | 0:40 – 0:55 | 3D filter animation + result speak-back | Screen + sfx + VO |
| 6 | 0:55 – 1:10 | Map ↔ panel selection sync | Screen + VO |
| 7 | 1:10 – 1:25 | Question checklist + Korean custom Q | Screen + VO |
| 8 | 1:25 – 2:10 | AI calling the restaurant (the centerpiece) | Phone audio + screen |
| 9 | 2:10 – 2:30 | Result checklist fills in live | Screen close-up + VO |
| 10 | 2:30 – 2:45 | Tech credibility flyover | B-roll collage + VO |
| 11 | 2:45 – 2:55 | Outro + CTA | Screen + VO + caption |

---

## Scene 1 — Hook (0:00 – 0:08)

**Visual.** Black screen for 0.5s, then bold white text appears centered:
"Find a restaurant that's wheelchair accessible, has vegetarian options,
allows your dog, and is open right now." Each clause types in fast (kinetic
typography). End with a question mark cursor blinking.

**Audio.** Slight tense ambient pad, no music yet. Voiceover (calm,
slightly conspiratorial):
> "You're traveling in Boston. You want a restaurant that's wheelchair
> accessible, has vegetarian options, allows your dog, and is open right
> now."

**On-screen captions.** Match VO line-by-line.

**Director notes.** Use a serif font (Inter Tight Italic or DM Serif) for
the question — gives it editorial weight. Hold the cursor blink for 1s
before cutting.

---

## Scene 2 — Problem montage (0:08 – 0:18)

**Visual.** Three-up split screen, each panel showing a different app
trying and failing to answer the question:
- Left: Yelp filter sidebar — wheelchair filter exists, dog filter doesn't.
- Center: Google Maps — no per-restaurant accessibility filter at the
  search level.
- Right: OpenTable — only shows reservation availability, no other filters.

Cursor jumps between panels with frustrated quick-cuts. End with a phone
icon overlaying all three (the universal fallback: "just call").

**Audio.** Voiceover continues:
> "No app gives you all of that. So you end up calling — in a second
> language, one restaurant at a time."

A soft phone-ring SFX hits on "calling" (~0:14).

**On-screen captions.** None — let the visuals speak.

**Director notes.** The split-screen frames can be still screenshots cut
together with quick zooms; you don't need live recordings of all three
apps. Make sure the cursor moves are deliberate, not jittery.

---

## Scene 3 — Reveal (0:18 – 0:28)

**Visual.** Hard cut from the busy split-screen to a clean, dark motzip
screen. Camera starts zoomed out high above Boston, slowly pitches down
and pans into downtown — buildings rise up in 3D, food icons floating
above them with subtle bob animation. Logo "M MOTZIP — 3D RESTAURANT MAP"
is visible top-left.

**Audio.** Music swells gently (a clean ambient or low-key electronic
track — nothing dramatic, hackathons hate cinematic over-scoring).
Voiceover:
> "Meet motzip. Discover Boston in 3D, search by voice, and let AI call
> ahead for you."

**On-screen captions.** "motzip" reveals as a lower-third caption when the
VO says it.

**Director notes.** Pre-record the camera fly-in by manually panning in the
browser and trimming the screen capture. Don't try to script camera moves
live — too jittery. 6–8s of fly-in is plenty.

---

## Scene 4 — Voice search input (0:28 – 0:40)

**Visual.** Cursor moves to the bottom mic button. User holds it (visual:
the button glows red with a pulse ring). Audio waveform overlays on the
button while speaking. Subtitle appears at the bottom transcribing as the
user speaks, then the transcript bubble appears above the mic when it's
released.

**Audio.** Live mic recording (or re-recorded clean in post):
> "Find me wheelchair accessible vegetarian restaurants near here."

(English here for the demo. Optional bonus: re-record with a Korean
phrase for a "look, multilingual" beat — see scene 7 instead.)

**On-screen captions.** Real-time subtitle, then the transcript bubble.

**Director notes.** The mic button has a hold-to-talk pattern. Make sure
you release cleanly so the audio captures fully.

---

## Scene 5 — 3D filter animation + result speak-back (0:40 – 0:55)

**Visual.** This is the wow moment. After the voice search resolves:
- Buildings without matching features smoothly sink into the ground
  (~0.5s ease).
- Matching buildings get a glowing spotlight column (cyan-blue beam).
- A "Voice filter active — N places" badge appears top-center.
- The right-side BatchCallPanel slides in with the matching restaurants
  as cards.

**Audio.** SFX: a soft "whoosh" sync'd to the building sink. AI TTS voice
(captured from the actual app — ElevenLabs Sarah) plays:
> "Found 5 restaurants matching your filters. Top picks: Mike's Pastry,
> Yuki Sushi, Boston Burger. Check them out on the map!"

(The exact restaurants will vary based on what Google Places returns at
demo time — that's fine, the names just need to sound real.)

**On-screen captions.** Caption: "AI extracts filters → Google Places →
filtered + ranked → spoken summary".

**Director notes.** The actual TTS audio is base64-encoded in the response
and the app auto-plays it. Make sure the system audio is being captured
in OBS. If the TTS sounds weak, re-mix it slightly louder than the music
in post.

---

## Scene 6 — Map ↔ panel sync (0:55 – 1:10)

**Visual.** Cursor clicks 2-3 of the highlighted (still-standing)
buildings in turn. Each click:
- Camera flies to that building (`map.flyTo`)
- The corresponding card on the right panel toggles its checkbox
  (purple fill animates in)

**Audio.** Voiceover:
> "I can pick the candidates I'm interested in straight from the map, or
> from the cards — they stay in sync."

Subtle UI tick SFX on each checkbox toggle.

**On-screen captions.** None — VO carries it.

**Director notes.** Click DELIBERATELY with ~1s pauses between clicks.
The first time you do it, hover for a beat so the building's hover state
(if any) is visible, then click. Don't double-click — that registers as
two toggles.

---

## Scene 7 — Question checklist + Korean custom Q (1:10 – 1:25)

**Visual.** Cursor moves up to the "What to ask" section in the panel.
Click the chips one at a time:
- ☐ Reservation → ☑
- ☐ Wheelchair access → ☑
- ☐ Vegetarian options → ☑

Then click into the "Or write a custom question..." input. Type slowly
(visible character-by-character):
> "유아 의자 있어요?"

**Audio.** Voiceover:
> "Now I pick the questions I actually want answered. And if I have
> something specific —" *(typing happens here, slight pause)*
> "— I can ask in any language. The AI translates it for the call."

Soft typing SFX.

**On-screen captions.** When typing the Korean: an overlay appears
"유아 의자 = high chair" so non-Korean-speaking judges follow along.

**Director notes.** Don't paste — type the Korean live for authenticity.
The English translation overlay is essential; many judges won't read
Hangul.

---

## Scene 8 — AI calling the restaurant (1:25 – 2:10)

**Visual setup.** Picture-in-picture: main view is the BatchCallPanel
showing the selected restaurants with spinners. PIP in the corner is a
clean shot of the phone (the test phone receiving the call), screen on,
showing the incoming call from the Twilio number.

**Sequence.**
1. (1:25) Cursor hits "Call 3 selected" button. Cards transition to
   "asking 1/4" with spinners.
2. (1:27) Phone rings on PIP. Pick it up — speaker on.
3. (1:28) AI voice through phone speaker:
   > "Hi, I'm calling on behalf of a customer. I have a few quick
   > questions. First, is a reservation available for a party of 2 right
   > now, or what is the current wait time?"
4. (1:35) You (as the restaurant) answer:
   > "Yeah, we can seat you in about 15 minutes."
5. (1:38) Brief pause (LLM parse, ~3s — keep it real or 2× speed in post).
6. (1:41) AI:
   > "Got it, thank you. Next, is the restaurant wheelchair accessible?"
7. (1:44) You: "Yes, fully accessible."
8. (1:46) AI: "Got it, thank you. Next, do you offer vegetarian options?"
9. (1:48) You: "Just one or two vegetarian dishes."
10. (1:51) AI: "Got it. And finally, do you have a high chair available?"
11. (1:53) You: "Yes, we do."
12. (1:55) AI: "Thank you so much for all the information! Have a great
    day. Goodbye." → call ends.

**Audio.** Phone speaker captured cleanly (consider routing the phone
audio through a USB capture device or just place a quality mic next to
the phone). Background music drops to almost-silent during this scene.

**On-screen captions.** Burn-in subtitles for EVERY spoken line — both AI
and user. This is critical because phone audio is often muffled.
Color-code: AI lines in violet, restaurant lines in white.

**Director notes.** This scene IS the demo. Plan to re-shoot it 2-3 times
to get a clean take. Keep the phone speaker close to the recording mic.
If a take has a long awkward pause from LLM parsing, leave it in for the
first take (shows it's real) but speed-cut it in the final edit.

---

## Scene 9 — Result checklist fills in live (2:10 – 2:30)

**Visual.** Zoom into the right-side panel cards. As each AI question
completes, the corresponding row populates on the card with the icon and
detail. Camera follows the action vertically:
- ✓ Reservation — ~15 min wait
- ✓ Wheelchair access — fully accessible
- ✗ Vegetarian options — only 1-2 dishes
- ✓ Your question — yes, available

**Audio.** Voiceover (over the visual):
> "It asked one question at a time, parsed each answer with tight LLM
> context, and gave me a structured checklist — exactly the answers I'd
> have spent ten minutes on the phone collecting."

Subtle UI "tick" SFX as each row appears.

**On-screen captions.** None — let the populated checklist do the talking.

**Director notes.** If the live results are messy (LLM mis-parses
something), you can re-shoot just this scene with mock data by manually
poking the call_state. Keep it real if possible.

---

## Scene 10 — Tech credibility flyover (2:30 – 2:45)

**Visual.** Quick collage / horizontal scroll past:
1. Terminal: `ollama serve` log line "model loaded gemma3:4b"
2. Terminal: FastAPI uvicorn log streaming `[twilio] gather step=2/4 ...`
3. ngrok dashboard
4. Twilio call log
5. Three.js scene wireframe (optional bonus)

Each panel ~2s with a smooth pan.

**Audio.** Voiceover:
> "Under the hood: a local Gemma 3 LLM via Ollama, ElevenLabs for speech
> in and out, Twilio multi-step Gather chains for the conversation, Google
> Places New for live data, and a Three.js custom layer on top of MapLibre
> for the 3D map. Every LLM call runs on-device — zero cost, no rate
> limits."

Light music swells back in.

**On-screen captions.** Lower-third tech logos appear and fade per panel:
"Ollama × Gemma 3", "ElevenLabs", "Twilio", "Google Places", "MapLibre +
Three.js".

**Director notes.** This scene is technical-credibility ammo for judges.
Keep it fast — don't dwell on any one terminal output.

---

## Scene 11 — Outro + CTA (2:45 – 2:55)

**Visual.** Cut to the clean motzip 3D map, camera slowly pulling out to
show all of Boston. Logo "M MOTZIP" centered, large.

**Audio.** Music carries out. Voiceover (warm, confident close):
> "motzip. Your AI restaurant concierge. It finds the place. It makes the
> call. You just show up."

**On-screen captions.** Lower-third:
> github.com/son-engr-kr/next-gen-hacks-beta
> Built by [team names] for NextGenHacks

**Director notes.** Music tail fades out at 2:55, then black.

---

## Edit notes

- **Color grade:** Slightly cool tone (3D map is dark / night-mode
  aesthetic). Don't over-saturate.
- **Music:** One track throughout, dipping under voice and the phone call.
  Avoid epic builds — this is a product demo, not a film trailer.
- **Caption font:** Inter or system sans, white with a soft black drop
  shadow (1px, 50% opacity) for readability over busy backgrounds.
- **Pacing:** No shot longer than 8 seconds without something happening
  on-screen. Hackathon judges' attention windows are short.
- **Loops gracefully:** Devpost auto-replays. End on the motzip logo over
  the map (Scene 11) so a loop back to Scene 1 is jarring in a way that
  draws the eye back.

---

## Required assets to capture (checklist)

- [ ] Scene 1 typography: black + 4 lines of white text (After Effects or Keynote)
- [ ] Scene 2 split-screen screenshots: Yelp filter, Google Maps, OpenTable
- [ ] Scene 3 fly-in: 8s of clean motzip 3D camera pan recording
- [ ] Scene 4 voice search recording (audio + screen)
- [ ] Scene 5 result animation + TTS audio captured cleanly
- [ ] Scene 6 click-and-sync recording
- [ ] Scene 7 typing + label overlay
- [ ] Scene 8 phone call (full conversation)
- [ ] Scene 9 result checklist zoomed in
- [ ] Scene 10 terminal/ngrok/Twilio b-roll
- [ ] Scene 11 outro logo over map
- [ ] Background music track (royalty-free, 3-min loop)
- [ ] SFX: phone ring, UI ticks, whoosh
