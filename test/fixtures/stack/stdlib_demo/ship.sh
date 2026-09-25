#!/usr/bin/env bash
# M-TABLES fixture, bash half. Three kinds of word, three different facts:
#
#   cd / echo    the shell itself          -> not a tool at all
#   curl         a named external tool     -> origin "third-party"
#   wibblectl    a word no table knows     -> origin "unknown"
#
# The last one used to claim "third-party", inventing a dependency out of
# not having a table. Nothing here can tell what `wibblectl` is: `command -v`
# would answer for the machine doing the PARSING, not the deploy host.
set -euo pipefail

deploy() {
  local bundle="$1"
  local endpoint="$2"
  cd "$(dirname "$0")"
  echo "shipping ${bundle}"
  curl -sSf -T "${bundle}" "${endpoint}"
  wibblectl register "${bundle}"
}

main() {
  deploy "$@"
}

main "$@"
