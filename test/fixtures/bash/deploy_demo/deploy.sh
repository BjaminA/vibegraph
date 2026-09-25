#!/usr/bin/env bash
# deploy_demo — M-LANG2a fixture. Shaped to pin every mapping decision:
# source→import (cross-file link into lib/common.sh), the effect
# vocabulary (curl→http, psql→db, rm→fs, echo→log), the honest
# subprocess default (ssh), dynamic honesty ($CMD, eval), a pipeline
# with data edges, if/elif/else, for, while/until, case, and the
# `main "$@"` entry pattern.
set -euo pipefail

source lib/common.sh

RELEASE="v1.4.2"
BUILD_STAMP=$(date +%s)

# Clean the build dir and pack the release tarball.
prepare() {
  rm -rf build/
  mkdir -p build/
  tar -czf "build/app-$RELEASE.tgz" src/
}

# Upload the tarball to the target environment (staging|canary|prod).
upload() {
  if [ "$1" = "staging" ]; then
    curl -fsS -T "build/app-$RELEASE.tgz" "https://staging.example.com/upload"
  elif [ "$1" = "canary" ]; then
    ssh deploy@canary.example.com "systemctl restart app"
  else
    curl -fsS -T "build/app-$RELEASE.tgz" "https://prod.example.com/upload"
  fi
}

record_release() {
  psql -h db.internal -c "insert into releases (tag, stamp) values ('$RELEASE', $BUILD_STAMP)"
}

watch_logs() {
  while read -r line; do
    echo "$line"
  done < /var/log/app.log
}

# Build, upload everywhere, record the release, then run the deploy hook.
main() {
  log_step "deploy $RELEASE"
  prepare
  for target in staging prod; do
    upload "$target"
  done
  record_release
  fetch_status | grep -v healthy | tee build/unhealthy.txt
  case "$1" in
    verbose) watch_logs ;;
    *) echo "done" ;;
  esac
  HOOK_CMD="${DEPLOY_HOOK:-true}"
  "$HOOK_CMD" --release "$RELEASE"
  eval "$POST_DEPLOY"
  return 0
}

main "$@"
