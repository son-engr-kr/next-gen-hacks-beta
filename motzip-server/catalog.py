"""Static catalogs shared across routes."""

# ── Restaurant categories ────────────────────────────────────────────────────
CATEGORIES = [
    "burger", "pizza", "sushi", "ramen", "cafe",
    "mexican", "italian", "chinese", "thai",
    "steakhouse", "seafood", "bakery",
]

# Maps Google Places type strings → our internal category.
GOOGLE_TYPE_MAP: dict[str, str] = {
    "hamburger_restaurant": "burger",
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

# Approximate USD per person ceiling for each Google priceLevel bucket.
# Used by voice-search to translate "under $30" into a price filter.
PRICE_LEVEL_MAX_USD: dict[str | None, float] = {
    None: 9999,
    "PRICE_LEVEL_FREE": 0,
    "PRICE_LEVEL_INEXPENSIVE": 15,
    "PRICE_LEVEL_MODERATE": 35,
    "PRICE_LEVEL_EXPENSIVE": 70,
    "PRICE_LEVEL_VERY_EXPENSIVE": 200,
}

# ── Phone-call question catalog ──────────────────────────────────────────────
# Each entry produces one segment in the per-call phone script and one answer
# slot in the result. Frontend mirrors this catalog (label-only) — keep in sync
# or expose via /api/questions if drift becomes an issue.
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
