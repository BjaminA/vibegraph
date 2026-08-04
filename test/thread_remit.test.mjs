/**
 * M-SKILL.1 — remit index + lexical question matching.
 *
 * The routing floor, pinned: only exact code-shaped tokens match (a bare
 * English word never routes un-backticked), scores rank by specificity
 * (node-id > file > symbol), ordering is deterministic, and an unmatched
 * question yields [] — the caller's no-op guarantee.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/thread_remit.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRemitIndex, matchQuestion, tokenizeQuestion } from "../src/server/thread_remit.ts";

// Two-thread fixture shaped like flask_demo's project envelope.
const THREADS = [
  {
    seed: { file: "db.py", qualifiedName: "db:query" },
    entryPointId: "db.py:query",
    filesReached: ["db.py"],
    nodes: [
      { id: "db:query", kind: "seed", label: "query", irNodeId: "module/query.fn" },
      { id: "db:_get_conn", kind: "step", label: "_get_conn", irNodeId: "module/_get_conn.fn" },
      {
        id: "external:sqlite3.connect",
        kind: "external",
        label: "sqlite3.connect",
        irNodeId: "module/_get_conn.fn/return@0",
        qualifiedTarget: "sqlite3.connect",
      },
    ],
  },
  {
    seed: { file: "app.py", qualifiedName: "app:create_user_route" },
    entryPointId: "app.py:create_user_route",
    filesReached: ["app.py", "models.py", "db.py"],
    nodes: [
      { id: "app:create_user_route", kind: "seed", label: "create_user_route", irNodeId: "module/create_user_route.fn" },
      { id: "models:create_user", kind: "step", label: "create_user", irNodeId: "module/create_user.fn" },
      { id: "db:insert", kind: "step", label: "insert", irNodeId: "module/insert.fn", receiverBoundFrom: "_get_conn" },
    ],
  },
  // No entry point → no skill/agent to route to → not indexed.
  { seed: { file: "loose.py", qualifiedName: "loose:orphan" }, entryPointId: null, filesReached: ["loose.py"], nodes: [] },
];

const INDEX = buildRemitIndex(THREADS);

test("index shape: one remit per entry-pointed thread; files/nodeIds/symbols populated", () => {
  assert.equal(INDEX.length, 2);
  const db = INDEX.find((r) => r.entryPointId === "db.py:query");
  assert.ok(db.files.has("db.py"));
  assert.ok(db.nodeIds.has("module/_get_conn.fn"));
  // colon form, human dotted form, and segments all enter the symbol set
  for (const s of ["db:query", "db.query", "query", "_get_conn", "sqlite3.connect"]) {
    assert.ok(db.symbols.has(s), `missing symbol ${s}`);
  }
});

test("node-id token matches and outranks everything", () => {
  const m = matchQuestion("why does module/_get_conn.fn open a connection?", INDEX);
  assert.equal(m.length, 1);
  assert.equal(m[0].entryPointId, "db.py:query");
  assert.deepEqual(m[0].matchedOn, [{ kind: "node-id", token: "module/_get_conn.fn" }]);
  assert.equal(m[0].score, 4);
});

test("file token matches every thread whose remit reaches it, ranked", () => {
  const m = matchQuestion("what happens in db.py?", INDEX);
  assert.equal(m.length, 2);
  for (const match of m) assert.deepEqual(match.matchedOn, [{ kind: "file", token: "db.py" }]);
  // equal score → deterministic entryPointId asc
  assert.deepEqual(m.map((x) => x.entryPointId), ["app.py:create_user_route", "db.py:query"]);
});

test("dotted symbol matches un-backticked; the seed's human form works", () => {
  const m = matchQuestion("explain db.query for me", INDEX);
  assert.equal(m.length, 1);
  assert.equal(m[0].entryPointId, "db.py:query");
  assert.deepEqual(m[0].matchedOn, [{ kind: "symbol", token: "db.query" }]);
});

test("a bare English word never matches un-backticked; backticked it does", () => {
  assert.deepEqual(matchQuestion("how do I query users?", INDEX), []);
  const m = matchQuestion("how does `query` work?", INDEX);
  assert.equal(m.length, 1);
  assert.equal(m[0].entryPointId, "db.py:query");
});

test("underscored and called tokens are code-shaped on their own", () => {
  // _get_conn is genuinely in BOTH remits (db walks it; app's insert binds a
  // receiver from it) — routing surfaces both, provenance says why.
  const conn = matchQuestion("where is _get_conn defined?", INDEX);
  assert.deepEqual(conn.map((x) => x.entryPointId).sort(), ["app.py:create_user_route", "db.py:query"]);
  assert.equal(matchQuestion("who calls create_user()?", INDEX)[0].entryPointId, "app.py:create_user_route");
});

test("seed ownership outranks a pass-through mention", () => {
  // Both remits carry `insert`-adjacent symbols in principle, but only the
  // app thread WALKS db:insert while a hypothetical seed owner would outrank
  // it. Here: `db.query` is db-thread's SEED (score 3) while a thread that
  // merely walked db:query would score 1 — pinned via the score itself.
  const m = matchQuestion("explain db.query", INDEX);
  assert.equal(m[0].entryPointId, "db.py:query");
  assert.equal(m[0].score, 3);
});

test("exclude drops the active thread; limit caps the result", () => {
  const m = matchQuestion("what happens in db.py?", INDEX, { exclude: ["app.py:create_user_route"] });
  assert.deepEqual(m.map((x) => x.entryPointId), ["db.py:query"]);
  assert.equal(matchQuestion("what happens in db.py?", INDEX, { limit: 1 }).length, 1);
});

test("scores accumulate across distinct matched tokens", () => {
  const m = matchQuestion("does `insert` in db.py go through create_user()?", INDEX);
  const app = m.find((x) => x.entryPointId === "app.py:create_user_route");
  // file(2) + symbol insert(1) + symbol create_user(1) = 4, ranked first
  assert.equal(app.score, 4);
  assert.equal(m[0].entryPointId, "app.py:create_user_route");
});

test("empty / codeless questions yield [] — the no-op guarantee", () => {
  assert.deepEqual(matchQuestion("", INDEX), []);
  assert.deepEqual(matchQuestion("please make the tests pass thanks", INDEX), []);
});

test("tokenizer: *.py tokens are files not symbols; node ids never re-enter as symbols", () => {
  const t = tokenizeQuestion("see module/insert.fn and db.py and `db.insert`");
  assert.ok(t.nodeIds.has("module/insert.fn"));
  assert.ok(t.files.has("db.py"));
  assert.ok(t.symbols.has("db.insert"));
  assert.ok(!t.symbols.has("db.py"));
  assert.ok(!t.symbols.has("module/insert.fn"));
});

// ── M-SKILL.2 — routing budget + session dedup (applyRoutingBudget) ──

import { applyRoutingBudget } from "../src/server/thread_remit.ts";

const cand = (id, body, hash, matchedOn = [{ kind: "symbol", token: id }]) => ({
  entryPointId: id,
  qualifiedName: id,
  matchedOn,
  score: 1,
  skillBody: body,
  sourceHash: hash,
});

test("budget: bodies inject in order until the budget runs out; overflow is honest, never truncated", () => {
  const { routed, injected } = applyRoutingBudget(
    [cand("a", "x".repeat(50), "h1"), cand("b", "y".repeat(60), "h2"), cand("c", "z".repeat(10), "h3")],
    new Map(),
    70,
  );
  assert.equal(routed[0].skill.length, 50);
  assert.equal(routed[1].skill, null);
  assert.equal(routed[1].skillOmitted, "over-budget");
  // c still fits in the remainder (20 left ≥ 10) — overflow of b does not end the turn's budget
  assert.equal(routed[2].skill.length, 10);
  assert.deepEqual(injected, [["a", "h1"], ["c", "h3"]]);
});

test("dedup: an identical already-injected skill re-routes as a reference; a CHANGED skill re-injects", () => {
  const seen = new Map([["a", "h1"], ["b", "old-hash"]]);
  const { routed, injected } = applyRoutingBudget(
    [cand("a", "body-a", "h1"), cand("b", "body-b-v2", "h2-new")],
    seen,
  );
  assert.equal(routed[0].skillOmitted, "already-in-session");
  assert.equal(routed[1].skill, "body-b-v2");
  assert.deepEqual(injected, [["b", "h2-new"]]);
});

test("a match with no authoritative skill routes with skill:null and NO omission reason", () => {
  const { routed, injected } = applyRoutingBudget([cand("a", null, null)], new Map());
  assert.equal(routed[0].skill, null);
  assert.equal(routed[0].skillOmitted, undefined);
  assert.deepEqual(injected, []);
});

test("M-SKILL.7: a stale-withheld ratified skill routes with the honest 'stale' omission reason", () => {
  const { routed, injected } = applyRoutingBudget(
    [{ ...cand("a", null, null), staleRatified: true }],
    new Map(),
  );
  assert.equal(routed[0].skill, null);
  assert.equal(routed[0].skillOmitted, "stale");
  assert.deepEqual(injected, []);
});

// Sitting-2 — the routed line must SAY why no skill was shared when none was
// ever ratified (the sitting read the plain routed line as a missing feature).
test("skillMissing: absent/draft threads carry the honest reason; stale-withheld does not double-report", () => {
  const { routed } = applyRoutingBudget(
    [
      { ...cand("a", null, null), skillState: "absent" },
      { ...cand("b", null, null), skillState: "draft" },
      // stale wins over any (mis)set skillState — a ratified skill EXISTS.
      { ...cand("c", null, null), staleRatified: true, skillState: "absent" },
      cand("d", "body-d", "h4"),
    ],
    new Map(),
  );
  assert.equal(routed[0].skillMissing, "absent");
  assert.equal(routed[1].skillMissing, "draft");
  assert.equal(routed[2].skillOmitted, "stale");
  assert.equal(routed[2].skillMissing, undefined);
  assert.equal(routed[3].skill, "body-d");
  assert.equal(routed[3].skillMissing, undefined);
});

test("matchedOn tokens render human-readable: symbols backticked, files/node-ids bare", () => {
  const { routed } = applyRoutingBudget(
    [cand("a", null, null, [
      { kind: "symbol", token: "db.query" },
      { kind: "file", token: "db.py" },
      { kind: "node-id", token: "module/query.fn" },
    ])],
    new Map(),
  );
  assert.deepEqual(routed[0].matchedOn, ["`db.query`", "db.py", "module/query.fn"]);
});

// ── M-SKILL.6 — node-click dispatch (matchNode + mergeMatches) ──

import { matchNode, mergeMatches } from "../src/server/thread_remit.ts";

// Rebuild with seed irNodeIds present (the wire always carries them).
const NODE_THREADS = [
  { ...THREADS[0], seed: { ...THREADS[0].seed, irNodeId: "module/query.fn" } },
  { ...THREADS[1], seed: { ...THREADS[1].seed, irNodeId: "module/create_user_route.fn" } },
];
const NODE_INDEX = buildRemitIndex(NODE_THREADS);

test("node dispatch: the SEED owner outranks a thread that merely walks the node", () => {
  // db.py's query.fn is db-thread's seed; no other thread walks it here.
  const m = matchNode("module/query.fn", "db.py", NODE_INDEX);
  assert.equal(m[0].entryPointId, "db.py:query");
  assert.equal(m[0].score, 4);
  // insert.fn is only WALKED by the app thread (its seed is elsewhere).
  const w = matchNode("module/insert.fn", "db.py", NODE_INDEX);
  assert.deepEqual(w.map((x) => [x.entryPointId, x.score]), [["app.py:create_user_route", 2]]);
});

test("node dispatch: file disambiguation — a thread not reaching the file never matches", () => {
  // db-thread's remit reaches only db.py; the same id 'in' models.py must not hit it.
  assert.deepEqual(matchNode("module/query.fn", "models.py", NODE_INDEX), []);
  // unknown file → caller passes null → membership alone decides.
  assert.equal(matchNode("module/query.fn", null, NODE_INDEX)[0].entryPointId, "db.py:query");
});

test("node dispatch: exclude drops the active thread; unknown node → []", () => {
  assert.deepEqual(matchNode("module/query.fn", "db.py", NODE_INDEX, { exclude: ["db.py:query"] }), []);
  assert.deepEqual(matchNode("module/nope.fn", null, NODE_INDEX), []);
});

test("mergeMatches: a thread hit by node AND text sums scores and unions tokens", () => {
  const node = matchNode("module/query.fn", "db.py", NODE_INDEX);
  const text = matchQuestion("explain db.query", NODE_INDEX);
  const merged = mergeMatches(node, text);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].entryPointId, "db.py:query");
  assert.equal(merged[0].score, 7); // owner 4 + seed symbol 3
  assert.deepEqual(merged[0].matchedOn.map((t) => t.token).sort(), ["db.query", "module/query.fn"]);
});

test("mergeMatches: distinct threads interleave by combined score, deterministic, limited", () => {
  const a = [{ entryPointId: "b", qualifiedName: "b", matchedOn: [{ kind: "symbol", token: "x" }], score: 2 }];
  const b = [
    { entryPointId: "a", qualifiedName: "a", matchedOn: [{ kind: "symbol", token: "y" }], score: 2 },
    { entryPointId: "c", qualifiedName: "c", matchedOn: [{ kind: "symbol", token: "z" }], score: 1 },
  ];
  assert.deepEqual(mergeMatches(a, b).map((m) => m.entryPointId), ["a", "b", "c"]);
  assert.deepEqual(mergeMatches(a, b, 2).map((m) => m.entryPointId), ["a", "b"]);
});
