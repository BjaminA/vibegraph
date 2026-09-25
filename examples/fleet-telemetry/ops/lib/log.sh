# lib/log.sh — sourced by the ops scripts: step logging.

# Log one step to stdout and syslog.
log_step() {
  echo "[fleet-ops] $1"
  logger -t fleet-ops "$1"
}
