// M-NEST Layer 3 — the agent-facing projection contract.
//
// Claude consumes a COMPACT projection of the complete thread by default and
// drills only when a trace needs it. The projection must preserve the TWO
// honest states as DISTINCT SEMANTICS — `nestedCollapsed` (drillable, in IR) vs
// `uncaptured` (chain/comprehension/literal, NOT in IR) — so an uncaptured hole
// is never read as empty-or-complete.
//
// Run: npm run test:nest-projection

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveNests,
  collapseNests,
  projectThreadForAgent,
  drillThread,
} from "../src/webview/threads/collapse.ts";

const OUTER = "module/N.fn/x.assign";          // F.relu wrapping self.conv1
const INNER = OUTER + "/self_conv1.call";      // the extracted nested call
const CHAIN = "module/N.fn/y.assign";          // self.proj(x).relu() — uncaptured

function fullThread() {
  return {
    version: "1.0",
    seed: { file: "m.py", irNodeId: "module/N.fn", qualifiedName: "N.fn" },
    nodes: [
      { id: "seed", kind: "seed", label: "fn", file: "m.py", irNodeId: "module/N.fn", preview: null },
      // drillable: nested calls ARE in the IR (nestExtracted) + a child present
      { id: "relu", kind: "external", label: "F.relu", file: null, irNodeId: OUTER, preview: null, nestsInnerCalls: true, nestExtracted: true },
      { id: "conv1", kind: "dynamic", label: "self.conv1", file: null, irNodeId: INNER, preview: null, nested: true },
      // uncaptured: detected but NOT decomposed — no child node exists
      { id: "chain", kind: "dynamic", label: "self.proj().relu", file: null, irNodeId: CHAIN, preview: null, nestsInnerCalls: true, nestExtracted: false },
      { id: "ret", kind: "return", label: "return", file: "m.py", irNodeId: "module/N.fn/return@0", preview: null },
    ],
    edges: [
      { from: "seed", to: "relu", kind: "direct", irSource: OUTER },
      { from: "seed", to: "conv1", kind: "direct", irSource: INNER },
      { from: "seed", to: "chain", kind: "direct", irSource: CHAIN },
      { from: "relu", to: "ret", kind: "direct", irSource: null },
    ],
  };
}

const ids = (t) => t.nodes.map((n) => n.id).sort();
const bytes = (o) => JSON.stringify(o).length;

test("faithfulness: projection node set == collapse(full)", () => {
  const full = fullThread();
  const nests = deriveNests(full.nodes);
  const collapsed = collapseNests(full, nests, () => false);
  // The projection adds marker FIELDS only — the node SET must equal collapse.
  assert.deepEqual(ids(projectThreadForAgent(full)), ids(collapsed));
});

test("faithfulness: drilling everything reproduces the full thread (round-trip)", () => {
  const full = fullThread();
  const drilled = drillThread(full); // no arg → expand all
  assert.deepEqual(ids(drilled), ids(full));
  assert.deepEqual(drilled.edges, full.edges);
});

test("two states survive into the projection with DISTINCT meaning", () => {
  const p = projectThreadForAgent(fullThread());
  const relu = p.nodes.find((n) => n.id === "relu");
  const chain = p.nodes.find((n) => n.id === "chain");
  // drillable: nestedCollapsed set, uncaptured NOT set
  assert.equal(relu.nestedCollapsed, 1);
  assert.equal(relu.uncaptured, undefined);
  // uncaptured: uncaptured set, nestedCollapsed NOT set — never conflated
  assert.equal(chain.uncaptured, true);
  assert.equal(chain.nestedCollapsed, undefined);
  // the drillable inner call is collapsed OUT of the default projection
  assert.equal(p.nodes.find((n) => n.id === "conv1"), undefined);
});

test("uncaptured is never droppable-silently: the marked step stays in the projection", () => {
  const p = projectThreadForAgent(fullThread());
  // The chain step itself is NOT collapsed (it's the outer, not a nested child)
  // — it survives, carrying its uncaptured flag. The hole is signalled, present.
  assert.ok(p.nodes.some((n) => n.id === "chain" && n.uncaptured === true));
});

test("token-footprint: compact << full, and no growth with nest depth", () => {
  const full = fullThread();
  const compact = projectThreadForAgent(full);
  // The genuine token-efficiency win: the projection is strictly smaller than
  // the full thread Claude would otherwise consume (the nested explosion gone).
  assert.ok(bytes(compact) < bytes(full), `compact ${bytes(compact)} !< full ${bytes(full)}`);
  // No node-count growth from nesting: the agent map has exactly the outer
  // steps — the same count as a no-nested baseline, regardless of nest depth.
  const baseline = {
    ...full,
    nodes: full.nodes.filter((n) => !n.nested),
  };
  assert.equal(compact.nodes.length, baseline.nodes.length);
  // The two-state markers are the only overhead vs that baseline, and it is
  // bounded by the marker COUNT (not nest depth) — cheap honesty.
  const markers = compact.nodes.filter((n) => n.nestedCollapsed || n.uncaptured).length;
  assert.ok(bytes(compact) - bytes(baseline) <= 80 * markers,
    `marker overhead ${bytes(compact) - bytes(baseline)} exceeds budget`);
});

test("drill returns the FULL sub-IR for one nest, not a re-collapsed view", () => {
  const full = fullThread();
  const drilled = drillThread(full, "relu");
  // relu's nested child is revealed (full sub-IR)…
  assert.ok(drilled.nodes.some((n) => n.id === "conv1"), "drilled nest must reveal its inner call");
  // …and it is not re-collapsed (conv1 carries its original `nested` truth).
  assert.equal(drilled.nodes.find((n) => n.id === "conv1").nested, true);
});
