// "NOW" (2026-10-16, src/server/now_state.ts): the GUI's one-line summary of
// where a project stands, and ONE next step chosen by a fixed order — what
// waits for a person, then stale Brief lines, then the setup's next step
// (groups, the Brief, rules, the objective and principles, hooks), and only
// then "start a task". Walked here on an empty project, filling each gap in turn.
//
//   npm run test:now-state
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nowState } from "../src/server/now_state.ts";
import { emptyPlan, savePlan } from "../src/server/plan_store.ts";
import { addConstraint } from "../src/server/constraint_store.ts";
import { saveDirection } from "../src/server/project_direction.ts";
import { loadArchStore, saveArchStore } from "../src/server/arch_store.ts";
import { saveBrief } from "../src/server/brief_store.ts";
import { cacheDirFor } from "../scripts/envelope_cache.mjs";
import { HOOK_MARKER } from "../scripts/cli/init.mjs";

let root;
before(() => { root = mkdtempSync(join(tmpdir(), "vg-now-")); process.env.VG_CACHE_DIR = join(root, ".cache-test"); });
after(() => { rmSync(root, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

const rule = (id, status) => ({ id, text: `rule ${id}`, why: "read from the code", basis: "funnel:fetch", evidence: ["lib/store.ts"], status, stamp: "x" });

test("the next step follows the setup's fixed order, each pointing at the panel that acts on it", () => {
  // 2026-10-20 — after decisions waiting and stale Brief lines, the order is
  // the setup's (src/server/setup_state.ts): groups, the Brief, rules, the
  // objective and principles, hooks (software needs the stack; none passed here)
  let n = nowState(root);
  assert.equal(n.objective, null);
  assert.deepEqual(n.next, { text: "Propose the architecture groups (the Brief)", panel: null });
  assert.deepEqual(n.setup, { done: 0, of: 5 });
  assert.equal(n.waiting, 0);

  saveArchStore(root, { ...loadArchStore(root), ratified: { at: "2026-10-20T10:00:00.000Z", model: "test" } });
  assert.deepEqual(nowState(root).next, { text: "Write the Brief", panel: null });
  saveBrief(root, { version: "1", ratified: { spec: { function: [], method: [], feature: [] }, at: "2026-10-20T10:00:00.000Z", by: "ben", model: "test" } });
  assert.deepEqual(nowState(root).next, { text: "State a rule the code must keep", panel: "rules" });

  addConstraint(root, { kind: "invariant", text: "only the decider writes decisions", scope: { all: true } }, "human");
  n = nowState(root);
  assert.equal(n.rules, 1);
  assert.deepEqual(n.next, { text: "Start the plan", panel: "plan" }, "no plan yet: a person starts it before anything is drafted into it");

  savePlan(root, { ...emptyPlan("Partners see only our signed decisions"), policies: [{ id: "p1", text: "only the decider writes decisions", why: "one signer", status: "agreed" }] });
  n = nowState(root);
  assert.equal(n.objective, "Partners see only our signed decisions");
  assert.deepEqual(n.next, { text: "Install the hooks: vibegraph-knowledge init --hooks", panel: null }, "direction is optional: suggested only when it waits");
  assert.deepEqual(n.direction, { agreed: 0, proposed: 0 });
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: `x ${HOOK_MARKER}` }] }] } }));
  mkdirSync(cacheDirFor(root), { recursive: true });
  writeFileSync(join(cacheDirFor(root), "hooks-fired.json"), JSON.stringify({ stop: { at: new Date(Date.now() + 1000).toISOString() } }));

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
