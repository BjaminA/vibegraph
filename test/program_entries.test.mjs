// Programs found without manual seeds (2026-10-01, item 4 of the hooks-
// feedback brief, and Module 4 of the planned-architecture brief). Fixture
// test/fixtures/jsts/program_demo, one file per way a TypeScript file says it
// is run: a package `bin` (built to dist/, found by its source), a package
// script through tsx, a `.listen()`, a top-level `await`, `process.argv`
// read inside a main() the file calls — and a library that computes at load
// but runs nothing, which must stay unseeded.
//
//   npm run test:program-entries
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { scriptTargets, resolvePackagePath } from "../scripts/package_entries.mjs";

const ROOT = "test/fixtures/jsts/program_demo";
let byFile;
before(() => {
  const env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  byFile = new Map(env.entryPoints.map((e) => [e.file, e]));
  globalThis.__env = env;
});

test("a package bin is found by its SOURCE (dist/cli.js → src/cli.ts), seeded on the module", () => {
  const e = byFile.get("src/cli.ts");
  assert.ok(e, [...byFile.keys()].join(", "));
  assert.equal(e.id, "src/cli.ts:module");
  assert.equal(e.framework, "package-bin");
  assert.deepEqual(e.metadata, { seed: "module", package: "program-demo", bin: "demo" });
  assert.match(e.summary, /bin "demo" of program-demo/);
});

test("a package script that runs a file through tsx makes it an entry", () => {
  const e = byFile.get("src/bin/provision.ts");
  assert.equal(e?.framework, "package-script");
  assert.equal(e.metadata.script, "provision");
});

test("a file that listens, awaits at the top, or reads process.argv in a main() it calls is a program", () => {
  assert.deepEqual(byFile.get("src/server.ts")?.metadata, { seed: "module", signals: ["listen"] });
  assert.deepEqual(byFile.get("src/migrate.ts")?.metadata, { seed: "module", signals: ["await"] });
  const args = byFile.get("src/args.ts");
  assert.equal(args?.id, "src/args.ts:main", "main() called at load is the richer seed");
  assert.deepEqual(args.metadata.signals, ["argv"]);
  assert.match(args.summary, /runs when loaded: reads process\.argv/);
  const ir = globalThis.__env.files["src/args.ts"];
  assert.deepEqual(ir.programSignals, ["argv"]);
});

test("a library that only computes at load is not a program", () => {
  assert.equal(byFile.get("src/lib.ts"), undefined);
  assert.equal(globalThis.__env.files["src/lib.ts"].programSignals, undefined, "nothing stamped: the IR is byte-identical");
});

test("script parsing: runners, wrappers and env assignments; non-runners ignored", () => {
  assert.deepEqual(scriptTargets("NODE_ENV=dev npx tsx watch-free src/server.ts"), [{ runner: "tsx", file: "src/server.ts" }]);
  assert.deepEqual(scriptTargets("node --loader ts-node/esm scripts/a.ts && eslint . | tee x"), [{ runner: "node", file: "scripts/a.ts" }]);
  assert.deepEqual(scriptTargets("pnpm exec vite-node tools/b.mts"), [{ runner: "vite-node", file: "tools/b.mts" }]);
  assert.deepEqual(scriptTargets("eslint src/a.ts"), []);
  assert.equal(resolvePackagePath("pkg", "./dist/bin/x.js", new Set(["pkg/src/bin/x.ts"])), "pkg/src/bin/x.ts");
  assert.equal(resolvePackagePath("", "lib/x.mjs", new Set(["src/x.mts"])), "src/x.mts");
  assert.equal(resolvePackagePath("", "dist/missing.js", new Set(["src/x.ts"])), null);
});
