// Thread hierarchy (2026-09-29): the Threads list nests a thread under the
// thread whose walk reaches its head. Every thread appears exactly once, and
// nothing is hidden by a cycle. The rule is src/webview/threads/threadNesting.ts.
//
//   npm run test:thread-nesting
import { test } from "node:test";
import assert from "node:assert/strict";
import { nestThreads } from "../src/webview/threads/threadNesting.ts";

const shape = (rows) => rows.map((r) => `${"  ".repeat(r.depth)}${r.id}`);

test("a sub-thread sits under its caller, depth-first, in display order", () => {
  const rows = nestThreads(["route", "cli", "insert", "query"], [
    { from: "cli", to: "insert" },
    { from: "route", to: "query" },
  ]);
  assert.deepEqual(shape(rows), ["route", "  query", "cli", "  insert"]);
  assert.equal(rows.find((r) => r.id === "insert").parent, "cli");
  assert.equal(rows.find((r) => r.id === "cli").childCount, 1);
});

test("several callers: placed once, under the first, the others counted", () => {
  const rows = nestThreads(["a", "b", "shared"], [
    { from: "a", to: "shared" },
    { from: "b", to: "shared" },
  ]);
  assert.deepEqual(shape(rows), ["a", "  shared", "b"]);
  const s = rows.find((r) => r.id === "shared");
  assert.deepEqual(s.callers, ["a", "b"]);
  assert.equal(rows.filter((r) => r.id === "shared").length, 1, "once, never duplicated");
});

test("a chain nests under its nearest caller, not the root", () => {
  const rows = nestThreads(["top", "mid", "leaf"], [
    { from: "top", to: "mid" },
    { from: "mid", to: "leaf" },
    { from: "top", to: "leaf" },
  ]);
  // top reaches leaf directly too, so breadth-first places it under top.
  assert.deepEqual(shape(rows), ["top", "  mid", "  leaf"]);
  const leaf = rows.find((r) => r.id === "leaf");
  assert.deepEqual(leaf.callers, ["top", "mid"]);
});

test("a cycle nothing else calls is promoted, never hidden", () => {
  const rows = nestThreads(["x", "y", "lone"], [
    { from: "x", to: "y" },
    { from: "y", to: "x" },
  ]);
  assert.deepEqual(shape(rows), ["x", "  y", "lone"]);
  assert.equal(rows.length, 3);
});

test("self-edges, duplicates and unknown ids are ignored", () => {
  const rows = nestThreads(["a", "b"], [
    { from: "a", to: "a" },
    { from: "a", to: "b" },
    { from: "a", to: "b" },
    { from: "ghost", to: "a" },
  ]);
  assert.deepEqual(shape(rows), ["a", "  b"]);
  assert.deepEqual(rows[1].callers, ["a"]);
});
