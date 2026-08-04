#!/usr/bin/env bash
# OPUS-SHOWDOWN — metering passthrough for the claude CLI.
#
# Used as VG_CLAUDE_BIN (VibeGraph arm) and invoked directly (plain arm).
# It forces the model and tees stdout to a per-invocation JSONL log so the
# usage / total_cost_usd envelope fields — which VibeGraph itself discards —
# are captured for the comparison report. Zero product-code changes.
#
# Contract (verified against the spawn sites):
#  - VG_CLAUDE_BIN is whitespace-split: this path must contain no spaces.
#  - Prefix args land BEFORE `-p`, so `--model` is prepended here (never
#    appended: gen spawns end with `-- <prompt>` and a trailing flag would
#    become a positional).
#  - stdout must carry ONLY the CLI's output (gen path strict-JSON.parses
#    the whole buffer); all meter metadata goes to the log file.
#  - stdin passes through untouched (the chat child is a live NDJSON
#    stream); exit code must be the CLI's (PIPESTATUS through tee).
#
# Log: reviews/opus-showdown-2026-08/meter/<arm>-<pid>-<epoch>.jsonl
# Arm: $VG_METER_ARM if set (the playwright webServer env whitelist does NOT
# forward it, so the VibeGraph arm always uses the baked default).

set -u

MODEL="${VG_METER_MODEL:-claude-opus-5}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
METER_DIR="${VG_METER_DIR:-$REPO_ROOT/reviews/opus-showdown-2026-08/meter}"
mkdir -p "$METER_DIR"

ARM="${VG_METER_ARM:-vibegraph}"
LOG="$METER_DIR/${ARM}-$$-$(date +%s).jsonl"

REAL_CLAUDE="$(command -v claude)"
if [ -z "$REAL_CLAUDE" ]; then
  echo "claude_meter: no real claude CLI on PATH" >&2
  exit 127
fi

# Meta line (log file only, never stdout): argv flags without the prompt
# payload, so the report can tell spawn kinds apart.
FLAGS=""
for a in "$@"; do
  case "$a" in
    --) break ;;
    *) FLAGS="$FLAGS $a" ;;
  esac
done
FLAGS_CLEAN="$(printf '%s' "${FLAGS# }" | tr -d '"\\')"
printf '{"_meter":{"arm":"%s","model":"%s","pid":%d,"flags":"%s"}}\n' \
  "$ARM" "$MODEL" "$$" "$FLAGS_CLEAN" >> "$LOG"

"$REAL_CLAUDE" --model "$MODEL" "$@" | tee -a "$LOG"
exit "${PIPESTATUS[0]}"
