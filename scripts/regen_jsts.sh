#!/usr/bin/env bash
# M-LANG3 — regenerate the JS/TS frontend's committed snapshots:
#   test/fixtures/jsts/api_demo/api_demo.ir.json      (linked file-map)
#   test/fixtures/jsts/api_demo/api_demo.thread.json  (route threads)
# Never hand-edit (vibegraph-fixtures contract).
set -euo pipefail
cd "$(dirname "$0")/.."

FIXTURE=test/fixtures/jsts/api_demo
OUT="$FIXTURE/api_demo.ir.json"
THREAD_OUT="$FIXTURE/api_demo.thread.json"

(cd "$FIXTURE" && printf 'server.ts\tserver.ts\ndb.ts\tdb.ts\ndb.test.ts\tdb.test.ts\n' \
  | node ../../../../scripts/frontends/jsts/parse_jsts.mjs --batch) \
  | node -e '
    let raw = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      const { files, errors } = JSON.parse(raw);
      if (Object.keys(errors ?? {}).length) {
        console.error("regen_jsts: parse errors:", JSON.stringify(errors));
        process.exit(1);
      }
      process.stdout.write(JSON.stringify({ files }));
    });' \
  | node scripts/frontends/jsts/link_jsts.mjs \
  | node -e '
    let raw = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      const { files } = JSON.parse(raw);
      process.stdout.write(JSON.stringify(files, null, 2) + "\n");
    });' > "$OUT"

node scripts/validate_ir.mjs "$OUT"
echo "regenerated $OUT"

node -e '
  const files = require("./'"$OUT"'");
  process.stdout.write(JSON.stringify({
    files,
    seeds: [
      { seedFile: "server.ts", seedId: "module/listUsers.fn", entryPointId: "server.ts:listUsers" },
      { seedFile: "server.ts", seedId: "module/createUser.fn", entryPointId: "server.ts:createUser" },
      { seedFile: "db.test.ts", seedId: "module/checkQueryUsers.fn", entryPointId: "db.test.ts:checkQueryUsers" },
    ],
  }));' \
  | PYTHONPATH=.pydeps python3 scripts/extract_thread.py --batch-seeds \
  | node -e '
    let raw = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      process.stdout.write(JSON.stringify(JSON.parse(raw), null, 2) + "\n");
    });' > "$THREAD_OUT"
echo "regenerated $THREAD_OUT"
