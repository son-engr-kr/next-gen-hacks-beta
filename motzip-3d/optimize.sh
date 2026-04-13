#!/bin/bash
# Optimize all GLB files in raw/ → output to optimized/
# Requires: npm install -g @gltf-transform/cli

set -e

INPUT_DIR="raw"
OUTPUT_DIR="optimized"
DEPLOY_DIR="../motzip-app/public/models"

mkdir -p "$OUTPUT_DIR" "$DEPLOY_DIR"

for file in "$INPUT_DIR"/*.glb; do
  name=$(basename "$file")
  echo "Optimizing $name..."

  gltf-transform simplify "$file" "$OUTPUT_DIR/$name" \
    --ratio 0.3 \
    --error 0.01

  gltf-transform draco "$OUTPUT_DIR/$name" "$OUTPUT_DIR/$name"

  gltf-transform resize "$OUTPUT_DIR/$name" "$OUTPUT_DIR/$name" \
    --width 512 --height 512

  echo "  → $OUTPUT_DIR/$name"
done

# Copy to app
cp "$OUTPUT_DIR"/*.glb "$DEPLOY_DIR/"
echo ""
echo "Done. Deployed to $DEPLOY_DIR"
echo "Models:"
ls -lh "$DEPLOY_DIR"/*.glb
