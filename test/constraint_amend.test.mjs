// Amending a stated rule (2026-10-01, item 1 of the hooks-feedback brief):
// a person's `constraint edit` applies and is recorded field by field; an
// agent's change — `propose`, `--as agent`, or `edit` run from inside Claude
// Code — is stored as a proposal and changes nothing until a person accepts
// it; every change is validated as the whole rule it would produce; `plan
// edit` on a promoted rule names the command; accept/reject are a person's.
//
//   npm run test:constraint-amend
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConstraints } from "../src/server/constraint_store.ts";
import { editConstraint, proposeConstraintEdit, decideConstraintProposal } from "../src/server/constraint_edit.ts";
import { runConstraints } from "../scripts/cli/constraints.mjs";
import { personOnlyStep } from "../scripts/cli/actor.mjs";
import { applyPlanOps } from "../src/server/plan_ops.ts";

let root;
const C1 = { id: "c1", kind: "invariant", text: "Only the guarded writer imports yjs", scope: { all: true }, source: "human", createdAt: "2026-10-01T00:00:00Z",
  check: { rule: "import-only", tool: "yjs", files: ["src/guarded-write.test.ts"] } };
before(() => {
  delete process.env.CLAUDECODE;
  root = mkdtempSync(join(tmpdir(), "vg-amend-"));
  mkdirSync(join(root, ".vibegraph"));
  writeFileSync(join(root, ".vibegraph", "constraints.json"), JSON.stringify({ version: "1", constraints: [C1] }));
});
after(() => { rmSync(root, { recursive: true, force: true }); delete process.env.CLAUDECODE; });
const c1 = () => loadConstraints(root).find((c) => c.id === "c1");
const now = () => new Date("2026-10-01T12:00:00Z");

test("a person's edit applies now and is recorded: who, when, before → after, why", () => {
  const r = editConstraint(root, "c1", { check: { rule: "import-only", tool: "yjs", files: ["src/transport/", "src/guarded-write.test.ts"] } }, { by: "human", why: "the transport layer is the funnel", now });
  assert.deepEqual(r.changed, ["check"]);
  const c = c1();
  assert.deepEqual(c.check.files, ["src/transport/", "src/guarded-write.test.ts"]);
  assert.equal(c.changes.length, 1);
  assert.deepEqual({ ...c.changes[0], before: c.changes[0].before.files }, { at: "2026-10-01T12:00:00.000Z", by: "human", field: "check", before: ["src/guarded-write.test.ts"], after: c.check, why: "the transport layer is the funnel" });
  assert.match(editConstraint(root, "c1", { check: c.check }, { by: "human" }).error, /no change/);
  assert.match(editConstraint(root, "c1", { check: { rule: "import-only" } }, { by: "human" }).error, /^refused:/, "validated as the whole rule");
  assert.match(editConstraint(root, "c1", { text: "x" }, { by: "agent" }).error, /it proposes/);
});

test("an agent's change is a PROPOSAL: the rule stands until a person accepts; reject drops it", () => {
  const before = JSON.stringify(c1().check);
  assert.match(proposeConstraintEdit(root, "c1", { text: "t" }, { by: "agent", why: "" }).error, /says why/);
  assert.match(proposeConstraintEdit(root, "c1", { check: { rule: "nope" } }, { by: "agent", why: "w" }).error, /^refused:/, "refused when made, not when accepted");
  const p = proposeConstraintEdit(root, "c1", { check: { rule: "import-only", tool: "yjs", files: ["src/"] } }, { by: "agent", why: "a new module needs it", now }).proposal;
  assert.equal(p.id, "p1");
  assert.equal(JSON.stringify(c1().check), before, "unchanged while pending");
  assert.equal(c1().proposals.length, 1);
  const q = proposeConstraintEdit(root, "c1", { note: "n" }, { by: "agent", why: "w" }).proposal;
  assert.equal(decideConstraintProposal(root, "c1", q.id, false).error, undefined);
  assert.equal(c1().proposals.length, 1, "rejected one gone");
  decideConstraintProposal(root, "c1", "p1", true, { now });
  const c = c1();
  assert.deepEqual(c.check.files, ["src/"]);
  assert.equal(c.proposals, undefined);
  assert.equal(c.changes.at(-1).fromProposal, "p1");
  assert.match(c.changes.at(-1).why, /accepted p1 \(proposed by agent\): a new module needs it/);
});

test("the CLI: `constraint edit` from inside Claude Code becomes a proposal; accept/reject are a person's steps; show prints history", () => {
  process.env.CLAUDECODE = "1";
  const r = runConstraints({ root, sub: "edit", id: "c1", values: { text: "Only src/ imports yjs", why: "re-scope" } });
  assert.equal(r.exitCode, 0, r.messages.join());
  assert.match(r.lines[0], /proposed p\d+ for c1 \(an edit by an agent is recorded as a proposal\)/);
  assert.equal(c1().text, "Only the guarded writer imports yjs");
  assert.match(personOnlyStep("constraint", ["accept", "c1", "p2"]), /constraints accept/);
  assert.match(personOnlyStep("constraints", ["reject", "c1", "p2"]), /constraints reject/);
  assert.equal(personOnlyStep("constraint", ["propose", "c1"]), null);
  delete process.env.CLAUDECODE;
  const s = runConstraints({ root, sub: "show", id: "c1", values: {} });
  const text = s.lines.join("\n");
  assert.match(text, /history:/);
  assert.match(text, /human {2}check:/);
  assert.match(text, /open proposals \(a person decides\):/);
  assert.match(text, /decide: vibegraph-knowledge constraint accept c1 p\d+/);
  const a = runConstraints({ root, sub: "accept", id: "c1", values: { pid: c1().proposals[0].id } });
  assert.equal(a.exitCode, 0, a.messages.join());
  assert.equal(c1().text, "Only src/ imports yjs");
  assert.ok(JSON.parse(readFileSync(join(root, ".vibegraph", "constraints.json"), "utf-8")).constraints[0].changes.length >= 3, "history survives the file round trip");
});

test("`plan edit` on a promoted rule names the command, not the file", () => {
  let plan = applyPlanOps(null, [{ op: "set-objective", text: "Guarded writes" }], "human").plan;
  plan = applyPlanOps(plan, [{ op: "add", section: "policies", item: { id: "p1", text: "t", why: "w", status: "agreed" } }], "human").plan;
  plan.policies[0].status = "promoted";
  plan.policies[0].constraintId = "c1";
  const r = applyPlanOps(plan, [{ op: "update", section: "policies", id: "p1", fields: { text: "u" } }], "agent");
  assert.match(r.error, /vibegraph-knowledge constraint propose c1 --check/);
  assert.match(applyPlanOps(plan, [{ op: "update", section: "policies", id: "p1", fields: { text: "u" } }], "human").error, /constraint edit c1/);
});
