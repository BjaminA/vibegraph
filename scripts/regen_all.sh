#!/usr/bin/env bash
# Regenerate every committed IR / envelope / thread snapshot in dependency
# order. Owned by the vibegraph-fixtures skill (bump that skill's version if
# this script's behaviour changes, so doc and tool stay in lockstep).
#
# The ordering is the whole point: project envelopes EMBED the per-file IR,
# and thread snapshots DERIVE from it. Rebuild the linked IRs FIRST or the
# downstream snapshots regenerate against stale input — a trap that already
# cost one session's trial-and-error.
#
# Run after an intentional parser / linker / extractor change. This script
# trusts the drift is intended — ALWAYS inspect `git diff` afterwards, then
# run `npm test` to confirm green.
#
#   ./scripts/regen_all.sh

set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONPATH=.pydeps

# Assert-clean-or-refuse: a MODIFIED tracked fixture SOURCE (.py) must never
# ride into a regen — it silently contaminates every downstream snapshot
# (this has bitten three times; the guard fires BEFORE regen, not after).
# Brand-new (untracked) fixtures are authored-this-session and fine. Override
# with VG_ALLOW_DIRTY_FIXTURES=1 ONLY for a deliberate source+regen change —
# which still owes its own commit + behavioural review (a runtime-behavior
# edit must not hide inside a parser/schema regen).
dirty_src=$(git diff --name-only -- test/fixtures | grep '\.py$' || true)
if [ -n "$dirty_src" ] && [ "${VG_ALLOW_DIRTY_FIXTURES:-}" != "1" ]; then
  echo "ERROR: modified fixture source(s) would contaminate this regen:" >&2
  echo "$dirty_src" | sed 's/^/  - /' >&2
  echo "Revert them ('git checkout -- <path>') or set VG_ALLOW_DIRTY_FIXTURES=1" >&2
  echo "if the source change is intended (it still needs its own commit)." >&2
  exit 1
fi

echo "[1/4] sample_advanced.ir.json — single-file parser snapshot"
python3 scripts/parse_cst.py test/fixtures/sample_advanced.py \
  > test/fixtures/sample_advanced.ir.json

echo "[2/4] linked IRs — project / aero_demo / flask_demo (*.ir.json)"
python3 scripts/regen_link_fixtures.py

echo "[3/4] project envelopes — aero_demo / flask_demo (*.project.json)"
node scripts/regen_project_envelopes.mjs

echo "[4/4] thread snapshots (*.thread.json)"
python3 scripts/extract_thread.py --seed-file main.py --seed-id module/compute_drag.fn \
  < test/fixtures/threads/aero_demo/aero_demo.ir.json \
  > test/fixtures/threads/aero_demo/aero_demo.thread.json
python3 scripts/extract_thread.py --seed-file db.py --seed-id module/insert.fn \
  < test/fixtures/threads/flask_demo/flask_demo.ir.json \
  > test/fixtures/threads/flask_demo/insert.thread.json
python3 scripts/extract_thread.py --seed-file jobs.py --seed-id module/run_job.fn \
  < test/fixtures/threads/exc_demo/exc_demo.ir.json \
  > test/fixtures/threads/exc_demo/run_job.thread.json

echo
echo "done. Inspect 'git diff' (confirm the drift is intended), then 'npm test'."
