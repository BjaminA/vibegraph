// M-RUN SM1 — the client-side run-plan / pre-gate contract.
//
// Run: npm run test:run-plan

import { test } from "node:test";
import assert from "node:assert/strict";
import { planRunToNode } from "../src/webview/threads/runToNode.ts";

const FN = "module/compute.fn";
// Build a per-file IR for `def compute(<params>): ...<body nodes>` quickly.
function ir(params, body) {
  const nodes = [
    { id: FN, type: "function_def", parentId: "module", name: "compute", params, line: 1, endLine: 99 },
    ...body,
  ];
  return { "m.py": { nodes, edges: [], symbolIndex: [] } };
}
const threadOf = (kinds = []) => ({
  version: "1.0",
  seed: { file: "m.py", irNodeId: FN, qualifiedName: "compute" },
  nodes: kinds.map((k, i) => ({ id: `t${i}`, kind: k, label: k, file: null, irNodeId: null, preview: null })),
  edges: [],
});
const sel = (irNodeId) => ({ irNodeId, file: "m.py" });

test("runnable: module-level no-arg pure assignment → entryFn + exprN", () => {
  const p = planRunToNode(
    sel(`${FN}/b.assign`),
    ir([], [{ id: `${FN}/b.assign`, type: "assignment", parentId: FN, name: "b", line: 3 }]),
    threadOf(["seed", "step"]),
  );
  assert.deepEqual(p, { runnable: true, entryFn: "compute", exprN: "b", filePath: "m.py", irTargetId: `${FN}/b.assign`, needsSynth: false });
});

test("resolves the call-site via the incoming direct edge (callee-id step node)", () => {
  // The real UI renders a resolved-call assignment as a step node whose
  // irNodeId is the CALLEE def (module/double.fn), with the call-site
  // assignment recorded on the incoming `direct` edge's irSource. The gate
  // must resolve through that edge — else it declines "not inside a function".
  const projectIR = ir([], [{ id: `${FN}/b.assign`, type: "assignment", parentId: FN, name: "b", line: 3 }]);
  projectIR["m.py"].nodes.push({ id: "module/double.fn", type: "function_def", parentId: "module", name: "double", line: 50, endLine: 51 });
  const thread = {
    version: "1.0",
    seed: { file: "m.py", irNodeId: FN, qualifiedName: "compute" },
    nodes: [
      { id: "m:compute", kind: "seed", label: "compute", file: "m.py", irNodeId: FN, preview: null },
      { id: "m:double", kind: "step", label: "double", file: "m.py", irNodeId: "module/double.fn", preview: null },
    ],
    edges: [{ from: "m:compute", to: "m:double", kind: "direct", irSource: `${FN}/b.assign` }],
  };
  const p = planRunToNode({ nodeId: "m:double", irNodeId: "module/double.fn", file: "m.py" }, projectIR, thread);
  assert.deepEqual(p, { runnable: true, entryFn: "compute", exprN: "b", filePath: "m.py", irTargetId: `${FN}/b.assign`, needsSynth: false });
});

test("callee-id step node WITHOUT the resolving edge still declines honestly", () => {
  // No incoming direct edge → falls back to the node's own irNodeId (the
  // callee def at module scope) → honest unsupported-target, never a crash.
  const projectIR = ir([], []);
  projectIR["m.py"].nodes.push({ id: "module/double.fn", type: "function_def", parentId: "module", name: "double", line: 50 });
  const thread = { version: "1.0", seed: { file: "m.py", irNodeId: FN, qualifiedName: "compute" },
    nodes: [{ id: "m:double", kind: "step", label: "double", file: "m.py", irNodeId: "module/double.fn", preview: null }], edges: [] };
  const p = planRunToNode({ nodeId: "m:double", irNodeId: "module/double.fn", file: "m.py" }, projectIR, thread);
  assert.equal(p.runnable, false);
  assert.equal(p.outcome, "unsupported-target");
});

test("needs-inputs is now a runnable synth route (SM2), not a decline", () => {
  const p = planRunToNode(
    sel(`${FN}/b.assign`),
    ir(["factor"], [{ id: `${FN}/b.assign`, type: "assignment", parentId: FN, name: "b", line: 3 }]),
    threadOf(["seed"]),
  );
  assert.equal(p.runnable, true);
  assert.equal(p.needsSynth, true);
});

test("all-default args are fine (no-arg-equivalent → no synth)", () => {
  const p = planRunToNode(
    sel(`${FN}/b.assign`),
    ir(["n=10"], [{ id: `${FN}/b.assign`, type: "assignment", parentId: FN, name: "b", line: 3 }]),
    threadOf(["seed"]),
  );
  assert.equal(p.runnable, true);
  assert.equal(p.needsSynth, false);
});

