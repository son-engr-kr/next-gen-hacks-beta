"""
motzip-server: Local LLM API for natural language restaurant search.

Requires Ollama running locally with Gemma:
  ollama pull gemma4:e4b-it-q4_K_M
  ollama serve
"""

import asyncio
import base64
import json
import os
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

OLLAMA_URL = "http://localhost:11434"
MODEL = os.getenv("MOTZIP_MODEL", "gemma4:e4b-it-q4_K_M")
OLLAMA_POLL_INTERVAL_SECONDS = 2


async def wait_for_ollama() -> None:
    """Block until Ollama is reachable and the configured model is available.

    Retries connection forever on I/O errors (Ollama may start after us).
    Exits immediately if Ollama is up but the model is missing — the user
    must run `ollama pull` to fix it, so waiting is pointless.
    """
    print(f"[motzip-server] Checking Ollama at {OLLAMA_URL} ...")
    printed_hint = False
    async with httpx.AsyncClient() as client:
        while True:
            try:
                r = await client.get(f"{OLLAMA_URL}/api/tags", timeout=2)
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout):
                if not printed_hint:
                    print()
                    print(f"[motzip-server] Ollama is not running at {OLLAMA_URL}.")
                    print("[motzip-server] Start it with one of:")
                    print("  - Launch 'Ollama' from the Start menu (Windows tray app)")
                    print("  - Run `ollama serve` in a separate terminal")
                    print("[motzip-server] Waiting for Ollama to come up ... (Ctrl+C to abort)")
                    printed_hint = True
                await asyncio.sleep(OLLAMA_POLL_INTERVAL_SECONDS)
                continue

            r.raise_for_status()
            models = [m["name"] for m in r.json().get("models", [])]
            if MODEL not in models:
                print()
                print(f"[motzip-server] ERROR: model '{MODEL}' is not installed in Ollama.")
                print(f"[motzip-server] Fix it with: ollama pull {MODEL}")
                print(f"[motzip-server] Available models: {models or '(none)'}")
                sys.exit(1)

            print(f"[motzip-server] Ollama OK. Using model: {MODEL}")
            return


@asynccontextmanager
async def lifespan(app: FastAPI):
    await wait_for_ollama()
    yield


app = FastAPI(title="motzip-server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CATEGORIES = [
    "burger", "pizza", "sushi", "ramen", "cafe",
    "mexican", "italian", "chinese", "thai",
    "steakhouse", "seafood", "bakery",
]

SYSTEM_PROMPT = f"""You are a restaurant search assistant. Given a user's natural language query, extract search filters as JSON.

Available categories: {", ".join(CATEGORIES)}

Respond ONLY with a JSON object (no markdown, no explanation):
{{
  "categories": ["category1"],  // matching categories, empty array if no preference
  "min_rating": 0,              // minimum rating 0-5, 0 if no preference
  "keywords": ["word1"],        // key terms from the query for name/description matching
  "vibe": ""                    // optional: "trending", "popular", "hidden_gem", or ""
}}"""


class SearchQuery(BaseModel):
    query: str


class SearchFilters(BaseModel):
    categories: list[str] = []
    min_rating: float = 0
    keywords: list[str] = []
    vibe: str = ""


@app.get("/health")
async def health():
    """Check if Ollama is reachable."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags", timeout=3)
            models = [m["name"] for m in r.json().get("models", [])]
            return {"status": "ok", "models": models}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


@app.post("/api/search", response_model=SearchFilters)
async def search(body: SearchQuery):
    """Parse natural language query into structured search filters."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": MODEL,
                "prompt": body.query,
                "system": SYSTEM_PROMPT,
                "stream": False,
                "options": {"temperature": 0.1, "num_predict": 200},
            },
            timeout=30,
        )
        r.raise_for_status()

    raw = r.json()["response"].strip()

    # Extract JSON from response (handle markdown wrapping)
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    parsed = json.loads(raw)
    return SearchFilters(**parsed)


class SummarizeRequest(BaseModel):
    name: str
    category: str
    rating: float
    review_count: int
    description: str


@app.post("/api/summarize")
async def summarize(body: SummarizeRequest):
    """Generate a short, engaging summary for a restaurant."""
    prompt = f"""Write a 2-sentence engaging summary for this restaurant:
Name: {body.name}
Category: {body.category}
Rating: {body.rating}/5 ({body.review_count} reviews)
Description: {body.description}

Be concise, vivid, and helpful. No quotes or prefixes."""

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.7, "num_predict": 100},
            },
            timeout=30,
        )
        r.raise_for_status()

    return {"summary": r.json()["response"].strip()}


