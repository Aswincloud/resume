#!/usr/bin/env bash
# Render resume.html -> Aswin_Resume.pdf using headless Chromium.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolve a browser.
#  - CI (and anyone) can pass BROWSER explicitly; we use it as-is and fail
#    loudly if it isn't runnable — we don't second-guess an explicit choice.
#  - Otherwise we search common Chrome/Chromium names, and if none are found
#    offer to install Chromium (only when running interactively).
if [[ -n "${BROWSER:-}" ]]; then
  if ! command -v "$BROWSER" >/dev/null 2>&1 && [[ ! -x "$BROWSER" ]]; then
    echo "BROWSER='$BROWSER' not found or not executable." >&2
    exit 1
  fi
else
  BROWSER=""
  for b in chromium chromium-browser google-chrome google-chrome-stable chrome; do
    if command -v "$b" >/dev/null 2>&1; then BROWSER="$b"; break; fi
  done

  if [[ -z "$BROWSER" ]]; then
    echo "No Chromium/Chrome found on PATH." >&2
    ans="n"
    if [[ -t 0 ]]; then
      read -rp "Install Chromium with apt-get now? [y/N] " ans
    fi
    if [[ "$ans" == [Yy]* ]]; then
      sudo apt-get update || true
      sudo apt-get install -y chromium \
        || sudo apt-get install -y chromium-browser \
        || true
      for b in chromium chromium-browser; do
        if command -v "$b" >/dev/null 2>&1; then BROWSER="$b"; break; fi
      done
    fi
  fi

  if [[ -z "$BROWSER" ]]; then
    echo "No browser available. Install Chromium, or run: BROWSER=/path/to/chrome ./build.sh" >&2
    exit 1
  fi
fi

"$BROWSER" --headless --no-sandbox --disable-gpu --no-margins \
  --print-to-pdf="$DIR/Aswin_Resume.pdf" --print-to-pdf-no-header \
  "file://$DIR/resume.html"
echo "Built $DIR/Aswin_Resume.pdf"
