// The architecture map's router, tool folding, traces and first view —
// the fixes reviews/m-arch/COMPARE.md asked for, pinned as pure functions.
//
//   npm run test:arch-route
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { applyArchStore, emptyStore } from "../src/server/arch_store.ts";
import { routeEdges } from "../src/webview/system/arch_route.ts";
import { collapseTools } from "../src/webview/system/arch_collapse.ts";
import { reach, route, storyBeats } from "../src/webview/system/arch_trace.ts";
import { ARCH_LENSES, buildArchLayout, cardHeight, readableViewport, CARD_W } from "../src/webview/system/archLayout.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const build = (rel) => {
  const root = join(ROOT, rel);
  const env = buildPolyglotEnvelope(root).envelope;
  return archModelForEnvelope(env, buildStackIndex(env, root), buildCrossingIndex(env), root, undefined, { applyStore: false });
};
let models;
before(() => {
  models = {
    next: build("test/fixtures/webstack/next_demo"),
    fleet: build("examples/fleet-telemetry"),
    shop: build("test/fixtures/polyglot/shop_demo"),
  };
});

/** segments crossing a box that is not an end; every segment axis-aligned. */
function faults(points, boxes, ends) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    if (a[0] !== b[0] && a[1] !== b[1]) out.push(`segment ${i} diagonal`);
    for (const r of boxes) {
      if (ends.includes(r.id)) continue;
      const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      if (x1 > r.x + 1 && x0 < r.x + r.w - 1 && y1 > r.y + 1 && y0 < r.y + r.h - 1) out.push(`segment ${i} crosses ${r.id}`);
    }
  }
  return out;
}

const OPTS = { spreadPorts: true, portBand: () => ({ top: 8, bottom: 46 }), gapAfterLast: 160 };
const box = (id, col, row, h = 54) => ({ id, col, x: col * 460, y: row * 132, w: 274, h });

test("the four shapes: forward past an occupied column, backward, same column, adjacent — none crosses a card", () => {
  const boxes = [box("a", 0, 0), box("block", 1, 0), box("block2", 1, 1), box("b", 2, 0), box("c", 2, 1), box("d", 0, 2)];
  const edges = [
    { id: "fwd", from: "a", to: "b", labelW: 80, labelH: 20 },     // skips column 1, whose row 0 is occupied
    { id: "back", from: "c", to: "d", labelW: 80, labelH: 20 },    // right to left
    { id: "same", from: "b", to: "c", labelW: 80, labelH: 20 },    // one column
    { id: "adj", from: "a", to: "block2", labelW: 80, labelH: 20 },
  ];
  const r = routeEdges(boxes, edges, OPTS);
  for (const e of edges) {
    const pts = r.get(e.id).points;
    assert.deepEqual(faults(pts, boxes, [e.from, e.to]), [], e.id);
  }
  // Sides: forward leaves right / enters left; backward leaves left / enters right; same column enters right.
  const at = (id, i) => r.get(id).points.at(i);
  assert.equal(at("fwd", 0)[0], 274); assert.equal(at("fwd", -1)[0], 920);
  assert.equal(at("back", 0)[0], 920); assert.equal(at("back", -1)[0], 274);
  assert.equal(at("same", -1)[0], 920 + 274);
  // Every label found a free spot, and none overlaps another.
  const labels = edges.map((e) => r.get(e.id));
  assert.ok(labels.every((l) => l.labelClear));
});

test("on every fixture and every lens, no routed edge crosses a card", () => {
  for (const [name, m] of Object.entries(models)) {
    for (const lens of ARCH_LENSES) {
      const l = buildArchLayout(m, lens);
      const boxes = l.nodes.filter((n) => n.type === "archNode").map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: CARD_W, h: cardHeight(n.data.node) }));
      for (const e of l.edges) {
        assert.ok(e.data.points.length >= 2, `${name}/${lens} ${e.id} has no route`);
        assert.deepEqual(faults(e.data.points, boxes, [e.source, e.target]), [], `${name}/${lens} ${e.id}`);
      }
    }
  }
});

test("an edge label sits on its own line, not on another's: fan-in labels read unambiguously", () => {
  // One source, four tools stacked to its right: every edge runs down the
  // same lane gap. A label on that shared lane covers the neighbouring lines
  // (fleet's "SSH" label sat on the HTTP line into fetch); each must take its
  // own horizontal run into its tool instead.
  const boxes = [
    { id: "src", x: 0, y: 0, w: 274, h: 60, col: 0 },
    ...[0, 1, 2, 3].map((i) => ({ id: `t${i}`, x: 500, y: i * 110, w: 274, h: 60, col: 1 })),
  ];
  const edges = [0, 1, 2, 3].map((i) => ({ id: `e${i}`, from: "src", to: `t${i}`, labelW: 60, labelH: 24 }));
  const out = routeEdges(boxes, edges, { spreadPorts: true, portBand: () => ({ top: 12, bottom: 48 }), gapAfterLast: 160 });
  const segs = [...out].flatMap(([id, r]) => r.points.slice(0, -1).map((p, i) => ({ id, a: p, b: r.points[i + 1] })));
  for (const [id, r] of out) {
    assert.ok(r.labelClear, `${id} has a label`);
    const box = { x0: r.label.cx - 30, x1: r.label.cx + 30, y0: r.label.cy - 12, y1: r.label.cy + 12 };
    const other = segs.find((s) => s.id !== id
      && Math.max(Math.min(s.a[0], s.b[0]), box.x0 + 1) <= Math.min(Math.max(s.a[0], s.b[0]), box.x1 - 1)
      && Math.max(Math.min(s.a[1], s.b[1]), box.y0 + 1) <= Math.min(Math.max(s.a[1], s.b[1]), box.y1 - 1));
    assert.equal(other, undefined, `${id}'s label covers ${other?.id}'s line`);
  }
});

