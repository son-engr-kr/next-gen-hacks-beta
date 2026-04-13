# motzip

Boston restaurant 3D map with a local LLM backend for natural language search, review analysis, and food image recognition.

## Structure

| Directory | Description |
|---|---|
| `motzip-app/` | Next.js frontend — 3D map (MapLibre + Three.js), restaurant panel, fireworks |
| `motzip-server/` | FastAPI + Ollama (Gemma 4) — local LLM API |
| `motzip-3d/` | 3D model generation pipeline — TRELLIS text-to-3D + mesh optimization |

---

## Install

One-time setup. After this, [Run](#run) should just work.

### Frontend (motzip-app)

Requires Node.js 20+.

```bash
cd motzip-app
npm install
```

### Server (motzip-server)

**1. Install Ollama**

Windows: download from https://ollama.com/download/windows. Ollama runs as a background service after install.

**2. Pull the model**

```bash
ollama pull gemma4:e4b-it-q4_K_M
```

Default model: `gemma4:e4b-it-q4_K_M` (9.6 GB, multimodal). Override at runtime with `MOTZIP_MODEL`.

**3. Python environment**

Requires Python 3.11+ and [uv](https://docs.astral.sh/uv/):

```bash
winget install --id=astral-sh.uv   # if not installed
cd motzip-server
uv sync
```

### 3D pipeline (motzip-3d)

Only needed to regenerate the 3D models. Pre-built models ship in `motzip-app/public/models/`.

| Requirement | Notes |
|------------|-------|
| NVIDIA GPU, ≥8GB VRAM | Tested on RTX 3080Ti 16GB |
| CUDA driver 12.x | `nvidia-smi` to check |
| Python 3.11 | |
| uv (latest) | |
| Visual Studio 2022 Community | "Desktop development with C++" workload — needed for CUDA extension builds |
| Node.js (latest) | For `gltf-transform` mesh optimization |

```bash
cd motzip-3d
git clone --recurse-submodules https://github.com/microsoft/TRELLIS.git
cd TRELLIS
uv venv --python 3.11 .venv
source .venv/Scripts/activate

# PyTorch + CUDA 12.1
uv pip install torch==2.4.0 torchvision==0.19.0 \
  --index-url https://download.pytorch.org/whl/cu121

# All other deps — see motzip-3d/README.md for full commands
```

CUDA extensions (need MSVC):

```bash
cd ..    # back to motzip-3d/
git clone --recurse-submodules https://github.com/JeffreyXiang/diffoctreerast.git extensions/diffoctreerast
git clone https://github.com/autonomousvision/mip-splatting.git extensions/mip-splatting
./install_nvdiffrast.bat
./install_extensions.bat
```

Full step-by-step: [`motzip-3d/README.md`](./motzip-3d/README.md).

Mesh optimization tooling:

```bash
npm install -g @gltf-transform/cli
```

---

## Run

Each component is independent. Start only what you need.

### Frontend (motzip-app)

```bash
cd motzip-app
npm run dev
```

http://localhost:3000

Production build:

```bash
npm run build && npm start
```

### Server (motzip-server)

```bash
cd motzip-server
uv run python main.py
```

http://localhost:8000

The server polls Ollama every 2 seconds — startup order doesn't matter.

Override the model per run:

```bash
MOTZIP_MODEL=gemma4:e2b-it-q4_K_M uv run python main.py     # lighter / faster
MOTZIP_MODEL=gemma4:26b-a4b-it-q4_K_M uv run python main.py # higher quality
```

### 3D pipeline (motzip-3d)

**Generate models** (text-to-3D via TRELLIS):

```bash
cd motzip-3d
source TRELLIS/.venv/Scripts/activate

python generate.py --all                        # all food icons + all buildings
python generate.py --all --type food            # food icons only (12 items)
python generate.py --all --type building        # buildings only (3 tiers + 12 landmarks)
python generate.py --category landmark_seafood  # single item
python generate.py --all --manual               # pause after each for Y/n/retry
python generate.py --all --skip-existing        # skip already-generated files
python generate.py --all --optimize             # generate + optimize in one step
```

Output:
```
motzip-3d/
├── 3d/
│   ├── food/<category>.glb        ← raw 3D food icons
│   └── buildings/<key>.glb        ← raw 3D building models
└── images/
    ├── food/<category>.png         ← PNG preview renders
    └── buildings/<key>.png
```

Edit prompts in [`motzip-3d/prompts.md`](./motzip-3d/prompts.md).

> First run downloads ~5 GB of TRELLIS model weights from HuggingFace. Cached afterwards.

**Optimize for web** (simplify → Draco → resize to 512px, target <500 KB per file):

```bash
cd motzip-3d
bash optimize.sh
```

Outputs: `3d/` → `optimized/` → deployed to `motzip-app/public/models/food/` and `motzip-app/public/models/buildings/`.

**Manual Gradio UI** (image-to-3D or text-to-3D):

```bash
cd motzip-3d/TRELLIS
python app.py        # image-to-3D at http://localhost:7860
python app_text.py   # text-to-3D
```

---

## Test

### Frontend

```bash
cd motzip-app
npm run lint
```

### Server

With the server running:

```bash
curl http://localhost:8000/health

curl -X POST http://localhost:8000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"spicy seafood near the waterfront"}'
```

Full endpoint reference: [`motzip-server/README.md`](./motzip-server/README.md).

### Ollama

```bash
curl http://localhost:11434
# → "Ollama is running"
```
