// Decision structures from literal tables (2026-10-02, module 7): a table of
// from/to rows is a state machine, a record of yes/no nodes is a decision
// tree, each node linked to the function a parallel record maps it to — by
// shape, in two codebases unlike the one that motivated it.
//
//   node --experimental-strip-types --no-warnings --test test/decision_tables.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { deriveDataArchitecture } from "../src/server/data_arch.ts";
import { validateTopology } from "../src/server/topology_store.ts";
import { formatDataArchMd } from "../src/server/data_arch_render.ts";

const ROOT = join(import.meta.dirname, "..");
const ts = deriveDataArchitecture(buildPolyglotEnvelope(join(ROOT, "test/fixtures/declared/broker_ts")).envelope.files);
const py = deriveDataArchitecture(buildPolyglotEnvelope(join(ROOT, "test/fixtures/declared/store_py")).envelope.files);

test("a from/to table is a state machine: roles, guards and the function that looks rows up", () => {
  const m = ts.topology.stateMachines.find((x) => x.id === "INVOICE_TRANSITIONS");
  assert.deepEqual(m.transitions.map((t) => `${t.from}->${t.to}`), ["DRAFT->ISSUED", "ISSUED->PAID", "ISSUED->VOID"]);
  assert.deepEqual(m.transitions[0].roles, ["billing"]);
  assert.deepEqual(m.transitions[0].requires, ["hasLines"], "a guard function is named by its reference");
  assert.equal(m.evaluatedBy, "transitionFor");
  assert.match(m.transitions[1].cite, /invoice_rules\.ts:\d+$/);
  const p = py.topology.stateMachines.find((x) => x.id === "JOB_STATES");
  assert.deepEqual(p.transitions[1].requires, ["has_output"]);
  assert.deepEqual(p.states, ["QUEUED", "RUNNING", "DONE", "FAILED"]);
});

test("a record of yes/no nodes is a tree: root, leaves as outcomes, each node's evaluating function and declared evidence", () => {
  const t = ts.topology.decisionTrees.find((x) => x.id === "APPROVAL_TREE");
  assert.equal(t.root, "start");
  const amount = t.nodes.find((n) => n.id === "amount");
  assert.equal(amount.evaluatedBy, "checkAmount");
  assert.deepEqual(amount.evidence, ["Invoice.total", "Tenant.limit"]);
  assert.deepEqual(t.nodes.filter((n) => n.outcome).map((n) => n.id).sort(), ["APPROVE", "REJECT"]);
  assert.match(t.evaluatedByTable, /^APPROVAL_CHECKS /);
  const q = py.topology.decisionTrees.find((x) => x.id === "PUBLISH_TREE");
  assert.equal(q.nodes.find((n) => n.id === "q2").evaluatedBy, "check_steward");
  assert.equal(validateTopology(ts.topology), null, "the derived topology is a valid topology document");
  assert.equal(validateTopology(py.topology), null);
});

test("what is not one stays out, and a tree no record evaluates says so", () => {
  assert.equal(ts.topology.stateMachines.some((x) => x.id === "LEGACY_STATES"), false, "a row with no target: not a machine");
  assert.equal(ts.topology.stateMachines.some((x) => x.id === "TOPICS"), false);
  const esc = ts.topology.decisionTrees.find((x) => x.id === "ESCALATION");
  assert.ok(esc.nodes.every((n) => !n.evaluatedBy));
  assert.match(formatDataArchMd(ts), /`ESCALATION`[\s\S]*No record maps its nodes to functions/);
  assert.equal(ts.topology.decisionTrees.some((x) => x.id === "FLAGS"), false, "a record of objects without yes/no is not a tree");
});
