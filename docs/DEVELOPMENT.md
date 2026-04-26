# MotZip — Development Guide

Everything you need to run, build, and deploy MotZip.
For the product overview, see the [project README](../README.md).

---

## Table of contents

- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Local development](#local-development)
  - [Prerequisites](#prerequisites)
  - [Environment](#environment)
  - [Run](#run)
- [Deployment](#deployment)
  - [Backend → Cloud Run](#backend--cloud-run)
  - [Frontend → Vercel](#frontend--vercel)
- [Twilio Trial accounts](#twilio-trial-accounts)
- [3D model pipeline (motzip-3d)](#3d-model-pipeline-motzip-3d)

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | **Next.js 16 (Turbopack)** · React 19 · TypeScript 5 · Tailwind 4 |
| 3D | **Three.js 0.183** · MapLibre GL 5.22 · GLTFLoader + DRACOLoader · custom GLSL spotlight shader |
| Frontend hosting | **Vercel** (auto HTTPS · `motzip.vercel.app`) |
| Backend | **FastAPI** · Python 3.11 · `uv` · APIRouter (places / voice_search / twilio_calls / llm / speech / catalog) |
| Backend hosting | **Google Cloud Run** (us-central1) · Vertex AI service account |
| LLM | **Gemini 2.0 Flash** via Vertex AI · `response_mime_type=application/json` |
| Speech (primary) | **Google Cloud Speech-to-Text + Text-to-Speech** (en + ko) |
| Speech (fallback) | **ElevenLabs** Scribe + Turbo v2.5 (warmer voices, local dev) |
| Restaurant data | **Google Places API (New)** — `searchNearby` ×7 cuisine type-groups |
| Phone calls | **Twilio Voice** — chained `<Gather>` per question, per-turn LLM parse |
| 3D model pipeline | **Microsoft TRELLIS** (text-to-3D) → `gltf-transform` → Draco compression (<500 KB / model) |

---

## Repository layout

```
.
├── motzip-app/                Next.js frontend (deploy target: Vercel)
│   ├── src/
│   │   ├── app/               Next.js app-router
│   │   │   └── page.tsx           dynamic-imported Map3D
│   │   ├── components/
│   │   │   ├── Map3D.tsx          MapLibre + Three.js scene + UI overlays
│   │   │   ├── BuildingLayer.ts   custom Three.js MapLibre layer
│   │   │   ├── VoiceSearch.tsx    push-to-talk mic + text fallback
│   │   │   ├── RestaurantPanel.tsx
│   │   │   ├── BatchCallPanel.tsx call-N-in-parallel orchestrator
│   │   │   ├── Fireworks.tsx      canvas FX for trending spots
│   │   │   └── batch-call/        per-restaurant call status pieces
│   │   ├── data/
│   │   │   └── restaurants.ts     seed fixtures (when Places is unavailable)
│   │   └── types/restaurant.ts    shared TS types
│   ├── public/models/          TRELLIS GLB icons (Draco-compressed)
│   ├── next.config.ts          devIndicators: false (no dev N badge)
│   └── package.json
│
├── motzip-server/              Python backend (deploy target: Cloud Run)
│   ├── main.py                 FastAPI app + CORS + APIRouter wiring
│   ├── places.py               Google Places (New) — 7-group cuisine fan-out
│   ├── voice_search.py         audio → STT → LLM filters → Places filter → TTS
│   ├── twilio_calls.py         chained <Gather> agent + per-Q LLM parsing
│   ├── speech.py               Google Cloud Speech / ElevenLabs (auto-fallback)
│   ├── llm.py                  Gemini 2.0 Flash via Vertex AI
│   ├── catalog.py              cuisine taxonomy + Google Places type maps
│   ├── config.py               env + CORS origins (single source of truth)
│   ├── deploy.sh               gcloud build + run deploy
│   ├── Dockerfile              → Artifact Registry → Cloud Run
│   └── pyproject.toml
│
├── motzip-3d/                  GLB pipeline (Windows + CUDA, dev-only)
│   ├── TRELLIS/                cloned Microsoft TRELLIS repo
│   ├── generate.py             batch CLI: text-to-3D for food + buildings
│   ├── optimize.sh             gltf-transform → <500 KB per model
│   ├── prompts.md              per-category prompts
│   └── README.md               full Windows setup (CUDA / MSVC / wheels)
│
├── docs/
│   ├── DEVELOPMENT.md          this file
│   ├── DEVPOST.md              Devpost submission writeup
│   ├── PRESENTATION.md         slide outline
│   ├── STORYBOARD.md           live demo script
│   ├── SUBMISSION.md           submission checklist
│   └── assets/                 README + writeup imagery
│
├── README.md                   product overview
└── CLAUDE.md / AGENTS.md       agent conventions + project memory
```

---

## Local development

### Prerequisites

- **Node.js 20+** — frontend (`brew install node`)
- **Python 3.11** + **uv** — backend (`brew install uv`)
- **gcloud CLI** — only if deploying or using Vertex AI from your laptop (`brew install --cask google-cloud-sdk`)
- **vercel CLI** — only if deploying frontend (`npm i -g vercel`)
- **ngrok** — only if exercising Twilio webhooks locally (`brew install ngrok`)

### Environment

Backend reads `motzip-server/.env`. Keys are issued out-of-band — ask the repo owner.

```bash
# Google Cloud (Places + Vertex AI + Speech)
GOOGLE_PLACES_API_KEY=
GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/service-account.json
VERTEX_PROJECT=theta-bliss-486220-s1
VERTEX_LOCATION=us-central1
VERTEX_MODEL=gemini-2.0-flash

# Speech fallback
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL

# Twilio (outbound calls)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=+18447589915
NGROK_URL=https://xxxx.ngrok-free.app   # public URL for Twilio webhooks
TWILIO_TEST_TO=                         # Trial-account override; leave blank in prod
```

Frontend reads `motzip-app/.env.local`:

```bash
NEXT_PUBLIC_SERVER_URL=http://localhost:8000
```

### Run

Two terminals (three if you need Twilio webhooks).

```bash
# Terminal 1 — backend
cd motzip-server
uv sync
uv run uvicorn main:app --reload --port 8000
# → http://localhost:8000/health

# Terminal 2 — frontend
cd motzip-app
npm install
npm run dev
# → http://localhost:3000

# Terminal 3 — ngrok (only for Twilio call testing)
ngrok http 8000
# → put the https URL in motzip-server/.env as NGROK_URL, restart backend
```

---

## Deployment

### Backend → Cloud Run

```bash
cd motzip-server

# Build + deploy in one shot
./deploy.sh
# Equivalent to:
#   gcloud builds submit --tag us-central1-docker.pkg.dev/$PROJECT/motzip/api:latest
#   gcloud run deploy motzip-api \
#     --image=us-central1-docker.pkg.dev/$PROJECT/motzip/api:latest \
#     --region=us-central1 \
#     --allow-unauthenticated \
#     --service-account=motzip-runtime@$PROJECT.iam.gserviceaccount.com \
#     --set-env-vars="VERTEX_PROJECT=$PROJECT,VERTEX_LOCATION=us-central1,..." \
#     --memory=1Gi --cpu=1 --timeout=300 --min-instances=0 --max-instances=3
```

The runtime service account needs:

- `roles/aiplatform.user` (Vertex AI / Gemini)
- `roles/serviceusage.serviceUsageConsumer`
- Speech and Places APIs enabled on the project

### Frontend → Vercel

```bash
cd motzip-app
vercel link --yes --project motzip-app

# Wire the backend URL
printf "https://motzip-api-XXXXXX.us-central1.run.app" \
  | vercel env add NEXT_PUBLIC_SERVER_URL production

vercel --prod --yes
```

---

## Twilio Trial accounts

Trial accounts can only call numbers registered as **Verified Caller IDs**.

- For testing: set `TWILIO_TEST_TO=+1...` in `motzip-server/.env` to force every outbound call to your own verified number, no matter which restaurant is clicked.
- For production: upgrade the Twilio account and leave `TWILIO_TEST_TO` blank to call real restaurants.

---

## 3D model pipeline (motzip-3d)

Pre-built models ship in `motzip-app/public/models/`, so most contributors never need to touch this pipeline.

If you need to regenerate or add new categories, see [`motzip-3d/README.md`](../motzip-3d/README.md) for the full Windows + CUDA + MSVC setup. TL;DR:

```bash
cd motzip-3d
source TRELLIS/.venv/Scripts/activate

python generate.py --all --skip-existing --optimize
# → raw GLBs in 3d/, optimized + Draco-compressed copies in
#   motzip-app/public/models/{food,buildings}/
```

Target: each final GLB <500 KB. Frontend uses `DRACOLoader` to decode at runtime.
