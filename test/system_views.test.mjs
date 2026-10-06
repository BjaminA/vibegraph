// SYSTEM VIEWS (2026-10-06, field brief PROMPT-system-views): the map in the
// project's own words, every item once, simpler as you zoom out. Fixture
// test/fixtures/system/views_demo: a partner gateway (listens; nothing in the
// project calls it), a decider, a clerk app and an admin script sharing one
// store through lib/store.ts; a declared topology (7 zones, 5 identities, a
// state machine, a decision tree); a plan naming every built process, an
// outside partner system, two processes not built and one flow. Pinned: Real
// draws the store under its plan name with its declared size and writers,
// the outside caller, the identities as badges and the decision structures;
// the Overlay matches by identity, so no zone and no store is drawn twice;
// at every mode the box count never rises as you zoom out; and topology
// inputs registered as one string still name their files.
//
//   npm run test:system-views
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { loadPlan } from "../src/server/plan_store.ts";
import { reconcilePlan } from "../src/server/plan_reconcile.ts";
import { loadTopology } from "../src/server/topology_store.ts";
import { enrichReal } from "../src/webview/system/arch_real.ts";
import { atLevel, levelOf, NOT_BUILT } from "../src/webview/system/arch_levels.ts";
import { planModel, overlayModel, PLAN_ID } from "../src/webview/system/arch_plan.ts";
import { lensSelection } from "../src/webview/system/arch_lens.ts";

const ROOT = "test/fixtures/system/views_demo";
let env, real, plan, rec, topology;
before(() => {
  env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  const stack = buildStackIndex(env, ROOT);
  const derived = archModelForEnvelope(env, stack, buildCrossingIndex(env), ROOT, undefined, { applyStore: false });
  plan = loadPlan(ROOT);
  rec = reconcilePlan(plan, env, stack, ROOT);
  topology = loadTopology(ROOT).topology;
  real = enrichReal(derived, { plan, rec, topology, threads: env.threads });
});

const LENS = { birdseye: "birdseye", overview: "overview", detail: "payloads" };
/** What a mode draws at a level: the cards, after the lens's own selection. */
function drawn(mode, level) {
  const base = mode === "real" ? real : mode === "plan" ? planModel(plan, rec) : overlayModel(real, plan, rec);
  const lv = atLevel(base, level, { plan: mode === "plan" });
  return mode === "plan" ? lensSelection(lv, "payloads", { keepPlannedTools: true }).nodes : lensSelection(lv, LENS[level], { keepPlannedTools: mode === "overlay" }).nodes;
}
const byLabel = (nodes, label) => nodes.find((n) => n.label === label);

test("Real: the store under its plan name, with its declared zones and writers; the code's zones in its box", () => {
  const store = byLabel(real.nodes, "order ledger");
  assert.ok(store, "the store card carries the plan's name");
  assert.match(store.sublabel, /^7 zones · 5 writers/);
  assert.deepEqual(store.badges.map((b) => b.id).sort(), ["admin", "auditor", "clerk", "decider", "gateway"]);
  const group = real.groups.find((g) => g.id === "storegroup:ledger");
  const zones = real.nodes.filter((n) => n.storeOf === store.id && n.zoneOf);
  assert.ok(zones.length >= 3, zones.map((z) => z.id).join(", "));
  // a zone is labelled by the plan, sized by the declaration, badged by who may write it
  const req = byLabel(zones, "order requests, per role");
  assert.ok(req, zones.map((z) => z.label).join(", "));
  assert.match(req.sublabel, /^3 zones · writers auditor, clerk, gateway/);
  const status = byLabel(zones, "order status");
  assert.deepEqual(status.badges.map((b) => b.id), ["decider"]);
  // a zone one identity alone writes sits in a trust box inside the store's
  const trust = real.groups.find((g) => g.kind === "trust" && g.wraps.includes(status.id));
  assert.equal(trust.label, "written only by decider");
  assert.ok(group.wraps.includes(trust.id) && group.wraps.includes(store.id));
});

