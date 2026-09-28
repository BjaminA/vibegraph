// Thread ranks — primary / secondary / tertiary (2026-09-25).
// src/shared/thread_rank.ts, pure: rank every node from injected facts, then
// project a view at a level. The thread below is a a private production codebase route handler
// shrunk to its shapes: a guard, a rate-limit helper with no boundary, local
// data work, logging, React-style state, a constructed model client and its
// round trip, a resolution gap, a runtime dispatch, and one call made twice.
//
//   npm run test:thread-rank
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankThread, projectRanks, remitText, callName } from "../src/shared/thread_rank.ts";

const N = (id, kind, label, extra = {}) => ({ id, kind, label, file: null, irNodeId: null, ...extra });
const thread = {
  nodes: [
    N("seed", "seed", "POST"),
    N("c-guard", "container", "if !apiKey", { containerKind: "if_then" }),
    N("log1", "external", "console.error"),
    N("exit1", "external", "process.exit"),
    N("helper", "step", "rateLimit"),
    N("d1", "external", "Math.max"),
    N("d2", "external", "xs.map"),
    N("st", "external", "useState"),
    N("path", "step", "askModel"),
    N("ctor", "external", "OpenAI"),
    N("call", "dynamic", "openai.chat.completions.create"),
    N("gap", "unresolved", "invokeCredits"),
    N("disp", "dynamic", "\"$TARGET_SCRIPT\""),
    N("j1", "external", "req.json"),
    N("j2", "external", "req.json"),
    N("pj", "external", "os.path.join", { effectKind: "fs" }),
  ],
  edges: [
    { from: "seed", to: "c-guard", kind: "conditional" },
    { from: "c-guard", to: "log1", kind: "contains" },
    { from: "c-guard", to: "exit1", kind: "contains" },
    { from: "seed", to: "log1", kind: "direct" },
    { from: "seed", to: "exit1", kind: "direct" },
    { from: "seed", to: "helper", kind: "direct" },
    { from: "helper", to: "d1", kind: "direct" },
    { from: "helper", to: "d2", kind: "direct" },
    { from: "seed", to: "st", kind: "direct" },
    { from: "seed", to: "path", kind: "direct" },
    { from: "path", to: "ctor", kind: "direct" },
    { from: "path", to: "call", kind: "direct" },
    { from: "seed", to: "gap", kind: "direct" },
    { from: "seed", to: "disp", kind: "direct" },
    { from: "seed", to: "j1", kind: "direct" },
    { from: "seed", to: "j2", kind: "direct" },
    { from: "seed", to: "pj", kind: "direct" },
  ],
};

// Facts as factsFrom would build them: only the model client is attributed.
const openai = { tool: "openai", role: "model-api", origin: "third-party" };
const facts = (n) => ({
  language: n.id === "disp" ? "bash" : n.id === "pj" ? "python" : "jsts",
  attribution: n.id === "ctor" ? { ...openai, how: "binding" }
    : n.id === "call" ? { ...openai, how: "client-instance" } : null,
  effectKind: null,
});
const ranked = rankThread(thread, facts);
const rk = (id) => ranked.rank.get(id);
const cat = (id) => ranked.category.get(id);

test("primary is what leaves the project and the path to it", () => {
  assert.equal(rk("seed"), 1);
  assert.equal(rk("call"), 1, "a constructed client's method is the round trip");
  assert.equal(cat("call"), "boundary");
  assert.equal(rk("path"), 1, "the step on the way to a boundary");
  assert.equal(cat("path"), "path");
  assert.equal(rk("disp"), 1, "a runtime dispatch is where the flow goes next");
  assert.equal(cat("disp"), "dispatch");
});

test("secondary: helpers with no boundary, gaps, set-up, outputs; tertiary: local work", () => {
  assert.equal(rk("helper"), 2);
  assert.equal(cat("helper"), "helper");
  assert.equal(rk("gap"), 2, "a resolution gap is never buried at tertiary");
  assert.equal(rk("ctor"), 2, "building the client is set-up, not the round trip");
  assert.equal(cat("ctor"), "setup");
  for (const id of ["d1", "d2", "st", "log1"]) assert.equal(rk(id), 3, id);
  assert.equal(cat("st"), "ui-state");
  assert.equal(cat("log1"), "log");
  assert.equal(rk("pj"), 3, "os.path.join is string work whatever the parser's prefix table stamps");
});

