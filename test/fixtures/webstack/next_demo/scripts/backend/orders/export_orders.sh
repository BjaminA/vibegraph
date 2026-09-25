#!/usr/bin/env bash
# A backend script in the quiver: run by the platform on the browser's
# behalf (lib/volt.ts hands its relative path to the Volt client), it has no
# `main` — its body IS its main (M-FLOW.1) — and it runs a Node helper by
# path (M-FLOW.2: a `command` crossing bash → node).
set -euo pipefail
REGION="${1:-all}"
HERE="$(cd "$(dirname "$0")" && pwd)"

psql "$DATABASE_URL" -c "copy (select * from orders where region = '${REGION}') to stdout csv" > "/tmp/orders-${REGION}.csv"
node "${HERE}/../lib/rates.mjs" "$REGION"
curl -s "https://api.exchangerate.host/latest?base=GBP" > "/tmp/rates-${REGION}.json"
echo "{\"region\":\"${REGION}\",\"ok\":true}"
