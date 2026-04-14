"""
motzip-server: Local LLM API for natural language restaurant search.

Requires Ollama running locally with Gemma:
  ollama pull gemma4:e4b-it-q4_K_M
  ollama serve
"""

import asyncio
import base64
import json
import math
import os
import sys
from dotenv import load_dotenv
load_dotenv()
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, UploadFile, Form, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

OLLAMA_URL = "http://localhost:11434"
ELEVENLABS_API_KEY  = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")  # Sarah

# Twilio credentials
TWILIO_ACCOUNT_SID   = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN    = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_PHONE_NUMBER  = os.getenv("TWILIO_PHONE_NUMBER", "")
NGROK_URL            = os.getenv("NGROK_URL", "http://localhost:8000")
MODEL = os.getenv("MOTZIP_MODEL", "gemma3:4b")
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
                print(f"[motzip-server] WARNING: model '{MODEL}' not found in Ollama.")
                print(f"[motzip-server] Available models: {models or '(none)'}")
                print(f"[motzip-server] Run: ollama pull {MODEL}")
                print(f"[motzip-server] Keyword fallback will be used for voice search.")
                return

            print(f"[motzip-server] Ollama OK. Using model: {MODEL}")
            return


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ollama is only needed for LLM endpoints (/api/search, /api/summarize, etc.)
    # /api/restaurants (Google Places) works without Ollama, so we don't block startup.
    asyncio.create_task(wait_for_ollama())
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


GOOGLE_PLACES_API_KEY = os.getenv("GOOGLE_PLACES_API_KEY", "")

GOOGLE_TYPE_MAP: dict[str, str] = {
    "burger_restaurant": "burger",
    "pizza_restaurant": "pizza",
    "sushi_restaurant": "sushi",
    "ramen_restaurant": "ramen",
    "japanese_restaurant": "sushi",
    "cafe": "cafe",
    "coffee_shop": "cafe",
    "bakery": "bakery",
    "mexican_restaurant": "mexican",
    "italian_restaurant": "italian",
    "chinese_restaurant": "chinese",
    "thai_restaurant": "thai",
    "steak_house": "steakhouse",
    "seafood_restaurant": "seafood",
    "american_restaurant": "steakhouse",
    "sandwich_shop": "burger",
    "fast_food_restaurant": "burger",
}


class PlaceRestaurant(BaseModel):
    id: str
    name: str
    category: str
    lat: float
    lng: float
    rating: float
    reviewCount: int
    isTrending: bool
    description: str
    topReview: str
    isWheelchairAccessible: bool = False
    parkingType: str | None = None
    isOpenNow: bool | None = None
    hasLiveMusic: bool = False
    allowsDogs: bool = False
    servesCocktails: bool = False
    priceLevel: str | None = None
    phone: str | None = None


def _map_types_to_category(types: list[str]) -> str:
    for t in types:
        if t in GOOGLE_TYPE_MAP:
            return GOOGLE_TYPE_MAP[t]
    return "cafe"


