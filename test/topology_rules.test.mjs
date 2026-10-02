// Rules over the declared topology (2026-10-02, topology brief Module 3).
// Each kind — single-writer (declared form), writer-subset, no-write — has a
// PASSING, a FAILING and an UNVERIFIABLE case on the fixture's real
// declarations, and unverifiable is never a pass: no topology, an undeclared
// zone or principal, or a STALE topology all refuse a verdict. The code form
// of single-writer (with `writes`) is untouched.
//
//   npm run test:topology-rules
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTopology } from "../src/server/topology_store.ts";
import { checkConstraint, isConstraintCheck, describeCheck } from "../src/server/constraint_grammar.ts";
import { runConstraintChecks } from "../scripts/cli/check.mjs";

const FIX = "test/fixtures/topology/topo_demo";
let facts, tmp;
before(() => { facts = { topology: loadTopology(FIX) }; tmp = mkdtempSync(join(tmpdir(), "vg-toporules-")); });
after(() => rmSync(tmp, { recursive: true, force: true }));
const v = (check, f = facts) => checkConstraint(f, check);

test("single-writer (declared): exactly the decider writes verdicts → pass; exactly intake → violated; an undeclared zone → unverifiable", () => {
  assert.ok(isConstraintCheck({ rule: "single-writer", zone: "verdicts", writer: "role:decider" }));
  assert.equal(v({ rule: "single-writer", zone: "verdicts", writer: "role:decider" }).verdict, "pass");
  assert.equal(v({ rule: "single-writer", zone: "verdicts", writer: "svc-decider" }).verdict, "pass");
  const bad = v({ rule: "single-writer", zone: "verdicts", writer: "svc-intake" });
  assert.equal(bad.verdict, "violated");
  assert.match(bad.reason, /also writable by svc-decider \(via role:decider\) \(catalogue\/principals\.mjs:11\); no write grant for svc-intake/);
  assert.equal(v({ rule: "single-writer", zone: "nowhere", writer: "svc-intake" }).verdict, "unverifiable");
  assert.match(describeCheck({ rule: "single-writer", zone: "verdicts", writer: "role:decider" }), /exactly role:decider \(declared topology\)/);
  // The code form still reads the code.
  assert.ok(isConstraintCheck({ rule: "single-writer", writes: ["writeDoc"], zone: "verdicts", by: ["decide"] }));
});

test("writer-subset: evidence is written only by inspectors → pass; only by deciders → violated; an undeclared zone → unverifiable", () => {
  assert.equal(v({ rule: "writer-subset", zone: "evidence", roles: ["inspector"] }).verdict, "pass");
  const bad = v({ rule: "writer-subset", zone: "evidence", roles: ["decider"] });
  assert.equal(bad.verdict, "violated");
  assert.match(bad.reason, /inspector holds inspector \(catalogue\/principals\.mjs:13\)/);
  assert.equal(v({ rule: "writer-subset", zone: "nowhere", roles: ["x"] }).verdict, "unverifiable");
});

test("no-write: intake never writes verdicts → pass; the decider never writes verdicts → violated; an unknown principal → unverifiable", () => {
  assert.equal(v({ rule: "no-write", principal: "svc-intake", zone: "verdicts" }).verdict, "pass");
  const bad = v({ rule: "no-write", principal: "svc-decider", zone: "verdicts" });
  assert.equal(bad.verdict, "violated");
  assert.match(bad.reason, /through role:decider \(catalogue\/principals\.mjs:11\)/);
  assert.equal(v({ rule: "no-write", principal: "ghost", zone: "verdicts" }).verdict, "unverifiable");
});

test("unverifiable is never a pass: no topology, and a STALE topology says what it would have answered", () => {
  assert.equal(v({ rule: "no-write", principal: "svc-intake", zone: "verdicts" }, {}).verdict, "unverifiable");
  const root = join(tmp, "stale");
  cpSync(FIX, root, { recursive: true });
  appendFileSync(join(root, "catalogue/principals.mjs"), "\n// changed after the generator ran\n");
  const stale = v({ rule: "no-write", principal: "svc-intake", zone: "verdicts" }, { topology: loadTopology(root) });
  assert.equal(stale.verdict, "unverifiable");
  assert.match(stale.reason, /not fresh \(catalogue: stale\) — on it this would read PASS/);
});

test("stated as constraints, `check` runs them with the three exit codes", () => {
  const root = join(tmp, "check");
  cpSync(FIX, root, { recursive: true });
  const cs = (checks) => writeFileSync(join(root, ".vibegraph/constraints.json"), JSON.stringify({ version: "1", constraints: checks.map((check, i) => ({ id: `c${i + 1}`, kind: "invariant", text: `rule ${i + 1} — because`, scope: { all: true }, source: "human", createdAt: "2026-10-02T00:00:00Z", check })) }));
  mkdirSync(join(root, ".vibegraph"), { recursive: true });
  cs([{ rule: "single-writer", zone: "verdicts", writer: "role:decider" }, { rule: "no-write", principal: "svc-intake", zone: "verdicts" }]);
  assert.equal(runConstraintChecks({ root, pipeline: {} }).exitCode, 0);
  cs([{ rule: "writer-subset", zone: "evidence", roles: ["decider"] }]);
  assert.equal(runConstraintChecks({ root, pipeline: {} }).exitCode, 1);
  cs([{ rule: "no-write", principal: "ghost", zone: "verdicts" }]);
  assert.equal(runConstraintChecks({ root, pipeline: {} }).exitCode, 2);
});
