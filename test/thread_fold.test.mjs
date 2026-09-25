// Big threads fold by file at the overview tier (src/webview/threads/thread_fold.ts).
//
//   npm run test:thread-fold
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldByFile, FOLD_COL, FOLD_ROW } from "../src/webview/threads/thread_fold.ts";

const nodes = [
  { id: "seed", kind: "seed", file: "a.ts" },
  { id: "a2", kind: "step", file: "a.ts" },
  { id: "b1", kind: "step", file: "b.ts" },
  { id: "c1", kind: "step", file: "c.ts" },
  { id: "c2", kind: "step", file: "c.ts" },
  { id: "ext", kind: "external", file: null },
  { id: "z1", kind: "step", file: "z.ts" },
];
const edges = [
  { from: "seed", to: "a2" }, { from: "a2", to: "b1" }, { from: "a2", to: "c1" },
  { from: "b1", to: "c2" }, { from: "c1", to: "ext" }, { from: "seed", to: "b1", kind: "contains" },
];
const pos = new Map(nodes.map((n, i) => [n.id, { x: i * 300, y: 0 }]));

test("one card per file: steps, boundary calls counted to the calling file, members kept", () => {
  const { cards } = foldByFile(nodes, edges, pos, "a.ts");
  const by = Object.fromEntries(cards.map((c) => [c.file, c]));
  assert.deepEqual(Object.keys(by).sort(), ["a.ts", "b.ts", "c.ts", "z.ts"]);
  assert.equal(by["c.ts"].steps, 2);
  assert.equal(by["c.ts"].boundaries, 1, "the external belongs to the file that calls it");
  assert.deepEqual(by["c.ts"].members.sort(), ["c1", "c2", "ext"]);
  assert.ok(by["a.ts"].seed && !by["b.ts"].seed);
});

test("a compact grid: one column per file depth from the seed file, unreached files last", () => {
  const { cards } = foldByFile(nodes, edges, pos, "a.ts");
  const by = Object.fromEntries(cards.map((c) => [c.file, c]));
  assert.equal(by["a.ts"].depth, 0);
  assert.equal(by["b.ts"].depth, 1);
  assert.equal(by["c.ts"].depth, 1);
  assert.equal(by["z.ts"].depth, 2, "no edge reaches z.ts");
  assert.equal(by["b.ts"].x, FOLD_COL);
  // stacked by size: c.ts (3 members) above b.ts (1)
  assert.equal(by["c.ts"].y, 0);
  assert.equal(by["b.ts"].y, FOLD_ROW);
});

test("cross-file edges merge per file pair; same-file and containment edges do not draw", () => {
  const { edges: fe } = foldByFile(nodes, edges, pos, "a.ts");
  const ids = fe.map((e) => `${e.from}>${e.to}:${e.count}`).sort();
  assert.deepEqual(ids, ["file:a.ts>file:b.ts:1", "file:a.ts>file:c.ts:1", "file:b.ts>file:c.ts:1"]);
});
