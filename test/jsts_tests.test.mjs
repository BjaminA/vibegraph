// TypeScript / JavaScript tests reach their threads (2026-09-29). On
// a private production codebase all 363 contracts said "no discovered test reaches this thread"
// with 95 test files on disk, for three reasons, each pinned here on a
// synthetic fixture (test/fixtures/jsts/tests_demo):
//   1. discovery only knew `it("x", namedFn)` — real suites use inline
//      arrows; a test file is now seeded on its MODULE (and .mjs counts);
//   2. `const { f } = await import("./x")` bound nothing;
//   3. once 1 and 2 work, a module the test MOCKS must not count as tested.
//
//   npm run test:jsts-tests
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { testReach } from "../src/shared/test_reach.ts";

let env;
before(() => { env = buildPolyglotEnvelope("test/fixtures/jsts/tests_demo", { skipSystem: true }).envelope; });

const TESTS = ["checkout.test.mjs", "dyn.test.ts", "mocked.test.ts", "price.test.ts"].map((f) => `src/__tests__/${f}:module`);

test("a test file of inline suites is one test entry point, seeded on its module (.mjs included)", () => {
  const tests = env.entryPoints.filter((e) => e.kind === "test").map((e) => e.id).sort();
  assert.deepEqual(tests, TESTS);
  const price = env.entryPoints.find((e) => e.id === "src/__tests__/price.test.ts:module");
  assert.equal(price.irNodeId, "module");
  assert.equal(price.framework, "vitest");
  assert.match(price.summary, /tests: price/);
  assert.equal(env.entryPoints.find((e) => e.id === "src/__tests__/checkout.test.mjs:module").framework, "test", "node:test");
});

test("the test's thread walks into the code its suites call", () => {
  const t = env.threads.find((x) => x.entryPointId === "src/__tests__/price.test.ts:module");
  assert.ok(t.nodes.some((n) => n.kind === "step" && n.file === "src/price.ts" && n.irNodeId === "module/applyDiscount.fn"));
});

test("a destructured `await import()` binds its names: the call is a step, not unresolved", () => {
  const t = env.threads.find((x) => x.entryPointId === "src/__tests__/dyn.test.ts:module");
  assert.ok(t.nodes.some((n) => n.kind === "step" && n.file === "src/price.ts" && n.irNodeId === "module/checkout.fn"), "checkout is a step");
  assert.ok(!t.nodes.some((n) => n.kind === "unresolved" && n.label === "checkout"));
});

test("the route's thread is tested by the three real tests, and NOT by the one that mocks its module", () => {
  const route = env.entryPoints.find((e) => e.kind === "route");
  assert.ok(route, "the express route is discovered");
  const tb = testReach(env.threads, env.entryPoints).get(route.id);
  const by = tb.partial.map((p) => p.entryPointId).sort();
  assert.deepEqual(by, ["src/__tests__/checkout.test.mjs:module", "src/__tests__/dyn.test.ts:module", "src/__tests__/price.test.ts:module"]);
  assert.deepEqual(tb.direct, [], "no test calls the route handler itself");
  const mocked = env.entryPoints.find((e) => e.id === "src/__tests__/mocked.test.ts:module");
  assert.deepEqual(mocked.metadata.mocks, ["src/price.ts"], "the mock resolves to the project file it replaces");
});
