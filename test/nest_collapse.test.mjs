// M-NEST Layer 2 — the collapse projection contract.
//
// Run: npm run test:nest-collapse
// Imports the .ts source directly (Node strips types natively).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveNests,
  collapseNests,
  nestFlowEdges,
} from "../src/webview/threads/collapse.ts";

// A ComposedNet-shaped thread: F.relu wraps self.conv1 (nested), then a bare
// `return`. The nested node's IR id is `<outer ir id>/self_conv1.call`.
const OUTER_IR = "module/Net.class/forward.fn/x.assign";
const INNER_IR = OUTER_IR + "/self_conv1.call";

function fixture() {
  return {
    version: "1.0",
    seed: { file: "m.py", irNodeId: "module/Net.class/forward.fn", qualifiedName: "Net.forward" },
    nodes: [
      { id: "seed", kind: "seed", label: "forward", file: "m.py", irNodeId: "module/Net.class/forward.fn", preview: null },
      { id: "relu", kind: "external", label: "F.relu", file: null, irNodeId: OUTER_IR, preview: null },
      { id: "conv1", kind: "dynamic", label: "self.conv1", file: null, irNodeId: INNER_IR, preview: null, nested: true },
      { id: "ret", kind: "return", label: "return", file: "m.py", irNodeId: "module/Net.class/forward.fn/return@0", preview: null },
    ],
    edges: [
      { from: "seed", to: "relu", kind: "direct", irSource: OUTER_IR },
      { from: "seed", to: "conv1", kind: "direct", irSource: INNER_IR },
      { from: "relu", to: "ret", kind: "direct", irSource: null },
    ],
  };
}

test("deriveNests: links the nested node to its outer via IR-id stripping", () => {
  const nests = deriveNests(fixture().nodes);
  assert.equal(nests.parentByChild.get("conv1"), "relu");
  assert.deepEqual(nests.childrenByParent.get("relu"), ["conv1"]);
});

test("collapsed by default: nested node + its edges drop, outer survives", () => {
  const t = fixture();
  const nests = deriveNests(t.nodes);
  const collapsed = collapseNests(t, nests, () => false);
  const ids = collapsed.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["relu", "ret", "seed"]);
  // No dangling edge into the dropped nested node.
  assert.ok(collapsed.edges.every((e) => e.from !== "conv1" && e.to !== "conv1"));
});

test("expanded: the nested node reappears (round-trip = full node set)", () => {
  const t = fixture();
  const nests = deriveNests(t.nodes);
  const expanded = collapseNests(t, nests, () => true);
  const ids = expanded.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, t.nodes.map((n) => n.id).sort());
});

test("nestFlowEdges: inner→outer 'runs before' edge only when both visible", () => {
  const t = fixture();
  const nests = deriveNests(t.nodes);
  // collapsed → no flow edge (child hidden)
  const collapsed = collapseNests(t, nests, () => false);
  assert.equal(nestFlowEdges(collapsed.nodes, nests).length, 0);
  // expanded → one inner→outer flow edge, children-first (conv1 → relu)
  const expanded = collapseNests(t, nests, () => true);
  const flows = nestFlowEdges(expanded.nodes, nests);
  assert.equal(flows.length, 1);
  assert.deepEqual(
    { from: flows[0].from, to: flows[0].to, kind: flows[0].kind },
    { from: "conv1", to: "relu", kind: "flow" },
  );
});

test("multi-level nest collapses transitively (inner hidden when outer closed)", () => {
  // pool(relu(conv2(x))) — conv2 nested in relu nested in pool.
  const POOL = "module/Net.class/forward.fn/y.assign";
  const RELU = POOL + "/F_relu.call";
  const CONV2 = RELU + "/self_conv2.call";
  const t = {
    version: "1.0",
    seed: { file: "m.py", irNodeId: "module/Net.class/forward.fn", qualifiedName: "Net.forward" },
    nodes: [
      { id: "pool", kind: "dynamic", label: "self.pool", file: null, irNodeId: POOL, preview: null },
      { id: "relu", kind: "external", label: "F.relu", file: null, irNodeId: RELU, preview: null, nested: true },
      { id: "conv2", kind: "dynamic", label: "self.conv2", file: null, irNodeId: CONV2, preview: null, nested: true },
    ],
    edges: [],
  };
  const nests = deriveNests(t.nodes);
  assert.equal(nests.parentByChild.get("relu"), "pool");
  assert.equal(nests.parentByChild.get("conv2"), "relu");
  // expand pool only → relu shows, conv2 still hidden (its parent relu closed)
  const expandPoolOnly = collapseNests(t, nests, (id) => id === "pool");
  const ids = expandPoolOnly.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["pool", "relu"]);
});
