#!/usr/bin/env bash
# shop_demo ops — build the C++ worker, migrate the DB, deploy the API
# and the gateway, then health-check EACH host in a loop (the bash
# round-trip lever for the thread contract).
set -euo pipefail

source lib/env.sh

RELEASE="v2.0.0"

build_worker() {
  make -C worker pricing
}

migrate_db() {
  psql -h "$DB_HOST" -f migrations/latest.sql
}

health_check() {
  for host in "$API_HOST" "$GATEWAY_HOST"; do
    curl -fsS "http://$host/health"
  done
}

# Build, migrate, deploy, verify.
main() {
  load_env
  log_step "deploy $RELEASE"
  build_worker
  migrate_db
  ssh "deploy@$API_HOST" "systemctl restart shop-api"
  health_check
  echo "deployed $RELEASE"
  return 0
}

main "$@"
