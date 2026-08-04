/**
 * A1 (PLAN-v6) — computeThreadBlindSpots pure-function unit.
 *
 * Locks the honesty semantics deterministically over synthetic threads (the
 * MCP wire test covers the real extractor on flask_demo). The load-bearing
 * rules pinned here:
 *   - the dynamic (runtimeDispatch) vs unresolved (resolutionGaps) split is
 *     preserved — never flattened;
 *   - uncaptured = nestsInnerCalls && !nestExtracted (extracted nests do NOT
 *     count);
 *   - effects is a SEPARATE axis (joined parse-time effectKind), and does NOT
 *     count against staticallyComplete;
 *   - staticallyComplete = no resolutionGaps AND no uncaptured. A dynamic-only
 *     thread is staticallyComplete (dynamic is correct, not a gap).
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/blind_spots.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeThreadBlindSpots, formatBlindSpotsBlock } from "../src/webview/threads/blindSpots.ts";

const seed = { file: "m.py", irNodeId: "module/seed.fn", qualifiedName: "m:seed" };
const node = (over) => ({ id: "n", kind: "step", label: "n", file: "m.py", irNodeId: "module/seed.fn/x.assign", preview: null, ...over });
const thread = (nodes) => ({ version: "1.0", seed, nodes, edges: [] });
const noEffects = () => null;

test("clean thread: no blind spots, staticallyComplete", () => {
  const r = computeThreadBlindSpots(thread([node({ id: "a" }), node({ id: "b" })]), noEffects);
  assert.equal(r.totals.resolutionGaps, 0);
  assert.equal(r.totals.runtimeDispatch, 0);
  assert.equal(r.totals.uncaptured, 0);
  assert.equal(r.staticallyComplete, true);
});

test("dynamic vs unresolved are kept in SEPARATE buckets", () => {
  const r = computeThreadBlindSpots(thread([
    node({ id: "d", kind: "dynamic", receiverBoundKind: "param", receiverBoundFrom: "store" }),
    node({ id: "u", kind: "unresolved", label: "mystery" }),
  ]), noEffects);
  assert.equal(r.totals.runtimeDispatch, 1);
  assert.equal(r.totals.resolutionGaps, 1);
  assert.equal(r.runtimeDispatch[0].receiverBoundKind, "param", "binding form travels with the dynamic entry");
  assert.equal(r.runtimeDispatch[0].receiverBoundFrom, "store");
  assert.equal(r.resolutionGaps[0].label, "mystery");
  assert.equal(r.staticallyComplete, false, "an unresolved gap makes it incomplete");
});

test("dynamic-only thread is staticallyComplete (dynamic is correct, not a gap)", () => {
  const r = computeThreadBlindSpots(thread([node({ kind: "dynamic" })]), noEffects);
  assert.equal(r.totals.runtimeDispatch, 1);
  assert.equal(r.staticallyComplete, true);
});

test("uncaptured = nestsInnerCalls && !nestExtracted; extracted nests do NOT count", () => {
  const r = computeThreadBlindSpots(thread([
    node({ id: "hidden", nestsInnerCalls: true, nestExtracted: false }),
    node({ id: "drillable", nestsInnerCalls: true, nestExtracted: true }),
    node({ id: "plain" }),
  ]), noEffects);
  assert.equal(r.totals.uncaptured, 1, "only the detected-but-undecomposed node");
  assert.equal(r.uncaptured[0].id, "hidden");
  assert.equal(r.staticallyComplete, false, "an uncaptured nest makes it incomplete");
});

test("effects is a separate axis joined from per-file IR; not a blind spot", () => {
  const effectKindFor = (_f, id) => (id === "module/seed.fn/x.assign" ? "db" : null);
  const r = computeThreadBlindSpots(thread([node({ id: "e" })]), effectKindFor);
  assert.equal(r.totals.effects, 1);
  assert.equal(r.effects[0].effectKind, "db");
  // A pure-but-effectful thread is still staticallyComplete — effects don't gate it.
  assert.equal(r.staticallyComplete, true);
});

test("a node can be both dynamic and effectful (honestly appears in both)", () => {
  const effectKindFor = (_f, id) => (id === "module/seed.fn/x.assign" ? "db" : null);
  const r = computeThreadBlindSpots(thread([node({ kind: "dynamic" })]), effectKindFor);
  assert.equal(r.totals.runtimeDispatch, 1);
  assert.equal(r.totals.effects, 1);
});

// C1 — the deterministic honesty block appended to a thread-skill.
test("formatBlindSpotsBlock: a complete thread says so", () => {
  const r = computeThreadBlindSpots(thread([node({ id: "a" })]), noEffects);
  const block = formatBlindSpotsBlock(r);
  assert.match(block, /Not statically known \(IR fact/);
  assert.match(block, /statically complete/);
});

test("formatBlindSpotsBlock: gaps + dynamic + effects each render with their node id", () => {
  const effectKindFor = (_f, id) => (id === "module/seed.fn/x.assign" ? "db" : null);
  const r = computeThreadBlindSpots(thread([
    node({ id: "u", kind: "unresolved", label: "mystery" }),
    node({ id: "d", kind: "dynamic", label: "conn.execute", receiverBoundFrom: "_get_conn" }),
  ]), effectKindFor);
  const block = formatBlindSpotsBlock(r);
  assert.match(block, /Resolution gaps/);
  assert.match(block, /mystery/);
  assert.match(block, /Runtime dispatch/);
  assert.match(block, /receiver from _get_conn/);
  assert.match(block, /Side effects on the path/);
  assert.match(block, /\[db\]/);
  assert.ok(!/statically complete/.test(block), "must not claim completeness when blind spots exist");
});
