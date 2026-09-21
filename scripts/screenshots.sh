#!/usr/bin/env bash
# Renders the store screenshots (1280×800) from store/screenshots.html with
# headless Chrome. Needs the static server running: python3 -m http.server 8790
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
BASE="${BASE:-http://localhost:8790}"
for scene in profile generate keywords; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1280,800 --virtual-time-budget=4000 \
    --screenshot="$ROOT/store/screenshot-$scene.png" "$BASE/store/screenshots.html#$scene" 2>/dev/null
  echo "store/screenshot-$scene.png"
done
