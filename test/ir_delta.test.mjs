/**
 * B3 (PLAN-v6) — diffIR pure-function unit.
 *
 * Pins the structural-delta semantics: nodes added/removed by structural id,
 * CLASSIFICATION changes (type/name/effectKind/parentId) on surviving ids,
 * edge add/remove by identity, line-number noise IGNORED, and noStructuralChange
 * for a formatting-only edit.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/ir_delta.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffIR } from "../src/server/ir_delta.ts";

const n = (id, over = {}) => ({ id, type: "assignment", name: id.split("/").pop(), ...over });

test("added and removed nodes are detected by structural id", () => {
  const before = { nodes: [n("module/a.fn"), n("module/b.fn")] };
  const after = { nodes: [n("module/a.fn"), n("module/c.fn")] };
  const d = diffIR(before, after);
  assert.deepEqual(d.nodesAdded.map((x) => x.id), ["module/c.fn"]);
  assert.deepEqual(d.nodesRemoved.map((x) => x.id), ["module/b.fn"]);
  assert.equal(d.noStructuralChange, false);
});

test("a classification change (effectKind flip) is reported on a surviving id", () => {
  const before = { nodes: [n("module/q.fn/x.assign", { effectKind: null })] };
  const after = { nodes: [n("module/q.fn/x.assign", { effectKind: "db" })] };
  const d = diffIR(before, after);
  assert.equal(d.summary.nodesChanged, 1);
  assert.deepEqual(d.nodesChanged[0].changes.effectKind, [null, "db"]);
});

test("line-number movement alone is NOT a structural change", () => {
  const before = { nodes: [{ id: "module/a.fn", type: "function_def", name: "a", line: 1 }] };
  const after = { nodes: [{ id: "module/a.fn", type: "function_def", name: "a", line: 99 }] };
  const d = diffIR(before, after);
  assert.equal(d.noStructuralChange, true, "line moves must not register as structural");
});

test("edges are diffed by identity (source/target/type/targetFile)", () => {
  const before = { nodes: [], edges: [{ source: "a", target: "b", type: "reference" }] };
  const after = {
    nodes: [],
    edges: [
      { source: "a", target: "b", type: "reference" },
      { source: "a", target: "c", type: "reference", targetFile: "m.py" },
    ],
  };
  const d = diffIR(before, after);
  assert.equal(d.summary.edgesAdded, 1);
  assert.equal(d.edgesAdded[0].target, "c");
  assert.equal(d.summary.edgesRemoved, 0);
});

test("identical IR → noStructuralChange", () => {
  const ir = { nodes: [n("module/a.fn")], edges: [{ source: "a", target: "b", type: "data" }] };
  const d = diffIR(structuredClone(ir), structuredClone(ir));
  assert.equal(d.noStructuralChange, true);
  assert.deepEqual(d.summary, { nodesAdded: 0, nodesRemoved: 0, nodesChanged: 0, edgesAdded: 0, edgesRemoved: 0 });
});