REVIEW_ANALYSIS_PROMPT = """You are a restaurant review analyst. Given a list of user reviews for a restaurant, synthesize them into structured insights.

Respond ONLY with a JSON object (no markdown, no explanation), matching this exact shape:
{
  "summary": "one vivid sentence capturing the restaurant's identity based on the reviews",
  "sentiment": {
    "positive": 0.0,
    "neutral": 0.0,
    "negative": 0.0
  },
  "pros": ["top 3-5 things reviewers love, short phrases"],
  "cons": ["top 3-5 complaints or downsides, short phrases, empty array if none"],
  "signature_dishes": ["dishes mentioned repeatedly, lowercase"],
  "vibe": "comma-separated atmosphere adjectives",
  "best_for": ["audiences this suits: e.g. date night, solo, family, tourists"],
  "red_flags": ["serious recurring concerns like hygiene, rude service, empty if none"]
}

Rules:
- sentiment values must sum to 1.0
- pros and cons must be distinct insights, not restatements
- signature_dishes only includes dishes mentioned by multiple reviewers when possible
- red_flags is strict: only include if multiple reviews raise the same serious issue
- Do not invent facts not supported by the reviews"""


class ReviewAnalysisRequest(BaseModel):
    restaurant_name: str = ""
    category: str = ""
    reviews: list[str]


class Sentiment(BaseModel):
    positive: float
    neutral: float
    negative: float


class ReviewAnalysis(BaseModel):
    summary: str
    sentiment: Sentiment
    pros: list[str] = []
    cons: list[str] = []
    signature_dishes: list[str] = []
    vibe: str = ""
    best_for: list[str] = []
    red_flags: list[str] = []
    review_count: int


@app.post("/api/analyze-reviews", response_model=ReviewAnalysis)
async def analyze_reviews(body: ReviewAnalysisRequest):
    """Synthesize a list of reviews into structured restaurant insights."""
    assert body.reviews, "reviews list must not be empty"
    assert all(r.strip() for r in body.reviews), "reviews must not contain empty strings"

    context_lines = []
    if body.restaurant_name:
        context_lines.append(f"Restaurant: {body.restaurant_name}")
    if body.category:
        context_lines.append(f"Category: {body.category}")
    context = "\n".join(context_lines)

    numbered = "\n".join(f"{i + 1}. {r.strip()}" for i, r in enumerate(body.reviews))
    user_prompt = f"{context}\n\nReviews:\n{numbered}" if context else f"Reviews:\n{numbered}"

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": MODEL,
                "prompt": user_prompt,
                "system": REVIEW_ANALYSIS_PROMPT,
                "stream": False,
                "options": {"temperature": 0.2, "num_predict": 700},
            },
            timeout=120,
        )
        r.raise_for_status()

    raw = r.json()["response"].strip()

    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    parsed = json.loads(raw)
    parsed["review_count"] = len(body.reviews)
    return ReviewAnalysis(**parsed)


FOOD_ANALYSIS_PROMPT = """Analyze this food image and respond ONLY with a JSON object (no markdown, no explanation):
{
  "dish_name": "best guess of the dish name",
  "category": "one of: burger, pizza, sushi, ramen, cafe, mexican, italian, chinese, thai, steakhouse, seafood, bakery, other",
  "ingredients": ["visible", "ingredients"],
  "description": "one vivid sentence describing the dish",
  "tags": ["short", "descriptive", "tags"]
}"""


class FoodAnalysis(BaseModel):
    dish_name: str
    category: str
    ingredients: list[str] = []
    description: str
    tags: list[str] = []


@app.post("/api/analyze-food", response_model=FoodAnalysis)
async def analyze_food(image: UploadFile = File(...)):
    """Analyze a food image using Gemma 3's vision capability."""
    raw_bytes = await image.read()
    assert raw_bytes, "empty image upload"
    b64 = base64.b64encode(raw_bytes).decode("ascii")

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": MODEL,
                "prompt": FOOD_ANALYSIS_PROMPT,
                "images": [b64],
                "stream": False,
                "options": {"temperature": 0.2, "num_predict": 300},
            },
            timeout=120,
        )
        r.raise_for_status()

    raw = r.json()["response"].strip()

    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    parsed = json.loads(raw)
    return FoodAnalysis(**parsed)


class ImageCaptionRequest(BaseModel):
    prompt: str = "Describe this image in detail."


@app.post("/api/vision")
async def vision(
    image: UploadFile = File(...),
    prompt: str = Form("Describe this image in detail."),
):
    """Freeform vision endpoint: ask any question about an uploaded image."""
    raw_bytes = await image.read()
    assert raw_bytes, "empty image upload"
    b64 = base64.b64encode(raw_bytes).decode("ascii")

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": MODEL,
                "prompt": prompt,
                "images": [b64],
                "stream": False,
                "options": {"temperature": 0.7, "num_predict": 400},
            },
            timeout=120,
        )
        r.raise_for_status()

    return {"response": r.json()["response"].strip()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
