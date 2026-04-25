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
from fastapi import FastAPI, File, UploadFile, Form, Query, Response
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
TWILIO_TEST_TO       = os.getenv("TWILIO_TEST_TO", "")  # override 'to' number for trial testing
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
    text_query: str = Form(""),
):
    """Full pipeline: (STT or text) → Ollama LLM filter extraction → Places search → filter → ElevenLabs TTS."""

    # ── Step 1: transcript 확보 (텍스트 직접 입력 or ElevenLabs STT) ──────────
    transcript = text_query.strip()

    if not transcript:
        raw_audio = await audio.read()
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
        extra = f" and {len(matched) - 3} more" if len(matched) > 3 else ""
        response_text = (
            f"Found {len(matched)} restaurants matching your filters. "
            f"Top picks: {names}{extra}. "
            f"Check them out on the map!"
        )
    else:
        response_text = "No restaurants matched your filters. Try loosening the criteria."

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


def _keyword_parse_gather(speech: str) -> dict:
    """Heuristic parse when Ollama is unavailable. EN/KO keywords."""
    import re
    text = speech.lower()

    # Wait time: pull a number near "minute(s)" or "분"
    wait = 0
    m = re.search(r"(\d+)\s*(?:to\s*\d+\s*)?(?:minutes?|min|mins|분)", text)
    if m:
        wait = int(m.group(1))

    pos = ["yes", "yeah", "yep", "sure", "of course", "absolutely", "available",
           "we have", "we can", "open table", "no wait", "right away", "come in",
           "네", "예", "가능", "있어요", "있습니다", "예약돼", "오세요", "환영"]
    neg = ["no", "sorry", "can't", "cannot", "fully booked", "full", "no reservations",
           "walk-in only", "walk in only", "first come", "no availability",
           "안 돼", "안돼", "불가", "예약 안", "워크인", "꽉 찼"]

    pos_hit = any(w in text for w in pos)
    neg_hit = any(w in text for w in neg)

    if pos_hit and not neg_hit:
        can_reserve = True
    elif neg_hit and not pos_hit:
        can_reserve = False
    else:
        can_reserve = None

    return {"can_reserve": can_reserve, "wait_minutes": wait, "notes": speech}


# Catalog of structured questions the caller can ask. Each entry produces
# one segment in the phone script and one answer slot in the result.
QUESTION_CATALOG: dict[str, dict] = {
    "reservation": {
        "label": "Reservation",
        "prompt": "is a reservation available for a party of {party_size} right now, or what is the current wait time",
    },
    "wheelchair": {
        "label": "Wheelchair access",
        "prompt": "is the restaurant wheelchair accessible",
    },
    "vegetarian": {
        "label": "Vegetarian options",
        "prompt": "do you offer vegetarian or vegan menu options",
    },
    "outdoor": {
        "label": "Outdoor seating",
        "prompt": "is outdoor seating available right now",
    },
    "dogs": {
        "label": "Allows dogs",
        "prompt": "do you allow dogs",
    },
    "parking": {
        "label": "Parking",
        "prompt": "what parking options do you have nearby",
    },
    "music": {
        "label": "Live music",
        "prompt": "do you have live music tonight",
    },
}


class CallRestaurantRequest(BaseModel):
    restaurant_name: str
    phone: str
    party_size: int = 2
    time_preference: str = "as soon as possible"
    questions: list[str] = []      # keys from QUESTION_CATALOG
    custom_question: str = ""      # freeform extra question (any language)


class CallRestaurantResponse(BaseModel):
    call_sid: str
    status: str


class QuestionAnswer(BaseModel):
    value: bool | None = None  # True=yes/available, False=no, None=unaddressed
    details: str = ""
    wait_minutes: int | None = None  # only meaningful for "reservation"


class CallResultResponse(BaseModel):
    call_sid: str
    status: str  # "initiated" | "in-progress" | "parsing" | "completed" | "failed"
    answers: dict[str, QuestionAnswer] = {}
    raw_speech: str = ""
    # Legacy fields (RestaurantPanel single-call view) — derived from
    # answers["reservation"] if present.
    can_reserve: bool | None = None
    wait_minutes: int | None = None
    notes: str = ""


async def _translate_to_english(text: str) -> str:
    """Translate a non-English question to a polite English phone question."""
    try:
        async with httpx.AsyncClient() as client_http:
            r = await client_http.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": MODEL,
                    "prompt": text,
                    "system": (
                        "Translate the user's question into a polite, natural English "
                        "question that one would ask a restaurant on the phone. "
                        "Output ONLY the translated question — one sentence, no quotes, "
                        "no preamble, no explanation."
                    ),
                    "stream": False,
                    "options": {"temperature": 0.2, "num_predict": 100},
                },
                timeout=15,
            )
            r.raise_for_status()
            return r.json()["response"].strip().strip('"“”‘’\'`')
    except Exception as e:
        print(f"[twilio] translation error: {e}, using original text")
        return text


