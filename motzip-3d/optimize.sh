#!/bin/bash
# Optimize GLB files in 3d/ → optimized/ → deploy to motzip-app/public/models/
# Requires: npm install -g @gltf-transform/cli
#
# Pipeline: dedup → simplify → resize textures → prune → draco (LAST!)
# Target: <500 KB per food icon, <1 MB per building

set -e

DEPLOY_DIR="../motzip-app/public/models"

optimize_dir() {
  local input_subdir="$1"
  local output_subdir="$2"
  local deploy_subdir="$3"
  local simplify_ratio="$4"
  local tex_size="$5"

  mkdir -p "$output_subdir" "$deploy_subdir"

  shopt -s nullglob
  local files=("$input_subdir"/*.glb)
  shopt -u nullglob

  if [ ${#files[@]} -eq 0 ]; then
    echo "  (no files in $input_subdir, skipping)"
    return
  fi

  for file in "${files[@]}"; do
    name=$(basename "$file")
    out="$output_subdir/$name"
    echo "  $name..."

    # 1. Dedup — merge identical textures/materials/meshes
    gltf-transform dedup "$file" "$out"

    # 2. Simplify — reduce polygon count
    gltf-transform simplify "$out" "$out" \
      --ratio "$simplify_ratio" \
      --error 0.01

    # 3. Resize textures — shrink before Draco so decode/re-encode isn't needed
    gltf-transform resize "$out" "$out" \
      --width "$tex_size" --height "$tex_size"

    # 4. Prune — strip unused resources after simplification
    gltf-transform prune "$out" "$out"

    # 5. Draco — geometry compression, MUST BE LAST
    gltf-transform draco "$out" "$out"

    size=$(du -h "$out" | cut -f1)
    cp "$out" "$deploy_subdir/$name"
    echo "    → $deploy_subdir/$name ($size)"
  done
}

echo "=== Optimizing food icons ==="
optimize_dir "3d/food" "optimized/food" "$DEPLOY_DIR/food" 0.05 256

echo ""
echo "=== Optimizing building models ==="
optimize_dir "3d/buildings" "optimized/buildings" "$DEPLOY_DIR/buildings" 0.1 256

echo ""
echo "=== Summary ==="
echo "Food:"
ls -lhS "$DEPLOY_DIR/food/"*.glb 2>/dev/null || true
echo ""
echo "Buildings:"
ls -lhS "$DEPLOY_DIR/buildings/"*.glb 2>/dev/null || true
echo ""
total=$(du -sh "$DEPLOY_DIR" | cut -f1)
echo "Total: $total"
