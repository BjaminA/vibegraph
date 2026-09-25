#!/usr/bin/env bash
# M-LANG5a — regenerate the C++ frontend's committed snapshots:
#   test/fixtures/cpp/geometry_demo/geometry_demo.ir.json      (linked map)
#   test/fixtures/cpp/geometry_demo/geometry_demo.thread.json  (main thread)
# Never hand-edit (vibegraph-fixtures contract).
set -euo pipefail
cd "$(dirname "$0")/.."

FIXTURE=test/fixtures/cpp/geometry_demo
OUT="$FIXTURE/geometry_demo.ir.json"
THREAD_OUT="$FIXTURE/geometry_demo.thread.json"

(cd "$FIXTURE" && printf 'main.cpp\tmain.cpp\ngeometry.h\tgeometry.h\ngeometry.cpp\tgeometry.cpp\ngeometry_test.cpp\tgeometry_test.cpp\n' \
  | node ../../../../scripts/frontends/cpp/parse_cpp.mjs --batch) \
  | node -e '
    let raw = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      const { files, errors } = JSON.parse(raw);
      if (Object.keys(errors ?? {}).length) {
        console.error("regen_cpp: parse errors:", JSON.stringify(errors));
        process.exit(1);
      }
      process.stdout.write(JSON.stringify({ files }));
    });' \
  | node scripts/frontends/cpp/link_cpp.mjs \
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
      { seedFile: "main.cpp", seedId: "module/main.fn", entryPointId: "main.cpp:main" },
      { seedFile: "geometry_test.cpp", seedId: "module/GeometrySuite_AreaOfUnitCircle.fn", entryPointId: "geometry_test.cpp:GeometrySuite.AreaOfUnitCircle" },
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
