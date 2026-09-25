/**
 * M-COMP — a comprehension is a loop, and the verdict does not depend on
 * spelling.
 *
 * W1's expression sweep made a call inside a comprehension VISIBLE to the
 * effect floor. It did not make it REPEATED: round-trip detection walks a
 * thread for a loop CONTAINER, and a comprehension had none — so
 * `[fetch(u) for u in urls]` and the identical spelled-out for-loop got
 * different N+1 verdicts for the same N requests.
 *
 * WHY THIS FIXTURE EXISTS. A census over every other fixture and example
 * found 59 comprehensions carrying a repeated call and ZERO carrying an
 * EFFECTFUL one (checked twice — once against the parser's own effectKind,
 * once with an independent regex net). That is not evidence the pattern is
 * rare in real code; it is evidence our fixtures were written to exercise
 * other things. Without a fixture that contains one, this container would
 * have been untested the day after it shipped. Same reasoning that built
 * test/fixtures/stack/stdlib_demo for M-TABLES.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/comprehension.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeThreadContract } from "../src/server/thread_contract.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, "test", "fixtures", "comprehension", "comp_demo");
const env = JSON.parse(readFileSync(join(DIR, "comp_demo.project.json"), "utf-8"));
const ir = env.files["fanout.py"];

const nodeFor = (file, irNodeId) => {
  if (!irNodeId) return null;
  const search = file ? [env.files[file]].filter(Boolean) : Object.values(env.files);
  for (const f of search) {
    const n = f.nodes.find((x) => x.id === irNodeId);
    if (n) return n;
  }
  return null;
};
const threadOf = (ep) => env.threads.find((t) => t.entryPointId === ep);
const contract = (ep) =>
  computeThreadContract(threadOf(ep), { nodeFor, reaches: [], reachedBy: [] });

const nodeById = Object.fromEntries(ir.nodes.map((n) => [n.id, n]));
const compsIn = (fn) =>
  ir.nodes.filter((n) => n.type === "comprehension" && n.id.startsWith(`module/${fn}.fn/`));
/** The single effectful call inside one function. */
const effectCallIn = (fn) => {
  const hits = ir.nodes.filter(
    (n) => n.type === "call" && n.effectKind && n.id.startsWith(`module/${fn}.fn/`));
  assert.equal(hits.length, 1, `${fn}: expected exactly one effectful call, got ${hits.length}`);
  return hits[0];
};

// ── the parser ────────────────────────────────────────────────────────

test("all four comprehension forms emit a container, with compKind and the outermost for-clause", () => {
  const seen = {};
  for (const fn of ["fetch_comp", "fetch_dict", "fetch_genexp", "filter_live"]) {
    const comps = compsIn(fn);
    assert.equal(comps.length, 1, `${fn}: one comprehension`);
    seen[fn] = comps[0].compKind;
    // target + iterName mirror ForLoopNode and carry the OUTERMOST clause.
    assert.ok(comps[0].target, `${fn}: target`);
    assert.ok(comps[0].iterName, `${fn}: iterName`);
  }
  assert.deepEqual(seen, {
    fetch_comp: "list", fetch_dict: "dict", fetch_genexp: "generator", filter_live: "list",
  });
});

test("the repeated call parents INSIDE the container — element and `if` clause alike", () => {
  for (const fn of ["fetch_comp", "fetch_dict", "fetch_genexp", "filter_live"]) {
    const call = effectCallIn(fn);
    assert.equal(nodeById[call.parentId]?.type, "comprehension",
      `${fn}: ${call.id} should parent at its comprehension, not ${call.parentId}`);
  }
});

test("page_once: the OUTERMOST iterable runs once, so its call parents OUTSIDE", () => {
  // `[row["id"] for row in requests.get(url).json()]` is ONE request. This is
  // the same rule visit_For applies to `for x in fetch_all():`, and it is the
  // half of the container that can go wrong quietly — an over-eager container
  // would invent an N+1 that the code does not perform.
  const call = effectCallIn("page_once");
  assert.equal(call.parentId, "module/page_once.fn",
    `the once-evaluated iterable's call must sit in the function, not ${call.parentId}`);
  assert.equal(compsIn("page_once").length, 1, "the container still exists — it just has no effect in it");
});