test("on the fleet example, no Tools-lens label covers another edge's line where a clear spot exists", () => {
  const l = buildArchLayout(models.fleet, "tools");
  const into = (tool) => l.edges.find((e) => e.target === tool);
  // The regression Ben would see: each tool's label names that tool's line.
  for (const tool of ["tool:curl", "tool:pg_dump", "tool:psql", "tool:ssh"]) {
    const e = into(tool);
    const t = l.nodes.find((n) => n.id === tool);
    assert.ok(e?.label, `${tool} is labelled`);
    assert.ok(Math.abs(e.data.labelAt.cy - e.data.points[e.data.points.length - 1][1]) < 1, `${tool}'s label sits on its own final run, level with ${t.id}'s port`);
  }
});

test("the Overview folds tools by category; the model keeps every tool", () => {
  const { model, hiddenTools } = collapseTools(models.next);
  const db = model.nodes.find((n) => n.id === "tools:database");
  assert.deepEqual(db.members, ["tool:pg", "tool:psql"]);
  assert.equal(db.sublabel, "pg, psql");
  assert.deepEqual(hiddenTools, ["tool:clsx"], "an unclassified tool is counted, not drawn");
  assert.ok(!model.nodes.some((n) => n.id === "tool:pg"));
  // Edges into one category box merge per caller: counts add, members kept.
  const originals = models.next.edges.filter((e) => e.from === "cluster:web:." && ["tool:pg", "tool:psql"].includes(e.to));
  const merged = model.edges.find((e) => e.id === "cluster:web:.->tools:database:uses");
  assert.equal(merged.count, originals.reduce((s, e) => s + e.count, 0));
  assert.deepEqual([...merged.members].sort(), originals.map((e) => e.id).sort());
  // A single-member category stays itself.
  assert.ok(model.nodes.some((n) => n.id === "tool:openai"));
  // The source model is untouched.
  assert.ok(models.next.nodes.some((n) => n.id === "tool:pg"));
  // The Tools lens draws each tool.
  assert.ok(buildArchLayout(models.next, "tools").nodes.some((n) => n.id === "tool:pg"));
  assert.ok(buildArchLayout(models.next, "tools").nodes.some((n) => n.id === "tool:clsx"));
});

test("a tool a group wraps is never folded: the box must not grow round tools it did not name", () => {
  const m = applyArchStore(models.next, { ...emptyStore(), groups: [{ id: "g-db", kind: "network", label: "db net", wraps: ["tool:pg"] }] });
  const { model } = collapseTools(m);
  assert.ok(model.nodes.some((n) => n.id === "tool:pg"));
  assert.ok(!model.nodes.some((n) => n.id === "tools:database"), "psql alone is not a category box");
});

test("reach, route and the story read the drawn graph and invent nothing", () => {
  const edges = [{ id: "ab", from: "a", to: "b" }, { id: "bc", from: "b", to: "c" }, { id: "ad", from: "a", to: "d" }];
  assert.deepEqual(reach(edges, "a", "down"), { nodes: ["a", "b", "c", "d"], edges: ["ab", "ad", "bc"] });
  assert.deepEqual(reach(edges, "c", "up"), { nodes: ["a", "b", "c"], edges: ["ab", "bc"] });
  assert.deepEqual(route(edges, "a", "c"), { nodes: ["a", "b", "c"], edges: ["ab", "bc"] });
  assert.equal(route(edges, "c", "a"), null, "arrows run one way");
  const nodes = [{ id: "a", label: "A", entryPoints: ["ep1"] }, { id: "b", label: "B" }, { id: "c", label: "C" }, { id: "d", label: "D" }];
  const sedges = [
    { id: "ab", from: "a", to: "b", protocol: "HTTP", protocolBasis: "a fetch", threads: ["ep1"] },
    { id: "bc", from: "b", to: "c", protocol: "SQL", protocolBasis: "pg", threads: ["ep1"] },
    { id: "ad", from: "a", to: "d", protocol: "exec", protocolBasis: "spawn", threads: ["ep2"] },
  ];
  const beats = storyBeats(nodes, sedges, ["ep1"]);
  assert.deepEqual(beats.map((b) => b.title), ["Start: ep1", "A → B", "B → C"], "an edge the thread does not take is not in its story");
  assert.equal(beats[1].caption, "HTTP — a fetch");
  assert.deepEqual(storyBeats(nodes, sedges, ["nobody"]), []);
});

test("the first view: fit all when legible, else fit the width, else the 11px floor — from the top-left", () => {
  const small = readableViewport({ x: 0, y: 0, w: 800, h: 400 }, 1200, 800);
  assert.ok(small.zoom >= 11 / 13);
  const wide = readableViewport({ x: 0, y: 0, w: 1300, h: 6000 }, 1200, 800);
  assert.ok(Math.abs(wide.zoom - (1200 - 64) / 1300) < 1e-9, "tall: fit the width, pan down");
  assert.equal(wide.y, 32);
  const huge = readableViewport({ x: 100, y: 50, w: 5000, h: 5000 }, 1200, 800);
  assert.equal(huge.zoom, 11 / 13);
  assert.equal(huge.x, 32 - 100 * huge.zoom);
});
