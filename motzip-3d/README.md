# motzip-3d (for developers)

3D model generation pipeline using **Microsoft TRELLIS** for restaurant category icons.
Generates GLB models, optimizes them for web, and deploys to `motzip-app/public/models/`.

---

## Prerequisites

| Requirement | Version | Notes |
|------------|---------|-------|
| OS | Windows 10/11 | Linux works too, scripts are Windows-targeted |
| GPU | NVIDIA, ≥8GB VRAM | Tested on RTX 3080Ti 16GB |
| CUDA driver | 12.x | `nvidia-smi` to check |
| Python | 3.11 | Installed via [python.org](https://www.python.org/downloads/) |
| uv | latest | [Install guide](https://docs.astral.sh/uv/getting-started/installation/) |
| Visual Studio 2022 Community | with "Desktop development with C++" workload | Required for CUDA extension builds |
| Node.js | latest | For `gltf-transform` mesh optimization |

---

## Project Layout

```
motzip-3d/
├── TRELLIS/                    # Cloned Microsoft TRELLIS repo
│   ├── .venv/                  # Python 3.11 venv (managed by uv)
│   ├── app.py                  # Image-to-3D Gradio UI
│   └── app_text.py             # Text-to-3D Gradio UI
├── extensions/                 # Custom CUDA extensions (built from source)
│   ├── diffoctreerast/
│   └── mip-splatting/
├── 3d/                         # Raw GLB outputs from TRELLIS (git-ignored)
│   ├── food/                   #   food icon models
│   └── buildings/              #   building tier + landmark models
├── images/                     # PNG preview renders (git-ignored)
│   ├── food/
│   └── buildings/
├── optimized/                  # Web-ready GLBs after optimize.sh (git-ignored)
│   ├── food/
│   └── buildings/
├── generate.py                 # CLI: text-to-3D batch pipeline
├── install_nvdiffrast.bat      # Helper: install nvdiffrast with MSVC env
├── install_extensions.bat      # Helper: build CUDA extensions
├── prompts.md                  # Generation prompts per category
├── optimize.sh                 # Mesh optimization pipeline
└── README.md
```

---

## Installation

If you cloned this repo and need to set up from scratch:

### 1. Clone TRELLIS into this folder

```bash
cd motzip-3d
git clone --recurse-submodules https://github.com/microsoft/TRELLIS.git
```

### 2. Create the virtual environment

```bash
cd TRELLIS
uv venv --python 3.11 .venv
source .venv/Scripts/activate    # Git Bash on Windows
```

### 3. Install PyTorch (CUDA 12.1)

```bash
uv pip install torch==2.4.0 torchvision==0.19.0 \
  --index-url https://download.pytorch.org/whl/cu121
```

### 4. Install basic Python dependencies

```bash
uv pip install \
  pillow imageio imageio-ffmpeg tqdm easydict opencv-python-headless \
  scipy ninja rembg onnxruntime trimesh open3d xatlas pyvista pymeshfix \
  igraph "transformers==4.45.2" "huggingface_hub<0.26" "numpy<2" \
  "git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8"
```

### 5. Install GPU-accelerated libraries

```bash
# xformers (memory-efficient attention)
uv pip install xformers==0.0.27.post2 \
  --index-url https://download.pytorch.org/whl/cu121

# kaolin (NVIDIA prebuilt Windows wheel)
uv pip install kaolin \
  -f https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.4.0_cu121.html

# flash-attention (prebuilt Windows wheel from kingbri1)
uv pip install \
  "https://github.com/kingbri1/flash-attention/releases/download/v2.7.4.post1/flash_attn-2.7.4.post1%2Bcu124torch2.4.0cxx11abiFALSE-cp311-cp311-win_amd64.whl"

# spconv (sparse convolution)
uv pip install spconv-cu120

# Gradio for the demo UI
uv pip install gradio==4.44.1 gradio_litmodel3d==0.0.1
```

### 6. Build CUDA extensions from source

These need MSVC, so we use helper batch files that activate the VS2022 build environment:

```bash
# Clone the source repos
cd ..    # back to motzip-3d/
git clone --recurse-submodules https://github.com/JeffreyXiang/diffoctreerast.git extensions/diffoctreerast
git clone https://github.com/autonomousvision/mip-splatting.git extensions/mip-splatting

# Build nvdiffrast (~1 min)
./install_nvdiffrast.bat

# Build diffoctreerast + diff-gaussian-rasterization (~3-4 min)
./install_extensions.bat
```

### 7. Verify installation

```bash
cd TRELLIS
source .venv/Scripts/activate
python -c "
import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())
import xformers, flash_attn, kaolin, nvdiffrast, spconv
import diffoctreerast, diff_gaussian_rasterization, gradio
print('all extensions OK')
import sys; sys.path.insert(0, '.')
from trellis.pipelines import TrellisImageTo3DPipeline
print('TRELLIS pipeline OK')
"
```

Expected output:
```
torch 2.4.0+cu121 cuda True
all extensions OK
[SPARSE] Backend: spconv, Attention: flash_attn
TRELLIS pipeline OK
```

---

## Running TRELLIS

### Image-to-3D (recommended)

```bash
cd TRELLIS
source .venv/Scripts/activate
python app.py
```

Open http://localhost:7860 — drag in a reference image, click Generate.

> **First run downloads ~5GB of model weights from HuggingFace.** Cached afterwards.

### Text-to-3D

```bash
python app_text.py
```

> Note from upstream: text-conditioned models are less detailed. Recommended workflow is text → image (via your favorite text-to-image model) → image-to-3D.

---

## Generating Restaurant Category Models

We need 12 stylized models, one per category (burger, pizza, sushi, ramen, cafe, mexican, italian, chinese, thai, steakhouse, seafood, bakery).

### Automated pipeline (recommended)

`generate.py` drives TRELLIS programmatically — no Gradio UI required.
Run from `motzip-3d/` with the TRELLIS venv activated:

```bash
cd motzip-3d
source TRELLIS/.venv/Scripts/activate

python generate.py --all                        # food icons + buildings (first run ~5 GB download)
python generate.py --all --type food            # food icons only
python generate.py --all --type building        # building models only
python generate.py --category landmark_burger   # single item
python generate.py --all --manual               # pause after each for Y/n/retry
python generate.py --all --skip-existing        # skip already-generated files
python generate.py --all --optimize             # generate + optimize in one go
python generate.py --all --seed 99              # custom seed
```

GLBs are saved to `motzip-3d/raw/<category>.glb`.

### Manual (Gradio UI)

```bash
cd TRELLIS
python app_text.py    # text-to-3D UI at http://localhost:7860
```

Open `prompts.md` for recommended prompts. Download each GLB and place it in `motzip-3d/raw/<category>.glb`.

### Tips for stylized food assets

- Use `cute miniature [item], isometric, stylized game asset, soft pastel colors`
- Upload reference images for consistency across the set
- Adjust **simplification** in the Gradio UI: 0.90 instead of default 0.95 keeps more detail (~40k tris vs 10k)
- Generate at **2K texture** for better quality

---

## Optimizing Models for Web

After generating raw GLBs, optimize them with `gltf-transform`:

```bash
# One-time install of CLI
npm install -g @gltf-transform/cli

# Run pipeline
cd motzip-3d
bash optimize.sh
```

The pipeline (order matters — Draco **must** be last):

1. **Dedup** — merge identical textures/materials/meshes
2. **Simplify** — food 5%, buildings 10% of original faces
3. **Resize textures** — 256×256
4. **Prune** — strip resources orphaned by simplify
5. **Draco compression** — geometry compression (final step, stays compressed)

> **Why this order?** If Draco runs before resize, the resize step decodes
> Draco internally and the output ships uncompressed — files bloat 5-10×.

Input: `3d/food/` and `3d/buildings/`.
Output: `optimized/` → auto-copied to `../motzip-app/public/models/food/` and `.../buildings/`.

Target: each final GLB <500 KB. The frontend uses `DRACOLoader` to decode at runtime.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `vswhere.exe is not recognized` warning during builds | Harmless — VS2022 vcvars still loads correctly. |
| Build error during `install_extensions.bat` | Open VS2022 "Developer PowerShell" once to confirm MSVC is installed. Re-run the batch. |
| `flash_attn` import fails | Wheel must match Python version (cp311) and torch (2.4.0). Re-download from kingbri1's releases. |
| `numpy 2.x` warning | Run `uv pip install "numpy<2"` — kaolin needs numpy 1.x. |
| `is_offline_mode` ImportError from transformers | Run `uv pip install "transformers==4.45.2" "huggingface_hub<0.26"` — newer versions are incompatible. |
| OOM on 8GB cards | Lower resolution in Gradio UI, or use a card with more VRAM. |

---

## Reference

- [TRELLIS upstream README](TRELLIS/README.md)
- [TRELLIS paper](https://arxiv.org/abs/2412.01506)
- [TRELLIS HuggingFace demo](https://huggingface.co/spaces/Microsoft/TRELLIS)
- [gltf-transform docs](https://gltf-transform.dev/)
