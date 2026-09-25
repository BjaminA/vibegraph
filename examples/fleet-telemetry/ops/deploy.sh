#!/usr/bin/env bash
# fleet-telemetry deploy — build the codec, migrate the DB, restart the
# service on every API host, then smoke-check each host in a loop.
set -euo pipefail

source lib/env.sh
source lib/log.sh

build_codec() {
  make -C codec decode
}

migrate_db() {
  psql -h "$DB_HOST" -f migrations/latest.sql
}

restart_hosts() {
  for host in "${API_HOSTS[@]}"; do
    ssh "deploy@$host" "systemctl restart fleet-api"
  done
}

# One liveness call per host — each iteration pays a round trip.
smoke_hosts() {
  for host in "${API_HOSTS[@]}"; do
    curl -fsS "http://$host/health"
  done
}

# Build, migrate, restart, verify.
main() {
  load_env
  log_step "deploy $RELEASE"
  build_codec
  migrate_db
  restart_hosts
  smoke_hosts
  log_step "deploy done"
  return 0
}

main "$@"
