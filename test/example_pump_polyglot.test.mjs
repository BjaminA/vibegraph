/**
 * Example 3 — pump-polyglot, pinned against its README (2026-09-06).
 *
 * `examples/pump-polyglot` is the four-language example the orchestrated
 * drill runs on; its README makes specific claims — which launchpad rows
 * appear per language, that no thread crosses a language, that every
 * cross-language hop is an honest external, that exactly two threads pay
 * a round trip per row, that `smooth` is unresolved. This test runs the
 * REAL per-language pipeline (the same one server.ts runs, via
 * scripts/regen_polyglot.mjs) and the REAL contract derivation over the
 * example in place (read-only; nothing is written).
 *
 * Run: npm run test:example-pump-polyglot
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { computeThreadContract } from "../src/server/thread_contract.ts";
import { languageForPath } from "../src/shared/languages.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXAMPLE = join(ROOT, "examples", "pump-polyglot");

const built = buildPolyglotEnvelope(EXAMPLE);
const env = built.envelope;
const nodeFor = (file, irNodeId) => {
  if (!irNodeId) return null;
  for (const ir of file ? [env.files[file]].filter(Boolean) : Object.values(env.files)) {
    const n = ir.nodes.find((x) => x.id === irNodeId);
    if (n) return n;
  }
  return null;
};
const thread = (ep) => {
  const t = env.threads.find((x) => x.entryPointId === ep);
  assert.ok(t, `thread ${ep} missing — have ${env.threads.map((x) => x.entryPointId).join(", ")}`);
  return t;
};
const contract = (ep) => computeThreadContract(thread(ep), { nodeFor, reaches: [], reachedBy: [] });

test("every file in all four languages parses; the envelope validates", () => {
  assert.deepEqual(built.parseErrors, {});
  assert.deepEqual(built.languages.sort(), ["bash", "cpp", "jsts", "python"]);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", "project_ir.schema.json"), "utf-8")));
  assert.equal(validate(env), true, JSON.stringify(validate.errors, null, 2));
});

test("README: the launchpad rows per language", () => {
  const kinds = Object.fromEntries(env.entryPoints.map((e) => [e.id, `${e.kind}/${e.framework ?? "-"}`]));
  assert.equal(kinds["api.py:predict_route"], "route/flask");
  assert.equal(kinds["api.py:health"], "route/flask");
  assert.equal(kinds["model.py:WearMLP.forward"], "model/pytorch");
  assert.equal(kinds["train.py:main"], "cli/-");
  assert.equal(kinds["dashboard/server.ts:postReading"], "route/express");
  assert.equal(kinds["dashboard/server.ts:postBatch"], "route/express");
  assert.equal(kinds["dashboard/server.ts:getHealth"], "route/express");
  assert.equal(kinds["ops/pipeline.sh:main"], "cli/shell");
  assert.equal(kinds["native/main.cpp:main"], "cli/-");
  assert.equal(kinds["native/window_stats_test.cpp:WindowStats.MeanOfPushedValues"], "test/gtest");
  assert.equal(kinds["native/window_stats_test.cpp:WindowStats.EmptyWindowIsZero"], "test/gtest");
});

test("FLOOR: no thread crosses a language; every cross-language hop is an honest external named from its own side", () => {
  for (const t of env.threads) {
    const lang = languageForPath(t.seed.file).id;
    for (const f of t.filesReached) assert.equal(languageForPath(f).id, lang, `${t.entryPointId} crossed into ${f}`);
  }
  const ts = contract("dashboard/server.ts:postReading");
  assert.equal(ts.effects.http, 1, "the dashboard reaches the Python API by fetch — http, not a link");
  const sh = contract("ops/pipeline.sh:main");
  assert.equal(sh.effects.subprocess, 3, "python3 make_pump_data.py / python3 train.py / make -C native — subprocess, not links");
  assert.equal(sh.effects.http, 2, "curl /health + the smoke loop");
  const py = contract("api.py:predict_route");
  assert.deepEqual([...py.filesReached].sort(), ["api.py", "data.py", "model.py", "predict.py"], "python walks its own siblings");
});

test("README: THREE threads pay a round trip per row inside a loop — TS postBatch (via postToApi), bash smoke_predict, and the C++ reader's fgets", () => {
  const flagged = env.threads
    .map((t) => [t.entryPointId, computeThreadContract(t, { nodeFor, reaches: [], reachedBy: [] }).roundTrips])
    .filter(([, r]) => r.length > 0);
  // The C++ reader joined this list on 2026-09-21, when the
  // expression-position walk reached calls written in a loop CONDITION:
  // `while (fgets(line, sizeof line, csv) != nullptr)` is one fs read per
  // row and had produced no IR node at all, so the contract could not see
  // it. Correct by the detector's OWN definition — ROUND_TRIP_EFFECTS
  // includes `fs` — and a cheaper trip than the other two. The contract
  // reports the SHAPE; what each trip costs is the reader's judgement.
  assert.deepEqual(flagged.map(([ep]) => ep).sort(),
    ["dashboard/server.ts:postBatch", "native/main.cpp:main", "ops/pipeline.sh:main"]);
  const native = contract("native/main.cpp:main").roundTrips[0];
  assert.deepEqual(native.calls.map((k) => [k.label, k.effectKind]), [["fgets", "fs"]]);
  const batch = contract("dashboard/server.ts:postBatch").roundTrips[0];
  assert.equal(batch.loop, "dashboard/server.ts:postBatch.fn/for@0");
  assert.deepEqual(batch.calls.map((k) => [k.label, k.effectKind, k.via]), [["fetch", "http", "postToApi"]]);
  const smoke = contract("ops/pipeline.sh:main").roundTrips[0];
  assert.equal(smoke.loop, "ops/pipeline.sh:smoke_predict.fn/for@0");
  assert.deepEqual(smoke.calls.map((k) => [k.label, k.effectKind]), [["curl", "http"]]);
  // evaluate_holdout's per-row loop is pure compute — NOT flagged, on purpose.
  assert.equal(contract("predict.py:evaluate_holdout").roundTrips.length, 0);
});

test("README: `smooth` is unresolved (two overloads; the linker will not pick) and the data contract is visible", () => {
  const main = thread("native/main.cpp:main");
  assert.ok(main.nodes.some((n) => n.kind === "unresolved" && n.label === "smooth"));
  assert.ok(!main.nodes.some((n) => n.kind === "step" && n.label === "smooth"));
  const api = contract("api.py:predict_route");
  assert.match(api.interface.docstring, /Score one row of 8 sensor readings/);
  const client = contract("dashboard/server.ts:postBatch");
  assert.deepEqual(client.interface.params, ["req", "res"]);
  const postToApi = env.files["dashboard/api_client.ts"].nodes.find((n) => n.id === "module/postToApi.fn");
  assert.deepEqual(postToApi.params, ["readings: number[]"]);
  assert.equal(postToApi.returns, "Promise<Scored>");
});
