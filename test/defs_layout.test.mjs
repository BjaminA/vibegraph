// The file view's definitions region, left to right (2026-09-24,
// src/webview/layout/defs_layout.ts). Ben: "use more horizontal space in the
// file view … minimise space via the flow line edge distance".
//
//   npm run test:defs-layout
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutDefinitions } from "../src/webview/layout/defs_layout.ts";

const def = (id, line, h = 120, w = 260) => ({ node: { id, line, type: "function_def" }, w, h });
const run = (list, calls, besideHeight) => {
  const size = new Map(list.map((d) => [d.node.id, d]));
  return layoutDefinitions({
    defs: list.map((d) => d.node), calls,
    width: (id) => size.get(id).w, height: (id) => size.get(id).h,
    ...(besideHeight ? { besideHeight } : {}),
  });
};
const overlaps = (pos, list) => {
  const size = new Map(list.map((d) => [d.node.id, d]));
  const r = [...pos].map(([id, p]) => ({ id, x0: p.x, y0: p.y, x1: p.x + size.get(id).w, y1: p.y + size.get(id).h }));
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
    const a = r[i], b = r[j];
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) return `${a.id} × ${b.id}`;
  }
  return null;
};

test("a call flows left to right: the callee sits right of its caller, level with it", () => {
  const list = [def("helper", 1), def("main", 10), def("other", 20)];
  const pos = run(list, [["main", "helper"], ["main", "other"]]);
  assert.ok(pos.get("helper").x > pos.get("main").x + 260, "callee right of caller");
  assert.equal(pos.get("helper").y, pos.get("main").y, "the first callee is level with its caller");
  assert.equal(pos.get("other").x, pos.get("helper").x, "callees share one column");
  assert.ok(pos.get("other").y > pos.get("helper").y, "and stack in it");
  assert.equal(overlaps(pos, list), null);
});

test("a layer taller than the region wraps into sub-columns beside itself", () => {
  const list = [def("main", 0, 120), ...Array.from({ length: 12 }, (_, i) => def(`f${i}`, i + 1, 400))];
  const pos = run(list, list.slice(1).map((d) => ["main", d.node.id]));
  const xs = new Set(list.slice(1).map((d) => pos.get(d.node.id).x));
  assert.ok(xs.size >= 2, `the 12 callees should wrap into sub-columns, got ${xs.size} column`);
  for (const d of list.slice(1)) assert.ok(pos.get(d.node.id).x > pos.get("main").x, "every callee right of the caller");
  assert.equal(overlaps(pos, list), null);
});

test("unrelated definitions pack into a laptop-shaped region, not one column", () => {
  const list = Array.from({ length: 16 }, (_, i) => def(`d${i}`, i, 200));
  const pos = run(list, []);
  let w = 0, h = 0;
  for (const [id, p] of pos) { w = Math.max(w, p.x + 260); h = Math.max(h, p.y + 200); }
  assert.ok(w / h > 0.8, `aspect ${(w / h).toFixed(2)} — sixteen helpers should spread sideways`);
  // Source order still reads first: the first definition is top-left.
  assert.deepEqual(pos.get("d0"), { x: 0, y: 0 });
  assert.equal(overlaps(pos, list), null);
});

test("the height the columns beside already spend is filled before spreading sideways", () => {
  const list = Array.from({ length: 4 }, (_, i) => def(`d${i}`, i, 100));
  const flat = run(list, []);
  const beside = run(list, [], 2000);
  const width = (pos) => Math.max(...[...pos.values()].map((p) => p.x)) + 260;
  assert.ok(width(beside) <= width(flat), "a tall imports column lets the definitions stack instead of widening");
});