@app.get("/api/restaurants", response_model=list[PlaceRestaurant])
async def get_restaurants(
    lat: float = 42.355,
    lng: float = -71.058,
    radius: float = 3000,
):
    """Fetch nearby restaurants from Google Places API (New).

    Makes 3 parallel requests targeting different cuisine groups so we get
    ~50-60 unique buildings instead of the 20-per-request limit.
    """
    if not GOOGLE_PLACES_API_KEY:
        return []

    field_mask = ",".join([
        "places.id",
        "places.displayName",
        "places.types",
        "places.location",
        "places.rating",
        "places.userRatingCount",
        "places.editorialSummary",
        "places.reviews",
        "places.accessibilityOptions",
        "places.parkingOptions",
        "places.currentOpeningHours",
        "places.liveMusic",
        "places.allowsDogs",
        "places.servesCocktails",
        "places.priceLevel",
        "places.nationalPhoneNumber",
    ])

    # Three groups so each request returns distinct cuisine clusters
    TYPE_GROUPS = [
        ["restaurant", "cafe", "bakery"],
        ["pizza_restaurant", "sushi_restaurant", "ramen_restaurant",
         "italian_restaurant", "chinese_restaurant", "thai_restaurant"],
        ["seafood_restaurant", "mexican_restaurant", "burger_restaurant",
         "steak_house", "coffee_shop"],
    ]

    async def _fetch(types: list[str]) -> list[dict]:
        try:
            async with httpx.AsyncClient() as client:
                r = await client.post(
                    "https://places.googleapis.com/v1/places:searchNearby",
                    headers={
                        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
                        "X-Goog-FieldMask": field_mask,
                        "Content-Type": "application/json",
                    },
                    json={
                        "locationRestriction": {
                            "circle": {
                                "center": {"latitude": lat, "longitude": lng},
                                "radius": radius,
                            }
                        },
                        "includedTypes": types,
                        "maxResultCount": 20,
                        "rankPreference": "POPULARITY",
                    },
                    timeout=10,
                )
                r.raise_for_status()
                return r.json().get("places", [])
        except Exception:
            return []

    batches = await asyncio.gather(*[_fetch(types) for types in TYPE_GROUPS])

    # Deduplicate by place ID across all batches
    seen_ids: set[str] = set()
    places: list[dict] = []
    for batch in batches:
        for p in batch:
            pid = p.get("id", "")
            if pid and pid not in seen_ids:
                seen_ids.add(pid)
                places.append(p)

    # Pre-compute average review count for trending threshold
    avg_count = sum(p.get("userRatingCount", 0) for p in places) / max(len(places), 1)

    results: list[PlaceRestaurant] = []

    for p in places:
        location = p.get("location", {})
        place_lat = location.get("latitude", lat)
        place_lng = location.get("longitude", lng)
        rating = float(p.get("rating", 3.0))
        review_count = int(p.get("userRatingCount", 0))
        types = p.get("types", [])
        category = _map_types_to_category(types)

        editorial = p.get("editorialSummary", {})
        description = editorial.get("text", "") if editorial else ""

        reviews = p.get("reviews", [])
        top_review = ""
        if reviews:
            top_review = reviews[0].get("text", {}).get("text", "") if reviews[0].get("text") else ""

        # Trending = high rating AND above-average review count
        is_trending = rating >= 4.3 and review_count >= avg_count * 1.5

        # Accessibility
        accessibility = p.get("accessibilityOptions") or {}
        is_wheelchair = bool(
            accessibility.get("wheelchairAccessibleEntrance")
            or accessibility.get("wheelchairAccessibleSeating")
            or accessibility.get("wheelchairAccessibleRestroom")
        )

        # Parking
        parking_opts = p.get("parkingOptions") or {}
        has_valet = bool(parking_opts.get("valetParking"))
        has_free = bool(
            parking_opts.get("freeParkingLot")
            or parking_opts.get("freeStreetParking")
            or parking_opts.get("freeGarageParking")
        )
        has_paid = bool(
            parking_opts.get("paidParkingLot")
            or parking_opts.get("paidGarageParking")
        )
        if has_valet:
            parking_type = "valet"
        elif has_free:
            parking_type = "free"
        elif has_paid:
            parking_type = "paid"
        else:
            parking_type = None

        # Opening hours
        opening_hours = p.get("currentOpeningHours") or {}
        is_open_now = opening_hours.get("openNow")  # True / False / None

        # Amenities
        has_live_music = bool(p.get("liveMusic"))
        allows_dogs = bool(p.get("allowsDogs"))
        serves_cocktails = bool(p.get("servesCocktails"))
        price_level = p.get("priceLevel")  # e.g. "MODERATE"

        results.append(PlaceRestaurant(
            id=p.get("id", f"place_{len(results)}"),
            name=p.get("displayName", {}).get("text", "Unknown"),
            category=category,
            lat=place_lat,
            lng=place_lng,
            rating=round(rating, 1),
            reviewCount=review_count,
            isTrending=is_trending,
            description=description,
            topReview=top_review,
            isWheelchairAccessible=is_wheelchair,
            parkingType=parking_type,
            isOpenNow=is_open_now,
            hasLiveMusic=has_live_music,
            allowsDogs=allows_dogs,
            servesCocktails=serves_cocktails,
            priceLevel=price_level,
            phone=p.get("nationalPhoneNumber"),
        ))

    return results


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


# ── Voice Search ──────────────────────────────────────────────────────────────

PRICE_LEVEL_MAX_USD: dict[str | None, float] = {
    None: 9999,
    "PRICE_LEVEL_FREE": 0,
    "PRICE_LEVEL_INEXPENSIVE": 15,
    "PRICE_LEVEL_MODERATE": 35,
    "PRICE_LEVEL_EXPENSIVE": 70,
    "PRICE_LEVEL_VERY_EXPENSIVE": 200,
}

