#!/usr/bin/env bash
# Render resume.html -> Aswin_Resume.pdf using headless Chromium.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BROWSER="${BROWSER:-chromium}"   # CI can override, e.g. BROWSER=$(which google-chrome)
"$BROWSER" --headless --no-sandbox --disable-gpu --no-margins \
  --print-to-pdf="$DIR/Aswin_Resume.pdf" --print-to-pdf-no-header \
  "file://$DIR/resume.html"
echo "Built $DIR/Aswin_Resume.pdf"
