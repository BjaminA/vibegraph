#!/usr/bin/env bash
# The dispatcher: runs one allow-listed script by its path under bin/.
#   orchestrator.sh <relative_script_path> [args...]
set -euo pipefail

REL_SCRIPT="${1:?usage: orchestrator.sh <script> [args...]}"
shift

ALLOWED_SCRIPTS=(
  "reports/daily.sh"
  "reports/weekly.sh"
  "sync/pull.sh"
  "sync/push.sh"
)

allowed=0
for s in "${ALLOWED_SCRIPTS[@]}"; do
  if [[ "$s" == "$REL_SCRIPT" ]]; then allowed=1; fi
done
if [[ "$allowed" -ne 1 ]]; then
  echo "{\"error\":\"not allowed: $REL_SCRIPT\"}"
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Every script writes its JSON under the shared cache the web app reads.
export CACHE_ROOT="${SCRIPT_DIR}/../../output_cache"
mkdir -p "$CACHE_ROOT"
bash "${SCRIPT_DIR}/${REL_SCRIPT}" "$@" > "${CACHE_ROOT}/$(basename "$REL_SCRIPT" .sh).json"