test("a guard folds into its outcome, labelled by its condition", () => {
  assert.equal(ranked.guards.length, 1);
  const g = ranked.guards[0];
  assert.equal(g.container, "c-guard");
  assert.equal(g.outcome, "exit1");
  assert.equal(g.label, "exits if !apiKey");
  const p = projectRanks(thread, ranked, 2);
  assert.equal(p.visible.has("exit1"), true);
  assert.equal(p.relabel.get("exit1"), "exits if !apiKey");
  assert.equal(p.visible.has("log1"), false);
  assert.equal(p.containers.has("c-guard"), false, "a folded guard draws no box");
});

test("level 1 draws the primary nodes; everything else is the seed's remit, said by category", () => {
  const p = projectRanks(thread, ranked, 1);
  assert.deepEqual([...p.visible].sort(), ["call", "disp", "path", "seed"]);
  const r = p.remit.get("seed");
  assert.ok(r, "the seed owns what it hides");
  assert.equal(r.count, 9, "the guard counts ONCE (its log line is part of it); the constructor is under its step");
  assert.equal(r.parts.find(([c]) => c === "guard")?.[1], 1);
  assert.match(remitText(r), /^9 hidden: /);
  assert.equal(p.remit.get("path")?.count, 1, "the constructor sits under the step that calls it");
});

test("identical calls from one caller fold into one ×N", () => {
  const p = projectRanks(thread, ranked, 2);
  const kept = ["j1", "j2"].filter((id) => p.visible.has(id));
  assert.deepEqual(kept, ["j1"]);
  assert.equal(p.repeat.get("j1"), 2);
});

test("expanding a node shows its remit; level 3 is the raw thread", () => {
  const open = projectRanks(thread, ranked, 1, new Set(["path"]));
  assert.equal(open.visible.has("ctor"), true);
  assert.equal(open.visible.has("d1"), false, "only that node's remit opens");
  const raw = projectRanks(thread, ranked, 3);
  assert.equal(raw.visible.size, thread.nodes.filter((n) => n.kind !== "container").length);
  assert.equal(raw.relabel.size + raw.repeat.size + raw.remit.size, 0, "no folds at everything");
  assert.equal(raw.containers.has("c-guard"), true);
});

test("the projection is lossless: every hidden node is in exactly one remit, a guard, or a repeat", () => {
  for (const level of [1, 2]) {
    const p = projectRanks(thread, ranked, level);
    const hidden = thread.nodes.filter((n) => n.kind !== "container" && !p.visible.has(n.id)).length;
    const inRemit = [...p.remit.values()].reduce((s, r) => s + r.count, 0);
    const inRepeat = [...p.repeat.values()].reduce((s, v) => s + v - 1, 0);
    const inGuard = ranked.guards.reduce((s, g) => s + g.members.length - 1, 0);
    assert.equal(inRemit + inRepeat + inGuard, hidden, `level ${level}`);
  }
});

test("callName strips await/new, arguments and optional chaining", () => {
  assert.equal(callName("await invokeCredits(x)"), "invokeCredits");
  assert.equal(callName("new Date(nowMs).toISOString().slice"), "Date.toISOString.slice");
  assert.equal(callName("xff?.split(\",\")[0]?.trim"), "xff.split.trim");
});

// ── through the real pipeline ──────────────────────────────────────────
// test/fixtures/thread_rank/route_demo parsed, linked, discovered and
// extracted as the server does, attributed through the real stack index —
// so the constructed-client fix and the ranks are pinned together.