VOICE_QUERY_PROMPT = """You are a restaurant search assistant. Extract search filters from the user's natural language query (supports English and Korean).

Respond ONLY with a valid JSON object (no markdown):
{
  "categories": [],
  "max_price_per_person": 0,
  "min_rating": 0.0,
  "distance_minutes": 0,
  "vibe_keywords": [],
  "party_size": 2,
  "keywords": [],
  "requires_parking": false,
  "requires_wheelchair": false,
  "requires_dogs": false,
  "requires_cocktails": false,
  "requires_live_music": false
}

Field rules:
- categories: subset of [burger, pizza, sushi, ramen, cafe, mexican, italian, chinese, thai, steakhouse, seafood, bakery], empty = any
- max_price_per_person: max USD per person (e.g. 30), 0 = no limit
- min_rating: 0-5, 0 = no preference
- distance_minutes: max walking minutes, 0 = no limit
- vibe_keywords: atmosphere tags like "romantic", "date night", "quiet", "cozy", "lively", "upscale", "casual"
- party_size: number of diners
- keywords: any other terms
- requires_parking: true if user mentions parking (주차, parking, 차)
- requires_wheelchair: true if user mentions wheelchair or accessibility (휠체어, 장애인)
- requires_dogs: true if user mentions dogs/pets (강아지, 반려견, pet)
- requires_cocktails: true if user mentions cocktails/alcohol (칵테일, 술, cocktail)
- requires_live_music: true if user mentions live music (라이브, 공연, live music)"""


def _haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


class VoiceFilters(BaseModel):
    categories: list[str] = []
    max_price_per_person: float = 0
    min_rating: float = 0
    distance_minutes: float = 0
    vibe_keywords: list[str] = []
    party_size: int = 2
    keywords: list[str] = []
    requires_parking: bool = False
    requires_wheelchair: bool = False
    requires_dogs: bool = False
    requires_cocktails: bool = False
    requires_live_music: bool = False


class VoiceSearchResponse(BaseModel):
    transcript: str
    filters: VoiceFilters
    restaurants: list[PlaceRestaurant]
    audio_base64: str


