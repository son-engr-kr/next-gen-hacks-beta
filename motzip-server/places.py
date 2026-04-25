"""Google Places (New) integration: fetch nearby restaurants and normalize
into our internal Restaurant shape."""

import asyncio

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from catalog import GOOGLE_TYPE_MAP
from config import GOOGLE_PLACES_API_KEY
from llm import generate_json

router = APIRouter()

# Cached review texts from the most recent /api/restaurants response, keyed by
# place_id. Populated by get_restaurants(); read by signature-dish extraction.
# Memory is bounded by Google's per-call result count, not by demo length.
_review_cache: dict[str, list[str]] = {}


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


# Fields we ask Google for. Listed verbose per-line so the field mask is easy
# to audit against the Places API docs.
_FIELD_MASK = ",".join([
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

# Each `searchNearby` is hard-capped at 20 results with no pagination, so we
# fan out across narrow type groups and dedupe. Note: if ANY type in a group
# is invalid (e.g. `burger_restaurant` — actual name is `hamburger_restaurant`)
# Google silently returns 0 for the WHOLE group. Verify each new type alone.
_TYPE_GROUPS = [
    ["restaurant", "cafe", "bakery"],
    ["pizza_restaurant", "sushi_restaurant", "ramen_restaurant"],
    ["italian_restaurant", "chinese_restaurant", "thai_restaurant",
     "japanese_restaurant", "korean_restaurant"],
    ["seafood_restaurant", "mexican_restaurant", "hamburger_restaurant",
     "steak_house", "coffee_shop"],
    ["american_restaurant", "fast_food_restaurant", "sandwich_shop",
     "ice_cream_shop", "dessert_shop"],
    ["french_restaurant", "vegetarian_restaurant", "vietnamese_restaurant",
     "indian_restaurant", "mediterranean_restaurant"],
    ["bar", "bar_and_grill", "brunch_restaurant", "fine_dining_restaurant",
     "breakfast_restaurant"],
]


async def _fetch_group(types: list[str], lat: float, lng: float, radius: float) -> list[dict]:
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                "https://places.googleapis.com/v1/places:searchNearby",
                headers={
                    "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
                    "X-Goog-FieldMask": _FIELD_MASK,
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


def _parking_type(parking_opts: dict) -> str | None:
    if parking_opts.get("valetParking"):
        return "valet"
    if any(parking_opts.get(k) for k in ("freeParkingLot", "freeStreetParking", "freeGarageParking")):
        return "free"
    if any(parking_opts.get(k) for k in ("paidParkingLot", "paidGarageParking")):
        return "paid"
    return None


def _extract_review_texts(p: dict) -> list[str]:
    return [
        r["text"]["text"]
        for r in (p.get("reviews") or [])
        if r.get("text") and r["text"].get("text")
    ]


def _normalize_place(p: dict, default_lat: float, default_lng: float, avg_review_count: float) -> PlaceRestaurant:
    location = p.get("location", {})
    rating = float(p.get("rating", 3.0))
    review_count = int(p.get("userRatingCount", 0))
    types = p.get("types", [])

    editorial = p.get("editorialSummary") or {}
    description = editorial.get("text", "")

    review_texts = _extract_review_texts(p)
    top_review = review_texts[0] if review_texts else ""

    accessibility = p.get("accessibilityOptions") or {}
    is_wheelchair = bool(
        accessibility.get("wheelchairAccessibleEntrance")
        or accessibility.get("wheelchairAccessibleSeating")
        or accessibility.get("wheelchairAccessibleRestroom")
    )

    parking_opts = p.get("parkingOptions") or {}
    opening_hours = p.get("currentOpeningHours") or {}

    # Trending = high rating AND above-average review count
    is_trending = rating >= 4.3 and review_count >= avg_review_count * 1.5

    return PlaceRestaurant(
        id=p.get("id", ""),
        name=p.get("displayName", {}).get("text", "Unknown"),
        category=_map_types_to_category(types),
        lat=location.get("latitude", default_lat),
        lng=location.get("longitude", default_lng),
        rating=round(rating, 1),
        reviewCount=review_count,
        isTrending=is_trending,
        description=description,
        topReview=top_review,
        isWheelchairAccessible=is_wheelchair,
        parkingType=_parking_type(parking_opts),
        isOpenNow=opening_hours.get("openNow"),
        hasLiveMusic=bool(p.get("liveMusic")),
        allowsDogs=bool(p.get("allowsDogs")),
        servesCocktails=bool(p.get("servesCocktails")),
        priceLevel=p.get("priceLevel"),
        phone=p.get("nationalPhoneNumber"),
    )


async def get_restaurants(
    lat: float = 42.355,
    lng: float = -71.058,
    radius: float = 3000,
) -> list[PlaceRestaurant]:
    """Fan out 3 cuisine-grouped Places queries in parallel, dedupe by id,
    normalize each into our Restaurant shape. Returns [] if no API key."""
    if not GOOGLE_PLACES_API_KEY:
        return []

    batches = await asyncio.gather(*[_fetch_group(t, lat, lng, radius) for t in _TYPE_GROUPS])

    seen_ids: set[str] = set()
    places: list[dict] = []
    for batch in batches:
        for p in batch:
            pid = p.get("id", "")
            if pid and pid not in seen_ids:
                seen_ids.add(pid)
                places.append(p)

    avg_count = sum(p.get("userRatingCount", 0) for p in places) / max(len(places), 1)

    # Cache the raw review texts for later signature-dish extraction. Stash
    # before normalization so we don't re-walk the response in the endpoint.
    for p in places:
        pid = p.get("id")
        if pid:
            _review_cache[pid] = _extract_review_texts(p)

    return [_normalize_place(p, lat, lng, avg_count) for p in places]


@router.get("/api/restaurants", response_model=list[PlaceRestaurant])
async def restaurants_endpoint(
    lat: float = 42.355,
    lng: float = -71.058,
    radius: float = 3000,
):
    return await get_restaurants(lat=lat, lng=lng, radius=radius)


# ── Signature dishes (lazy LLM extraction over cached reviews) ───────────────

class SignatureDishesResponse(BaseModel):
    dishes: list[str] = []


_SIGNATURE_PROMPT = (
    "From the restaurant reviews below, extract the 3-5 specific FOOD or "
    "DRINK menu items that reviewers mention positively most often or with "
    "the strongest praise. Use the exact dish names as written, lowercase.\n\n"
    "Strict rules:\n"
    "- Only items you would order from a menu (e.g. 'cannoli', 'fish and chips', "
    "'spicy tuna roll', 'iced latte').\n"
    "- NEVER include non-food items (devices, decor, ambiance, service, staff names).\n"
    "- NEVER include generic words like 'food', 'meal', 'menu', 'lunch', 'dinner'.\n"
    "- If no specific dishes are clearly named, return an empty list.\n\n"
    "Respond ONLY with a JSON object — no markdown, no preamble:\n"
    "{ \"dishes\": [\"dish 1\", \"dish 2\", ...] }"
)

# Per-place result cache so re-expanding the same card is instant + free.
_signature_cache: dict[str, list[str]] = {}


@router.get("/api/signature-dishes/{place_id}", response_model=SignatureDishesResponse)
async def signature_dishes(place_id: str):
    if place_id in _signature_cache:
        return SignatureDishesResponse(dishes=_signature_cache[place_id])

    reviews = _review_cache.get(place_id)
    if not reviews:
        # Either the place isn't in our cache (frontend out of sync) or the
        # place has zero reviews. Either way, nothing to extract.
        return SignatureDishesResponse(dishes=[])

    # Cap input length so the LLM call stays fast even with long reviews.
    joined = "\n\n".join(f"Review {i+1}: {r}" for i, r in enumerate(reviews[:5]))[:4000]

    try:
        parsed = await generate_json(
            joined, _SIGNATURE_PROMPT,
            temperature=0.1, num_predict=200, timeout=20,
        )
        dishes = [str(d).strip() for d in (parsed.get("dishes") or []) if str(d).strip()]
        dishes = dishes[:5]
    except Exception as e:
        print(f"[places] signature-dish LLM failed for {place_id}: {e}")
        raise HTTPException(status_code=503, detail="LLM unavailable")

    _signature_cache[place_id] = dishes
    return SignatureDishesResponse(dishes=dishes)
