// Checkable shapes for access and authority rules (2026-10-01, Module 7 of
// the plan-architecture brief). Fixture test/fixtures/plan/authority_demo: a
// decider that writes verdicts through its id producer and always audits, and
// a `rogue` module with each failure the rules exist to catch — a second
// verdict writer with an inline id, a decision that can return before its
// audit, a decision audited on one branch only, a request whose id comes from
// the caller. Pinned: each kind has a PASSING and a FAILING case on real code,
// unverifiable is distinct from pass, and each says what it could not check.
//
//   npm run test:plan-authority
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cpSync } from "node:fs";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { loadPlan } from "../src/server/plan_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { promotePolicy } from "../src/server/plan_promote.ts";
import { loadConstraints } from "../src/server/constraint_store.ts";
import { checkConstraint, isConstraintCheck, describeCheck } from "../src/server/constraint_grammar.ts";

const ROOT = "test/fixtures/plan/authority_demo";
let env, plan, rec;
before(() => {
  env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  plan = loadPlan(ROOT);
  rec = reconcilePlan(plan, env, buildStackIndex(env, ROOT), ROOT);
});
const v = (id) => rec.findings.find((f) => f.section === "policies" && f.id === id);

test("single-writer: the decider alone writes its zone → pass; a second writer → violated, named", () => {
  assert.equal(v("p2").verdict, "pass");
  assert.equal(v("p1").verdict, "violated");
  assert.match(v("p1").detail, /also written at rogue\/override\.ts:7 overrideVerdict/);
});

test("always-with: audited on every path → pass (both arms of an if count); an early return or one arm → violated", () => {
  assert.equal(v("p3").verdict, "pass");
  assert.equal(v("p9").verdict, "pass", "both arms of the if call it");
  assert.equal(v("p4").verdict, "violated");
  assert.match(v("p4").detail, /rogue\/override\.ts:12 quickDecide can return before calling appendAudit \(line 13\)/);
  assert.equal(v("p5").verdict, "violated");
  assert.match(v("p5").detail, /reviewLater calls appendAudit only inside a branch or loop/);
});

test("id-scheme: ids through the producer → pass; an id built inline from the family → violated", () => {
  assert.equal(v("p7").verdict, "pass");
  assert.equal(v("p6").verdict, "violated");
  assert.match(v("p6").detail, /overrideVerdict builds a verdict id inline \("verdict:" \+ requestId\)/);
});

test("unverifiable is never a pass: a missing producer, an id from a parameter, a computed zone, an absent function", () => {
  assert.equal(v("p8").verdict, "unverifiable");
  assert.match(v("p8").detail, /no producer requestId is defined/);
  const facts = { irFiles: env.files };
  const fromParam = checkConstraint(facts, { rule: "id-scheme", family: "request", producers: ["eventId"], writes: ["writeDoc"] });
  assert.equal(fromParam.verdict, "unverifiable");
  assert.match(fromParam.reason, /cannot tell who produced the id at rogue\/override\.ts:25 submitRequest \(id from requestId/);
  assert.equal(checkConstraint(facts, { rule: "always-with", target: "nowhere", with: "appendAudit" }).verdict, "unverifiable");
  // A write whose zone and family are both computed could be a write anywhere.
  const computed = { irFiles: { "x.ts": { nodes: [{ id: "module/relay.fn/writeDoc.call", type: "call", funcName: "writeDoc", line: 3, args: ["zone", "fam", "id", "data"] }] } } };
  const sw = checkConstraint(computed, { rule: "single-writer", writes: ["writeDoc"], zone: "verdicts", by: ["recordVerdict"] });
  assert.equal(sw.verdict, "unverifiable");
  assert.match(sw.reason, /x\.ts:3 relay \(zone\/family computed\)/);
  assert.equal(checkConstraint({}, { rule: "single-writer", writes: ["writeDoc"], zone: "z", by: ["f"] }).verdict, "unverifiable", "no IR: never a pass");
});

test("the grammar: shapes refused at the boundary; promotion expands the plan's names", () => {
  assert.ok(isConstraintCheck({ rule: "single-writer", writes: ["writeDoc"], families: ["verdict"], files: ["decider/"] }));
  assert.ok(!isConstraintCheck({ rule: "single-writer", writes: ["writeDoc"], by: ["x"] }), "needs a zone or families");
  assert.ok(!isConstraintCheck({ rule: "single-writer", writes: ["writeDoc"], zone: "z" }), "needs who may");
  assert.ok(!isConstraintCheck({ rule: "id-scheme", family: "f", producers: [] , writes: ["w"] }));
  assert.ok(!isConstraintCheck({ rule: "always-with", target: "a" }));
  assert.match(describeCheck({ rule: "always-with", target: "decide", with: "audit" }), /every path through `decide` calls `audit`/);
  const tmp = mkdtempSync(join(tmpdir(), "vg-auth-"));
  try {
    cpSync(ROOT, join(tmp, "a"), { recursive: true });
    const r = promotePolicy(join(tmp, "a"), loadPlan(join(tmp, "a")), "p1");
    assert.equal(r.error, undefined, r.error);
    const c = loadConstraints(join(tmp, "a")).find((x) => x.id === r.plan.policies[0].constraintId);
    assert.deepEqual(c.check, { rule: "single-writer", zone: "verdicts", writes: ["writeDoc"], families: ["verdict"], files: ["decider/"] });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
