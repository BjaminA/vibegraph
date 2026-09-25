#!/usr/bin/env bash
# M-RUST — regenerate the Rust frontend's committed snapshots:
#   test/fixtures/rust/router_demo/router_demo.ir.json      (linked map)
#   test/fixtures/rust/router_demo/router_demo.thread.json  (main + a test)
# Never hand-edit (vibegraph-fixtures contract).
set -euo pipefail
cd "$(dirname "$0")/.."

FIXTURE=test/fixtures/rust/router_demo
OUT="$FIXTURE/router_demo.ir.json"
THREAD_OUT="$FIXTURE/router_demo.thread.json"

# Parsed from INSIDE the fixture so the file keys are crate-relative and
# the parser finds the Cargo.toml above each file (it walks up for the
# manifest — see parse_rust.mjs's Cargo identity note).
(cd "$FIXTURE" && printf 'src/lib.rs\tsrc/lib.rs\nsrc/main.rs\tsrc/main.rs\nsrc/router.rs\tsrc/router.rs\nsrc/store.rs\tsrc/store.rs\ntests/router_test.rs\ttests/router_test.rs\n' \
  | node ../../../../scripts/frontends/rust/parse_rust.mjs --batch) \
  | node -e '
    let raw = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      const { files, errors } = JSON.parse(raw);
      if (Object.keys(errors ?? {}).length) {
        console.error("regen_rust: parse errors:", JSON.stringify(errors));
        process.exit(1);
      }
      process.stdout.write(JSON.stringify({ files }));
    });' \
  | node scripts/frontends/rust/link_rust.mjs \
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
      { seedFile: "src/main.rs", seedId: "module/main.fn", entryPointId: "src/main.rs:main" },
      { seedFile: "tests/router_test.rs", seedId: "module/routes_to_named_sink.fn", entryPointId: "tests/router_test.rs:routes_to_named_sink" },
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