test("a comprehension reached through a once-evaluated expression parents at the ENCLOSING scope", () => {
  // Traversal reaches both of these only AFTER the enclosing construct's own
  // container has been pushed, so the naive parenting nests them one level
  // too deep — a node in the wrong place, which is worse than no node
  // because it looks handled.
  //
  //   guard_then_fetch:  `if any(... for u in urls):`  — the test runs in
  //     the enclosing flow whichever arm is taken, so the container must not
  //     land inside the then-arm.
  //   loop_over_comp:    `for p in [... for uid in ids]:` — the list is
  //     built ONCE before the first iteration, so the container is a SIBLING
  //     of the for_loop. Nested inside it, N requests would read as N per item.
  for (const fn of ["guard_then_fetch", "loop_over_comp"]) {
    const comp = compsIn(fn)[0];
    assert.equal(comp.parentId, `module/${fn}.fn`,
      `${fn}: container should sit in the function, not at ${comp.parentId}`);
  }
});

// ── the verdict ───────────────────────────────────────────────────────

test("THE CLAIM: the same N+1 gets the same verdict in every spelling", () => {
  // fetch_loop is the control — its round trip was reported before M-COMP
  // and is unchanged by it. The other five perform exactly the same N HTTP
  // requests, written differently.
  const spellings = ["fetch_loop", "fetch_comp", "fetch_dict", "fetch_genexp", "filter_live"];
  for (const fn of spellings) {
    const c = contract(`fanout.py:${fn}`);
    assert.equal(c.roundTrips.length, 1, `${fn}: exactly one round-trip loop`);
    assert.deepEqual(c.roundTrips[0].calls.map((k) => k.effectKind), ["http"],
      `${fn}: one http call, repeated`);
  }
  // ...and each names its own loop, so a reader can find it in the source.
  const labels = Object.fromEntries(spellings.map((fn) =>
    [fn, contract(`fanout.py:${fn}`).roundTrips[0].loopLabel]));
  assert.deepEqual(labels, {
    fetch_loop: "for uid in ids",
    fetch_comp: "listcomp for uid in ids",
    fetch_dict: "dictcomp for uid in ids",
    fetch_genexp: "genexp for uid in ids",
    filter_live: "listcomp for u in urls",
  });
});

test("page_once reports NO round trip — one request is not N", () => {
  const c = contract("fanout.py:page_once");
  assert.equal(c.roundTrips.length, 0, JSON.stringify(c.roundTrips));
  // But the request itself is still a boundary the contract reports. A
  // comprehension that performs one request must not become invisible.
  assert.equal(c.effects.http, 1, JSON.stringify(c.effects));
});

test("loop_over_comp names the COMPREHENSION as the loop, not the for it feeds", () => {
  const c = contract("fanout.py:loop_over_comp");
  assert.equal(c.roundTrips.length, 1, JSON.stringify(c.roundTrips.map((r) => r.loopLabel)));
  assert.equal(c.roundTrips[0].loopLabel, "listcomp for uid in ids");
  assert.ok(c.roundTrips[0].loop.includes("/comp@"),
    `the loop is the comprehension: ${c.roundTrips[0].loop}`);
});

test("main reaches every spelling, and every loop of every spelling", () => {
  // main() calls every helper, so its count is the sum of theirs. It was 7
  // before the clause walk (one loop per comprehension, however many it
  // held), 15 after it (the three N*M helpers at two each, plus the two
  // clause negatives), and 33 with the depth-3 block: six helpers at three
  // loops each. main's own comprehensions build plain strings — a
  // comprehension with nothing effectful in it is a container, not a
  // finding.
  const c = contract("fanout.py:main");
  assert.equal(c.roundTrips.length, 33, JSON.stringify(c.roundTrips.map((r) => r.loopLabel)));
  assert.ok(c.roundTrips.every((r) => r.calls.every((k) => k.effectKind === "http")));
});

test("a comprehension with no effectful call produces a container and NO finding", () => {
  // main's `[API + "/" + uid for uid in ids]` — string work, repeated. The
  // container exists (it is a real loop) and contributes nothing to the
  // round-trip list. Pinned because the opposite failure — a container that
  // manufactures findings — is the one that costs trust.
  const comps = compsIn("main");
  assert.equal(comps.length, 2, "main builds two url lists");
  for (const comp of comps) {
    const inside = ir.nodes.filter((n) => n.parentId === comp.id && n.effectKind);
    assert.deepEqual(inside, [], `${comp.id} holds no effectful call`);
  }
});

