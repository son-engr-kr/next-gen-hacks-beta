"""
motzip-3d/generate.py

Generate GLB models + PNG preview images for motzip using TRELLIS text-to-3D.

Output layout:
    3d/food/<key>.glb          — raw 3D food icons
    3d/buildings/<key>.glb     — raw 3D building models
    images/food/<key>.png      — preview renders of food icons
    images/buildings/<key>.png — preview renders of building models

Two asset types, controlled by --type:
  food      — floating food icons (12 categories)
  building  — building models: 3 generic tiers + 12 landmark shapes
  all       — both (default)

Usage:
    cd motzip-3d
    source TRELLIS/.venv/Scripts/activate

    python generate.py --all                        # all food icons + all buildings
    python generate.py --all --type food            # food icons only (12 items)
    python generate.py --all --type building        # buildings only (3 tiers + 12 landmarks)
    python generate.py --category landmark_seafood  # single item
    python generate.py --all --manual               # pause after each for Y/n/retry
    python generate.py --all --skip-existing        # skip already-generated files
    python generate.py --all --optimize             # generate + optimize in one step
    python generate.py --all --seed 99              # custom seed
"""

import os
import sys
import argparse

# Must be set before importing trellis (env vars are read at module import time)
os.environ["SPCONV_ALGO"] = "native"
# flash_attn wheel is cu124 but PyTorch is cu121 — CUDA kernel mismatch causes
# "CUDA error: invalid argument" inside the transformer. xformers is cu121-compatible.
os.environ["ATTN_BACKEND"] = "xformers"

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRELLIS_DIR = os.path.join(SCRIPT_DIR, "TRELLIS")

# 3D output dirs
GLB_DIRS: dict[str, str] = {
    "food":     os.path.join(SCRIPT_DIR, "3d", "food"),
    "building": os.path.join(SCRIPT_DIR, "3d", "buildings"),
}
# Preview image dirs (same sub-structure)
IMG_DIRS: dict[str, str] = {
    "food":     os.path.join(SCRIPT_DIR, "images", "food"),
    "building": os.path.join(SCRIPT_DIR, "images", "buildings"),
}
for d in list(GLB_DIRS.values()) + list(IMG_DIRS.values()):
    os.makedirs(d, exist_ok=True)

# Add TRELLIS to sys.path so `import trellis` works without installing
if TRELLIS_DIR not in sys.path:
    sys.path.insert(0, TRELLIS_DIR)

# ── Prompt parsing ─────────────────────────────────────────────────────────────
PROMPTS_FILE = os.path.join(SCRIPT_DIR, "prompts.md")

FOOD_KEYS = {
    "burger", "pizza", "sushi", "ramen", "cafe",
    "mexican", "italian", "chinese", "thai", "steakhouse", "seafood", "bakery",
}
BUILDING_KEYS = {
    "building_regular", "building_mid", "building_major",
    "landmark_burger", "landmark_pizza", "landmark_sushi", "landmark_ramen",
    "landmark_cafe", "landmark_mexican", "landmark_italian", "landmark_chinese",
    "landmark_thai", "landmark_steakhouse", "landmark_seafood", "landmark_bakery",
}


