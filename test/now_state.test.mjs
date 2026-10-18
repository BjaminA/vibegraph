// "NOW" (2026-10-16, src/server/now_state.ts): the GUI's one-line summary of
// where a project stands, and ONE next step chosen by a fixed order — what
// waits for a person, then stale Brief lines, then no objective, no rules, no
// agreed direction, and only then "start a task". Walked here on an empty
// project, filling each gap in turn.
//
//   npm run test:now-state
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nowState } from "../src/server/now_state.ts";
import { emptyPlan, savePlan } from "../src/server/plan_store.ts";
import { addConstraint } from "../src/server/constraint_store.ts";
import { saveDirection } from "../src/server/project_direction.ts";

let root;
before(() => { root = mkdtempSync(join(tmpdir(), "vg-now-")); });
after(() => rmSync(root, { recursive: true, force: true }));

const rule = (id, status) => ({ id, text: `rule ${id}`, why: "read from the code", basis: "funnel:fetch", evidence: ["lib/store.ts"], status, stamp: "x" });

test("the next step follows the fixed order, each pointing at the panel that acts on it", () => {
  let n = nowState(root);
  assert.equal(n.objective, null);
  assert.deepEqual(n.next, { text: "State what the project is for", panel: "plan" });
  assert.equal(n.waiting, 0);

  savePlan(root, emptyPlan("Partners see only our signed decisions"));
  n = nowState(root);
  assert.equal(n.objective, "Partners see only our signed decisions");
  assert.deepEqual(n.next, { text: "State a rule the code must keep", panel: "rules" });

  addConstraint(root, { kind: "invariant", text: "only the decider writes decisions", scope: { all: true } }, "human");
  n = nowState(root);
  assert.equal(n.rules, 1);
  assert.equal(n.next.panel, "direction");
  assert.deepEqual(n.direction, { agreed: 0, proposed: 0 });

  // a proposed direction rule waits for a person: it outranks everything below it
  saveDirection(root, { version: "1", rules: [rule("d1", "proposed")] });
  n = nowState(root);
  assert.equal(n.waiting, 1);
  assert.deepEqual(n.next, { text: "1 decision waits for you", panel: "inbox" });
  assert.deepEqual(n.badges, { inbox: 1, plan: 0, direction: 1 });
  // ...and a stale Brief line ranks below a waiting decision
  assert.equal(nowState(root, { briefStale: ["b1"] }).next.panel, "inbox");

  saveDirection(root, { version: "1", rules: [rule("d1", "agreed")] });
  n = nowState(root, { briefStale: ["b1", "b2"] });
  assert.equal(n.briefStale, 2);
  assert.deepEqual(n.next, { text: "2 Brief lines are stale — re-brief them", panel: null });

  n = nowState(root);
  assert.deepEqual(n.direction, { agreed: 1, proposed: 0 });
  assert.deepEqual(n.next, { text: "Start a task with Claude Code", panel: "agents" });
  assert.deepEqual(n.badges, { inbox: 0, plan: 0, direction: 0 });
});