// ── nested loops, and the three ways to write one ─────────────────────
//
// A comprehension may carry SEVERAL `for` clauses, and they are nested
// loops: `[f(x) for g in groups for x in g]` runs f exactly as often as the
// spelled-out `for g: for x: f(x)`. Emitting one container for the whole
// comprehension reported that as a single loop, so an N*M fan-out read as
// N — the same spelling-dependent verdict M-COMP existed to end, one level
// down. libcst hands the clauses back as a chain, outermost first, and that
// chain IS the nesting.

test("THE CLAIM, one level down: all three spellings of N*M give the same verdict", () => {
  const nm = ["nm_loop", "nm_two_clauses", "nm_nested_comps"];
  for (const fn of nm) {
    const c = contract(`fanout.py:${fn}`);
    assert.equal(c.roundTrips.length, 2, `${fn}: TWO nested loops, not one`);
    assert.ok(c.roundTrips.every((r) => r.calls.every((k) => k.effectKind === "http")),
      `${fn}: the same http call, under both`);
  }
  // The two COMPREHENSION spellings are not merely both-two — they are
  // indistinguishable, labels included. One comprehension with two clauses
  // and two comprehensions nested one inside the other are the same loop,
  // and now say so identically.
  const labels = (fn) => contract(`fanout.py:${fn}`).roundTrips.map((r) => r.loopLabel);
  assert.deepEqual(labels("nm_two_clauses"), labels("nm_nested_comps"));
  assert.deepEqual(labels("nm_two_clauses"), ["listcomp for uid in g", "listcomp for g in groups"]);
  // ...and the spelled-out control names the same two loops, in the same
  // order, differing only in the noun that says which construct it is.
  assert.deepEqual(labels("nm_loop"), ["for uid in g", "for g in groups"]);
});

test("the clause chain nests in the IR exactly as the spelled-out loops do", () => {
  // Structure, not just counts: the effectful call must sit TWO containers
  // deep in every spelling. A count can be right for the wrong reason; a
  // parent chain cannot.
  const depthOf = (fn) => {
    const call = effectCallIn(fn);
    let depth = 0;
    for (let n = nodeById[call.parentId]; n; n = nodeById[n.parentId]) {
      if (n.type === "comprehension" || n.type === "for_loop") depth += 1;
    }
    return depth;
  };
  assert.equal(depthOf("nm_two_clauses"), 2, "one comprehension, two clauses");
  assert.equal(depthOf("nm_nested_comps"), 2, "two comprehensions");
  // nm_loop's call is an arg-nest under out.append, so count its loop
  // ancestors the same way — the two for_loops are what must be there.
  assert.equal(depthOf("nm_loop"), 2, "the spelled-out control");
});

test("an `if` belongs to ITS clause, so the guard runs once per group", () => {
  // `[uid for g in groups if requests.head(g).ok for uid in g]` — the guard
  // is evaluated per GROUP, not per uid. If `if`s were allowed to drift
  // into the next clause's container the count would read 2, and it would
  // read 2 quietly: a plausible number for a real loop that does not exist.
  const c = contract("fanout.py:clause_guard");
  assert.equal(c.roundTrips.length, 1, JSON.stringify(c.roundTrips.map((r) => r.loopLabel)));
  assert.equal(c.roundTrips[0].loopLabel, "listcomp for g in groups");
});

test("a later clause's ITERABLE runs once per item of the clause before it", () => {
  // `[uid for g in groups for uid in requests.get(g).json()]` — one request
  // per group, inside loop 1 and outside loop 2. Same rule as the outermost
  // iterable, applied one level in.
  const c = contract("fanout.py:clause_iterable");
  assert.equal(c.roundTrips.length, 1, JSON.stringify(c.roundTrips.map((r) => r.loopLabel)));
  assert.equal(c.roundTrips[0].loopLabel, "listcomp for g in groups");
});