def load_prompts() -> dict[str, str]:
    """Parse all markdown tables in prompts.md."""
    assert os.path.exists(PROMPTS_FILE), f"prompts.md not found: {PROMPTS_FILE}"
    prompts: dict[str, str] = {}
    with open(PROMPTS_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line.startswith("|"):
                continue
            inner = line.replace("|", "").replace("-", "").replace(" ", "")
            if not inner:
                continue
            parts = [p.strip() for p in line.strip("|").split("|")]
            if len(parts) < 2:
                continue
            key, prompt = parts[0].lower(), parts[1]
            if key in ("category", "tier"):
                continue
            if key and prompt:
                prompts[key] = prompt
    assert prompts, f"No prompts parsed from {PROMPTS_FILE}"
    return prompts


def filter_by_type(prompts: dict[str, str], asset_type: str) -> dict[str, str]:
    if asset_type == "food":
        return {k: v for k, v in prompts.items() if k in FOOD_KEYS}
    if asset_type == "building":
        return {k: v for k, v in prompts.items() if k in BUILDING_KEYS}
    return prompts


def asset_type_of(key: str) -> str:
    return "food" if key in FOOD_KEYS else "building"


def glb_path_for(key: str) -> str:
    return os.path.join(GLB_DIRS[asset_type_of(key)], f"{key}.glb")


def img_path_for(key: str) -> str:
    return os.path.join(IMG_DIRS[asset_type_of(key)], f"{key}.png")


# ── Generation ─────────────────────────────────────────────────────────────────

def load_pipeline():
    from trellis.pipelines import TrellisTextTo3DPipeline
    print("[generate] Loading TRELLIS-text-xlarge (first run downloads ~5 GB) ...")
    pipeline = TrellisTextTo3DPipeline.from_pretrained("microsoft/TRELLIS-text-xlarge")
    pipeline.cuda()
    print("[generate] Pipeline ready.")
    return pipeline


def save_preview(outputs: dict, key: str) -> str:
    """Render a single-frame PNG preview from the Gaussian output."""
    import imageio
    from trellis.utils import render_utils

    # Render 8 frames and pick the one at ~30° elevation for a nice isometric look
    frames = render_utils.render_video(outputs["gaussian"][0], num_frames=8)["color"]
    out_path = img_path_for(key)
    imageio.imwrite(out_path, frames[2])  # frame 2 ≈ 90° into orbit
    return out_path


def generate_one(pipeline, key: str, prompt: str, seed: int, manual: bool, _attempt: int = 0) -> tuple[str, str]:
    """
    Generate a single GLB + PNG.
    Returns (glb_path, img_path), either may be '' if skipped.
    Auto-retries up to 5 times with seed+1 on empty sparse structure.
    """
    import torch
    from trellis.utils import postprocessing_utils

    MAX_ATTEMPTS = 5

    glb_out = glb_path_for(key)
    img_out = img_path_for(key)

    if _attempt == 0:
        print(f"\n[generate] {key}")
        print(f"           prompt : {prompt}")
        print(f"           seed   : {seed}")

    try:
        outputs = pipeline.run(
            prompt,
            seed=seed,
            formats=["gaussian", "mesh"],
            sparse_structure_sampler_params={"steps": 12, "cfg_strength": 7.5},
            slat_sampler_params={"steps": 12, "cfg_strength": 7.5},
        )
    except ValueError as e:
        if "EmptySparseStructure" in str(e) and _attempt < MAX_ATTEMPTS:
            new_seed = seed + 1
            print(f"  Empty sparse structure (seed {seed}), retrying with seed {new_seed} ...")
            torch.cuda.empty_cache()
            return generate_one(pipeline, key, prompt, new_seed, manual, _attempt + 1)
        raise
    except RuntimeError as e:
        if "CUDA error" in str(e):
            print(f"\n[generate] CUDA error on '{key}' (seed {seed}) — CUDA context is now invalid.")
            print("  Re-run with --skip-existing to resume from the next item:")
            print(f"    python generate.py --all --skip-existing")
            print(f"  To debug: CUDA_LAUNCH_BLOCKING=1 python generate.py --category {key}")
            sys.exit(1)
        raise

    glb = postprocessing_utils.to_glb(
        outputs["gaussian"][0],
        outputs["mesh"][0],
        simplify=0.0,       # VTK QuadricDecimation crashes on some meshes; skip here,
        texture_size=1024,  # mesh reduction is handled later by optimize.sh (gltf-transform)
        verbose=False,
    )

    if manual:
        # Save preview first so user can open the PNG to evaluate
        tmp_img = save_preview(outputs, key)
        print(f"  Preview image saved → {tmp_img}")
        answer = input(f"  Save {key}.glb? [Y/n/r(etry)] ").strip().lower()
        if answer == "n":
            print(f"  Skipped {key}.")
            os.remove(tmp_img)
            del glb, outputs
            torch.cuda.empty_cache()
            return "", ""
        if answer == "r":
            os.remove(tmp_img)
            del glb, outputs
            torch.cuda.empty_cache()
            new_seed = seed + 1000
            print(f"  Retrying with seed {new_seed} ...")
            return generate_one(pipeline, key, prompt, new_seed, manual)
        # Accepted — GLB already prepared, fall through to save

    glb.export(glb_out)
    if not manual:
        save_preview(outputs, key)

    # Explicitly free GPU tensors before the next generation
    del glb, outputs
    torch.cuda.empty_cache()
    print(f"  3D    → {glb_out}")
    print(f"  image → {img_out}")
    return glb_out, img_out


def run_optimize():
    import subprocess
    optimize_sh = os.path.join(SCRIPT_DIR, "optimize.sh")
    assert os.path.exists(optimize_sh), f"optimize.sh not found: {optimize_sh}"
    print("\n[generate] Running optimize.sh ...")
    result = subprocess.run(["bash", optimize_sh], cwd=SCRIPT_DIR)
    assert result.returncode == 0, f"optimize.sh exited with code {result.returncode}"
    print("[generate] Optimization complete.")


# ── CLI ────────────────────────────────────────────────────────────────────────

def parse_args(all_keys: list[str]):
    parser = argparse.ArgumentParser(
        description="Generate GLB models + PNG previews for motzip via TRELLIS text-to-3D."
    )
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--all", action="store_true", help="Generate all items selected by --type.")
    target.add_argument("--category", choices=all_keys, metavar="KEY",
                        help=f"Generate one item. Choices: {', '.join(all_keys)}")

    parser.add_argument("--type", choices=["food", "building", "all"], default="all",
                        help="Which asset group to generate (default: all).")
    parser.add_argument("--seed", type=int, default=42, help="Random seed (default: 42).")
    parser.add_argument("--manual", action="store_true",
                        help="Show preview image and pause for Y/n/retry after each.")
    parser.add_argument("--optimize", action="store_true",
                        help="Run optimize.sh after generation.")
    parser.add_argument("--skip-existing", action="store_true",
                        help="Skip items whose GLB already exists in 3d/.")
    return parser.parse_args()


def main():
    all_prompts = load_prompts()
    args = parse_args(list(all_prompts.keys()))

    prompts = filter_by_type(all_prompts, args.type)

    keys: list[str]
    if args.all:
        keys = list(prompts.keys())
    else:
        assert args.category in all_prompts, f"Unknown key: {args.category}"
        keys = [args.category]
        prompts = {args.category: all_prompts[args.category]}

    if args.skip_existing:
        before = keys[:]
        keys = [k for k in keys if not os.path.exists(glb_path_for(k))]
        skipped = set(before) - set(keys)
        if skipped:
            print(f"[generate] Skipping already-generated: {', '.join(sorted(skipped))}")

    if not keys:
        print("[generate] Nothing to generate.")
        return

    print(f"[generate] {len(keys)} item(s): {', '.join(keys)}")

    pipeline = load_pipeline()

    saved_glb: list[str] = []
    saved_img: list[str] = []
    for key in keys:
        glb, img = generate_one(pipeline, key, prompts[key], args.seed, args.manual)
        if glb:
            saved_glb.append(glb)
        if img:
            saved_img.append(img)

    print(f"\n[generate] Done.")
    print(f"  3D files : {len(saved_glb)}/{len(keys)}")
    print(f"  Images   : {len(saved_img)}/{len(keys)}")

    if args.optimize and saved_glb:
        run_optimize()


if __name__ == "__main__":
    main()
