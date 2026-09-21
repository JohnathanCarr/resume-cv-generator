#!/usr/bin/env bash
# Builds the Chrome Web Store upload: dist/resume-studio-<version>.zip
# containing the *contents* of extension/ at the zip root (the store rejects
# a zip whose manifest.json sits inside a folder). Excludes OS cruft.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/extension"
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$SRC/manifest.json")"
OUT_DIR="$ROOT/dist"
OUT="$OUT_DIR/resume-studio-$VERSION.zip"

[ -n "$VERSION" ] || { echo "Could not read version from manifest.json" >&2; exit 1; }
for f in manifest.json background.js app.html app.js icons/icon128.png; do
  [ -f "$SRC/$f" ] || { echo "Missing $SRC/$f" >&2; exit 1; }
done

mkdir -p "$OUT_DIR"
rm -f "$OUT"
( cd "$SRC" && zip -qr -X "$OUT" . -x '.DS_Store' '*/.DS_Store' '*.md' '.*' )

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
unzip -Z1 "$OUT" | sed 's/^/  /'
