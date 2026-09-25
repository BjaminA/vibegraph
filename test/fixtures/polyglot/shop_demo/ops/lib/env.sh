# lib/env.sh — sourced by deploy.sh: environment loading + step logging.

# Load DB_HOST / API_HOST / GATEWAY_HOST from the env file.
load_env() {
  if [ -f .env ]; then
    set -a
    source .env
    set +a
  fi
  : "${DB_HOST:=db.internal}"
  : "${API_HOST:=api.internal}"
  : "${GATEWAY_HOST:=gw.internal}"
}

# Log one deploy step to stdout and syslog.
log_step() {
  echo "[deploy] $1"
  logger -t shop-deploy "$1"
}
