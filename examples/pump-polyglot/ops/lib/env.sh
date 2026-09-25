# lib/env.sh — sourced by pipeline.sh: environment defaults + step logging.

# API host and two sample rows (8 sensor readings each) for the smoke test.
load_env() {
  : "${API_HOST:=localhost:5000}"
  : "${SAMPLE_A:=1.2,0.8,300,0.5,2.1,0.9,1500,0.3}"
  : "${SAMPLE_B:=0.9,0.7,280,0.4,1.9,0.8,1400,0.2}"
}

# Log one pipeline step to stdout and syslog.
log_step() {
  echo "[pipeline] $1"
  logger -t pump-pipeline "$1"
}
