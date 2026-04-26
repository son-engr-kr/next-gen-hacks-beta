"""Speech-to-Text + Text-to-Speech with two backends.

  • Primary: Google Cloud (Speech-to-Text + Text-to-Speech). Works on Cloud
    Run because it auths via the runtime service account and doesn't trigger
    abuse detectors on datacenter IPs.
  • Fallback: ElevenLabs (Scribe + Turbo). Used when the primary fails or when
    SPEECH_PROVIDER=elevenlabs (e.g. local dev, where ElevenLabs voices may
    sound nicer).

Public API stays the same: `transcribe(bytes, filename, content_type) -> str`
and `synthesize(text) -> str` (base64-encoded MP3).
"""

import asyncio
import base64

import httpx

from config import (
    ELEVENLABS_API_KEY,
    ELEVENLABS_VOICE_ID,
    GOOGLE_STT_ALT_LANGS,
    GOOGLE_STT_PRIMARY_LANG,
    GOOGLE_TTS_VOICE,
    SPEECH_PROVIDER,
)


# ── Google Cloud clients (lazy-init so import doesn't fail without creds) ──

_stt_client = None
_tts_client = None
_google_init_failed = False


def _get_stt_client():
    global _stt_client, _google_init_failed
    if _stt_client is not None:
        return _stt_client
    if _google_init_failed:
        return None
    try:
        from google.cloud import speech

        _stt_client = speech.SpeechClient()
        return _stt_client
    except Exception as e:
        print(f"[google] STT init failed ({e}); will use ElevenLabs fallback.")
        _google_init_failed = True
        return None


def _get_tts_client():
    global _tts_client, _google_init_failed
    if _tts_client is not None:
        return _tts_client
    if _google_init_failed:
        return None
    try:
        from google.cloud import texttospeech

        _tts_client = texttospeech.TextToSpeechClient()
        return _tts_client
    except Exception as e:
        print(f"[google] TTS init failed ({e}); will use ElevenLabs fallback.")
        _google_init_failed = True
        return None


# ── Google Cloud Speech-to-Text ─────────────────────────────────────────────


def _guess_encoding(content_type: str, filename: str):
    """MediaRecorder defaults to webm/opus on most browsers; iOS Safari may
    send mp4/aac. Map to Google's enum or return None (autodetect)."""
    from google.cloud import speech

    Enc = speech.RecognitionConfig.AudioEncoding
    ct = (content_type or "").lower()
    fn = (filename or "").lower()
    if "webm" in ct or fn.endswith(".webm"):
        return Enc.WEBM_OPUS
    if "ogg" in ct or fn.endswith(".ogg"):
        return Enc.OGG_OPUS
    if "wav" in ct or fn.endswith(".wav"):
        return Enc.LINEAR16
    if "flac" in ct or fn.endswith(".flac"):
        return Enc.FLAC
    if "mp4" in ct or "m4a" in ct or fn.endswith((".mp4", ".m4a")):
        return Enc.MP3  # close enough; Google sometimes auto-detects MP4 audio
    return Enc.ENCODING_UNSPECIFIED


async def _google_transcribe(raw_audio: bytes, filename: str, content_type: str) -> str:
    client = _get_stt_client()
    if client is None:
        raise RuntimeError("Google STT unavailable")
    from google.cloud import speech

    config = speech.RecognitionConfig(
        encoding=_guess_encoding(content_type, filename),
        # 0 = let the API infer from header (works for WEBM_OPUS / OGG_OPUS).
        sample_rate_hertz=0,
        language_code=GOOGLE_STT_PRIMARY_LANG,
        alternative_language_codes=[
            l.strip() for l in GOOGLE_STT_ALT_LANGS if l.strip()
        ],
        enable_automatic_punctuation=True,
    )
    audio = speech.RecognitionAudio(content=raw_audio)

    def _call():
        resp = client.recognize(config=config, audio=audio)
        return " ".join(
            r.alternatives[0].transcript for r in resp.results if r.alternatives
        ).strip()

    return await asyncio.to_thread(_call)


# ── Google Cloud Text-to-Speech ─────────────────────────────────────────────


async def _google_synthesize(text: str) -> str:
    client = _get_tts_client()
    if client is None:
        raise RuntimeError("Google TTS unavailable")
    from google.cloud import texttospeech

    synthesis_input = texttospeech.SynthesisInput(text=text)
    # Voice name like "en-US-Neural2-C" implies its language; pass it both ways
    # so the API accepts it without complaining.
    lang_code = "-".join(GOOGLE_TTS_VOICE.split("-")[:2]) or "en-US"
    voice = texttospeech.VoiceSelectionParams(
        language_code=lang_code,
        name=GOOGLE_TTS_VOICE,
    )
    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.MP3,
        speaking_rate=1.0,
    )

    def _call():
        resp = client.synthesize_speech(
            input=synthesis_input, voice=voice, audio_config=audio_config
        )
        return base64.b64encode(resp.audio_content).decode()

    return await asyncio.to_thread(_call)


# ── ElevenLabs fallback ─────────────────────────────────────────────────────


async def _elevenlabs_transcribe(
    raw_audio: bytes, filename: str, content_type: str
) -> str:
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


async def _elevenlabs_synthesize(text: str) -> str:
    if not ELEVENLABS_API_KEY:
        return ""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}",
                headers={
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Content-Type": "application/json",
                },
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


# ── Public API ──────────────────────────────────────────────────────────────


async def transcribe(raw_audio: bytes, filename: str, content_type: str) -> str:
    """Speech-to-text. Returns "" on failure — caller decides what to do."""
    if not raw_audio:
        return ""
    if SPEECH_PROVIDER == "google":
        try:
            text = await _google_transcribe(raw_audio, filename, content_type)
            if text:
                return text
            print("[speech] Google STT returned empty, trying ElevenLabs.")
        except Exception as e:
            print(f"[speech] Google STT failed ({e}); falling back to ElevenLabs.")
    return await _elevenlabs_transcribe(raw_audio, filename, content_type)


async def synthesize(text: str) -> str:
    """Text-to-speech → base64-encoded MP3. Returns "" on failure."""
    if not text:
        return ""
    if SPEECH_PROVIDER == "google":
        try:
            return await _google_synthesize(text)
        except Exception as e:
            print(f"[speech] Google TTS failed ({e}); falling back to ElevenLabs.")
    return await _elevenlabs_synthesize(text)
