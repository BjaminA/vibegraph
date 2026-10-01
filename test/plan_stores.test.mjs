// Stores are resources, not processes (2026-10-01, Module 1 of the plan-
// architecture brief). Fixture test/fixtures/plan/store_demo: a TypeScript
// monorepo whose two apps coordinate ONLY through a shared document store,
// reached through a workspace client package that wraps a store SDK and a
// CRDT library. Pinned: a store is realised when what it is reached through
// is used; boundaries into it are realised or unverified, never drifted or
// orphaned; a database modelled as a dropped process is converted by the
// `to-store` op; a plan without stores saves byte-for-byte as before.
//
//   npm run test:plan-stores
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { loadPlan, savePlan, validatePlan } from "../src/server/plan_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { applyPlanOps } from "../src/server/plan_ops.ts";
import { formatPlanMd, compactPlan } from "../src/server/plan_render.ts";
import { planModel, PLAN_ID } from "../src/webview/system/arch_plan.ts";

const ROOT = "test/fixtures/plan/store_demo";
let env, stack, plan, tmp;
before(() => {
  env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  stack = buildStackIndex(env, ROOT);
  plan = loadPlan(ROOT);
  tmp = mkdtempSync(join(tmpdir(), "vg-stores-"));
});
after(() => rmSync(tmp, { recursive: true, force: true }));
const verdicts = (rec, section) => Object.fromEntries(rec.findings.filter((f) => f.section === section).map((f) => [f.id, f]));

test("a store reached through its client package, SDK and data library is realised; boundaries into it are realised", () => {
  const rec = reconcilePlan(plan, env, stack, ROOT);
  const st = verdicts(rec, "stores").docs;
  assert.equal(st.verdict, "realised");
  assert.match(st.detail, /@acme\/store-sdk/);
  const b = verdicts(rec, "boundaries");
  assert.equal(b.b1.verdict, "realised");
  assert.match(b.b1.detail, /apps\/requester\/src\/main\.ts/);
  assert.equal(b.b2.verdict, "realised");
  assert.equal(verdicts(rec, "stack").yjs.verdict, "realised", "a role no table knows is not a drift");
});

test("ACCEPTANCE: reached only through an SDK + a data library, the store is realised and its boundaries never drifted or orphaned", () => {
  const p = structuredClone(plan);
  p.stores[0].reachedThrough = ["@acme/store-sdk", "yjs"];
  const rec = reconcilePlan(p, env, stack, ROOT);
  assert.equal(verdicts(rec, "stores").docs.verdict, "realised");
  for (const id of ["b1", "b2"]) {
    const f = verdicts(rec, "boundaries")[id];
    assert.ok(["realised", "unverified"].includes(f.verdict), `${id}: ${f.verdict} — ${f.detail}`);
  }
  // A store nothing reaches yet is not built — and still never orphaned.
  p.stores[0].reachedThrough = ["@acme/not-used"];
  const none = reconcilePlan(p, env, stack, ROOT);
  assert.equal(verdicts(none, "stores").docs.verdict, "not-built");
  assert.equal(verdicts(none, "boundaries").b1.verdict, "not-built");
});

test("a database dropped as a process: its orphaned boundary says what it is, and `to-store` makes it one", () => {
  const rec = reconcilePlan(plan, env, stack, ROOT);
  assert.equal(verdicts(rec, "boundaries").b3.verdict, "orphaned");
  assert.match(verdicts(rec, "boundaries").b3.detail, /"op":"to-store","id":"storedb"/);
  const refused = applyPlanOps(plan, [{ op: "to-store", id: "storedb" }], "human");
  assert.match(refused.error, /say what the code reaches it through/);
  const r = applyPlanOps(plan, [{ op: "to-store", id: "storedb", reachedThrough: ["@acme/store-client"] }], "human");
  assert.equal(r.error, undefined);
  const st = r.plan.stores.find((s) => s.id === "storedb");
  assert.deepEqual([st.kind, st.status, st.label], ["database", "proposed", "Shared store"], "a dropped db comes back as a proposed store");
  assert.ok(!r.plan.processes.some((p) => p.id === "storedb"));
  const after = verdicts(reconcilePlan(r.plan, env, stack, ROOT), "boundaries").b3;
  assert.equal(after.verdict, "realised", after.detail);
  assert.match(r.changes.join(" "), /process storedb is a store \(database/);
});

test("validation: a zone needs its store; a store is not a process; a plan without stores saves as before", () => {
  const bad = structuredClone(plan);
  bad.boundaries[0].zone = "nope";
  assert.match(validatePlan(bad), /store docs has no zone "nope"/);
  const twin = structuredClone(plan);
  twin.stores.push({ id: "decider", kind: "queue", reachedThrough: ["x"], status: "proposed" });
  assert.match(validatePlan(twin), /a store is not a process/);
  const noStore = structuredClone(plan);
  noStore.stores[0].reachedThrough = [];
  assert.match(validatePlan(noStore), /reachedThrough must list/);
  // Byte-for-byte: a v1 plan with no stores round-trips without a `stores` key.
  const old = structuredClone(plan);
  for (const k of ["stores", "principals", "flows"]) delete old[k];
  for (const p of old.processes) delete p.runsAs;
  old.boundaries = old.boundaries.filter((b) => b.to !== "docs");
  mkdirSync(join(tmp, ".vibegraph"), { recursive: true });
  const before = JSON.stringify(old, null, 2) + "\n";
  writeFileSync(join(tmp, ".vibegraph/plan.json"), before);
  assert.equal(savePlan(tmp, loadPlan(tmp)).error, undefined);
  assert.equal(readFileSync(join(tmp, ".vibegraph/plan.json"), "utf-8"), before);
});

test("the store is drawn as its own card, the boundaries land on it, and it is in plan.md and the hook's plan", () => {
  const rec = reconcilePlan(plan, env, stack, ROOT);
  const m = planModel(plan, rec);
  const card = m.nodes.find((n) => n.id === `${PLAN_ID}store:docs`);
  assert.ok(card, "a store card");
  assert.match(card.sublabel, /document-store store/);
  // A boundary with no zone lands on the store's own card (one naming a zone lands on the zone: test:plan-zones).
  const noZone = structuredClone(plan);
  for (const b of noZone.boundaries) delete b.zone;
  const m0 = planModel(noZone, reconcilePlan(noZone, env, stack, ROOT));
  for (const b of ["b1", "b2"]) assert.equal(m0.edges.find((e) => e.planBoundary === b)?.to, card.id);
  assert.match(formatPlanMd(plan, rec), /## Stores \(shared resources, not processes\)[\s\S]*\*\*docs\*\* \(document-store/);
  assert.match(compactPlan(plan), /Stores \(shared resources, not processes\): docs \(document-store via @acme\/store-client/);
});