@app.post("/api/voice-search", response_model=VoiceSearchResponse)
async def voice_search(
    audio: UploadFile = File(...),
    user_lat: float = Form(42.355),
    user_lng: float = Form(-71.058),
):
    """Full pipeline: ElevenLabs STT → Ollama LLM filter extraction → Places search → filter → ElevenLabs TTS."""

    # ── Step 1: ElevenLabs STT ────────────────────────────────────────────────
    raw_audio = await audio.read()
    transcript = ""

    if ELEVENLABS_API_KEY and raw_audio:
        try:
            async with httpx.AsyncClient() as client:
                r = await client.post(
                    "https://api.elevenlabs.io/v1/speech-to-text",
                    headers={"xi-api-key": ELEVENLABS_API_KEY},
                    files={"file": (audio.filename or "audio.webm", raw_audio, audio.content_type or "audio/webm")},
                    data={"model_id": "scribe_v1"},
                    timeout=30,
                )
                if r.status_code == 200:
                    transcript = r.json().get("text", "")
                else:
                    print(f"[voice] STT error {r.status_code}: {r.text}")
        except Exception as e:
            print(f"[voice] STT error: {e}")

    if not transcript:
        return VoiceSearchResponse(transcript="", filters=VoiceFilters(), restaurants=[], audio_base64="")

    # ── Step 2: LLM → structured filters (with keyword fallback) ─────────────
    filters = VoiceFilters()
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": MODEL,
                    "prompt": transcript,
                    "system": VOICE_QUERY_PROMPT,
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 300},
                },
                timeout=10,
            )
            r.raise_for_status()
        raw = r.json()["response"].strip()
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        filters = VoiceFilters(**json.loads(raw))
        print(f"[voice] LLM filters: {filters}")
    except Exception as e:
        print(f"[voice] LLM unavailable ({e}), using keyword fallback")
        # Keyword-based fallback — works without Ollama
        t = transcript.lower()
        filters = VoiceFilters(
            requires_parking=any(w in t for w in ["주차", "parking", "차 가지고", "차로"]),
            requires_wheelchair=any(w in t for w in ["휠체어", "장애인", "wheelchair", "accessible"]),
            requires_dogs=any(w in t for w in ["강아지", "반려견", "dog", "pet"]),
            requires_cocktails=any(w in t for w in ["칵테일", "cocktail", "술", "bar"]),
            requires_live_music=any(w in t for w in ["라이브", "공연", "live music", "band"]),
            min_rating=4.0 if any(w in t for w in ["맛있", "좋은", "훌륭", "최고", "good", "great", "best"]) else 0,
        )

    # ── Step 3: Fetch restaurants near user ───────────────────────────────────
    all_places = await get_restaurants(lat=user_lat, lng=user_lng)

    # ── Step 4: Apply filters ─────────────────────────────────────────────────
    matched: list[PlaceRestaurant] = []
    for place in all_places:
        # Distance
        if filters.distance_minutes > 0:
            dist_m   = _haversine_meters(user_lat, user_lng, place.lat, place.lng)
            walk_min = dist_m / 80  # ~80 m/min walking
            if walk_min > filters.distance_minutes:
                continue

        # Price
        if filters.max_price_per_person > 0:
            if PRICE_LEVEL_MAX_USD.get(place.priceLevel, 9999) > filters.max_price_per_person:
                continue

        # Rating
        if filters.min_rating > 0 and place.rating < filters.min_rating:
            continue

        # Category
        if filters.categories and place.category not in filters.categories:
            continue

        # Vibe keyword match against description + top review
        if filters.vibe_keywords:
            blob = (place.description + " " + place.topReview).lower()
            if not any(kw.lower() in blob for kw in filters.vibe_keywords):
                continue

        # Parking
        if filters.requires_parking and not place.parkingType:
            continue

        # Wheelchair
        if filters.requires_wheelchair and not place.isWheelchairAccessible:
            continue

        # Dogs
        if filters.requires_dogs and not place.allowsDogs:
            continue

        # Cocktails
        if filters.requires_cocktails and not place.servesCocktails:
            continue

        # Live music
        if filters.requires_live_music and not place.hasLiveMusic:
            continue

        matched.append(place)

    # Sort matched by rating desc
    matched.sort(key=lambda x: x.rating, reverse=True)

    # ── Step 5: TTS response ──────────────────────────────────────────────────
    if matched:
        top = matched[:3]
        names = ", ".join(r.name for r in top)
        extra = f" 외 {len(matched) - 3}곳" if len(matched) > 3 else ""
        response_text = (
            f"조건에 맞는 식당이 {len(matched)}곳 있습니다. "
            f"추천 순위: {names}{extra}. "
            f"지도에서 확인해보세요!"
        )
    else:
        response_text = "조건에 맞는 식당을 찾지 못했습니다. 조건을 조금 완화해보세요."

    audio_base64 = ""
    if ELEVENLABS_API_KEY:
        try:
            async with httpx.AsyncClient() as client:
                r = await client.post(
                    f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}",
                    headers={"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json"},
                    json={
                        "text": response_text,
                        "model_id": "eleven_turbo_v2_5",
                        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
                    },
                    timeout=30,
                )
                if r.status_code == 200:
                    audio_base64 = base64.b64encode(r.content).decode()
        except Exception as e:
            print(f"[voice] TTS error: {e}")

    return VoiceSearchResponse(
        transcript=transcript,
        filters=filters,
        restaurants=matched,
        audio_base64=audio_base64,
    )


# ── Twilio Reservations ────────────────────────────────────────────────────────

# In-memory call state (production would use Redis / DB)
_call_state: dict[str, dict] = {}  # call_sid → {restaurant_name, response_text, status}

TWILIO_GATHER_PROMPT = """You are summarizing a restaurant's response about reservations or wait times.
Extract the key info and respond ONLY with a JSON object:
{
  "can_reserve": true,
  "wait_minutes": 0,
  "notes": "any additional info the restaurant said"
}
- can_reserve: true if they accept reservations or will take your name, false if walk-in only
- wait_minutes: estimated wait in minutes (0 = unknown or no wait)
- notes: any useful details"""


class CallRestaurantRequest(BaseModel):
    restaurant_name: str
    phone: str
    party_size: int = 2
    time_preference: str = "as soon as possible"


class CallRestaurantResponse(BaseModel):
    call_sid: str
    status: str


class CallResultResponse(BaseModel):
    call_sid: str
    status: str  # "initiated" | "in-progress" | "completed" | "failed"
    can_reserve: bool | None = None
    wait_minutes: int | None = None
    notes: str = ""
    raw_speech: str = ""


