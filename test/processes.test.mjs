// RUNTIME PROCESSES, NOT PACKAGES; RUNS-AS FROM EVIDENCE (2026-10-06, direction
// review M3 + M4). Fixture test/fixtures/system/processes_demo: one package
// holding a listening server, a runner forked by a launcher that first makes
// an account for the run, and an offline tool that shares the runner's write
// logic with an in-memory store. Pinned: a process that listens or that
// another project file forks is its own box, the one-shot scripts stay
// together; who a process runs as comes from the code (an identity env var it
// reads, one its starter passes, an identity its starter creates) and never
// from the plan alone; a plan process placed only by `at` is LOCATED, not
// anchored, and gets no badge from the plan; shared logic run with no client
// for the store is not a writer of it.
//
//   npm run test:processes
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { loadPlan } from "../src/server/plan_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { enrichReal } from "../src/webview/system/arch_real.ts";

const ROOT = "test/fixtures/system/processes_demo";
let derived, real;
before(() => {
  const env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  const stack = buildStackIndex(env, ROOT);
  derived = archModelForEnvelope(env, stack, buildCrossingIndex(env), ROOT, undefined, { applyStore: false });
  const plan = loadPlan(ROOT);
  real = enrichReal(derived, { plan, rec: reconcilePlan(plan, env, stack, ROOT), threads: env.threads });
});
const box = (m, id) => m.nodes.find((n) => n.id === id);

test("a process that listens or is forked is its own box; one-shot scripts stay together", () => {
  const clusters = derived.nodes.filter((n) => n.kind === "cluster").map((n) => n.id).sort();
  assert.deepEqual(clusters, ["cluster:process:.:runner", "cluster:process:.:server", "cluster:scripts:."]);
  assert.deepEqual(box(derived, "cluster:process:.:server").runtime, { how: ["listens"], port: "8080" }); // M12: its own listen call
  assert.deepEqual(box(derived, "cluster:process:.:runner").runtime, { how: ["spawned"], by: ["svc/start-runner.ts"] });
  assert.deepEqual(box(derived, "cluster:scripts:.").entryPoints.sort(), ["svc/start-runner.ts:main", "tools/offline.ts:main"]);
});

test("runs-as from evidence: created per run, given by the starter, read from env — and none for the offline tool", () => {
  const id = (c) => (box(derived, c).identity ?? []).map((i) => `${i.kind}:${i.name}`);
  assert.deepEqual(id("cluster:process:.:runner"), ["created:its own identity, per run", "given:$RUN_CONFIG_PATH"]);
  assert.match(box(derived, "cluster:process:.:runner").identity[0].evidence, /svc\/start-runner\.ts:\d+ calls createRunAccount/);
  assert.deepEqual(id("cluster:process:.:server"), ["env:$SVC_USER"]);
  assert.deepEqual(id("cluster:scripts:."), []);
});

test("shared logic with no client for the store is not a writer of it", () => {
  const writers = derived.edges.filter((e) => e.to === "zone:ledger/status" && e.protocol === "write").map((e) => e.from);
  assert.deepEqual(writers, ["cluster:process:.:runner"]);
  assert.ok(derived.notes.some((n) => /holds no client for the store/.test(n)));
});

test("the plan names a box it is anchored to; one only LOCATED by `at` gets no plan badge; created beats the plan's name", () => {
  const runner = box(real, "cluster:process:.:runner");
  assert.equal(runner.label, "release runner");
  assert.deepEqual(runner.badges.map((b) => b.label), ["own identity per run"]);
  assert.ok(runner.notes.some((n) => /the plan says it runs as svc; the code creates its own identity for each run/.test(n)));
  const server = box(real, "cluster:process:.:server");
  assert.equal(server.label, "order service");
  assert.match(server.sublabel, /^located, not anchored/);
  assert.deepEqual(server.badges.map((b) => b.label), ["$SVC_USER"]);
});