test("Real: processes by their plan names with who they run as; the outside caller; the decision structures", () => {
  const gw = real.nodes.find((n) => n.kind === "cluster" && n.label === "partner gateway");
  assert.ok(gw, real.nodes.filter((n) => n.kind === "cluster").map((n) => n.label).join(" | "));
  assert.deepEqual(gw.serves, { how: "listen", files: ["gateway/src/server.ts"] });
  assert.deepEqual(gw.badges.map((b) => b.id), ["gateway"]);
  assert.ok(gw.derivedLabel && gw.derivedLabel !== gw.label, "the code's own name is kept");
  const partner = byLabel(real.nodes, "partner system");
  assert.equal(partner.kind, "actor");
  assert.ok(real.edges.some((e) => e.from === partner.id && e.to === gw.id && e.kind === "http"), "the plan's outside caller calls the gateway");
  // the clerk app also listens and nothing calls it: an unnamed outside caller
  const app = real.nodes.find((n) => n.label === "clerk app");
  assert.ok(real.edges.some((e) => e.to === app.id && e.from.startsWith("actor:outside:")));
  const decider = real.nodes.find((n) => n.label === "order decider");
  assert.deepEqual(decider.badges.map((b) => b.id), ["decider"]);
  for (const id of ["decision:sm:order-phase", "decision:dt:release"]) {
    const d = real.nodes.find((n) => n.id === id);
    assert.ok(d?.essential, id);
    assert.ok(real.edges.some((e) => e.from === decider.id && e.to === id && e.protocol === "enforces"), `${id} hangs off the decider (evaluatedBy → its threads)`);
  }
  assert.match(real.nodes.find((n) => n.id === "decision:dt:release").sublabel, /2 gates · 2 outcomes/);
});

test("Overlay: matched by identity — no zone family, store or process drawn twice", () => {
  const ov = overlayModel(real, plan, rec);
  // every planned zone lands on ONE box
  const zoneBoxes = ov.nodes.filter((n) => n.zoneOf || n.id.startsWith(`${PLAN_ID}zone:`));
  const families = zoneBoxes.flatMap((n) => n.zoneOf?.holds ?? []);
  assert.equal(new Set(families).size, families.length, `a family twice: ${families.join(", ")}`);
  assert.ok(!ov.nodes.some((n) => n.id.startsWith(`${PLAN_ID}zone:`)), "every planned zone is realised: no ghost zone");
  assert.ok(!ov.nodes.some((n) => n.id === `${PLAN_ID}store:ledger`), "the store is not drawn a second time");
  for (const p of ["partner-gateway", "decider", "clerk-app", "appointer", "partner"]) assert.ok(!ov.nodes.some((n) => n.id === `${PLAN_ID}${p}`), `${p} not drawn twice`);
  assert.ok(ov.nodes.some((n) => n.plannedAs?.id === "ledger/status"), "the real zone carries the plan's chip");
  assert.deepEqual(ov.nodes.filter((n) => n.source === "planned").map((n) => n.id).sort(), [`${PLAN_ID}archiver`, `${PLAN_ID}projector`]);
});

test("every mode simplifies as you zoom out: detail ≥ overview ≥ Bird's-eye, and Bird's-eye < detail", () => {
  const counts = {};
  for (const mode of ["real", "plan", "overlay"]) {
    const [b, o, d] = ["birdseye", "overview", "detail"].map((l) => drawn(mode, l).length);
    counts[mode] = { b, o, d };
    assert.ok(d >= o && o >= b && b < d, `${mode}: detail ${d}, overview ${o}, bird's-eye ${b}`);
  }
  assert.ok(counts.real.b <= 14, `Real bird's-eye ${counts.real.b} boxes`);
  assert.ok(counts.overlay.b <= counts.real.b + 1, `Overlay bird's-eye ${counts.overlay.b} vs Real ${counts.real.b}`);
  const bird = drawn("real", "birdseye");
  for (const label of ["order ledger", "partner system", "order-phase", "release"]) assert.ok(byLabel(bird, label), `${label} on Real's Bird's-eye`);
  assert.ok(!bird.some((n) => n.zoneOf), "zones fold into the store at Bird's-eye");
  const chip = drawn("overlay", "birdseye").find((n) => n.id === NOT_BUILT);
  assert.equal(chip.label, "2 planned, not built");
  assert.match(chip.sublabel, /order projector, order archiver/);
  assert.deepEqual(["birdseye", "overview", "tools", "payloads", "trust"].map(levelOf), ["birdseye", "overview", "detail", "detail", "overview"]);
});

test("a flow is a named path over the boxes it crosses", () => {
  const f = real.realFlows.find((x) => x.id === "order-request");
  const labels = f.nodes.map((id) => real.nodes.find((n) => n.id === id)?.label);
  for (const l of ["clerk app", "order decider", "partner gateway", "order requests, per role", "order status"]) assert.ok(labels.includes(l), `${l} on the path (${labels.join(", ")})`);
  assert.ok(f.edges.length >= 3, `${f.edges.length} edges lit`);
  assert.equal(f.steps.length, 4);
});
