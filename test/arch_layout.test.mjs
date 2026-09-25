// The architecture map's HIERARCHY and PLACEMENT (2026-09-24).
//
// Ben: "company orchestrator should be under the backend portion or under
// the Volt host", flow left to right, laptop-shaped, related parts close.
//
//   * the hierarchy is resolved once (src/shared/arch_hierarchy.ts) and
//     stamped on the model as `group` / `parent`: a dispatcher inherits its
//     cluster's group; a group nests in the smallest group wrapping it, else
//     the smallest whose members are a strict superset; cycles are cut;
//   * placement (src/webview/system/arch_pack.ts): flow columns (a callback
//     never pushes its target right; a dispatcher shares its cluster's
//     column), groups packed as rectangles, the variant that reads largest on
//     a laptop canvas wins.
//
// The synthetic model mirrors a private production codebase's stated store, messiness included:
// two groups wrapping one host, a host whose members sit inside another
// host, a tool inside a trust zone beside processes.
//
//   npm run test:arch-layout
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHierarchy, stampHierarchy } from "../src/shared/arch_hierarchy.ts";
import { buildArchLayout } from "../src/webview/system/archLayout.ts";
import { flowColumns } from "../src/webview/system/arch_pack.ts";
import { measure } from "../scripts/arch_layout_metrics.mjs";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const node = (id, kind, category, extra = {}) => ({ id, kind, label: id, sublabel: "", category, source: "derived", threads: [], refs: [], ...extra });
const edge = (from, to, kind, protocol = "HTTP") => ({ id: `${from}->${to}:${kind}`, from, to, kind, protocol, protocolBasis: "test", count: 1, threads: [], confidence: "path", refs: [], source: "derived" });
const group = (id, wraps, extra = {}) => ({ id, kind: "host", label: id, wraps, source: "stated", ...extra });

const MODEL = {
  version: "1",
  nodes: [
    node("cluster:web:.", "cluster", "frontend", { family: "web", root: "web", entryPoints: ["a"] }),
    node("cluster:mcp:.", "cluster", "agent", { family: "mcp", root: "mcp", entryPoints: ["b"] }),
    node("cluster:scripts:api", "cluster", "scripts", { family: "scripts", root: "api", entryPoints: ["c", "d"] }),
    node("hub:api/orchestrator.sh:module", "hub", "scripts", { family: "scripts", root: "api", cluster: "cluster:scripts:api", entryPoints: ["c"] }),
    node("tool:volt", "tool", "platform"),
    node("tool:pg", "tool", "database"),
    node("tool:openai", "tool", "model"),
  ],
  edges: [
    edge("cluster:web:.", "cluster:mcp:.", "http"),
    edge("cluster:mcp:.", "hub:api/orchestrator.sh:module", "command", "exec"),
    edge("hub:api/orchestrator.sh:module", "cluster:scripts:api", "command", "exec"),
    edge("cluster:scripts:api", "cluster:web:.", "http"), // a callback: must not push the web app right
    edge("cluster:web:.", "tool:volt", "uses", "Volt"),
    edge("cluster:scripts:api", "tool:pg", "uses", "SQL"),
    edge("cluster:mcp:.", "tool:openai", "uses", "HTTPS"),
  ],
  groups: [
    group("g-app-host", ["cluster:web:.", "cluster:mcp:."]),
    group("g-mcp-process", ["cluster:mcp:."], { kind: "process" }),         // a strict subset of g-app-host
    group("g-mesh", ["g-host", "tool:volt"], { kind: "trust" }),
    group("g-trust", ["g-host"], { kind: "trust" }),                        // a second wrapper of g-host
    group("g-host", ["cluster:scripts:api"], { parent: "g-trust" }),        // explicit parent wins
    group("g-db", ["tool:pg"]),
    group("g-loop-a", ["g-loop-b"]), group("g-loop-b", ["g-loop-a"]),        // a cycle, cut
  ],
  unplaced: { tests: 0, unmatchedHops: 0, toolsPresentNotCalled: [], unattributedBoundaries: 0 },
  notes: [],
};

