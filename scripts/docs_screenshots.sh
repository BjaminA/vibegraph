#!/usr/bin/env bash
# Regenerate docs/screenshots/ from real fixtures (test/e2e/docs-screenshots.spec.ts).
#
#   ./scripts/docs_screenshots.sh            # everything
#
# Each fixture is served from a throwaway COPY, so a pin, a run or a trace
# never lands in examples/ or test/fixtures/. The terminal images are the
# real output of the commands, captured here and then drawn as a terminal.
# The Agent Manager shot uses the stub Claude the hooked-run e2e uses (it runs
# the real injected hooks, so the block it shows is real; the model is not).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT/.pydeps${PYTHONPATH:+:$PYTHONPATH}"
TMP="$(mktemp -d /tmp/vg-docs-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
CLI="env NODE_NO_WARNINGS=1 node $ROOT/scripts/cli/main.mjs"

npm run -s build >/dev/null

copy() { mkdir -p "$TMP/$2"; cp -r "$ROOT/$1" "$TMP/$2/"; find "$TMP/$2" -name __pycache__ -prune -exec rm -rf {} +; }
copy examples/fleet-telemetry fx
copy test/fixtures/journeys/journeys_demo jx
copy test/fixtures/hooked_run/hooked_demo hx
copy test/fixtures/dataflow/taint_demo dx
copy test/fixtures/plan/plan_demo px

shots() { # <fixture dir> <port> [extra env...]
  local fix="$1" port="$2"; shift 2
  env VG_DOCS_SHOTS=1 VG_FIXTURE="$fix" VG_PORT="$port" PORT="$port" "$@" \
    npx playwright test test/e2e/docs-screenshots.spec.ts --reporter=list --workers=1
}

shots "$TMP/fx/fleet-telemetry" 4310
shots "$TMP/jx/journeys_demo" 4311
shots "$TMP/px/plan_demo" 4314
shots "$TMP/hx/hooked_demo" 4312 VG_AGENT_ENGINE=hooked \
  VG_CLAUDE_BIN="node $ROOT/test/fixtures/hooked_run/fake_claude_hooked.mjs"

# ── terminal output, captured for real ───────────────────────────────────
TERM_DIR="$TMP/term"; mkdir -p "$TERM_DIR"
FLEET="$TMP/fx/fleet-telemetry"
( cd "$FLEET" && git init -q && git add -A && git -c user.email=d@d -c user.name=d commit -qm base )
PROMPT="Page operators when a device changes region, in telemetry/alerts.py"
{
  echo "\$ claude   # with vibegraph-knowledge init --hooks"
  echo "> $PROMPT"
  echo
  printf '%s' "{\"session_id\":\"docs\",\"prompt\":\"$PROMPT\",\"cwd\":\"$FLEET\"}" \
    | VG_CACHE_DIR="$TMP/cache" $CLI hook prompt --root "$FLEET" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.hookSpecificOutput?.additionalContext??j.systemMessage??s)})' \
    | head -n 46
  echo "…"
} > "$TERM_DIR/hook.txt"
{ echo "\$ vibegraph-knowledge check"; ( cd "$FLEET" && VG_CACHE_DIR="$TMP/cache" $CLI check ) || true; } > "$TERM_DIR/check.txt" 2>&1
{ echo "\$ vibegraph-knowledge dataflow"; ( cd "$TMP/dx/taint_demo" && VG_CACHE_DIR="$TMP/cache" $CLI dataflow ) || true; } > "$TERM_DIR/dataflow.txt" 2>&1
env VG_DOCS_SHOTS=1 VG_DOCS_TERM="$TERM_DIR" VG_PORT=4313 PORT=4313 \
  npx playwright test test/e2e/docs-screenshots.spec.ts -g terminal --reporter=list --workers=1

echo "docs/screenshots/ regenerated"
