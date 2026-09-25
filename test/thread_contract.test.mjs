/**
 * M-CONTRACT.2 — the thread contract, pinned over the POLYGLOT snapshot:
 * what enters / leaves a thread, every effectful external with its literal
 * call text, round trips inside loops (through steps), cross-thread
 * adjacency, and where static knowledge ends. IR fact only; the honesty
 * split (fact vs stated constraint) is the block's first line.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/thread_contract.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeThreadContract, formatContractBlock, summarizeContract, ROUND_TRIP_EFFECTS } from "../src/server/thread_contract.ts";
import { buildStackIndex, contractStackForFile } from "../src/server/stack.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const env = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "polyglot", "shop_demo", "shop_demo.project.json"), "utf-8"));

// The server's findNode join: file given → that file; null → every file.
const nodeFor = (file, irNodeId) => {
  if (!irNodeId) return null;
  const search = file ? [env.files[file]].filter(Boolean) : Object.values(env.files);
  for (const ir of search) {
    const n = ir.nodes.find((x) => x.id === irNodeId);
    if (n) return n;
  }
  return null;
};
const threadOf = (ep) => env.threads.find((t) => t.entryPointId === ep);
// M-BOUNDARY.1  the boundary→tool join needs the owning file of a
// terminal (they carry `file: null`), that file's import bindings, and the
// index (funnel homes + bash call sites)  the same three the server
// injects in threadContractFor.
const SHOP = join(ROOT, "test", "fixtures", "polyglot", "shop_demo");
const stack = buildStackIndex(env, SHOP);
const fileOfNode = (irNodeId) =>
  Object.entries(env.files).find(([, ir]) => ir.nodes.some((n) => n.id === irNodeId))?.[0] ?? null;
// NOTE the four injections are independent: `stackFor` fills `stack`
// (presence), the other three fill `tool` per boundary (use). The default
// helper deliberately leaves `stackFor` out, because a test below pins
// that `stack` stays empty when no index is wired.
const boundaryOpts = {
  fileOfNode,
  importsFor: (f) => stack.importsByFile?.[f] ?? [],
  stackIndex: stack,
};
const contract = (ep, adj = { reaches: [], reachedBy: [] }) =>
  computeThreadContract(threadOf(ep), { nodeFor, ...boundaryOpts, ...adj });
/** Everything the server injects, for the called-vs-present assertions. */
const contractFull = (ep) => computeThreadContract(threadOf(ep), {
  nodeFor, reaches: [], reachedBy: [], ...boundaryOpts,
  stackFor: (f) => contractStackForFile(stack, f),
});

