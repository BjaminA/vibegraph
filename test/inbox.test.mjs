// THE DECISION INBOX (2026-10-06, direction review M11). On a project driven
// from the terminal, the person-only steps piled up where nobody looked. The
// inbox is one list of them — plan proposals, rules an agent stated, rule
// changes, a groups proposal, scopes — decided through each store's own
// operation. Pinned: the list and its ids; agree / reject change exactly the
// store they belong to; the CLI lists them (exit 1 while any waits) and
// refuses deciding under Claude Code; the Stop hook ends a turn with one line
// saying how many wait and where.
//
//   npm run test:inbox
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildInbox, decideInbox, inboxLine } from "../src/server/inbox.ts";
import { addConstraint, loadConstraints } from "../src/server/constraint_store.ts";
import { proposeConstraintEdit } from "../src/server/constraint_edit.ts";
import { loadArchStore, saveArchStore } from "../src/server/arch_store.ts";
import { loadPlan } from "../src/server/plan_store.ts";
import { runHook } from "../scripts/cli/hooks.mjs";

let tmp, root;
const cli = (args, env = {}) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", ...args, "--root", root], { encoding: "utf-8", env: { ...process.env, CLAUDECODE: "", ...env } });
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "vg-inbox-"));
  root = join(tmp, "p");
  cpSync("test/fixtures/system/views_demo", root, { recursive: true });
  // what an agent left behind in the terminal
  const c = addConstraint(root, { kind: "invariant", text: "Only the decider writes status", scope: { all: true } }, "agent");
  const human = addConstraint(root, { kind: "invariant", text: "Requests are never deleted", scope: { all: true } }, "human");
  assert.ok(!proposeConstraintEdit(root, human.id, { text: "Requests are never deleted or rewritten" }, { by: "agent", why: "a rewrite loses who asked" }).error);
  const store = loadArchStore(root);
  store.proposal = { at: "2026-10-06T09:00:00.000Z", model: "stub", groups: [{ id: "g-edge", kind: "network", label: "the edge", wraps: [], evidence: [] }], names: {}, refused: [] };
  store.scopes = { "tool:fetch": { node: "tool:fetch", proposed: { at: "2026-10-06T09:00:00.000Z", model: "stub", summary: "the HTTP client", words: [{ word: "call", evidence: ["lib/store.ts:3"] }], in: [], out: [], refused: [] } } };
  saveArchStore(root, store);
  void c;
});
after(() => rmSync(tmp, { recursive: true, force: true }));

test("one list of every waiting person step, with stable ids and evidence", () => {
  const ids = buildInbox(root).map((i) => i.id).sort();
  assert.deepEqual(ids, ["groups", "plan:processes:archiver", "rule-change:c2:p1", "rule:c1", "scope:tool:fetch"]);
  const plan = buildInbox(root).find((i) => i.id === "plan:processes:archiver");
  assert.equal(plan.title, "new plan process archiver");
  assert.match(inboxLine(buildInbox(root)), /^5 decisions await the person \(1 plan, 1 rule, 1 rule-change, 1 groups, 1 scope\): `vibegraph-knowledge inbox` in a terminal outside Claude Code/);
});

test("the CLI lists them and refuses deciding under Claude Code; the Stop hook says how many wait", () => {
  const list = cli(["inbox"]);
  assert.equal(list.status, 1, list.stdout + list.stderr);
  assert.match(list.stdout, /5 decisions wait for a person/);
  assert.match(list.stdout, /• scope:tool:fetch — a scope of tool:fetch \(stub\)/);
  const agent = cli(["inbox", "agree", "rule:c1"], { CLAUDECODE: "1" });
  assert.notEqual(agent.status, 0);
  assert.match(agent.stdout + agent.stderr, /person's step/);
  const stop = runHook("stop", { session_id: "s-inbox" }, { absRoot: root, pipeline: {} });
  assert.match(stop?.json?.systemMessage ?? "", /5 decisions await the person/);
});

test("agree and reject run each store's own operation", () => {
  assert.equal(decideInbox(root, "rule:c1", "agree").ok, true);
  assert.equal(loadConstraints(root).find((c) => c.id === "c1").source, "human");
  assert.equal(decideInbox(root, "rule-change:c2:p1", "agree").ok, true);
  assert.equal(loadConstraints(root).find((c) => c.id === "c2").text, "Requests are never deleted or rewritten");
  assert.equal(decideInbox(root, "plan:processes:archiver", "reject").ok, true);
  assert.equal(loadPlan(root).processes.find((p) => p.id === "archiver")?.status ?? "dropped", "dropped", "rejecting a NEW plan item drops it");
  assert.equal(decideInbox(root, "scope:tool:fetch", "agree").ok, true);
  assert.ok(loadArchStore(root).scopes["tool:fetch"].ratified);
  // the CLI decides as a person (outside Claude Code)
  const r = cli(["inbox", "reject", "groups"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(loadArchStore(root).proposal, undefined);
  assert.deepEqual(buildInbox(root), []);
  assert.equal(inboxLine(buildInbox(root)), null);
  assert.match(decideInbox(root, "nothing:x", "agree").detail, /not an inbox item/);
});
