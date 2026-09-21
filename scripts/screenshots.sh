#!/usr/bin/env bash
# Renders the store screenshots (1280×800) from store/screenshots.html with
# headless Chrome. Needs the static server running: python3 -m http.server 8790
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
BASE="${BASE:-http://localhost:8790}"
# The store wants JPEG or PNG without an alpha channel; headless Chrome writes
# RGBA PNGs, so convert with sips (macOS) to JPEG.
for scene in profile generate keywords; do
  tmp="$(mktemp -t shot).png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1280,800 --virtual-time-budget=4000 \
    --screenshot="$tmp" "$BASE/store/screenshots.html#$scene" 2>/dev/null
  sips -s format jpeg -s formatOptions 92 "$tmp" --out "$ROOT/store/screenshot-$scene.jpg" >/dev/null
  rm -f "$tmp"
  echo "store/screenshot-$scene.jpg"
done
