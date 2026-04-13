# motzip-server

Local LLM-powered API for natural language restaurant search and review summarization.

## Prerequisites

1. **Ollama** installed and running: https://ollama.com
2. **Gemma model** pulled:
   ```bash
   ollama pull gemma4:e4b-it-q4_K_M
   ```
   The model tag can be overridden at runtime with the `MOTZIP_MODEL` environment variable.

## Setup

Uses [uv](https://docs.astral.sh/uv/) for environment management. Requires Python 3.11+.

```bash
uv sync
```

This creates `.venv` and installs all dependencies from `uv.lock`.

## Run

```bash
# Terminal 1: Ollama (if not already running)
ollama serve

# Terminal 2: API server
uv run python main.py
```

Server runs at http://localhost:8000

## Endpoints

### `GET /health`
Check Ollama connection and available models.

### `POST /api/search`
Natural language → structured filters.

```json
// Request
{ "query": "spicy seafood near the waterfront" }

// Response
{
  "categories": ["seafood"],
  "min_rating": 0,
  "keywords": ["spicy", "waterfront"],
  "vibe": ""
}
```

### `POST /api/summarize`
Generate an engaging restaurant summary.

```json
// Request
{
  "name": "Neptune Oyster",
  "category": "seafood",
  "rating": 4.8,
  "review_count": 490,
  "description": "Tiny North End spot with the city's best lobster roll."
}

// Response
{ "summary": "A tiny North End gem ..." }
```

### `POST /api/analyze-reviews`
Synthesize a list of reviews into structured insights (summary, sentiment, pros/cons, signature dishes, vibe, red flags).

```json
// Request
{
  "restaurant_name": "Neptune Oyster",
  "category": "seafood",
  "reviews": [
    "Hot butter lobster roll is life-changing. Get there early.",
    "Waited 2 hours on Saturday but worth every minute.",
    "Cramped and loud but food is unreal."
  ]
}

// Response
{
  "summary": "A cozy but cramped North End spot legendary for its butter-drenched lobster roll.",
  "sentiment": { "positive": 0.78, "neutral": 0.14, "negative": 0.08 },
  "pros": ["legendary lobster roll", "fresh seafood", "generous butter"],
  "cons": ["long wait times", "cramped seating"],
  "signature_dishes": ["hot butter lobster roll", "oysters"],
  "vibe": "cozy, cramped, buzzing",
  "best_for": ["seafood lovers", "visitors", "date night"],
  "red_flags": [],
  "review_count": 3
}
```

### `POST /api/analyze-food` (multimodal)
Upload a food photo, get structured analysis. Uses Gemma 3's vision capability.

```bash
curl -X POST http://localhost:8000/api/analyze-food \
  -F "image=@./lobster_roll.jpg"
```

```json
// Response
{
  "dish_name": "Lobster Roll",
  "category": "seafood",
  "ingredients": ["lobster", "brioche bun", "butter", "chives"],
  "description": "A buttery, overstuffed lobster roll on a toasted brioche bun.",
  "tags": ["seafood", "sandwich", "new-england"]
}
```

### `POST /api/vision` (multimodal)
Freeform vision Q&A over an uploaded image.

```bash
curl -X POST http://localhost:8000/api/vision \
  -F "image=@./menu.jpg" \
  -F "prompt=Extract all menu items and prices as a list."
```

```json
// Response
{ "response": "1. Margherita Pizza - $14 ..." }
```