@app.post("/api/call-restaurant", response_model=CallRestaurantResponse)
async def call_restaurant(body: CallRestaurantRequest):
    """Initiate an outbound Twilio call. The caller picks which structured
    questions to ask via `questions` (keys from QUESTION_CATALOG) and may add a
    freeform `custom_question`. Both kinds end up in the phone script and are
    parsed back into per-key answers when the restaurant responds.
    """
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN or not TWILIO_PHONE_NUMBER:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Twilio credentials not configured")

    from twilio.rest import Client as TwilioClient  # type: ignore
    import urllib.parse
    client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

    # Resolve question keys to (key, prompt_text) pairs in catalog order.
    ordered: list[tuple[str, str]] = []
    asked_keys: list[str] = []
    for k in body.questions:
        spec = QUESTION_CATALOG.get(k)
        if not spec:
            continue
        ordered.append((k, spec["prompt"].format(party_size=body.party_size)))
        asked_keys.append(k)

    # Translate custom question if non-ASCII (Korean etc.); pass through if English.
    custom_en = ""
    raw_extra = body.custom_question.strip()
    if raw_extra:
        if any(ord(c) > 127 for c in raw_extra):
            custom_en = await _translate_to_english(raw_extra)
            print(f"[twilio] translated custom: {custom_en}")
        else:
            custom_en = raw_extra
        # Strip trailing punctuation so our script template can re-add it
        custom_en = custom_en.rstrip(".?!").strip()
        ordered.append(("custom", custom_en))
        asked_keys.append("custom")

    # Default to reservation if nothing was asked — keeps single-call panels working.
    if not ordered:
        ordered.append(("reservation", QUESTION_CATALOG["reservation"]["prompt"].format(party_size=body.party_size)))
        asked_keys.append("reservation")

    print(f"[twilio] questions for call: {asked_keys}")
    # Per-step iteration: voice endpoint reads CallSid + step from the request,
    # looks up the question list in _call_state. No script in the URL anymore.
    twiml_url = f"{NGROK_URL}/api/twilio/voice?step=0"

    to_number = TWILIO_TEST_TO if TWILIO_TEST_TO else body.phone
    call = client.calls.create(
        to=to_number,
        from_=TWILIO_PHONE_NUMBER,
        url=twiml_url,
        status_callback=f"{NGROK_URL}/api/twilio/status",
        status_callback_method="POST",
        timeout=30,
    )

    _call_state[call.sid] = {
        "restaurant_name": body.restaurant_name,
        "status": "initiated",
        "asked_keys": asked_keys,
        "asked_questions": dict(ordered),  # key → question text (for LLM context)
        "custom_label": custom_en,
        "answers": {},
        "raw_speech": "",
    }

    return CallRestaurantResponse(call_sid=call.sid, status="initiated")


def _xml_escape(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
              .replace('"', "&quot;").replace("'", "&apos;"))


def _step_say(step: int, question_text: str) -> str:
    """Speech bubble for a single step. First step adds the greeting; later steps acknowledge."""
    if step == 0:
        return (
            f"Hi, I'm calling on behalf of a customer. I have a few quick questions. "
            f"First, {question_text}?"
        )
    return f"Got it, thank you. Next, {question_text}?"


@app.post("/api/twilio/voice")
async def twilio_voice(step: int = Query(0), CallSid: str = Form("")):
    """TwiML handler — Twilio fetches this when the restaurant picks up.
    With per-question iteration, this is only used for step=0 (the very first
    question). Subsequent questions are chained from /api/twilio/gather.
    """
    from fastapi.responses import PlainTextResponse

    info = _call_state.get(CallSid) or {}
    asked_keys: list[str] = info.get("asked_keys") or ["reservation"]
    asked_questions: dict[str, str] = info.get("asked_questions") or {
        "reservation": QUESTION_CATALOG["reservation"]["prompt"].format(party_size=2)
    }

    if step >= len(asked_keys):
        twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="Polly.Joanna-Neural">Sorry, no questions configured. Goodbye.</Say><Hangup/></Response>"""
        return PlainTextResponse(content=twiml, media_type="application/xml")

    info["status"] = f"asking 1/{len(asked_keys)}"
    _call_state[CallSid] = info

    key = asked_keys[step]
    question_text = asked_questions[key]
    say_text = _xml_escape(_step_say(step, question_text))

    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="{NGROK_URL}/api/twilio/gather?step={step}" method="POST"
          speechTimeout="auto" timeout="10" language="en-US">
    <Say voice="Polly.Joanna-Neural">{say_text}</Say>
  </Gather>
  <Say voice="Polly.Joanna-Neural">I did not receive a response. Thank you. Goodbye.</Say>
</Response>"""

    return PlainTextResponse(content=twiml, media_type="application/xml")


