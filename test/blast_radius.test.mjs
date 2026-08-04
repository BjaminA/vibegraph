/**
 * A2 (PLAN-v6) — computeBlastRadius pure-function unit.
 *
 * Pins the reverse/caller index over synthetic IR (the MCP wire test covers the
 * real linker on flask_demo): same-file vs cross-file caller resolution, the
 * enclosing-function walk, threads-that-traverse-N, and the HONEST hidden-caller
 * flag (name-matched dynamic/unresolved terminals are surfaced as unverified
 * suspects, never folded into the proven dependents).
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/blast_radius.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBlastRadius } from "../src/server/blast_radius.ts";

// Two files. a.py: foo() calls bar() (same file) and qux() in b.py (cross-file).
const files = {
  "a.py": {
    nodes: [
      { id: "module/foo.fn", type: "function_def", name: "foo" },
      { id: "module/foo.fn/x.assign", type: "assignment", name: "x", parentId: "module/foo.fn" },
      { id: "module/foo.fn/y.assign", type: "assignment", name: "y", parentId: "module/foo.fn" },
      { id: "module/bar.fn", type: "function_def", name: "bar" },
    ],
    refEdges: [
      { source: "module/foo.fn/x.assign", target: "module/bar.fn" },                                   // same-file
      { source: "module/foo.fn/y.assign", target: "module/qux.fn", targetFile: "b.py", qualifiedTarget: "b:qux" }, // cross-file
    ],
  },
  "b.py": {
    nodes: [{ id: "module/qux.fn", type: "function_def", name: "qux" }],
    refEdges: [],
  },
};

const threads = [
  {
    entryPointId: "a.py:foo", qualifiedName: "a:foo",
    nodes: [
      { irNodeId: "module/foo.fn", file: "a.py", kind: "seed", label: "foo" },
      { irNodeId: "module/bar.fn", file: "a.py", kind: "step", label: "bar" },
      // a dynamic terminal whose name matches qux — a possible hidden caller of qux.
      { irNodeId: "module/foo.fn/z.assign", file: "a.py", kind: "dynamic", label: "h.qux" },
    ],
  },
];

test("same-file caller resolves, with its enclosing function", () => {
  const r = computeBlastRadius("a.py", "module/bar.fn", files, threads);
  assert.equal(r.totals.dependents, 1);
  assert.equal(r.dependents[0].callerNodeId, "module/foo.fn/x.assign");
  assert.equal(r.dependents[0].file, "a.py");
  assert.equal(r.dependents[0].enclosingFn, "foo", "the unit that breaks if bar changes");
  assert.equal(r.dependents[0].enclosingFnId, "module/foo.fn");
});

test("cross-file caller resolves via targetFile, carries qualifiedTarget", () => {
  const r = computeBlastRadius("b.py", "module/qux.fn", files, threads);
  assert.equal(r.totals.dependents, 1);
  assert.equal(r.dependents[0].file, "a.py");
  assert.equal(r.dependents[0].enclosingFn, "foo");
  assert.equal(r.dependents[0].qualifiedTarget, "b:qux");
});

test("threads that traverse N are reported (file-qualified)", () => {
  const r = computeBlastRadius("a.py", "module/bar.fn", files, threads);
  assert.deepEqual(r.threads, [{ entryPointId: "a.py:foo", qualifiedName: "a:foo" }]);
});

test("HONEST blind spot: a name-matched dynamic terminal is an UNVERIFIED suspect, not a dependent", () => {
  const r = computeBlastRadius("b.py", "module/qux.fn", files, threads);
  // qux has 1 proven dependent (foo) and 1 possible hidden caller (h.qux, dynamic).
  assert.equal(r.totals.dependents, 1, "the dynamic hop is NOT counted as a proven caller");
  assert.equal(r.totals.possibleHiddenCallers, 1);
  assert.equal(r.possibleHiddenCallers[0].label, "h.qux");
  assert.equal(r.possibleHiddenCallers[0].kind, "dynamic");
  assert.equal(r.possibleHiddenCallers[0].inThread, "a:foo");
});

test("a node with no callers reports an honest empty radius", () => {
  const r = computeBlastRadius("a.py", "module/foo.fn", files, threads);
  assert.equal(r.totals.dependents, 0);
  assert.equal(r.target.name, "foo");
});
