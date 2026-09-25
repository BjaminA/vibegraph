#!/usr/bin/env bash
# pump-polyglot ops — regenerate data, train, build the native stats
# tool, then smoke-test the API with one curl PER SAMPLE ROW (the bash
# round-trip lever the thread contract flags).
set -euo pipefail

source lib/env.sh

make_data() {
  python3 make_pump_data.py
}

train_model() {
  python3 train.py
}

build_native() {
  make -C native window_stats
}

# One request per sample row — each iteration pays a full round trip.
smoke_predict() {
  for row in "$SAMPLE_A" "$SAMPLE_B"; do
    curl -fsS -X POST -H 'content-type: application/json' \
      -d "{\"readings\": [$row]}" "http://$API_HOST/predict"
  done
}

# Data, model, native tool, then prove the API answers.
main() {
  load_env
  log_step "pipeline start"
  make_data
  train_model
  build_native
  curl -fsS "http://$API_HOST/health"
  smoke_predict
  echo "pipeline done"
  return 0
}

main "$@"
