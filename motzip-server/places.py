"""Google Places (New) integration: fetch nearby restaurants and normalize
into our internal Restaurant shape."""

import asyncio

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from catalog import GOOGLE_TYPE_MAP
from config import GOOGLE_PLACES_API_KEY

router = APIRouter()


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

# Three groups so each request returns a distinct cuisine cluster — gets us
# ~50-60 unique buildings instead of the 20-per-request API limit.
_TYPE_GROUPS = [
    ["restaurant", "cafe", "bakery"],
    ["pizza_restaurant", "sushi_restaurant", "ramen_restaurant",
     "italian_restaurant", "chinese_restaurant", "thai_restaurant"],
    ["seafood_restaurant", "mexican_restaurant", "burger_restaurant",
     "steak_house", "coffee_shop"],
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


def _normalize_place(p: dict, default_lat: float, default_lng: float, avg_review_count: float) -> PlaceRestaurant:
    location = p.get("location", {})
    rating = float(p.get("rating", 3.0))
    review_count = int(p.get("userRatingCount", 0))
    types = p.get("types", [])

    editorial = p.get("editorialSummary") or {}
    description = editorial.get("text", "")

    reviews = p.get("reviews") or []
    top_review = ""
    if reviews and reviews[0].get("text"):
        top_review = reviews[0]["text"].get("text", "")

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
    return [_normalize_place(p, lat, lng, avg_count) for p in places]


@router.get("/api/restaurants", response_model=list[PlaceRestaurant])
async def restaurants_endpoint(
    lat: float = 42.355,
    lng: float = -71.058,
    radius: float = 3000,
):
    return await get_restaurants(lat=lat, lng=lng, radius=radius)
