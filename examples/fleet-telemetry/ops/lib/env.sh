# lib/env.sh — sourced by the ops scripts: environment defaults.

# Hosts, database, release tag, and backup settings — env overrides win.
load_env() {
  : "${RELEASE:=v3.1.0}"
  : "${DB_HOST:=db.internal}"
  : "${BACKUP_BUCKET:=fleet-backups}"
  : "${KEEP_BACKUPS:=7}"
  if [ -z "${API_HOSTS+x}" ]; then
    API_HOSTS=(api-1.internal api-2.internal)
  fi
}
