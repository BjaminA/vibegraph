# lib/common.sh — sourced by deploy.sh; owns the functions the
# cross-file reference edges must land on.

LOG_PREFIX="[deploy]"

# Log one deploy step to stdout and syslog.
log_step() {
  echo "$LOG_PREFIX $1"
  logger -t deploy "$1"
}

fetch_status() {
  curl -fsS "https://prod.example.com/status"
}
