"""Environment-driven configuration. Single source of truth for credentials,
model selection, and Twilio webhook URL. Loaded from .env via python-dotenv
when the app starts (see main.py)."""

import os

# ── LLM ──────────────────────────────────────────────────────────────────────
# Primary: Gemini via Vertex AI. Fallback: local Ollama (works offline, used
# automatically if Vertex calls fail — important during demos where wifi
# can drop).
LLM_PROVIDER = os.getenv("MOTZIP_LLM_PROVIDER", "gemini")  # "gemini" | "ollama"

# Gemini / Vertex AI
GCP_PROJECT = os.getenv("GCP_PROJECT", "theta-bliss-486220-s1")
GCP_LOCATION = os.getenv("GCP_LOCATION", "us-central1")
GEMINI_MODEL = os.getenv("MOTZIP_GEMINI_MODEL", "gemini-2.5-flash")

# Ollama (fallback)
OLLAMA_URL = "http://localhost:11434"
MODEL = os.getenv("MOTZIP_MODEL", "gemma3:4b")
OLLAMA_POLL_INTERVAL_SECONDS = 2

# ── Speech (STT + TTS) ───────────────────────────────────────────────────────
# Primary: Google Cloud Speech-to-Text + Text-to-Speech (works on Cloud Run
# without datacenter-IP abuse blocks). Fallback: ElevenLabs (only used when
# SPEECH_PROVIDER=elevenlabs or Google call fails).
SPEECH_PROVIDER = os.getenv("MOTZIP_SPEECH_PROVIDER", "google")  # "google" | "elevenlabs"
GOOGLE_TTS_VOICE = os.getenv("GOOGLE_TTS_VOICE", "en-US-Neural2-C")
GOOGLE_STT_PRIMARY_LANG = os.getenv("GOOGLE_STT_PRIMARY_LANG", "en-US")
GOOGLE_STT_ALT_LANGS = os.getenv("GOOGLE_STT_ALT_LANGS", "ko-KR").split(",")

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")  # Sarah

# ── Google Places ────────────────────────────────────────────────────────────
GOOGLE_PLACES_API_KEY = os.getenv("GOOGLE_PLACES_API_KEY", "")

# ── Twilio ───────────────────────────────────────────────────────────────────
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")
# Public webhook URL Twilio dials back to. In dev this is an ngrok tunnel.
NGROK_URL = os.getenv("NGROK_URL", "http://localhost:8000")
# Trial-account override: redirect every outbound call to this verified number.
TWILIO_TEST_TO = os.getenv("TWILIO_TEST_TO", "")

# ── CORS ─────────────────────────────────────────────────────────────────────
# Comma-separated list. Defaults cover local dev; Cloud Run deploys add the
# Vercel URL via the CORS_ORIGINS env var.
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://localhost:3001",
    ).split(",")
    if o.strip()
]
