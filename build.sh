#!/usr/bin/env bash
# Render resume.html -> Aswin_Resume.pdf using headless Chromium.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
chromium --headless --no-sandbox --disable-gpu --no-margins \
  --print-to-pdf="$DIR/Aswin_Resume.pdf" --print-to-pdf-no-header \
  "file://$DIR/resume.html"
echo "Built $DIR/Aswin_Resume.pdf"