test("the hierarchy: one tree from untidy statements; a dispatcher sits in its cluster's host", () => {
  const h = resolveHierarchy(MODEL);
  assert.equal(h.groupParent.get("g-host"), "g-trust", "an explicit parent wins over a second wrapper");
  assert.equal(h.groupParent.get("g-trust"), "g-mesh", "a group whose members sit inside a bigger group nests in it");
  assert.equal(h.groupParent.get("g-mcp-process"), "g-app-host", "a strict subset nests");
  assert.equal(h.groupParent.has("g-app-host"), false);
  assert.ok(!(h.groupParent.get("g-loop-a") === "g-loop-b" && h.groupParent.get("g-loop-b") === "g-loop-a"), "a cycle is cut");
  assert.equal(h.nodeGroup.get("cluster:mcp:."), "g-mcp-process", "the deepest wrapper holds the node");
  assert.equal(h.nodeGroup.get("hub:api/orchestrator.sh:module"), "g-host", "no statement wraps the hub: it inherits its cluster's host");
  assert.deepEqual(h.chainOf("hub:api/orchestrator.sh:module"), ["g-mesh", "g-trust", "g-host"]);

  const m = stampHierarchy(MODEL);
  const hub = m.nodes.find((n) => n.id === "hub:api/orchestrator.sh:module");
  assert.equal(hub.group, "g-host");
  assert.equal(hub.parent, "cluster:scripts:api", "the hub's direct parent is its cluster");
  assert.equal(m.nodes.find((n) => n.id === "tool:openai").group, undefined, "an ungrouped node carries none");
  assert.equal(m.groups.find((g) => g.id === "g-trust").parent, "g-mesh", "groups carry the resolved parent");
});

test("flow columns: left to right along the hops; callbacks draw back; a dispatcher shares its cluster's column", () => {
  const col = flowColumns(MODEL.nodes, MODEL.edges);
  assert.equal(col.get("cluster:web:."), 0, "the web app stays first despite the callback into it");
  assert.equal(col.get("cluster:mcp:."), 1);
  assert.equal(col.get("hub:api/orchestrator.sh:module"), col.get("cluster:scripts:api"));
  assert.ok(col.get("cluster:scripts:api") > col.get("cluster:mcp:."));
  const last = Math.max(...col.values());
  assert.equal(col.get("tool:pg"), last, "tools take the last column");
});

test("placement: every card inside its group's box, no two boxes cross, a tool beside the processes it shares a zone with", () => {
  const m = stampHierarchy(MODEL);
  const l = buildArchLayout(m, "overview", { collapseTools: false });
  const r = measure(m, "overview");
  assert.equal(r.orphans, 0, "a card outside its own group's box");
  assert.equal(r.groupOverlap, 0, "two group boxes that cross");
  const box = (gid) => l.nodes.find((n) => n.id === `group:${gid}`);
  const at = (id) => l.nodes.find((n) => n.id === id).position;
  // The hub is drawn inside the host, which is inside both trust zones.
  const hub = at("hub:api/orchestrator.sh:module");
  for (const g of ["g-host", "g-trust", "g-mesh"]) {
    const b = box(g);
    assert.ok(hub.x >= b.position.x && hub.x <= b.position.x + b.width && hub.y >= b.position.y && hub.y <= b.position.y + b.height, `hub inside ${g}`);
  }
  // volt shares g-mesh with the scripts: one column right of them, not in the tools column.
  const col = (id) => Math.round(at(id).x / 400);
  assert.equal(col("tool:volt"), col("cluster:scripts:api") + 1);
  assert.ok(col("tool:pg") >= col("tool:volt"));
});

test("real fixtures read on a laptop canvas (1160×700) at a legible size", () => {
  for (const [rel, minZoom] of [["examples/fleet-telemetry", 1.0], ["test/fixtures/webstack/next_demo", 0.75], ["test/fixtures/arch/dispatch_demo", 1.0]]) {
    const root = join(ROOT, rel);
    const env = buildPolyglotEnvelope(root).envelope;
    const model = archModelForEnvelope(env, buildStackIndex(env, root), buildCrossingIndex(env), root);
    const r = measure(model, "overview");
    assert.ok(r.fitZoom >= minZoom, `${rel}: fits at ${r.fitZoom} (${r.size})`);
    assert.equal(r.groupOverlap, 0);
    assert.equal(r.orphans, 0);
  }
});
