"""Thin async wrapper around Ollama's /api/generate. Centralizes model
selection, JSON-from-markdown extraction, and the startup readiness probe."""

import asyncio
import json

import httpx

from config import MODEL, OLLAMA_POLL_INTERVAL_SECONDS, OLLAMA_URL


async def wait_for_ollama() -> None:
    """Block until Ollama is reachable. Don't crash if the model is missing —
    voice search has a keyword fallback that works without an LLM."""
    print(f"[motzip-server] Checking Ollama at {OLLAMA_URL} ...")
    printed_hint = False
    async with httpx.AsyncClient() as client:
        while True:
            try:
                r = await client.get(f"{OLLAMA_URL}/api/tags", timeout=2)
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout):
                if not printed_hint:
                    print(f"\n[motzip-server] Ollama is not running at {OLLAMA_URL}.")
                    print("[motzip-server] Start it with `ollama serve` in a separate terminal.")
                    print("[motzip-server] Waiting for Ollama to come up ... (Ctrl+C to abort)")
                    printed_hint = True
                await asyncio.sleep(OLLAMA_POLL_INTERVAL_SECONDS)
                continue

            r.raise_for_status()
            models = [m["name"] for m in r.json().get("models", [])]
            if MODEL not in models:
                print(f"\n[motzip-server] WARNING: model '{MODEL}' not found in Ollama.")
                print(f"[motzip-server] Available models: {models or '(none)'}")
                print(f"[motzip-server] Run: ollama pull {MODEL}")
                print(f"[motzip-server] Keyword fallback will be used for voice search.")
                return

            print(f"[motzip-server] Ollama OK. Using model: {MODEL}")
            return


def _strip_codefence(raw: str) -> str:
    """Some prompts make gemma wrap JSON in ```json fences. Strip them."""
    raw = raw.strip()
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


async def generate_json(
    prompt: str,
    system: str,
    *,
    temperature: float = 0.1,
    num_predict: int = 200,
    timeout: float = 20,
) -> dict:
    """Call Ollama with a system+user prompt, parse the response as JSON.
    Raises on connection error, HTTP error, or invalid JSON — callers handle
    fallback logic (keyword matching, defaults, etc.)."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": MODEL,
                "prompt": prompt,
                "system": system,
                "stream": False,
                "options": {"temperature": temperature, "num_predict": num_predict},
            },
            timeout=timeout,
        )
        r.raise_for_status()
    return json.loads(_strip_codefence(r.json()["response"]))


async def generate_text(
    prompt: str,
    system: str,
    *,
    temperature: float = 0.3,
    num_predict: int = 150,
    timeout: float = 15,
) -> str:
    """Call Ollama for a freeform text response (no JSON parsing)."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": MODEL,
                "prompt": prompt,
                "system": system,
                "stream": False,
                "options": {"temperature": temperature, "num_predict": num_predict},
            },
            timeout=timeout,
        )
        r.raise_for_status()
    return r.json()["response"].strip()