async def _parse_single_answer(key: str, question_text: str, speech: str) -> dict:
    """LLM-parse one restaurant utterance against one specific question."""
    if not speech:
        return {"value": None, "details": ""}

    extra_field = (
        ", \"wait_minutes\": <integer if a wait time was mentioned, otherwise omit>"
        if key == "reservation" else ""
    )
    system_prompt = (
        "You are parsing a restaurant staff member's spoken reply to ONE question.\n"
        f"Question that was asked: \"{question_text}\"\n\n"
        "Respond ONLY with a JSON object — no markdown, no preamble:\n"
        "{ \"value\": true|false|null, \"details\": \"short factual phrase or empty string\""
        + extra_field + " }\n\n"
        "Rules:\n"
        "- value: true = yes/affirmative/available, false = no/negative/unavailable, null = ambiguous or unrelated.\n"
        "- details: ONE short factual phrase the staff said (e.g. \"15 min wait\", \"only one veg dish\"). Empty string if nothing useful.\n"
        "- No invented facts. Use only what the staff actually said."
    )

    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": MODEL,
                    "prompt": speech,
                    "system": system_prompt,
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 150},
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
        return {
            "value": parsed.get("value"),
            "details": parsed.get("details") or "",
            **({"wait_minutes": int(parsed["wait_minutes"])}
               if key == "reservation" and isinstance(parsed.get("wait_minutes"), (int, float))
               else {}),
        }
    except Exception as e:
        print(f"[twilio] single-answer parse failed for {key}: {e}, using keyword fallback")
        kw = _keyword_parse_gather(speech)
        out: dict = {"value": kw["can_reserve"], "details": speech[:120]}
        if key == "reservation":
            out["wait_minutes"] = kw["wait_minutes"]
        return out


@app.post("/api/twilio/gather")
async def twilio_gather(
    step: int = Query(0),
    CallSid: str = Form(""),
    SpeechResult: str = Form(""),
):
    """Per-step gather: parse this one answer, then chain to the next question
    (or hang up if it was the last). Each question is parsed independently so
    the LLM has tight context.
    """
    from fastapi.responses import PlainTextResponse

    raw_speech = SpeechResult.strip()
    call_info = _call_state.get(CallSid, {})
    asked_keys: list[str] = call_info.get("asked_keys") or ["reservation"]
    asked_questions: dict[str, str] = call_info.get("asked_questions") or {
        "reservation": QUESTION_CATALOG["reservation"]["prompt"].format(party_size=2)
    }

    if step >= len(asked_keys):
        # Defensive — shouldn't happen.
        twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="Polly.Joanna-Neural">Goodbye.</Say><Hangup/></Response>"""
        return PlainTextResponse(content=twiml, media_type="application/xml")

    cur_key = asked_keys[step]
    cur_question = asked_questions[cur_key]
    print(f"[twilio] gather step={step+1}/{len(asked_keys)} key={cur_key} speech={raw_speech!r}")

    # Parse this single answer for this single question
    answer = await _parse_single_answer(cur_key, cur_question, raw_speech)
    print(f"[twilio] parsed [{cur_key}]: {answer}")

    answers = call_info.setdefault("answers", {})
    answers[cur_key] = answer

    # Append to per-step raw log + legacy concatenated raw_speech
    raw_log: list = call_info.setdefault("raw_speech_log", [])
    raw_log.append({"key": cur_key, "speech": raw_speech})
    call_info["raw_speech"] = " | ".join(f"[{r['key']}] {r['speech']}" for r in raw_log)

    next_step = step + 1
    if next_step < len(asked_keys):
        # More questions — chain another <Gather>
        call_info["status"] = f"asking {next_step + 1}/{len(asked_keys)}"
        _call_state[CallSid] = call_info

        next_key = asked_keys[next_step]
        next_question = asked_questions[next_key]
        say_text = _xml_escape(_step_say(next_step, next_question))
        twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="{NGROK_URL}/api/twilio/gather?step={next_step}" method="POST"
          speechTimeout="auto" timeout="10" language="en-US">
    <Say voice="Polly.Joanna-Neural">{say_text}</Say>
  </Gather>
  <Say voice="Polly.Joanna-Neural">I did not receive a response. Goodbye.</Say>
</Response>"""
        return PlainTextResponse(content=twiml, media_type="application/xml")

    # Last question answered — populate legacy fields, finish.
    res_ans = answers.get("reservation")
    if isinstance(res_ans, dict):
        call_info["can_reserve"] = res_ans.get("value")
        call_info["wait_minutes"] = int(res_ans.get("wait_minutes") or 0)
        call_info["notes"] = res_ans.get("details") or call_info.get("raw_speech", "")
    else:
        call_info["can_reserve"] = None
        call_info["wait_minutes"] = 0
        call_info["notes"] = call_info.get("raw_speech", "")

    call_info["status"] = "completed"
    _call_state[CallSid] = call_info

    farewell = "Thank you so much for all the information! Have a great day. Goodbye."
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">{farewell}</Say>
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

    raw_answers = info.get("answers") or {}
    answers = {
        k: QuestionAnswer(
            value=v.get("value") if isinstance(v, dict) else None,
            details=(v.get("details") or "") if isinstance(v, dict) else "",
            wait_minutes=v.get("wait_minutes") if isinstance(v, dict) else None,
        )
        for k, v in raw_answers.items()
    }

    return CallResultResponse(
        call_sid=call_sid,
        status=info.get("status", "initiated"),
        answers=answers,
        raw_speech=info.get("raw_speech", ""),
        can_reserve=info.get("can_reserve"),
        wait_minutes=info.get("wait_minutes"),
        notes=info.get("notes", ""),
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
