// Plan state that goes stale or cannot be reached (2026-10-01, items 7 and 8
// of the hooks-feedback brief): a promoted rule whose constraint is removed
// is demoted, not left "promoted as cN"; a boundary to a dropped process is
// ORPHANED, not "not built"; a stack tool reached through a client library
// (`via`) is realised by the library's use; a cap refusal names what to drop
// or merge. (Item 7d — why an agreement went back to proposed — is pinned in
// test/plan_thread_match.test.mjs.)
//
//   npm run test:plan-stale
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { loadPlan, savePlan, validatePlan, demoteOrphanedPromotions } from "../src/server/plan_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { applyPlanOps } from "../src/server/plan_ops.ts";
import { removeConstraintAndDemote } from "../src/server/constraint_store.ts";

const ROOT = "test/fixtures/plan/map_demo";
let env, stack, base, tmp;
before(() => {
  delete process.env.CLAUDECODE;
  env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  stack = buildStackIndex(env, ROOT);
  base = loadPlan(ROOT);
  tmp = mkdtempSync(join(tmpdir(), "vg-stale-"));
});
after(() => rmSync(tmp, { recursive: true, force: true }));

function promotedRoot(name) {
  const r = join(tmp, name);
  mkdirSync(join(r, ".vibegraph"), { recursive: true });
  const plan = structuredClone(base);
  Object.assign(plan.policies[0], { status: "promoted", constraintId: "c1" });
  assert.equal(savePlan(r, plan).error, undefined);
  writeFileSync(join(r, ".vibegraph", "constraints.json"), JSON.stringify({ version: "1", constraints: [{ id: "c1", kind: "invariant", text: "Only the API writes readings", scope: { all: true }, source: "human", createdAt: "" }] }));
  return r;
}

test("removing the constraint demotes the rule promoted into it", () => {
  const r = promotedRoot("rm");
  assert.deepEqual(removeConstraintAndDemote(r, "c1"), { removed: true, demoted: ["p1"] });
  const p1 = loadPlan(r).policies.find((p) => p.id === "p1");
  assert.equal(p1.status, "agreed");
  assert.equal(p1.constraintId, undefined);
  assert.match(loadPlan(r).changelog.at(-1).change, /c1 is gone from constraints\.json — p1 is a planned rule again \(agreed\)/);
});

test("a constraint removed by hand is demoted the next time the plan is read", () => {
  const r = promotedRoot("hand");
  writeFileSync(join(r, ".vibegraph", "constraints.json"), JSON.stringify({ version: "1", constraints: [] }));
  assert.deepEqual(demoteOrphanedPromotions(r, new Set()), ["p1"]);
  assert.deepEqual(demoteOrphanedPromotions(r, new Set()), [], "idempotent");
});

test("a boundary whose process was dropped is orphaned, not not-built", () => {
  const plan = applyPlanOps(base, [{ op: "drop", section: "processes", id: "dashboard" }], "human").plan;
  const f = reconcilePlan(plan, env, stack, ROOT).findings.find((x) => x.id === "b3");
  assert.equal(f.verdict, "orphaned");
  assert.match(f.detail, /dashboard was dropped from the plan/);
});

test("a store reached through its client library (`via`) is realised by the library's use", () => {
  const plan = applyPlanOps(base, [
    { op: "add", section: "stack", item: { tool: "pumpstore", role: "db", via: ["sqlite3"], status: "agreed" } },
    { op: "add", section: "boundaries", item: { id: "b4", from: "api", to: "pumpstore", protocol: "SQL", status: "agreed" } },
  ], "human").plan;
  const rec = reconcilePlan(plan, env, stack, ROOT);
  const tool = rec.findings.find((x) => x.section === "stack" && x.id === "pumpstore");
  assert.equal(tool.verdict, "realised", tool.detail);
  assert.match(tool.detail, /reached through sqlite3/);
  const b4 = rec.findings.find((x) => x.id === "b4");
  assert.equal(b4.verdict, "realised", b4.detail);
  assert.match(b4.detail, /api reaches pumpstore \(through sqlite3\)/);
  // Without `via` the same tool reads as drifted — the report this fixes.
  const bare = applyPlanOps(base, [{ op: "add", section: "stack", item: { tool: "pumpstore", role: "db", status: "agreed" } }], "human").plan;
  assert.equal(reconcilePlan(bare, env, stack, ROOT).findings.find((x) => x.id === "pumpstore").verdict, "drifted");
  assert.match(validatePlan({ ...plan, stack: [{ tool: "x", role: "db", via: "yjs", status: "agreed" }] }), /via must be/);
});

test("over a cap: the refusal lists proposed items to drop and overlapping ones to merge", () => {
  let plan = base;
  const add = (i, status, text) => ({ op: "add", section: "policies", item: { id: `x${i}`, text, why: "w", status } });
  const ops = [];
  for (let i = 0; i < 6; i++) ops.push(add(i, "agreed", `rule number ${i} about pumps`));
  ops.push(add(6, "proposed", "Docstore writes are validated against the schema"));
  ops.push(add(7, "proposed", "Every docstore write validated before set"));
  plan = applyPlanOps(plan, ops, "human").plan; // 2 + 8 = 10, at the cap
  const over = applyPlanOps(plan, [add(8, "proposed", "one more")], "human");
  assert.match(over.error, /over the cap of 10/);
  assert.match(over.error, /drop a proposed one: .*x6 \("Docstore writes are validated/);
  assert.match(over.error, /or merge: .*x6 \+ x7 \(both about .*docstore/);
});
