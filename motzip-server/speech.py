"""ElevenLabs Speech-to-Text + Text-to-Speech wrappers. Both no-op gracefully
when no API key is configured so the rest of the app keeps working."""

import base64

import httpx

from config import ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID


async def transcribe(raw_audio: bytes, filename: str, content_type: str) -> str:
    """Speech-to-text via ElevenLabs Scribe v1. Returns "" on failure or when
    the key isn't set — caller decides whether to surface an error."""
    if not (ELEVENLABS_API_KEY and raw_audio):
        return ""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                "https://api.elevenlabs.io/v1/speech-to-text",
                headers={"xi-api-key": ELEVENLABS_API_KEY},
                files={"file": (filename, raw_audio, content_type)},
                data={"model_id": "scribe_v1"},
                timeout=30,
            )
            if r.status_code == 200:
                return r.json().get("text", "")
            print(f"[elevenlabs] STT error {r.status_code}: {r.text}")
    except Exception as e:
        print(f"[elevenlabs] STT exception: {e}")
    return ""


async def synthesize(text: str) -> str:
    """Text-to-speech → base64-encoded MP3. Returns "" if no key or on failure."""
    if not ELEVENLABS_API_KEY:
        return ""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}",
                headers={"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json"},
                json={
                    "text": text,
                    "model_id": "eleven_turbo_v2_5",
                    "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
                },
                timeout=30,
            )
            if r.status_code == 200:
                return base64.b64encode(r.content).decode()
            print(f"[elevenlabs] TTS error {r.status_code}: {r.text}")
    except Exception as e:
        print(f"[elevenlabs] TTS exception: {e}")
    return ""
