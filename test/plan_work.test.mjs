/**
 * vibegraph_plan_work — deterministic task decomposition, pinned:
 * remit-matched packets ordered dependencies-first off the tcall graph,
 * boundary counts + outside-plan adjacency (the escalation surface) on every
 * packet, skill states mapped through the M-SKILL.7 lifecycle, zero-match and
 * unmatched-token honesty, cycles reported never silently linearized.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/plan_work.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planWork } from "../src/server/plan_work.ts";

// Envelope-shaped fixture: a route and a cli thread both call into db:query's
// head; the route thread ALSO reaches an entry-pointed thread that stays
// outside the plan (audit). db:query carries one unresolved + one dynamic +
// one uncaptured node for the boundary counts.
const THREADS = [
  {
    seed: { file: "app.py", qualifiedName: "app:route", irNodeId: "module/route.fn" },
    entryPointId: "app.py:route",
    filesReached: ["app.py", "db.py"],
    nodes: [
      { id: "app:route", kind: "seed", label: "route", file: "app.py", irNodeId: "module/route.fn" },
      { id: "db:query", kind: "step", label: "query", file: "db.py", irNodeId: "module/query.fn" },
      { id: "audit:log", kind: "step", label: "log_audit", file: "audit.py", irNodeId: "module/log_audit.fn" },
    ],
  },
  {
    seed: { file: "db.py", qualifiedName: "db:query", irNodeId: "module/query.fn" },
    entryPointId: "db.py:query",
    filesReached: ["db.py"],
    nodes: [
      { id: "db:query", kind: "seed", label: "query", file: "db.py", irNodeId: "module/query.fn" },
      { id: "unres:helper", kind: "unresolved", label: "helper", file: null, irNodeId: null },
      { id: "dyn:conn.execute", kind: "dynamic", label: "conn.execute", file: "db.py", irNodeId: "module/query.fn/cursor.assign" },
      { id: "db:pack", kind: "step", label: "pack_rows", file: "db.py", irNodeId: "module/pack_rows.fn", nestsInnerCalls: true, nestExtracted: false },
    ],
  },
  {
    seed: { file: "cli.py", qualifiedName: "cli:main", irNodeId: "module/main.fn" },
    entryPointId: "cli.py:main",
    filesReached: ["cli.py", "db.py"],
    nodes: [
      { id: "cli:main", kind: "seed", label: "main", file: "cli.py", irNodeId: "module/main.fn" },
      { id: "db:query", kind: "step", label: "query", file: "db.py", irNodeId: "module/query.fn" },
    ],
  },
  {
    seed: { file: "audit.py", qualifiedName: "audit:log_audit", irNodeId: "module/log_audit.fn" },
    entryPointId: "audit.py:log_audit",
    filesReached: ["audit.py"],
    nodes: [
      { id: "audit:log_audit", kind: "seed", label: "log_audit", file: "audit.py", irNodeId: "module/log_audit.fn" },
    ],
  },
];

const ENTRY_POINTS = [
  { id: "app.py:route", kind: "route", file: "app.py", irNodeId: "module/route.fn" },
  { id: "db.py:query", kind: "public_api", file: "db.py", irNodeId: "module/query.fn" },
  { id: "cli.py:main", kind: "cli", file: "cli.py", irNodeId: "module/main.fn" },
  { id: "audit.py:log_audit", kind: "public_api", file: "audit.py", irNodeId: "module/log_audit.fn" },
];

const NO_SKILL = () => ({ exists: false, key: "", entryPointId: "" });

function plan(task, skillFor = NO_SKILL, maxPackets) {
  return planWork({ task, threads: THREADS, entryPoints: ENTRY_POINTS, skillFor, maxPackets });
}

test("packets order dependencies-first: the called thread (db:query) builds before its callers", () => {
  const p = plan("rework `db.query` pagination for the `route` handler and `cli.main`");
  const ids = p.packets.map((x) => x.entryPointId);
  assert.ok(ids.includes("db.py:query") && ids.includes("app.py:route") && ids.includes("cli.py:main"), JSON.stringify(ids));
  assert.ok(
    ids.indexOf("db.py:query") < ids.indexOf("app.py:route") && ids.indexOf("db.py:query") < ids.indexOf("cli.py:main"),
    `dependency must come first: ${ids.join(", ")}`,
  );
  assert.deepEqual(p.packets.map((x) => x.order), p.packets.map((_, i) => i + 1));
  assert.equal(p.cycles.length, 0);
});

test("each packet carries honest provenance, dependsOn, and the outside-plan escalation surface", () => {
  const p = plan("rework `db.query` pagination for the `route` handler and `cli.main`");
  const route = p.packets.find((x) => x.entryPointId === "app.py:route");
  assert.equal(route.kind, "route");
  assert.deepEqual(route.boundaries.dependsOn, ["db.py:query"]);
  // audit:log_audit is entry-pointed and called by route, but NOT in the plan.
  assert.deepEqual(route.boundaries.outsidePlan.reaches, ["audit.py:log_audit"]);
  assert.ok(route.matchedOn.includes("`route`"), JSON.stringify(route.matchedOn));

  const query = p.packets.find((x) => x.entryPointId === "db.py:query");
  assert.deepEqual(query.boundaries.dependsOn, []);
  // Callers outside the plan: none (both callers are IN the plan).
  assert.deepEqual(query.boundaries.outsidePlan.reachedBy, []);
  assert.deepEqual(query.filesReached, ["db.py"]);
});

test("boundary counts read straight off the thread's node kinds; completeness ignores dynamic", () => {
  const p = plan("fix `db.query`");
  const query = p.packets.find((x) => x.entryPointId === "db.py:query");
  assert.equal(query.boundaries.resolutionGaps, 1);
  assert.equal(query.boundaries.runtimeDispatch, 1);
  assert.equal(query.boundaries.uncaptured, 1);
  assert.equal(query.boundaries.staticallyComplete, false);
});

test("skill lifecycle maps through: authoritative / stale(±auto) / draft / none, each with an actionable note", () => {
  const states = {
    "db.py:query": { exists: true, status: "ratified", stale: false, body: "", key: "", entryPointId: "db.py:query", sourceHash: "", generatedAt: "" },
    "app.py:route": { exists: true, status: "ratified", stale: true, body: "", key: "", entryPointId: "app.py:route", sourceHash: "", generatedAt: "" },
    "cli.py:main": { exists: true, status: "draft", stale: false, body: "", key: "", entryPointId: "cli.py:main", sourceHash: "", generatedAt: "" },
  };
  const p = plan("rework `db.query` pagination for the `route` handler and `cli.main`", (id) => states[id] ?? NO_SKILL());
  const by = Object.fromEntries(p.packets.map((x) => [x.entryPointId, x.skill]));
  assert.equal(by["db.py:query"].status, "authoritative");
  assert.equal(by["app.py:route"].status, "stale");
  assert.match(by["app.py:route"].note, /Re-affirm or Re-draft/);
  assert.equal(by["cli.py:main"].status, "draft");
  assert.match(by["cli.py:main"].note, /NOT ratified/);

  const p2 = plan("fix `db.query`", () => ({ ...states["app.py:route"], autoReaffirm: true }));
  assert.match(p2.packets[0].skill.note, /verify-first caveat/);
});

test("zero matches: an honest empty plan with guidance — never an error, never a guess", () => {
  const p = plan("make everything better please");
  assert.deepEqual(p.packets, []);
  assert.match(p.planNote, /No thread's remit matched/);
  assert.match(p.planNote, /vibegraph_list_entry_points/);
  assert.ok(p.verification.length > 0);
});

test("unmatchedTokens names code-shaped tokens NO thread owns; owned tokens stay off the list", () => {
  const p = plan("wire `db.query` into the new `billing_engine` module");
  assert.ok(p.unmatchedTokens.includes("`billing_engine`"), JSON.stringify(p.unmatchedTokens));
  assert.ok(!p.unmatchedTokens.includes("`db.query`"));
  assert.match(p.planNote, /unmatchedTokens/);
});

test("a dependency cycle is REPORTED and its packets still ship, score-ranked", () => {
  // a's thread walks b's head and vice versa.
  const threads = [
    {
      seed: { file: "a.py", qualifiedName: "a:alpha", irNodeId: "module/alpha.fn" },
      entryPointId: "a.py:alpha", filesReached: ["a.py", "b.py"],
      nodes: [
        { id: "a:alpha", kind: "seed", label: "alpha", file: "a.py", irNodeId: "module/alpha.fn" },
        { id: "b:beta", kind: "step", label: "beta", file: "b.py", irNodeId: "module/beta.fn" },
      ],
    },
    {
      seed: { file: "b.py", qualifiedName: "b:beta", irNodeId: "module/beta.fn" },
      entryPointId: "b.py:beta", filesReached: ["b.py", "a.py"],
      nodes: [
        { id: "b:beta", kind: "seed", label: "beta", file: "b.py", irNodeId: "module/beta.fn" },
        { id: "a:alpha", kind: "step", label: "alpha", file: "a.py", irNodeId: "module/alpha.fn" },
      ],
    },
  ];
  const eps = [
    { id: "a.py:alpha", kind: "public_api", file: "a.py", irNodeId: "module/alpha.fn" },
    { id: "b.py:beta", kind: "public_api", file: "b.py", irNodeId: "module/beta.fn" },
  ];
  const p = planWork({ task: "refactor `alpha` and `beta`", threads, entryPoints: eps, skillFor: NO_SKILL });
  assert.equal(p.packets.length, 2);
  assert.equal(p.cycles.length, 1);
  assert.deepEqual([...p.cycles[0]].sort(), ["a.py:alpha", "b.py:beta"]);
});

test("maxPackets caps the plan; determinism: same task → byte-identical plan", () => {
  const p = plan("what touches db.py?", NO_SKILL, 2);
  assert.ok(p.packets.length <= 2);
  const a = JSON.stringify(plan("rework `db.query` for `route` and `cli.main`"));
  const b = JSON.stringify(plan("rework `db.query` for `route` and `cli.main`"));
  assert.equal(a, b);
});

test("verification names the real floor: bounded agents, CST chokepoint, assertions, run-to-node", () => {
  const p = plan("fix `db.query`");
  const v = p.verification.join("\n");
  assert.match(v, /vibegraph_spawn_thread_agent/);
  assert.match(v, /vibegraph_rewrite_node/);
  assert.match(v, /vibegraph_thread_assertions/);
  assert.match(v, /vibegraph_run_thread_to_node/);
  assert.match(v, /Ratification stays human/);
});