test("python route: params/returns/doc from the seed IR; effects joined from the per-file IR", () => {
  const c = contract("api/app.py:create_order", { reaches: ["api/db.py:insert_order"], reachedBy: [] });
  assert.equal(c.language, "python");
  assert.deepEqual(c.interface.params, []);
  assert.equal(c.interface.returns, null);
  assert.match(c.interface.docstring, /notify the gateway PER LINE ITEM/);
  assert.deepEqual(c.interface.returnPreviews, ['jsonify({"id": order_id, "total": priced["total"]}), 201']);
  // Python effects do NOT ride thread nodes — the join must find them.
  assert.equal(c.effects.http, 1);
  assert.equal(c.effects.subprocess, 1);
  assert.ok(c.effects.db >= 2, `db calls joined: ${JSON.stringify(c.effects)}`);
  const post = c.externals.find((e) => e.id === "external:requests.post");
  assert.equal(post.effectKind, "http");
  assert.match(post.preview, /requests\.post\(GATEWAY_URL/);
  assert.deepEqual(c.crossThread, { reaches: ["api/db.py:insert_order"], reachedBy: [] });
  assert.deepEqual(c.filesReached.sort(), ["api/app.py", "api/db.py", "api/orders.py"]);
});

test("round trips: a loop's reachable http/db work is named per loop — directly AND through a step", () => {
  const c = contract("api/app.py:create_order");
  const own = c.roundTrips.find((r) => r.loop === "api/app:create_order.fn/for@0");
  assert.ok(own, `own loop missing: ${JSON.stringify(c.roundTrips.map((r) => r.loop))}`);
  assert.deepEqual(own.calls.map((k) => [k.label, k.effectKind, k.via]), [["requests.post", "http", null]]);
  const inner = c.roundTrips.find((r) => r.loop === "api/db:insert_order.fn/for@0");
  assert.ok(inner, "the callee's loop is part of this thread too");
  assert.equal(inner.calls[0].effectKind, "db");

  // TS: the fetch is INSIDE a step called from the loop — `via` names it.
  const ts = contract("gateway/server.ts:getOrders");
  assert.equal(ts.roundTrips.length, 1);
  assert.deepEqual(ts.roundTrips[0].calls.map((k) => [k.label, k.effectKind, k.via]), [["fetch", "http", "fetchOrderDetail"]]);
  assert.deepEqual(ts.interface.params, ["req", "res"]);

  // bash: curl per host, directly in health_check's loop.
  const sh = contract("ops/deploy.sh:main");
  assert.equal(sh.roundTrips.length, 1);
  assert.equal(sh.roundTrips[0].loop, "ops/deploy.sh:health_check.fn/for@0");
  assert.deepEqual(sh.roundTrips[0].calls.map((k) => [k.label, k.effectKind]), [["curl", "http"]]);
  for (const k of [...ts.roundTrips, ...sh.roundTrips].flatMap((r) => r.calls)) assert.ok(ROUND_TRIP_EFFECTS.has(k.effectKind));
});

test("every language carries its param types — python via the additive paramTypes map; unannotated params are NAMED, never silent", () => {
  const ts = contract("gateway/server.ts:createOrder");
  assert.equal(ts.language, "jsts");
  const cpp = contract("worker/main.cpp:main");
  assert.deepEqual(cpp.interface.params, ["int argc", "char** argv"]);
  assert.equal(cpp.interface.returns, "int");
  assert.equal(cpp.boundaries.resolutionGaps, 1, "the overloaded discount");
  // Python: `params` stays ["limit"] in the IR; paramTypes {"limit": "int"} renders "limit: int".
  const py = contract("api/db.py:list_orders");
  assert.deepEqual(py.interface.params, ["limit: int"]);
  assert.equal(py.interface.returns, "list");
  assert.ok(!py.notes.some((n) => /Unannotated/.test(n)), "fully annotated → no note");
  assert.deepEqual(env.files["api/db.py"].nodes.find((n) => n.id === "module/list_orders.fn").params, ["limit"], "the IR's params list is untouched");
  const noParams = contract("api/app.py:get_orders");
  assert.ok(!noParams.notes.some((n) => /Unannotated/.test(n)), "no params → no note");
  // Partially annotated: the untyped ones are named; defaults keep their place.
  const fake = {
    version: "1.0", entryPointId: "m.py:f", filesReached: ["m.py"],
    seed: { file: "m.py", irNodeId: "module/f.fn", qualifiedName: "m:f" },
    nodes: [{ id: "m:f", kind: "seed", label: "f", file: "m.py", irNodeId: "module/f.fn", preview: null }], edges: [],
  };
  const partial = computeThreadContract(fake, {
    nodeFor: () => ({ type: "function_def", params: ["self", "x", "y=1", "z"], paramTypes: { x: "int", y: "float" }, returns: null }),
    reaches: [], reachedBy: [],
  });
  assert.deepEqual(partial.interface.params, ["self", "x: int", "y: float=1", "z"]);
  assert.ok(partial.notes.some((n) => /Unannotated Python params .*: z\./.test(n)), partial.notes.join(" | "));
  assert.match(formatContractBlock(partial), /Enters: self, x: int, y: float=1, z/);
});

test("the rendered block is labelled IR fact, lists effects with literal call text, and names the round trips", () => {
  const c = contract("api/app.py:create_order", { reaches: ["api/db.py:insert_order"], reachedBy: ["ops/deploy.sh:main"] });
  const block = formatContractBlock(c);
  assert.match(block, /^## Thread contract \(IR fact/);
  assert.match(block, /Seed: api\/app:create_order \(Python, api\/app\.py\)/);
  assert.match(block, /Enters: \(no parameters\)/);
  assert.match(block, /Leaves: no declared return type; returns `jsonify/);
  assert.match(block, /- \[http\] requests\.post: requests\.post\(GATEWAY_URL/);
  assert.match(block, /- \[subprocess\] subprocess\.run/);
  assert.match(block, /Round trips inside loops[\s\S]*`api\/app:create_order\.fn\/for@0`/);
  assert.match(block, /Cross-thread: reaches api\/db\.py:insert_order; reached by ops\/deploy\.sh:main/);
  assert.match(block, /Where static knowledge ends: 0 resolution gap\(s\)/);
  const pure = formatContractBlock(contract("api/orders.py:validate_order"));
  assert.match(pure, /Touches: no effectful external calls/);
  assert.match(pure, /Round trips inside loops: none found\./);
});

test("summarizeContract is the compact packet annotation", () => {
  const s = summarizeContract(contract("gateway/server.ts:getOrders"));
  // M-STACK.1 — `stack` is additive and EMPTY without an injected index:
  // the contract stays pure over the IR, so a caller that never wired the
  // stack index gets the pre-M-STACK annotation plus an empty list.
  // M-BOUNDARY.1: `called` is filled by the boundary join, a different
  // injection from `stackFor`, so the two legitimately differ here.
  // Quality layer (RUN1 4.2): `unattributed` rides the summary for the
  // no-new-unattributed-boundary pre-check; a count, not asserted here.
  const { unattributed, ...rest } = s;
  assert.equal(typeof unattributed, "number");
  assert.deepEqual(rest, {
    params: 2, returns: null, effects: { http: 2 }, roundTrips: 1,
    stack: [], called: ["gateway.client", "fetch"],
    // M-XLANG.1: no crossing index injected here, so nothing is claimed.
    crossesInto: [],
  });
});

// ── M-BOUNDARY.1 ─────────────────────────────────────────────────────

test("M-BOUNDARY: every boundary is attributed to a tool, said to be unattributed, or a builtin", () => {
  const c = contract("api/app.py:create_order");
  // Exhaustive by construction: nothing may fall out of all three buckets.
  const attributed = c.externals.filter((e) => e.tool && e.tool.how !== "builtin");
  const builtins = c.externals.filter((e) => e.tool?.how === "builtin");
  const none = c.externals.filter((e) => !e.tool);
  assert.equal(attributed.length + builtins.length + none.length, c.externals.length);
  assert.equal(c.boundaries.unattributed, none.length);
  assert.equal(c.boundaries.builtins, builtins.length);

  // requests.post is an import binding in app.py → the http-client tool.
  const post = c.externals.find((e) => e.id === "external:requests.post");
  assert.equal(post.tool.tool, "requests");
  assert.equal(post.tool.role, "http-client");
  assert.equal(post.tool.how, "binding");

  // The block names the tool per boundary and never hides one.
  const block = formatContractBlock(c);
  assert.match(block, /Leaves the project through \(boundaries by tool/);
  assert.match(block, /requests \[http-client\]/);
  assert.ok(!/\n\s*\n\s*\n/.test(block), "no empty section left behind");
});

test("M-BOUNDARY: `called` is what the thread reaches, `stack` is what its files hold", () => {
  const c = contractFull("api/app.py:create_order");
  assert.ok(c.called.includes("requests"), `called: ${c.called.join(",")}`);
  for (const t of c.called) {
    assert.ok(c.stack.some((s) => s.tool === t), `${t} is called but not present — called must be a subset`);
  }
  assert.ok(c.called.length <= c.stack.length);
  assert.deepEqual(summarizeContract(c).called, c.called);
});

test("M-BOUNDARY: with no injection, only what the IR ITSELF resolved is attributed", () => {
  // Worth pinning because it says exactly what each injection buys. A
  // `qualifiedTarget` rides the thread node, so the linker's own work
  // survives with nothing wired; a binding needs the owning file's
  // imports, and a funnel needs the index.
  const bare = computeThreadContract(threadOf("api/app.py:create_order"), { nodeFor, reaches: [], reachedBy: [] });
  // `flask` joined this list at M-SWEEP W1 (2026-09-10). app.py's route ends
  //     return jsonify({"id": order_id, ...}), 201
  // and a return whose value is a TUPLE never reached visit_Return's
  // direct-Call branch — so the route's own response call was not in the IR
  // at all. It is a linker-resolved import binding like sqlite3, so it
  // belongs here: this test pins what the IR resolves with NO injection,
  // and the IR resolves both.
  assert.deepEqual(bare.called, ["flask", "sqlite3"], "the receivers the linker resolved still attribute");
  assert.equal(bare.externals.find((e) => e.id === "external:requests.post").tool, undefined,
    "requests.post needs app.py's import bindings - unattributed, never guessed");
  assert.ok(bare.boundaries.unattributed > 0);
});

// ── PLAN-M-RUNTIME phase 3 — the trace overlay in the contract ────────

test("phase 3: an observation rides the contract in its OWN section, never folded into the facts", () => {
  const ep = "api/app.py:create_order";
  const plain = contract(ep);
  const target = plain.externals.find((e) => e.kind === "dynamic" || e.kind === "unresolved")
    ?? plain.externals[0];
  assert.ok(target, "the fixture must have a terminal to annotate");

  const c = computeThreadContract(threadOf(ep), {
    nodeFor, ...boundaryOpts, reaches: [], reachedBy: [],
    observedFor: (_file, irNodeId) => (irNodeId && irNodeId === target.irNodeId
      ? [{
        callees: [{ callee: "shop.db.Connection.execute", count: 3 }],
        entryPointId: "api/app.py:create_order",
        at: "2026-09-10T09:00:00.000Z",
        inputs: "no arguments — the entry point runs on its own",
        stale: false,
      }]
      : []),
  });

  const annotated = c.externals.find((e) => e.irNodeId === target.irNodeId);
  assert.ok(annotated?.observed?.length, "the observation is attached to the terminal it belongs to");
  // The static facts are UNTOUCHED: an observation is not a resolution.
  assert.equal(annotated.kind, target.kind, "the node's kind never changes");
  assert.deepEqual(annotated.tool, target.tool, "attribution is what the SOURCE says, unchanged");
  assert.equal(annotated.effectKind, target.effectKind);

  const block = formatContractBlock(c);
  assert.match(block, /Observed at runtime \(NOT static fact/);
  assert.match(block, /shop\.db\.Connection\.execute ×3/);
  assert.match(block, /run 2026-09-10 via api\/app\.py:create_order/);
  assert.match(block, /no arguments/);
  // The caveats a reader needs to discount it are IN the section, not
  // somewhere else in the document.
  assert.match(block, /a branch that did not execute is absent/);
  assert.match(block, /still `dynamic`\/`unresolved` in the IR/);
});

test("phase 3: a STALE observation is shown WITH its caveat, never silently dropped", () => {
  const ep = "api/app.py:create_order";
  const c = computeThreadContract(threadOf(ep), {
    nodeFor, ...boundaryOpts, reaches: [], reachedBy: [],
    observedFor: () => [{
      callees: [{ callee: "shop.db.Connection.execute", count: 1 }],
      entryPointId: "api/app.py:create_order",
      at: "2026-09-10T09:00:00.000Z",
      inputs: "no arguments — the entry point runs on its own",
      stale: true,
    }],
  });
  const block = formatContractBlock(c);
  // Still evidence about the code as it was — a different thing from no
  // evidence at all — so it is shown, and the caveat travels with it.
  assert.match(block, /shop\.db\.Connection\.execute/);
  assert.match(block, /STALE — the file has changed since this run/);
});

test("phase 3: with no overlay the contract is byte-identical to before it existed", () => {
  const ep = "api/app.py:create_order";
  const withNone = computeThreadContract(threadOf(ep), {
    nodeFor, ...boundaryOpts, reaches: [], reachedBy: [], observedFor: () => [],
  });
  const withoutOpt = contract(ep);
  assert.equal(formatContractBlock(withNone), formatContractBlock(withoutOpt));
  assert.ok(!/Observed at runtime/.test(formatContractBlock(withoutOpt)),
    "an untraced project must read exactly as it did before phase 3");
});
