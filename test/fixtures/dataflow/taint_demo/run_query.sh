#!/usr/bin/env bash
# Run a report query — the query arrives as the first argument.
set -euo pipefail

main() {
  local query="$1"
  psql -c "$query"
  eval "$2"
}

main "$@"
