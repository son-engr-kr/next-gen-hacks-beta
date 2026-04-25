"""motzip-server: FastAPI app for the motzip restaurant discovery demo.

Composes three feature routers:
- places         — Google Places "search nearby" → normalized restaurants
- voice_search   — STT → LLM filter extraction → Places → TTS summary
- twilio_calls   — outbound AI phone calls with per-question iteration

Ollama is checked at startup but never blocks; voice_search and twilio_calls
have keyword fallbacks when the LLM is unavailable.
"""

import asyncio
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()  # before importing config so env vars are visible

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import CORS_ORIGINS
from llm import wait_for_ollama
import places
import twilio_calls
import voice_search


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Ollama is best-effort. /api/restaurants doesn't need it; voice + twilio
    # have keyword fallbacks. So we probe in the background instead of blocking.
    asyncio.create_task(wait_for_ollama())
    yield


app = FastAPI(title="motzip-server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(places.router)
app.include_router(voice_search.router)
app.include_router(twilio_calls.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