test("method is runnable via a synthesized example instance (M-RUN2.1): className set, synth forced", () => {
  const projectIR = ir([], [{ id: `${FN}/b.assign`, type: "assignment", parentId: FN, name: "b", line: 3 }]);
  // re-parent the function under a class_def
  projectIR["m.py"].nodes.push({ id: "module/Cls.class", type: "class_def", parentId: "module", name: "Cls", line: 1 });
  projectIR["m.py"].nodes.find((n) => n.id === FN).parentId = "module/Cls.class";
  const p = planRunToNode(sel(`${FN}/b.assign`), projectIR, threadOf());
  assert.equal(p.runnable, true);
  assert.equal(p.className, "Cls");
  // Constructing the instance is itself a synthesis step — even with a
  // no-arg method, the run must route through the synth→confirm gate.
  assert.equal(p.needsSynth, true);
});

test("a method whose class has no usable name still declines honestly", () => {
  const projectIR = ir([], [{ id: `${FN}/b.assign`, type: "assignment", parentId: FN, name: "b", line: 3 }]);
  projectIR["m.py"].nodes.push({ id: "module/Cls.class", type: "class_def", parentId: "module", line: 1 });
  projectIR["m.py"].nodes.find((n) => n.id === FN).parentId = "module/Cls.class";
  const p = planRunToNode(sel(`${FN}/b.assign`), projectIR, threadOf());
  assert.equal(p.runnable, false);
  assert.equal(p.outcome, "unsupported-target");
});

// M-RUN3 — a return statement (and a bare call) IS capturable now: the server
// rewrites the run's temp copy via capture_probe, holding the value in
// __vg_value. The value is real; only the holding name is synthetic.
test("M-RUN3: a return statement is runnable via the capture probe", () => {
  const p = planRunToNode(
    sel(`${FN}/return@0`),
    ir([], [{ id: `${FN}/return@0`, type: "return_stmt", parentId: FN, line: 3 }]),
    threadOf(),
  );
  assert.equal(p.runnable, true);
  assert.equal(p.exprN, "__vg_value");
});

test("M-RUN3: a bare call statement is runnable via the capture probe", () => {
  const p = planRunToNode(
    sel(`${FN}/print.call`),
    ir([], [{ id: `${FN}/print.call`, type: "call", parentId: FN, line: 3 }]),
    threadOf(),
  );
  assert.equal(p.runnable, true);
  assert.equal(p.exprN, "__vg_value");
});

test("value-ambiguous: a node that produces NO value still declines (e.g. an if statement)", () => {
  const p = planRunToNode(
    sel(`${FN}/if@0`),
    ir([], [{ id: `${FN}/if@0`, type: "if_stmt", parentId: FN, line: 3 }]),
    threadOf(),
  );
  assert.equal(p.runnable, false);
  assert.equal(p.outcome, "value-ambiguous");
});

// M-RUN2.3 — the client-side purity pre-gate is GONE: it dead-ended every
// directly-effectful function with a reason-only decline (no effect list,
// no consent token, no missing-data offer). Effects are the SERVER floor's
// decision now — the plan stays runnable and the floor refuses WITH the
// consent affordance.
test("an effectKind on the path no longer declines client-side — the floor decides", () => {
  const p = planRunToNode(
    sel(`${FN}/b.assign`),
    ir([], [
      { id: `${FN}/w.assign`, type: "assignment", parentId: FN, name: "w", line: 2, valueKind: "call", effectKind: "fs" },
      { id: `${FN}/b.assign`, type: "assignment", parentId: FN, name: "b", line: 3 },
    ]),
    threadOf(["seed"]),
  );
  assert.equal(p.runnable, true);
});

test("a dynamic terminal on the path no longer declines client-side — the floor decides", () => {
  const p = planRunToNode(
    sel(`${FN}/b.assign`),
    ir([], [{ id: `${FN}/b.assign`, type: "assignment", parentId: FN, name: "b", line: 3 }]),
    threadOf(["seed", "dynamic"]),
  );
  assert.equal(p.runnable, true);
});

test("arg-needing fn with an effect on the path routes to synth; the floor gates before synthesis", () => {
  // handleSynthThreadArgs runs the floor FIRST (blockedByEffect + token), so
  // the consent still precedes any synthesis — just server-side now.
  const p = planRunToNode(
    sel(`${FN}/b.assign`),
    ir(["factor"], [
      { id: `${FN}/w.assign`, type: "assignment", parentId: FN, name: "w", line: 2, valueKind: "call", effectKind: "fs" },
      { id: `${FN}/b.assign`, type: "assignment", parentId: FN, name: "b", line: 3 },
    ]),
    threadOf(["seed"]),
  );
  assert.equal(p.runnable, true);
  assert.equal(p.needsSynth, true);
});

test("effect AFTER N does not block (only the path UP-TO-N matters)", () => {
  const p = planRunToNode(
    sel(`${FN}/b.assign`),
    ir([], [
      { id: `${FN}/b.assign`, type: "assignment", parentId: FN, name: "b", line: 3 },
      { id: `${FN}/w.assign`, type: "assignment", parentId: FN, name: "w", line: 5, valueKind: "call", effectKind: "http" },
    ]),
    threadOf(["seed"]),
  );
  assert.equal(p.runnable, true);
});
