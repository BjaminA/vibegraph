#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$1" ]; then
  echo "Usage: ./runVis.sh <path-to-python-file>      Single file"
  echo "       ./runVis.sh <path-to-directory>        Project (all .py files)"
  echo ""
  echo "Examples:"
  echo "  ./runVis.sh test/fixtures/sample_advanced.py"
  echo "  ./runVis.sh myproject/"
  exit 1
fi

# Bootstrap Python deps locally (no system pip required, no sudo).
PYDEPS_DIR="$SCRIPT_DIR/.pydeps"
if ! PYTHONPATH="$PYDEPS_DIR" python3 -c "from libcst import native" 2>/dev/null; then
  echo "Installing Python deps to .pydeps/ (one-time) ..."
  mkdir -p "$PYDEPS_DIR"
  if ! PYTHONPATH="$PYDEPS_DIR" python3 -c "import pip" 2>/dev/null; then
    curl -sSL https://bootstrap.pypa.io/get-pip.py -o /tmp/vg-get-pip.py
    python3 /tmp/vg-get-pip.py --target "$PYDEPS_DIR" --quiet --no-warn-script-location
  fi
  PYTHONPATH="$PYDEPS_DIR" python3 -m pip install --target "$PYDEPS_DIR" --quiet --upgrade -r "$SCRIPT_DIR/requirements.txt"
fi
export PYTHONPATH="$PYDEPS_DIR${PYTHONPATH:+:$PYTHONPATH}"

# Build if dist doesn't exist or is stale
if [ ! -f "$SCRIPT_DIR/dist/server.js" ]; then
  echo "Building VibeGraph..."
  (cd "$SCRIPT_DIR" && node esbuild.mjs)
fi

if [ -d "$1" ]; then
  echo "Starting VibeGraph (project mode)..."
else
  echo "Starting VibeGraph..."
fi

node "$SCRIPT_DIR/dist/server.js" "$1"
