# motzip

Boston restaurant 3D map with a local LLM backend for natural language search, review analysis, and food image recognition.

## Structure

| Directory | Description |
|---|---|
| `motzip-app/` | Next.js 16 frontend (3D map, MapLibre + Three.js) |
| `motzip-server/` | FastAPI + Ollama (Gemma 4) local LLM API |
| `motzip-3d/` | 3D model generation pipeline (TRELLIS + mesh optimization) |

---

## Install

One-time environment setup. After this section, the [Run](#run) section should just work.

### Frontend (motzip-app)

Requires Node.js 20+.

```bash
cd motzip-app
npm install
```

### Server (motzip-server)

**1. Install Ollama**

Windows: download from https://ollama.com/download/windows. After install, Ollama runs as a background service in the system tray.

**2. Pull the Gemma 4 model**

```bash
ollama pull gemma4:e4b-it-q4_K_M
```

Default model is `gemma4:e4b-it-q4_K_M` (9.6 GB, multimodal). Override at runtime with the `MOTZIP_MODEL` environment variable.

**3. Python environment (uv)**

Requires Python 3.11+. Install [uv](https://docs.astral.sh/uv/) if needed:

```bash
winget install --id=astral-sh.uv
```

Install project dependencies:

```bash
cd motzip-server
uv sync
```

This creates `.venv` and installs the exact versions pinned in `uv.lock`.

### 3D pipeline (motzip-3d)

Only needed if you want to regenerate category models. The shipped models already live in `motzip-app/public/models/`.

| Requirement | Version | Notes |
|------------|---------|-------|
| GPU | NVIDIA, ≥8GB VRAM | Tested on RTX 3080Ti 16GB |
| CUDA driver | 12.x | `nvidia-smi` to check |
| Python | 3.11 | |
| uv | latest | |
| Visual Studio 2022 Community | with "Desktop development with C++" workload | Required for CUDA extension builds |
| Node.js | latest | For `gltf-transform` mesh optimization |

Short version:

```bash
cd motzip-3d
git clone --recurse-submodules https://github.com/microsoft/TRELLIS.git
cd TRELLIS
uv venv --python 3.11 .venv
source .venv/Scripts/activate

# PyTorch + CUDA 12.1
uv pip install torch==2.4.0 torchvision==0.19.0 \
  --index-url https://download.pytorch.org/whl/cu121

# Basic deps + GPU libs (xformers, kaolin, flash-attn, spconv, gradio)
# See motzip-3d/README.md for the full install commands
```

CUDA extensions need MSVC, so use the helper batch files from `motzip-3d/`:

```bash
cd ..    # back to motzip-3d/
git clone --recurse-submodules https://github.com/JeffreyXiang/diffoctreerast.git extensions/diffoctreerast
git clone https://github.com/autonomousvision/mip-splatting.git extensions/mip-splatting
./install_nvdiffrast.bat
./install_extensions.bat
```

The full step-by-step is in [`motzip-3d/README.md`](./motzip-3d/README.md).

Mesh optimization tooling:

```bash
npm install -g @gltf-transform/cli
```

---

## Test

Smoke tests to confirm each component is wired up correctly.

### Frontend

```bash
cd motzip-app
npm run lint
```

### Server

With the server running (see [Run](#run)), in another terminal:

```bash
# Health check
curl http://localhost:8000/health

# Natural language search
curl -X POST http://localhost:8000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"spicy seafood near the waterfront"}'
```

See [`motzip-server/README.md`](./motzip-server/README.md) for the full endpoint reference.

### Ollama

```bash
curl http://localhost:11434
# → "Ollama is running" if OK
```

---

## Run

Assumes [Install](#install) is complete. Each component runs independently.

### Frontend (motzip-app)

```bash
cd motzip-app
npm run dev
```

http://localhost:3000

Production build:

```bash
npm run build
npm start
```

### Server (motzip-server)

```bash
cd motzip-server
uv run python main.py
```

http://localhost:8000

Override the model per run:

```bash
MOTZIP_MODEL=gemma4:e2b-it-q4_K_M uv run python main.py   # lighter / faster
MOTZIP_MODEL=gemma4:26b-a4b-it-q4_K_M uv run python main.py   # higher quality
```

The server polls Ollama every 2 seconds and connects automatically once it's reachable, so startup order between Ollama and the server doesn't matter.

### 3D pipeline (motzip-3d)

Image-to-3D Gradio UI:

```bash
cd motzip-3d/TRELLIS
source .venv/Scripts/activate
python app.py
```

http://localhost:7860

> First run downloads ~5GB of model weights from HuggingFace. Cached afterwards.

Generate the 12 category models: use prompts from [`motzip-3d/prompts.md`](./motzip-3d/prompts.md), save outputs to `motzip-3d/raw/` as `burger.glb`, `pizza.glb`, etc.

Optimize for web (simplify 30% → Draco → texture resize 512×512, auto-copied to `motzip-app/public/models/`, target <500KB per GLB):

```bash
cd motzip-3d
bash optimize.sh
```
