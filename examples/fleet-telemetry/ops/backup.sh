#!/usr/bin/env bash
# fleet-telemetry backup — dump the DB, ship it to object storage, keep
# the last N copies.
set -euo pipefail

source lib/env.sh
source lib/log.sh

dump_db() {
  pg_dump -h "$DB_HOST" fleet > "backups/fleet-$(date +%F).sql"
}

upload_dump() {
  aws s3 cp "backups/fleet-$(date +%F).sql" "s3://$BACKUP_BUCKET/"
}

rotate_local() {
  ls -1t backups/*.sql | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm --
}

main() {
  load_env
  log_step "backup start"
  dump_db
  upload_dump
  rotate_local
  log_step "backup done"
  return 0
}

main "$@"
