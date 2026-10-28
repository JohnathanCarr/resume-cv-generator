#!/usr/bin/env bash
# Smoke test: runs test/smoke/smoke.html (the real app over a stubbed chrome
# API and a stubbed OpenAI; nothing is sent or billed) in headless Chrome and
# checks the main flows. Also compares the tailored resume's measured page
# height with test/smoke/expected.json, so preview layout drift cannot slip
# through unnoticed. Needs Google Chrome; set CHROME to use another binary.
#
#   ./scripts/smoke.sh            run the checks
#   ./scripts/smoke.sh --update   run them and record the current page height
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/test/smoke/run.mjs" "$@"