test("each clause carries ITS OWN target and iterable, not the comprehension's", () => {
  const comps = compsIn("nm_two_clauses");
  assert.equal(comps.length, 2);
  const outer = comps.find((c) => c.id.endsWith("/comp@0"));
  const inner = comps.find((c) => c.id.includes("/comp@0/comp@0"));
  assert.deepEqual([outer.target, outer.iterName], ["g", "groups"]);
  assert.deepEqual([inner.target, inner.iterName], ["uid", "g"]);
  assert.equal(inner.parentId, outer.id, "outermost clause first, the rest inside it");
});

// ── depth three: the clause walk is unbounded, and this is the proof ──
//
// "Will it work for three?" The walk is a `while` over libcst's clause
// chain, so it works for any depth BY CONSTRUCTION — and by construction is
// precisely the kind of claim that gets pinned rather than trusted. What
// actually needs checking at three is COMPOSITION: a node boundary and a
// clause boundary meeting in one expression, in either order.

const T3 = ["t3_loop", "t3_clauses", "t3_nodes", "t3_mixed_node_outside", "t3_mixed_clauses_outside"];
const loopDepthOf = (fn) => {
  const call = effectCallIn(fn);
  let depth = 0;
  for (let n = nodeById[call.parentId]; n; n = nodeById[n.parentId]) {
    if (n.type === "comprehension" || n.type === "for_loop") depth += 1;
  }
  return depth;
};

test("depth three: every spelling of a triple loop is three loops in the IR", () => {
  for (const fn of T3) assert.equal(loopDepthOf(fn), 3, `${fn}: three containers between the call and its function`);
});

test("depth three: every spelling reports three round trips, in the same inner-to-outer order", () => {
  const labels = (fn) => contract(`fanout.py:${fn}`).roundTrips.map((r) => r.loopLabel);
  for (const fn of T3) assert.equal(labels(fn).length, 3, `${fn}: three loops`);
  // The four comprehension spellings — one node with three clauses, three
  // nodes, and both mixes — are indistinguishable down to the labels.
  const comp = ["listcomp for uid in b", "listcomp for b in a", "listcomp for a in A"];
  for (const fn of T3.slice(1)) assert.deepEqual(labels(fn), comp, fn);
  // The spelled-out control names the same three loops, same order, differing
  // only in the noun that says which construct it is.
  assert.deepEqual(labels("t3_loop"), ["for uid in b", "for b in a", "for a in A"]);
});

test("depth three: the two mixed forms compose a node boundary with a clause boundary correctly", () => {
  // These are the ones with a way to be wrong. In t3_mixed_node_outside the
  // inner comprehension is reached as the OUTER's element; in
  // t3_mixed_clauses_outside it is reached from inside the outer's LAST
  // clause container. Either way the inner node's own clause containers
  // must stack on top of whatever is already there, and the chain must
  // read b -> a -> A from the call outward.
  for (const fn of ["t3_mixed_node_outside", "t3_mixed_clauses_outside"]) {
    const call = effectCallIn(fn);
    const chain = [];
    for (let n = nodeById[call.parentId]; n; n = nodeById[n.parentId]) {
      if (n.type === "comprehension") chain.push(n.iterName);
    }
    assert.deepEqual(chain, ["b", "a", "A"], `${fn}: inner-to-outer iterables`);
  }
});

test("depth three: a guard on the MIDDLE clause sits at depth two while the element sits at three", () => {
  // One comprehension, two effectful calls, two different depths. The guard
  // `if requests.head(b).ok` belongs to the second clause, so it runs once
  // per b — under two loops. The element runs once per uid — under three.
  const calls = ir.nodes.filter((n) => n.type === "call" && n.effectKind
    && n.id.startsWith("module/t3_guard_middle.fn/"));
  const depth = (call) => {
    let d = 0;
    for (let n = nodeById[call.parentId]; n; n = nodeById[n.parentId]) if (n.type === "comprehension") d += 1;
    return d;
  };
  const byName = Object.fromEntries(calls.map((c) => [c.funcName, depth(c)]));
  assert.deepEqual(byName, { "requests.head": 2, "requests.get().json": 3 });
  // And the contract sees three loops, because the element reaches all three.
  assert.equal(contract("fanout.py:t3_guard_middle").roundTrips.length, 3);
});
