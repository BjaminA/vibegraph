// Nested helpers (2026-09-29). A function defined inside another and called
// there was never walked: both parsers linked a bare call only to a
// MODULE-level def, so the helper's call was `unresolved` and the extractor
// flattened its body into the caller — boundaries in the wrong function,
// outside the loop that calls the helper, and the helper's returns read as
// the caller's. On a private production codebase: 414 helpers, 249 now walked. Fixture:
// test/fixtures/nested/nested_demo (TypeScript + Python).
//
//   npm run test:nested-helpers
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";

let env;
before(() => { env = buildPolyglotEnvelope("test/fixtures/nested/nested_demo", { skipSystem: true }).envelope; });
const thread = (ep) => env.threads.find((t) => t.entryPointId === ep);
const steps = (ep) => thread(ep).nodes.filter((n) => n.kind === "step").map((n) => n.irNodeId);
const refs = (file) => env.files[file].edges.filter((e) => e.type === "reference").map((e) => `${e.source} -> ${e.target}`);

test("TS: a function declared inside an effect and called there is a step, and so is what it calls", () => {
  assert.ok(steps("page.tsx:Panel").includes("module/Panel.fn/load.fn"));
  assert.ok(steps("page.tsx:Panel").includes("module/fetchThing.fn"), "the boundary is reached through the helper");
});

test("TS: a const arrow helper links, and an inner function shadows the top-level one of the same name", () => {
  const s = steps("page.tsx:helper");
  assert.ok(s.includes("module/helper.fn/inner.fn"));
  assert.ok(s.includes("module/helper.fn/shadow.fn"));
  assert.ok(!s.includes("module/shadow.fn"), "the old false edge: helper's shadow() linked to the TOP-LEVEL shadow");
});

test("TS: two definitions of one name in one scope are ambiguous — no edge, an honest unresolved", () => {
  assert.ok(!refs("page.tsx").some((r) => r.includes("/pick.call")));
  assert.equal(thread("page.tsx:twice").nodes.filter((n) => n.kind === "unresolved" && n.label === "pick").length, 2);
});

test("Python: a helper called in a loop is a step INSIDE the loop, so its round trip is a round trip", () => {
  const t = thread("helpers.py:outer");
  const load = t.nodes.find((n) => n.kind === "step" && n.irNodeId === "module/outer.fn/load.fn");
  assert.ok(load, "load is a step");
  const loop = t.nodes.find((n) => n.kind === "container" && n.label === "for i in ids");
  assert.ok(t.edges.some((e) => e.kind === "contains" && e.from === loop.id && e.to === load.id), "…inside the for container");
});

test("Python: an inner def shadows the module def — the false edge is gone", () => {
  assert.deepEqual(refs("helpers.py").filter((r) => r.startsWith("module/uses_shadow.fn/")), ["module/uses_shadow.fn/shadow.call -> module/uses_shadow.fn/shadow.fn"]);
  assert.ok(steps("helpers.py:uses_shadow").includes("module/uses_shadow.fn/shadow.fn"));
});

test("Python: a call naming a PARAMETER stays dynamic — never linked to a def of that name", () => {
  const t = thread("helpers.py:takes_callable");
  assert.ok(t.nodes.some((n) => n.kind === "dynamic" && n.label === "load"));
  assert.ok(!refs("helpers.py").some((r) => r.startsWith("module/takes_callable.fn/")));
});