@app.post("/api/call-restaurant", response_model=CallRestaurantResponse)
async def call_restaurant(body: CallRestaurantRequest):
    """Initiate an outbound Twilio call to a restaurant to ask about availability."""
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN or not TWILIO_PHONE_NUMBER:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Twilio credentials not configured")

    from twilio.rest import Client as TwilioClient  # type: ignore
    client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

    twiml_url = (
        f"{NGROK_URL}/api/twilio/voice"
        f"?restaurant_name={body.restaurant_name.replace(' ', '+')}"
        f"&party_size={body.party_size}"
        f"&time_preference={body.time_preference.replace(' ', '+')}"
    )

    call = client.calls.create(
        to=body.phone,
        from_=TWILIO_PHONE_NUMBER,
        url=twiml_url,
        status_callback=f"{NGROK_URL}/api/twilio/status",
        status_callback_method="POST",
        timeout=30,
    )

    _call_state[call.sid] = {
        "restaurant_name": body.restaurant_name,
        "status": "initiated",
        "can_reserve": None,
        "wait_minutes": None,
        "notes": "",
        "raw_speech": "",
    }

    return CallRestaurantResponse(call_sid=call.sid, status="initiated")


@app.post("/api/twilio/voice")
async def twilio_voice(
    restaurant_name: str = "the restaurant",
    party_size: int = 2,
    time_preference: str = "as soon as possible",
):
    """TwiML handler — called by Twilio when the restaurant picks up."""
    from fastapi.responses import PlainTextResponse

    greeting = (
        f"Hello! I'm calling on behalf of a customer who would like to make a reservation "
        f"or ask about the current wait time for a party of {party_size}, {time_preference}. "
        f"Could you please let me know if a reservation is available or what the current wait time is?"
    )

    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="{NGROK_URL}/api/twilio/gather" method="POST"
          speechTimeout="auto" timeout="10" language="en-US">
    <Say voice="Polly.Joanna">{greeting}</Say>
  </Gather>
  <Say voice="Polly.Joanna">I did not receive a response. Thank you for your time. Goodbye.</Say>
</Response>"""

    return PlainTextResponse(content=twiml, media_type="application/xml")


@app.post("/api/twilio/gather")
async def twilio_gather(
    CallSid: str = Form(""),
    SpeechResult: str = Form(""),
):
    """Twilio posts here after gathering the restaurant's speech response."""
    from fastapi.responses import PlainTextResponse

    raw_speech = SpeechResult.strip()
    call_info = _call_state.get(CallSid, {})
    call_info["raw_speech"] = raw_speech
    call_info["status"] = "completed"

    # Parse the restaurant's response with LLM
    parsed = {"can_reserve": None, "wait_minutes": 0, "notes": raw_speech}
    if raw_speech:
        try:
            async with httpx.AsyncClient() as client:
                r = await client.post(
                    f"{OLLAMA_URL}/api/generate",
                    json={
                        "model": MODEL,
                        "prompt": raw_speech,
                        "system": TWILIO_GATHER_PROMPT,
                        "stream": False,
                        "options": {"temperature": 0.1, "num_predict": 200},
                    },
                    timeout=20,
                )
                r.raise_for_status()
            raw = r.json()["response"].strip()
            if "```" in raw:
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            parsed = json.loads(raw)
        except Exception as e:
            print(f"[twilio] LLM parse error: {e}")

    call_info["can_reserve"] = parsed.get("can_reserve")
    call_info["wait_minutes"] = int(parsed.get("wait_minutes") or 0)
    call_info["notes"] = parsed.get("notes", raw_speech)
    _call_state[CallSid] = call_info

    farewell = "Thank you so much for the information! Have a great day. Goodbye."
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">{farewell}</Say>
  <Hangup/>
</Response>"""

    return PlainTextResponse(content=twiml, media_type="application/xml")


@app.post("/api/twilio/status")
async def twilio_status(CallSid: str = Form(""), CallStatus: str = Form("")):
    """Twilio status callback to track call lifecycle."""
    if CallSid in _call_state:
        if CallStatus in ("failed", "busy", "no-answer", "canceled"):
            _call_state[CallSid]["status"] = CallStatus
    return {"ok": True}


@app.get("/api/call-result/{call_sid}", response_model=CallResultResponse)
async def call_result(call_sid: str):
    """Poll for the result of a Twilio call."""
    info = _call_state.get(call_sid)
    if not info:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Call not found")

    return CallResultResponse(
        call_sid=call_sid,
        status=info.get("status", "initiated"),
        can_reserve=info.get("can_reserve"),
        wait_minutes=info.get("wait_minutes"),
        notes=info.get("notes", ""),
        raw_speech=info.get("raw_speech", ""),
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
