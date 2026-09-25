#!/usr/bin/env bash
# The pattern that dead-ended: bash resolves a sibling .mjs and execs it.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="${NODE_BIN:-node}"
MJS_SCRIPT="${SCRIPT_DIR}/ingest.mjs"
# Sourced through a VARIABLE: the linker cannot follow it, so `log_step`
# below is a bare word to it — and it is still this project's own function.
source "${SCRIPT_DIR}/lib/log.sh"

main() {
  log_step "ingest $1"
  "${NODE_BIN}" "${MJS_SCRIPT}" "$1"
}

main "$@"
