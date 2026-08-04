/**
 * B4 (PLAN-v6) — computeThreadAssertions pure-function unit.
 *
 * Pins the behavioural-contract extraction over synthetic threads (the MCP wire
 * test covers the real extractor): ordered execution path (seed+step only),
 * effects joined from the IR with position, terminals grouped by kind, and the
 * human-readable invariant strings.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/thread_assertions.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeThreadAssertions } from "../src/webview/threads/threadAssertions.ts";

const seed = { file: "m.py", irNodeId: "module/seed.fn", qualifiedName: "m:seed" };
const node = (over) => ({ id: "n", kind: "step", label: "n", file: "m.py", irNodeId: "module/seed.fn/x.assign", preview: null, ...over });
const thread = (nodes) => ({ version: "1.0", seed, nodes, edges: [] });
const noEffects = () => null;

test("order is seed + steps only, 1-based, in array order", () => {
  const r = computeThreadAssertions(thread([
    node({ kind: "seed", label: "seed" }),
    node({ kind: "step", label: "helper" }),
    node({ kind: "dynamic", label: "x.run" }),
  ]), noEffects);
  assert.deepEqual(r.order.map((s) => [s.position, s.kind, s.label]), [[1, "seed", "seed"], [2, "step", "helper"]]);
});

test("effects are joined with position; terminal effects marked 'terminal'", () => {
  const effectKindFor = (_f, id) => (id === "module/seed.fn/x.assign" ? "db" : null);
  const r = computeThreadAssertions(thread([
    node({ kind: "seed", label: "seed", irNodeId: "module/seed.fn" }),
    node({ kind: "step", label: "write", irNodeId: "module/seed.fn/x.assign" }),
    node({ kind: "dynamic", label: "conn.exec", irNodeId: "module/seed.fn/x.assign" }),
  ]), effectKindFor);
  assert.deepEqual(r.effects.find((e) => e.position === 2), { position: 2, label: "write", effectKind: "db" });
  assert.ok(r.effects.some((e) => e.position === "terminal" && e.effectKind === "db"));
});

test("terminals are grouped by kind", () => {
  const r = computeThreadAssertions(thread([
    node({ kind: "seed", label: "seed" }),
    node({ kind: "dynamic", label: "a.run" }),
    node({ kind: "unresolved", label: "mystery" }),
    node({ kind: "external", label: "json.dumps" }),
  ]), noEffects);
  assert.deepEqual(r.terminals, { external: ["json.dumps"], dynamic: ["a.run"], unresolved: ["mystery"] });
});

test("invariants render the testable contract", () => {
  const r = computeThreadAssertions(thread([
    node({ kind: "seed", label: "seed" }),
    node({ kind: "dynamic", label: "a.run" }),
  ]), noEffects);
  assert.ok(r.invariants.includes("thread 'm:seed' has 1 ordered step(s)"));
  assert.ok(r.invariants.includes("step 1 is seed 'seed'"));
  assert.ok(r.invariants.some((i) => /1 dynamic terminal\(s\): a\.run/.test(i)));
});