test("route_demo: primary is the seed and the model round trip; secondary adds guards, set-up, helper, output", async () => {
  const { buildPolyglotEnvelope } = await import("../scripts/regen_polyglot.mjs");
  const { buildStackIndex } = await import("../src/server/stack.ts");
  const { contractOptsFor } = await import("../src/server/quality/facts.ts");
  const { factsFrom } = await import("../src/shared/thread_rank.ts");
  const root = "test/fixtures/thread_rank/route_demo";
  const env = buildPolyglotEnvelope(root).envelope;
  const stack = buildStackIndex(env, root);
  const opts = contractOptsFor(env, stack);
  const t = env.threads.find((x) => x.seed?.file === "app/api/interpret/route.ts");
  assert.ok(t, "the App Router POST is an entry point");
  const r = rankThread(t, factsFrom({
    ownerFile: (n) => n.file ?? (n.irNodeId ? opts.fileOfNode?.(n.irNodeId) ?? null : null),
    irNode: (f, id) => opts.nodeFor?.(f, id),
    imports: (f) => opts.importsFor?.(f) ?? [],
    locals: (f) => opts.localsFor?.(f) ?? [],
    stack,
  }));
  const label = (id) => t.nodes.find((n) => n.id === id)?.label;
  const p1 = projectRanks(t, r, 1);
  assert.deepEqual([...p1.visible].map(label).sort(), ["POST", "openai.chat.completions.create"]);
  const p2 = projectRanks(t, r, 2);
  const shown = [...p2.visible].map((id) => p2.relabel.get(id) ?? label(id)).sort();
  assert.deepEqual(shown, [
    "OpenAI", "POST", "Response.json", "openai.chat.completions.create", "rateLimit", "req.json",
    "returns if !apiKey", "returns if rateLimit(req.headers.get(\"x-forwarded-for\") ?? \"\")",
  ]);
  assert.equal(p2.remit.get(t.nodes.find((n) => n.label === "rateLimit").id)?.count, 4,
    "the helper owns its local work: Date.now, buckets.get, buckets.set, Math.max");
  const raw = projectRanks(t, r, 3);
  assert.equal(raw.visible.size, t.nodes.filter((n) => n.kind !== "container").length);
});

// ── ranks by code location (the code view, 2026-09-28) ─────────────────
test("route_demo: each call is ranked where it is WRITTEN, and a step's def carries its rank", async () => {
  const { buildPolyglotEnvelope } = await import("../scripts/regen_polyglot.mjs");
  const { buildStackIndex } = await import("../src/server/stack.ts");
  const { contractOptsFor } = await import("../src/server/quality/facts.ts");
  const { factsFrom, rankByLocation } = await import("../src/shared/thread_rank.ts");
  const root = "test/fixtures/thread_rank/route_demo";
  const env = buildPolyglotEnvelope(root).envelope;
  const stack = buildStackIndex(env, root);
  const opts = contractOptsFor(env, stack);
  const facts = factsFrom({
    ownerFile: (n) => n.file ?? (n.irNodeId ? opts.fileOfNode?.(n.irNodeId) ?? null : null),
    irNode: (f, id) => opts.nodeFor?.(f, id),
    imports: (f) => opts.importsFor?.(f) ?? [],
    locals: (f) => opts.localsFor?.(f) ?? [],
    stack,
  });
  const loc = rankByLocation(env.threads, () => facts);
  const ir = env.files["app/api/interpret/route.ts"];
  const lineOf = (id) => ir.nodes.find((n) => n.id === id)?.line;
  const at = (file, pred) => [...loc].filter(([k]) => k.startsWith(`${file}|`))
    .map(([k, v]) => ({ id: k.slice(file.length + 1), ...v })).filter(pred);

  const route = "app/api/interpret/route.ts";
  const create = at(route, (x) => x.category === "boundary");
  assert.equal(create.length, 1, "one boundary call site in the route");
  assert.equal(create[0].rank, 1);
  assert.equal(lineOf(create[0].id), 17, "openai.chat.completions.create is written on line 17");
  const helperCall = at(route, (x) => x.category === "helper");
  assert.equal(helperCall.length, 1, "the rateLimit CALL SITE in the route carries the helper's rank");
  assert.equal(lineOf(helperCall[0].id), 10);
  assert.ok(at(route, (x) => x.category === "log").every((x) => x.rank === 3));
  // the helper's own file: its definition is secondary, its body tertiary
  const lib = "lib/ratelimit.ts";
  assert.ok(at(lib, (x) => x.category === "helper" && x.rank === 2).length === 1, "the def carries the step's rank");
  assert.ok(at(lib, (x) => x.rank === 3).length >= 3, "Date.now / buckets.get / buckets.set are local work");
  assert.ok([...loc.values()].every((v) => v.threads === 1), "one entry point, one thread");
});
