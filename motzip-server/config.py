"""Environment-driven configuration. Single source of truth for credentials,
model selection, and Twilio webhook URL. Loaded from .env via python-dotenv
when the app starts (see main.py)."""

import os

# ── LLM ──────────────────────────────────────────────────────────────────────
OLLAMA_URL = "http://localhost:11434"
MODEL = os.getenv("MOTZIP_MODEL", "gemma3:4b")
OLLAMA_POLL_INTERVAL_SECONDS = 2

# ── ElevenLabs (STT + TTS) ───────────────────────────────────────────────────
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
CORS_ORIGINS = ["http://localhost:3000", "http://localhost:3001"]
