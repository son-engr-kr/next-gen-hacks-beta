"""Voice search pipeline: (audio or text) → STT → LLM filter extraction →
Google Places fetch → in-memory filter → TTS response.

Falls back gracefully at every step:
- empty audio + non-empty text_query → skip STT, use the text
- LLM unreachable → keyword heuristics
- ElevenLabs not configured → no audio in response
"""

import math

from fastapi import APIRouter, File, Form, UploadFile
from pydantic import BaseModel

from catalog import PRICE_LEVEL_MAX_USD
from places import PlaceRestaurant, get_restaurants
from speech import synthesize, transcribe
from llm import generate_json

router = APIRouter()


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


def _keyword_filters(transcript: str) -> VoiceFilters:
    """Naive fallback when the LLM is unavailable. Recognizes the same
    multilingual feature keywords as the LLM prompt."""
    t = transcript.lower()
    return VoiceFilters(
        requires_parking=any(w in t for w in ["주차", "parking", "차 가지고", "차로"]),
        requires_wheelchair=any(w in t for w in ["휠체어", "장애인", "wheelchair", "accessible"]),
        requires_dogs=any(w in t for w in ["강아지", "반려견", "dog", "pet"]),
        requires_cocktails=any(w in t for w in ["칵테일", "cocktail", "술", "bar"]),
        requires_live_music=any(w in t for w in ["라이브", "공연", "live music", "band"]),
        min_rating=4.0 if any(w in t for w in ["맛있", "좋은", "훌륭", "최고", "good", "great", "best"]) else 0,
    )


def _matches_filters(place: PlaceRestaurant, filters: VoiceFilters, user_lat: float, user_lng: float) -> bool:
    """Centralized filter predicate. Each branch is one filter; failing any
    rejects the place."""
    if filters.distance_minutes > 0:
        walk_min = _haversine_meters(user_lat, user_lng, place.lat, place.lng) / 80
        if walk_min > filters.distance_minutes:
            return False
    if filters.max_price_per_person > 0:
        if PRICE_LEVEL_MAX_USD.get(place.priceLevel, 9999) > filters.max_price_per_person:
            return False
    if filters.min_rating > 0 and place.rating < filters.min_rating:
        return False
    if filters.categories and place.category not in filters.categories:
        return False
    if filters.vibe_keywords:
        blob = (place.description + " " + place.topReview).lower()
        if not any(kw.lower() in blob for kw in filters.vibe_keywords):
            return False
    if filters.requires_parking and not place.parkingType:
        return False
    if filters.requires_wheelchair and not place.isWheelchairAccessible:
        return False
    if filters.requires_dogs and not place.allowsDogs:
        return False
    if filters.requires_cocktails and not place.servesCocktails:
        return False
    if filters.requires_live_music and not place.hasLiveMusic:
        return False
    return True


def _summary_text(matched: list[PlaceRestaurant]) -> str:
    """Build the spoken English response that ElevenLabs will TTS."""
    if not matched:
        return "No restaurants matched your filters. Try loosening the criteria."
    top = matched[:3]
    names = ", ".join(r.name for r in top)
    extra = f" and {len(matched) - 3} more" if len(matched) > 3 else ""
    return (
        f"Found {len(matched)} restaurants matching your filters. "
        f"Top picks: {names}{extra}. Check them out on the map!"
    )


@router.post("/api/voice-search", response_model=VoiceSearchResponse)
async def voice_search(
    audio: UploadFile = File(...),
    user_lat: float = Form(42.355),
    user_lng: float = Form(-71.058),
    text_query: str = Form(""),
):
    # Step 1: transcript — text input wins; fall back to audio STT.
    transcript = text_query.strip()
    if not transcript:
        raw_audio = await audio.read()
        transcript = await transcribe(
            raw_audio,
            audio.filename or "audio.webm",
            audio.content_type or "audio/webm",
        )

    if not transcript:
        return VoiceSearchResponse(
            transcript="", filters=VoiceFilters(), restaurants=[], audio_base64=""
        )

    # Step 2: LLM extracts structured filters; keyword fallback if unavailable.
    try:
        parsed = await generate_json(
            transcript, VOICE_QUERY_PROMPT,
            temperature=0.1, num_predict=300, timeout=10,
        )
        filters = VoiceFilters(**parsed)
        print(f"[voice] LLM filters: {filters}")
    except Exception as e:
        print(f"[voice] LLM unavailable ({e}), using keyword fallback")
        filters = _keyword_filters(transcript)

    # Step 3+4: fetch nearby places, apply filters, sort by rating desc.
    all_places = await get_restaurants(lat=user_lat, lng=user_lng)
    matched = sorted(
        [p for p in all_places if _matches_filters(p, filters, user_lat, user_lng)],
        key=lambda x: x.rating,
        reverse=True,
    )

    # Step 5: TTS the spoken summary.
    audio_base64 = await synthesize(_summary_text(matched))

    return VoiceSearchResponse(
        transcript=transcript,
        filters=filters,
        restaurants=matched,
        audio_base64=audio_base64,
    )
