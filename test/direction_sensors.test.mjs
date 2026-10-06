// THE DECISIONS LEDGER, SUPERSEDE AND THE DRIFT SENSORS (2026-10-06, direction
// review M1 + M9 + M10). On the reviewed project the important decisions were
// made in the terminal and recorded everywhere but the plan: a question's own
// text said a planned process was "likely not needed", another question began
// ANSWERED, a handover note said "we decided", and the code ran processes and
// identities the plan never named. Fixture test/fixtures/system/direction_demo.
// Pinned: the sensors find each of those with its evidence and the plan edits
// it implies, WRITING NOTHING; the inbox lists them; a person agreeing one
// records a decision whose effects apply together (a supersede leaves every
// map, an answered question closes); a rejected finding does not come back;
// an agent's supersede waits as a proposed decision.
//
//   npm run test:direction-sensors
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { loadPlan, savePlan } from "../src/server/plan_store.ts";
import { applyPlanOps } from "../src/server/plan_ops.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { planSensors } from "../src/server/plan_sensors.ts";
import { buildInbox, decideInbox, inboxLine } from "../src/server/inbox.ts";
import { formatPlanMd, compactPlan } from "../src/server/plan_render.ts";
import { planRecords } from "../src/webview/system/arch_plan.ts";

let tmp, root, model, rec;
const git = (...a) => spawnSync("git", a, { cwd: root, encoding: "utf-8" });
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "vg-direction-"));
  root = join(tmp, "p");
  cpSync("test/fixtures/system/direction_demo", root, { recursive: true });
  git("init", "-q");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "add", ".");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "decision: one ledger for every order");
  const env = buildPolyglotEnvelope(root, { skipSystem: true }).envelope;
  const stack = buildStackIndex(env, root);
  model = archModelForEnvelope(env, stack, buildCrossingIndex(env), root, undefined, { applyStore: false });
  rec = reconcilePlan(loadPlan(root), env, stack, root);
});
after(() => rmSync(tmp, { recursive: true, force: true }));

const sensed = () => planSensors(root, loadPlan(root), { model, rec });
const byKind = (fs, k) => fs.filter((f) => f.kind === k);

test("the sensors find each drift with its evidence, and write nothing", () => {
  const before = readFileSync(join(root, ".vibegraph/plan.json"), "utf-8");
  const { findings } = sensed();
  const kinds = [...new Set(findings.map((f) => f.kind))].sort();
  assert.deepEqual(kinds, ["answered", "contradicted", "located", "new-identity", "new-process", "outside"]);
  const [c] = byKind(findings, "contradicted");
  assert.deepEqual(c.effects, [{ op: "supersede", section: "processes", id: "projector", why: "q2: Likely not needed: a query projector; status reads go straight to the ledger" }]);
  assert.ok(c.evidence.some((e) => e.startsWith("q2")));
  const [loc] = byKind(findings, "located");
  assert.equal(loc.effects[0].op, "update");
  assert.equal(loc.effects[0].id, "server");
  assert.match(loc.effects[0].fields.entryPoints[0], /^svc\/server\.ts/);
  const [np] = byKind(findings, "new-process");
  assert.match(np.said, /jobs\/sweeper\.ts/);
  const [ni] = byKind(findings, "new-identity");
  assert.equal(ni.effects[0].item.id, "runner-run");
  const outside = byKind(findings, "outside").map((f) => f.from).sort();
  assert.deepEqual(outside, [outside.find((x) => x.startsWith("commit:")), "doc:DECISIONS.md:3"]);
  assert.ok(outside[0], "the commit that says 'decision:' is found");
  assert.equal(readFileSync(join(root, ".vibegraph/plan.json"), "utf-8"), before, "sensing writes nothing");
});

test("the inbox lists them; the Stop line counts them", () => {
  const items = buildInbox(root, { model, rec });
  const sensors = items.filter((i) => i.kind === "sensor");
  assert.equal(sensors.length, sensed().findings.length);
  assert.ok(sensors.every((i) => i.decidable && i.id.startsWith("sensor:")));
  assert.match(inboxLine(items), /^\d+ decisions? await the person/);
});

test("agreeing a contradiction supersedes the item: it leaves every map and stays on the record", () => {
  const r = decideInbox(root, "sensor:contradicted:processes:projector", "agree", { who: "Ben", model, rec });
  assert.ok(r.ok, r.detail);
  const plan = loadPlan(root);
  const p = plan.processes.find((x) => x.id === "projector");
  assert.equal(p.status, "dropped");
  assert.equal(p.supersededBy, plan.decisions[0].id);
  assert.match(p.supersededWhy, /not needed/);
  assert.equal(plan.decisions[0].status, "agreed");
  assert.equal(plan.decisions[0].from, "sensor:contradicted:processes:projector");
  const recs = planRecords(plan, null, null);
  assert.ok(!recs.nodes.some((n) => n.id.includes("projector")), "a superseded item is drawn on no map");
  assert.match(formatPlanMd(plan), /## Superseded[\s\S]*projector/);
  assert.match(compactPlan(plan), /Superseded — do not build: projector/);
  assert.ok(!sensed().findings.some((f) => f.kind === "contradicted"), "decided once, not found again");
});

test("agreeing an answered question records the decision and closes the question", () => {
  const r = decideInbox(root, "sensor:answered:q1", "agree", { model, rec });
  assert.ok(r.ok, r.detail);
  const plan = loadPlan(root);
  assert.ok(!plan.open.some((q) => q.id === "q1"));
  assert.equal(plan.resolved.find((q) => q.id === "q1").state, "closed");
  assert.ok(plan.decisions.some((d) => d.from === "open:q1" && d.status === "agreed"));
});

test("agreeing a placement and a principal applies their edits; a rejected finding does not come back", () => {
  assert.ok(decideInbox(root, "sensor:located:server", "agree", { model, rec }).ok);
  assert.ok(decideInbox(root, "sensor:new-identity:svc/runner.ts", "agree", { model, rec }).ok);
  const np = sensed().findings.find((f) => f.kind === "new-process");
  assert.ok(decideInbox(root, `sensor:${np.key}`, "reject", { model, rec }).ok);
  const plan = loadPlan(root);
  assert.match(plan.processes.find((p) => p.id === "server").entryPoints[0], /^svc\/server\.ts/);
  assert.ok(plan.principals.some((p) => p.id === "runner-run"));
  assert.equal(plan.decisions.find((d) => d.from === np.from).status, "rejected");
  assert.ok(!sensed().findings.some((f) => f.from === np.from), "a person's no is remembered");
});

test("an agent's supersede waits as a proposed decision a person takes", () => {
  const r = applyPlanOps(loadPlan(root), [{ op: "supersede", section: "processes", id: "runner", why: "the runner moves into the order service" }], "agent");
  assert.ok(r.plan, r.error);
  assert.ok(!savePlan(root, r.plan).error);
  let plan = loadPlan(root);
  assert.notEqual(plan.processes.find((p) => p.id === "runner").status, "dropped", "nothing applied yet");
  const d = plan.decisions.at(-1);
  assert.equal(d.status, "proposed");
  assert.ok(buildInbox(root).some((i) => i.id === `decision:${d.id}`));
  assert.ok(decideInbox(root, `decision:${d.id}`, "reject").ok);
  plan = loadPlan(root);
  assert.equal(plan.decisions.at(-1).status, "rejected");
  assert.notEqual(plan.processes.find((p) => p.id === "runner").status, "dropped");
});
