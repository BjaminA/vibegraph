// System-tier tests (M19.1, PLAN-v5 §1) — the `system` field of the
// project envelope: subsystems[] + cross-subsystem edges[], a pure
// roll-up of threads + effectKind + entryPoints (scripts/build_system_tier.py).
//
// These pin the data model itself (the snapshot equality lives in
// project_ir.test.mjs). They assert the derivation rules hold:
//   - all six subsystem kinds derive on system_demo;
//   - effect edges carry a resolvable viaThread drill-down handle;
//   - cache is classified at the aggregation layer, NOT a per-file
//     effectKind (the Q6 invariant — per-file IR stays frozen);
//   - external_http hosts come from parsed URLs;
//   - the library bucket owns manual-seed effects;
//   - the frontend calls-edges are low-confidence text matches to routes;
//   - a project with no frontend (flask_demo) yields no calls edges;
//   - M-NN-2: `backend` means WEB backend — a routeless project's
//     non-manual entries (model/public_api/cli) own `library`, never
//     `backend` (library_only fixture), while a routed project keeps
//     rolling its non-route entries into `backend` (flask_demo).
//
// Run: npm run test:system

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));

const SYSTEM = JSON.parse(readFileSync(
  join(ROOT, "test", "fixtures", "system", "system_demo", "system_demo.project.json"), "utf-8"));
const FLASK = JSON.parse(readFileSync(
  join(ROOT, "test", "fixtures", "threads", "flask_demo", "flask_demo.project.json"), "utf-8"));
const LIBRARY = JSON.parse(readFileSync(
  join(ROOT, "test", "fixtures", "system", "library_only", "library_only.project.json"), "utf-8"));

// Does an edge endpoint resolve to a declared subsystem? Endpoints are
// either a bare subsystem id, an `external_http:<host>` id, or an
// endpoint-qualified `<owner>:<entryPointId>` whose owner is a subsystem.
function endpointResolves(envelope, endpoint) {
  const ids = new Set(envelope.system.subsystems.map((s) => s.id));
  if (ids.has(endpoint)) return true;
  if (endpoint.startsWith("external_http:")) return ids.has(endpoint);
  const head = endpoint.split(":", 1)[0];
  return ids.has(head);
}

test("M19.1: envelope is version 2.1 with a system field", () => {
  assert.equal(SYSTEM.version, "2.1");
  assert.ok(SYSTEM.system, "missing system field");
  assert.ok(Array.isArray(SYSTEM.system.subsystems));
  assert.ok(Array.isArray(SYSTEM.system.edges));
});

test("M19.1: system_demo derives all six subsystem kinds", () => {
  const kinds = new Set(SYSTEM.system.subsystems.map((s) => s.kind));
  for (const k of ["frontend", "backend", "cache", "db", "external_http", "library"]) {
    assert.ok(kinds.has(k), `system_demo missing subsystem kind=${k}`);
  }
});

test("M19.1: backend lists its route endpoints; frontend records detection + path", () => {
  const backend = SYSTEM.system.subsystems.find((s) => s.kind === "backend");
  assert.equal(backend.framework, "flask");
  assert.deepEqual(backend.endpointRefs, [
    "app.py:create_charge_route",
    "app.py:get_user_route",
    "app.py:list_users_route",
  ]);
  const frontend = SYSTEM.system.subsystems.find((s) => s.kind === "frontend");
  assert.equal(frontend.path, "web");
  assert.match(frontend.detectedBy, /package\.json:react/);
});

test("M19.1: every edge endpoint resolves to a declared subsystem", () => {
  for (const e of SYSTEM.system.edges) {
    assert.ok(endpointResolves(SYSTEM, e.from), `edge.from ${e.from} resolves to no subsystem`);
    assert.ok(endpointResolves(SYSTEM, e.to), `edge.to ${e.to} resolves to no subsystem`);
  }
});

test("M19.1: effect edges are high-confidence and carry a resolvable viaThread", () => {
  const epIds = new Set(SYSTEM.entryPoints.map((e) => e.id));
  const threadEpIds = new Set(SYSTEM.threads.map((t) => t.entryPointId));
  const effects = SYSTEM.system.edges.filter((e) => e.kind === "effect");
  assert.ok(effects.length > 0, "expected effect edges");
  for (const e of effects) {
    assert.equal(e.confidence, "high");
    assert.ok(["db", "cache", "http"].includes(e.effectKind), `bad effectKind ${e.effectKind}`);
    assert.ok(e.refs.length > 0, "effect edge has no refs");
    // viaThread back-points into threads[] / entryPoints[] (the drill-down).
    assert.ok(epIds.has(e.viaThread), `viaThread ${e.viaThread} is not an entry point`);
    assert.ok(threadEpIds.has(e.viaThread), `viaThread ${e.viaThread} has no thread`);
  }
});

