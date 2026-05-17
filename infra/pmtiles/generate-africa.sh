#!/usr/bin/env bash
set -euo pipefail

# Generates africa.pmtiles from OpenStreetMap data using Planetiler.
# Output: ~15GB. Run on a machine with at least 16GB RAM and 80GB disk.
# Prerequisites: Java 21+, curl, rclone (for R2 upload)

PLANETILER_VERSION="0.8.3"
PLANETILER_JAR="planetiler-${PLANETILER_VERSION}-with-deps.jar"
OUTPUT="africa.pmtiles"

if [ ! -f "$PLANETILER_JAR" ]; then
  echo "Downloading Planetiler ${PLANETILER_VERSION}..."
  curl -L -o "$PLANETILER_JAR" \
    "https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/${PLANETILER_JAR}"
fi

echo "Generating ${OUTPUT}..."
java -Xmx12g -jar "$PLANETILER_JAR" \
  --area=africa \
  --download \
  --output="$OUTPUT" \
  --nodemap-type=sparsearray \
  --nodemap-storage=mmap

echo "Done: $(du -sh "$OUTPUT" | cut -f1)"
echo ""
echo "Upload to R2:"
echo "  rclone copy $OUTPUT r2:sentinelmesh-tiles/tiles/"
echo ""
echo "Then update infra/map-style/sentinelmesh-dark.json:"
echo "  Replace {MAPTILES_URL} with:"
echo "  https://r2.sentinelmesh.io/tiles/$OUTPUT"
