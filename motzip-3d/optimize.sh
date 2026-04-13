#!/bin/bash
# Optimize GLB files in 3d/ → optimized/ → deploy to motzip-app/public/models/
# Requires: npm install -g @gltf-transform/cli
#
# Input layout:
#   3d/food/*.glb
#   3d/buildings/*.glb
#
# Output layout:
#   optimized/food/*.glb      → public/models/food/
#   optimized/buildings/*.glb → public/models/buildings/

set -e

DEPLOY_DIR="../motzip-app/public/models"

optimize_dir() {
  local input_subdir="$1"   # e.g. 3d/food
  local output_subdir="$2"  # e.g. optimized/food
  local deploy_subdir="$3"  # e.g. ../motzip-app/public/models/food

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
    echo "  $name..."

    gltf-transform simplify "$file" "$output_subdir/$name" \
      --ratio 0.3 \
      --error 0.01

    gltf-transform draco "$output_subdir/$name" "$output_subdir/$name"

    gltf-transform resize "$output_subdir/$name" "$output_subdir/$name" \
      --width 512 --height 512

    cp "$output_subdir/$name" "$deploy_subdir/$name"
    echo "    → $deploy_subdir/$name"
  done
}

echo "=== Optimizing food icons ==="
optimize_dir "3d/food" "optimized/food" "$DEPLOY_DIR/food"

echo ""
echo "=== Optimizing building models ==="
optimize_dir "3d/buildings" "optimized/buildings" "$DEPLOY_DIR/buildings"

echo ""
echo "Done."
ls -lh "$DEPLOY_DIR/food/"*.glb      2>/dev/null || true
ls -lh "$DEPLOY_DIR/buildings/"*.glb 2>/dev/null || true