test("M19.1: cache is classified at the aggregation layer, not in the per-file IR (Q6)", () => {
  // The cache subsystem + edge must exist...
  assert.ok(SYSTEM.system.subsystems.some((s) => s.kind === "cache"));
  const cacheEdges = SYSTEM.system.edges.filter((e) => e.effectKind === "cache");
  assert.ok(cacheEdges.length > 0, "expected a cache effect edge");
  for (const e of cacheEdges) assert.equal(e.evidence, "name-match");
  // ...while NO per-file IR node carries effectKind 'cache' — the
  // per-file EffectKind enum stays frozen (db|http|fs|subprocess|log).
  for (const [f, ir] of Object.entries(SYSTEM.files)) {
    for (const n of ir.nodes) {
      assert.notEqual(n.effectKind, "cache", `${f}:${n.id} leaked a per-file effectKind=cache`);
    }
  }
});

test("M19.1: external_http subsystem id carries the parsed host", () => {
  const ext = SYSTEM.system.subsystems.find((s) => s.kind === "external_http");
  assert.equal(ext.id, "external_http:api.stripe.com");
  assert.equal(ext.label, "api.stripe.com");
  const httpEdge = SYSTEM.system.edges.find((e) => e.effectKind === "http");
  assert.equal(httpEdge.to, "external_http:api.stripe.com");
});

test("M19.1: the library bucket owns the manual-seed thread's effects (§1.5)", () => {
  const libEdges = SYSTEM.system.edges.filter((e) => e.from.startsWith("library"));
  assert.ok(libEdges.length > 0, "expected library-owned effect edges");
  // The manual seed get_user reaches both cache and db.
  const targets = new Set(libEdges.map((e) => e.effectKind));
  assert.ok(targets.has("cache") && targets.has("db"),
    `library edges should reach cache + db; got ${[...targets]}`);
  for (const e of libEdges) {
    const ep = SYSTEM.entryPoints.find((x) => x.id === e.viaThread);
    assert.equal(ep.kind, "manual", "library origin should be a manual entry point");
  }
});

test("M19.1: frontend calls edges are low-confidence string matches to routes", () => {
  const calls = SYSTEM.system.edges.filter((e) => e.kind === "calls");
  assert.equal(calls.length, 3, "expected one calls edge per fetch literal");
  for (const e of calls) {
    assert.equal(e.from, "frontend");
    assert.equal(e.confidence, "low");
    assert.equal(e.evidence, "string-scan");
    assert.match(e.to, /^backend:app\.py:\w+_route$/);
    assert.ok(e.refs.every((r) => r.startsWith("web/")), `calls ref outside web/: ${e.refs}`);
  }
  // The parametered route resolves to the param endpoint, not the bare one.
  const getUser = calls.find((e) => e.to === "backend:app.py:get_user_route");
  assert.ok(getUser, "the /api/users/${id} literal should map to get_user_route");
});

test("M-NN-2: a routeless project derives a library subsystem, never backend (library_only)", () => {
  assert.equal(LIBRARY.version, "2.1");
  // The fixture is the rehearsal's CNN: model + public_api + cli, no routes.
  const epKinds = new Set(LIBRARY.entryPoints.map((e) => e.kind));
  assert.ok(!epKinds.has("route"), "library_only must have no route entry points");
  assert.ok(epKinds.has("model") && epKinds.has("public_api") && epKinds.has("cli"),
    `expected model+public_api+cli entries; got ${[...epKinds]}`);
  const kinds = LIBRARY.system.subsystems.map((s) => s.kind);
  assert.ok(!kinds.includes("backend"), "routeless project must not derive a backend card");
  assert.ok(kinds.includes("library"), "routeless project must derive a library card");
});

test("M-NN-2: the library card owns the routeless project's entry points", () => {
  const lib = LIBRARY.system.subsystems.find((s) => s.kind === "library");
  const nonManual = LIBRARY.entryPoints.filter((e) => e.kind !== "manual").map((e) => e.id).sort();
  assert.deepEqual(lib.endpointRefs, nonManual,
    "library endpointRefs must list every non-manual entry point");
  assert.equal(lib.fileCount, Object.keys(LIBRARY.files).length);
});

test("M-NN-2: a routed project still rolls non-route entries into backend (flask_demo)", () => {
  // flask_demo has cli/test/public_api entries alongside its routes — the
  // has_routes gate keeps them in backend (the 6d/Flask baseline).
  const epKinds = new Set(FLASK.entryPoints.map((e) => e.kind));
  assert.ok(epKinds.has("route") && epKinds.has("cli"),
    "flask_demo should carry routes plus non-route entries");
  const backend = FLASK.system.subsystems.find((s) => s.kind === "backend");
  assert.ok(backend, "routed project keeps its backend card");
  // Its library card (manual-seed bucket) carries no endpointRefs — the
  // owned-entries shape is exclusive to the routeless case.
  const lib = FLASK.system.subsystems.find((s) => s.kind === "library");
  assert.ok(lib && lib.endpointRefs === undefined,
    "routed project's library card must not claim entry points");
});

test("M19.1: a project with no frontend yields no calls edges (flask_demo)", () => {
  assert.equal(FLASK.version, "2.1");
  assert.ok(!FLASK.system.subsystems.some((s) => s.kind === "frontend"),
    "flask_demo has no web dir — frontend must not be detected");
  assert.equal(FLASK.system.edges.filter((e) => e.kind === "calls").length, 0,
    "no frontend → no calls edges");
  // It still derives backend + db from parsed effectKinds.
  const kinds = new Set(FLASK.system.subsystems.map((s) => s.kind));
  assert.ok(kinds.has("backend") && kinds.has("db"));
});
