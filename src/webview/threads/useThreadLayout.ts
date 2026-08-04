// Layered top-down layout for the thread view (U4 — updateUI-plan §2).
//
// Earlier (M4b → M9) this hook ran an unconstrained d3-force with the seed
// hard-pinned at the canvas centre. The simulation arranged the rest
// radially around the seed, which gave a Visio-ish web with no obvious
// flow direction: the user's eye couldn't trace `main → cmd_create →
// create_user → insert → conn.execute` as a path. The thread *existed*
// but didn't *read*.
//
// U4 fixes that. The thread already has a natural top-down order — the
// extractor walks DFS from the seed and collapses back-edges
// (extract_thread.py:14-23) — so the graph the renderer sees is acyclic.
// We exploit that:
//
//   1. BFS from the seed → depth per node.
//   2. y(node) = depth * --thread-row-height. Rows are pinned.
//   3. Initial x = even spread across each layer (DFS order within row).
//   4. d3-force x-relaxation with `fy` pinned per node — only x moves.
//      forceLink (96px target), forceManyBody (-400), forceCollide (80).
//      200 ticks; deterministic given the same input.
//
// Output is still a flat {id → {x,y}} map so the renderer doesn't have to
// change shape. The y values come straight out of the pinned layer; the
// x values are post-relaxation.
//
// Disconnected nodes (shouldn't happen in a normal thread but defensive):
// they land in a bottom "floating" row with depth = maxDepth + 1.

import { useMemo } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import type { Thread } from "./types";
import { deriveNests } from "./collapse";
import type { FileGroups } from "./depthCues";
import type { ProjectFileData } from "../../shared/protocol";

// M21 — thread orientation (PLAN-v5 §3). Vertical (top-to-bottom source
// order) is the default/norm; horizontal (left-to-right) is the opt-in
// toggle. Only the source-order layout transposes — execution order reads
// along the MAIN axis (y when vertical, x when horizontal); the cross axis
// is fixed. Container bounding boxes are derived from child positions in
// ThreadView, so they follow the transpose for free.
export type ThreadOrientation = "vertical" | "horizontal";

export interface LaidOutPosition {
  x: number;
  y: number;
}

export interface ThreadLayout {
  positions: Map<string, LaidOutPosition>;
  width: number;
  height: number;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  fy: number;
}

const DEFAULT_ITERATIONS = 200;

// Tunings — pinned in tokens.css for the y-spacing (96px), inline here
// for the x-relaxation forces. The plan's defaults were 96/-400/80; we
// bumped collide 80 → 95 and charge -400 → -550 after the first U4
// review showed wider lucide-labelled cards (e.g. parser.add_subparsers)
// clipping in dense rows. With y pinned the only escape valve is
// horizontal spread, so the collide radius needs to cover the widest
// card the typical thread emits, not the average.
//
// IMPORTANT: forceCollide is *approximate* — with forceLink + charge
// pulling, overlap pairs can still appear after 200 ticks (observed:
// 30px residual overlap on cli:main row 1). The deterministic fix is
// the post-relaxation pass below (enforceRowSpacing), which sorts each
// y-row by x and hard-enforces a minimum centre-to-centre distance.
const LINK_DISTANCE = 96;
const CHARGE_STRENGTH = -550;
const COLLIDE_RADIUS = 95;
// Minimum centre-to-centre x-distance enforced by the post-pass.
// ThreadNode CSS uses maxWidth: 220 + padding ~26px + icon/gap ~24px =
// ~250px for the widest cards (verified via offsetWidth probe on
// flask_demo's cli:main row 1: argparse.ArgumentParser renders at
// 246px CSS). Spacing must exceed the average half-width SUM of any
// two adjacent cards, so 260 leaves a small visible gap even when
// two max-width cards land next to each other.
//
// Note: this is in LAYOUT coordinates, not screen. fitView scales the
// final layout to fit the viewport, so a wider layout just means a
// smaller display zoom — readable but never overlapping.
const ROW_MIN_SPACING_X = 260;

// Vertical pad above the seed so the top of the canvas isn't flush
// against the seed card. Matches the M3 four-px scale.
const Y_PADDING_TOP = 80;

// M9.3 — diagonal flow offset per file-depth-from-seed step. The plan
// pins (8px x, 4px y); depth is already capped at 4 in depthCues.ts,
// so the maximum push is (32, 16) — subtle enough that the row-
// spacing pass (260px) absorbs it without re-introducing overlap.
const DEPTH_OFFSET_X = 8;
const DEPTH_OFFSET_Y = 4;

// Read the --thread-row-height token at module load with a 96px fallback
// for SSR / test contexts where document isn't defined.
function readRowHeight(): number {
  if (typeof window === "undefined" || typeof document === "undefined") return 96;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--thread-row-height").trim();
  if (!v) return 96;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 96;
}

interface DepthMap {
  depthOf: Map<string, number>;
  rows: Map<number, string[]>;  // depth → ordered node ids
  maxDepth: number;
}

// Single BFS from the seed. Edge.from → Edge.to is treated as parent →
// child. The extractor has already collapsed cycles so back-edges
// shouldn't appear; if one does (e.g. future IR change), the visited-set
// check below silently ignores it — same defensive shape used in
// extract_thread.py.
function bfsDepth(thread: Thread): DepthMap {
  const adj = new Map<string, string[]>();
  for (const e of thread.edges) {
    const arr = adj.get(e.from);
    if (arr) arr.push(e.to);
    else adj.set(e.from, [e.to]);
  }
  const depthOf = new Map<string, number>();
  const seedId = thread.seed.qualifiedName;
  const queue: string[] = [seedId];
  depthOf.set(seedId, 0);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const nexts = adj.get(cur);
    if (!nexts) continue;
    const nextDepth = depthOf.get(cur)! + 1;
    for (const next of nexts) {
      if (depthOf.has(next)) continue;
      depthOf.set(next, nextDepth);
      queue.push(next);
    }
  }
  // Any thread.nodes that the BFS didn't reach (orphans / disconnected)
  // get bucketed at maxDepth + 1 so they still render somewhere
  // predictable rather than at (0, 0).
  let maxDepth = 0;
  for (const d of depthOf.values()) if (d > maxDepth) maxDepth = d;
  const orphanDepth = maxDepth + 1;
  let hasOrphan = false;
  for (const n of thread.nodes) {
    if (!depthOf.has(n.id)) {
      depthOf.set(n.id, orphanDepth);
      hasOrphan = true;
    }
  }
  if (hasOrphan) maxDepth = orphanDepth;
  // Group by row. Iterate thread.nodes in extractor (DFS) order so
  // siblings within a row keep a stable left-to-right ordering.
  const rows = new Map<number, string[]>();
  for (const n of thread.nodes) {
    const d = depthOf.get(n.id)!;
    const arr = rows.get(d);
    if (arr) arr.push(n.id);
    else rows.set(d, [n.id]);
  }
  return { depthOf, rows, maxDepth };
}

export function useThreadLayout(
  thread: Thread | null,
  width: number,
  height: number,
  fileGroups?: FileGroups,
  projectIR?: Record<string, ProjectFileData> | null,
  iterations: number = DEFAULT_ITERATIONS,
  orientation: ThreadOrientation = "vertical",
): ThreadLayout {
  return useMemo(() => {
    const positions = new Map<string, LaidOutPosition>();
    if (!thread || thread.nodes.length === 0) {
      return { positions, width, height };
    }

    // M17.3-polish — vertical source-order layout. Each thread node's
    // y-position is its rank in a DFS pre-order traversal that visits
    // children sorted by their incoming-edge `irSource` line number.
    // This makes the vertical axis read as execution / source order:
    // setup statements above the try block, the try body in source
    // order inside, finally below try, etc. Cross-function calls
    // cascade below their call site (the called function's body
    // appears immediately under the call). Falls back to the legacy
    // d3-force BFS layout when projectIR isn't available (no way to
    // look up call-site lines without it).
    if (projectIR) {
      return sourceOrderLayout(thread, width, height, projectIR, orientation);
    }

    const rowHeight = readRowHeight();
    const { depthOf, rows } = bfsDepth(thread);

    // y per layer: pinned. x: spread evenly across the available width
    // per row, then relaxed by d3-force.
    const nodes: SimNode[] = thread.nodes.map((n) => {
      const depth = depthOf.get(n.id)!;
      const row = rows.get(depth)!;
      const indexInRow = row.indexOf(n.id);
      const count = row.length;
      // (i+1) / (count+1) gives an evenly-spread series in (0, 1)
      // exclusive of both edges, so the leftmost / rightmost cards
      // still get gutter space.
      const xFraction = (indexInRow + 1) / (count + 1);
      const x = xFraction * width;
      const y = Y_PADDING_TOP + depth * rowHeight;
      return { id: n.id, x, y, fy: y };
    });

    const links: SimulationLinkDatum<SimNode>[] = thread.edges.map((e) => ({
      source: e.from,
      target: e.to,
    }));

    // Run d3-force with no centring force and `fy` pinned per node — the
    // only degree of freedom is x. forceLink pulls connected siblings
    // horizontally toward their target; forceCollide stops labels
    // overlapping; forceManyBody gives a gentle repulsion so dense rows
    // spread.
    const sim = forceSimulation<SimNode>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
          .id((d) => d.id)
          .distance(LINK_DISTANCE),
      )
      .force("charge", forceManyBody().strength(CHARGE_STRENGTH))
      .force("collide", forceCollide(COLLIDE_RADIUS))
      .alphaDecay(0.05)
      .stop();

    for (let i = 0; i < iterations; i++) {
      sim.tick();
    }

    // Post-pass: enforce hard minimum spacing within each row. d3-force's
    // forceCollide is approximate when other forces are pulling; this
    // pass guarantees no two adjacent nodes in the same y-row end up
    // closer than ROW_MIN_SPACING_X. Sweep left→right per row, sliding
    // each node right if it's too close to its left neighbour, then
    // re-centre the whole row around its original centroid so the
    // spread doesn't drift toward the right edge.
    enforceRowSpacing(nodes, rows);

    // M9.3 — diagonal flow offset. Applied AFTER row-spacing so each
    // file-group is pushed (depth*8, depth*4) off the strict grid; the
    // eye sees same-file nodes drift together as a cluster, even when
    // the BFS row layout would otherwise interleave them. Terminals
    // (file=null) inherit their parent step's file in the renderer's
    // visual treatment but here they have no file so they don't shift.
    if (fileGroups) {
      const fileById = new Map<string, string | null>();
      for (const n of thread.nodes) fileById.set(n.id, n.file);
      for (const n of nodes) {
        const f = fileById.get(n.id);
        if (!f) continue;
        const depth = fileGroups.fileDepth.get(f);
        if (depth == null || depth === 0) continue;
        n.x = (n.x ?? width / 2) + depth * DEPTH_OFFSET_X;
        // fy is the pinned y; shift it directly rather than treating
        // it as immutable — we want the y-band to step too.
        (n as { fy: number }).fy = n.fy + depth * DEPTH_OFFSET_Y;
      }
    }

    for (const n of nodes) {
      positions.set(n.id, { x: n.x ?? width / 2, y: n.fy });
    }
    return { positions, width, height };
  }, [thread, width, height, iterations, fileGroups, projectIR, orientation]);
}

// ─────────────────────────────────────────── vertical source order ──
//
// M17.3-polish — DFS layout where the y-axis is execution order:
// each node lands one row below its preceding-by-source-line sibling
// (or below its parent, for the first child). Cross-function children
// cascade — once we enter a step's subtree, the step's body lays out
// fully before we return to the next sibling at the parent's level.
// Single horizontal column (centerX); branching out horizontally is
// reserved for if_then / if_else arm-pairs (M17.3+ / M18 work).

// Row height for the vertical layout. Sized to leave a clear gap
// between cards: typical thread node renders ~75px tall (8px paddingY
// + ~28px label + ~32px preview text + 8px paddingY); 110 gives a
// ~35px clean gap that's readable AND leaves room for the
// container's top padding + chip without bleeding into the node above.
const VERTICAL_ROW_HEIGHT = 110;
// M21 — step along the main axis when horizontal. Cards are wider than
// tall, so L-R needs a larger stride than the vertical row height to keep
// the same clean gap between consecutive cards.
const HORIZONTAL_COL_WIDTH = 300;
// M23 — cross-axis lane stride for the horizontal layout. Each DFS
// tree-depth level gets its own horizontal lane: ~75px card + container
// chip/padding clearance (18px top pad + chip overhang) + breathing room.
// 140 keeps nested-container chrome from grazing the lane above.
const HORIZONTAL_LANE_HEIGHT = 140;
// Left padding before the seed card in horizontal mode (mirrors
// Y_PADDING_TOP's role on the vertical main axis).
const X_PADDING_LEFT = 80;
// Top padding above lane 0 in horizontal mode — room for the seed
// container chip; fitView centres the result so this is chrome
// clearance, not composition.
const LANE_PADDING_TOP = 100;

function lineOfIrNode(
  irNodeId: string | null | undefined,
  hostFile: string | null,
  projectIR: Record<string, ProjectFileData>,
): number {
  // Lookup line for an IR node id in its containing file. Path-tolerant
  // for the absolute vs relative IR-key cases the colour picker handles
  // (rare but shows up when the runtime ingests files from outside the
  // project root). Returns 0 when the node can't be found — that means
  // "treat as top of file" for the source-order sort, which keeps the
  // seed at the top even when irSource is null.
  if (!irNodeId || !hostFile) return 0;
  let ir = projectIR[hostFile];
  if (!ir) {
    for (const [k, v] of Object.entries(projectIR)) {
      if (k === hostFile || k.endsWith(hostFile)) {
        ir = v;
        break;
      }
    }
  }
  if (!ir) return 0;
  const node = ir.nodes.find((m) => m.id === irNodeId);
  return node?.line ?? 0;
}

function sourceOrderLayout(
  thread: Thread,
  width: number,
  height: number,
  projectIR: Record<string, ProjectFileData>,
  orientation: ThreadOrientation,
): ThreadLayout {
  const positions = new Map<string, LaidOutPosition>();
  // Vertical (the norm): main axis = execution order (DFS source order),
  // cross axis = fixed centre — a single readable column.
  //
  // Horizontal (M23, replacing M21's shallow transpose): main axis = the
  // SAME DFS execution rank (every node keeps a unique column, so time
  // still reads left→right), but the cross axis is a LANE = the node's
  // depth in the DFS call tree. Each function body runs as a horizontal
  // band; descending into a callee drops one lane. Branches therefore
  // stack down the cross axis instead of collapsing onto one centre rail
  // (M21's failure mode: containers/branches flattened to a single row,
  // via-local edges weaving along it).
  const horizontal = orientation === "horizontal";
  const crossCenter = Math.max(width / 2, 320);
  const step = horizontal ? HORIZONTAL_COL_WIDTH : VERTICAL_ROW_HEIGHT;
  const place = (main: number, lane: number): LaidOutPosition =>
    horizontal
      ? { x: X_PADDING_LEFT + main, y: LANE_PADDING_TOP + lane * HORIZONTAL_LANE_HEIGHT }
      : { x: crossCenter, y: main };

  const fileById = new Map<string, string | null>();
  for (const n of thread.nodes) fileById.set(n.id, n.file);
  // M24 — container nodes never participate in the execution-order
  // DFS: their bounds derive from their children in ThreadView. Flow
  // joins (container→container) and fork arrows (→container) are
  // therefore excluded from the adjacency, like `contains` edges.
  const containerIds = new Set(
    thread.nodes.filter((n) => n.kind === "container").map((n) => n.id),
  );

  // Build adjacency keyed on `from`, with each edge stamped by the
  // call-site's source line (look up `irSource` in the FROM node's
  // file's IR). `contains` edges aren't part of execution order, so
  // they're excluded — the vertical nesting alone carries that signal.
  const adj = new Map<string, { to: string; line: number }[]>();
  for (const e of thread.edges) {
    if (e.kind === "contains" || e.kind === "flow") continue;
    if (containerIds.has(e.from) || containerIds.has(e.to)) continue;
    const fromFile = fileById.get(e.from) ?? null;
    const line = lineOfIrNode(e.irSource, fromFile, projectIR);
    const arr = adj.get(e.from);
    if (arr) arr.push({ to: e.to, line });
    else adj.set(e.from, [{ to: e.to, line }]);
  }
  // M-NEST L2d — a nested call shares its outer's source line, so a pure
  // line sort can't order them. Execution is children-first (the inner call
  // runs before the outer one wraps it), so break same-line ties by placing a
  // nested child immediately before its outer parent. This keeps each nest's
  // members adjacent, so the bordered nest box wraps them cleanly.
  const nestParentOf = deriveNests(thread.nodes).parentByChild;
  for (const arr of adj.values()) {
    arr.sort((a, b) => {
      if (a.line !== b.line) return a.line - b.line;
      if (nestParentOf.get(a.to) === b.to) return -1; // a nested in b → a first
      if (nestParentOf.get(b.to) === a.to) return 1;
      return 0;
    });
  }

  const visited = new Set<string>();

  if (horizontal) {
    // M23 — branch-stacked L-R, with a FLAT SPINE (M-NA6). Two rules:
    //   * a node with ONE call continues in the caller's lane — a
    //     linear chain reads as one horizontal rail (the "sentence"),
    //     instead of the pre-NA6 staircase where every hop dropped a
    //     lane AND advanced a column, drifting down-right unbounded;
    //   * a node with 2+ calls opens a body band one lane below —
    //     genuine branching still stacks on the cross axis (M23's
    //     point), and per-lane cursors keep sibling subtrees sharing
    //     main-axis range where the lanes allow.
    // Per-lane execution order holds either way (lane cursors are
    // monotonic and DFS visits a callee's body before the next
    // sibling), and edges always flow rightward: child main ≥ parent
    // main + step. Revisited nodes keep their first position (visited
    // check), same as the vertical pass.
    const laneCursor: number[] = [];
    const dfsH = (nodeId: string, lane: number, parentMain: number): void => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const main = Math.max(parentMain + HORIZONTAL_COL_WIDTH, laneCursor[lane] ?? 0);
      positions.set(nodeId, place(main, lane));
      laneCursor[lane] = main + HORIZONTAL_COL_WIDTH;
      const children = (adj.get(nodeId) ?? []).filter((c) => !visited.has(c.to));
      const childLane = children.length > 1 ? lane + 1 : lane;
      for (const { to } of children) {
        dfsH(to, childLane, main);
      }
    };
    dfsH(thread.seed.qualifiedName, 0, -HORIZONTAL_COL_WIDTH);
    // Orphans — lane 0, after everything placed there so far. M24 —
    // containers are skipped: they were never DFS-reachable (contains/
    // flow edges are excluded above) and their bounds come from their
    // children, so an orphan slot would just stretch the canvas.
    for (const n of thread.nodes) {
      if (!visited.has(n.id) && n.kind !== "container") {
        const main = laneCursor[0] ?? 0;
        positions.set(n.id, place(main, 0));
        laneCursor[0] = main + HORIZONTAL_COL_WIDTH;
      }
    }
    return { positions, width, height };
  }

  // Vertical — the historical single-column pass, untouched by M23.
  let cursor = Y_PADDING_TOP; // advances along the main axis

  function dfs(nodeId: string): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    positions.set(nodeId, place(cursor, 0));
    cursor += step;
    for (const { to } of adj.get(nodeId) ?? []) {
      dfs(to);
    }
  }

  dfs(thread.seed.qualifiedName);

  // Orphans — nodes the seed's DFS didn't reach (shouldn't happen in a
  // well-formed thread; defensive bucket so they still land somewhere
  // predictable rather than at (0, 0)). M24 — containers skipped, as in
  // the horizontal pass.
  for (const n of thread.nodes) {
    if (!visited.has(n.id) && n.kind !== "container") {
      positions.set(n.id, place(cursor, 0));
      cursor += step;
    }
  }

  return { positions, width, height };
}

// Per-row collision sweep. Each row's nodes are sorted by their post-
// d3-force x; we then walk left→right and slide any too-close node
// rightward to clear its neighbour. After the sweep we shift the whole
// row so its centroid matches the pre-sweep centroid (otherwise rows
// drift right when many nodes collide and the rightmost gets pushed).
function enforceRowSpacing(
  nodes: { id: string; x?: number }[],
  rows: Map<number, string[]>,
): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const ids of rows.values()) {
    if (ids.length < 2) continue;
    const rowNodes = ids
      .map((id) => byId.get(id)!)
      .filter((n) => n.x !== undefined) as { id: string; x: number }[];
    rowNodes.sort((a, b) => a.x - b.x);
    const preCentroid = rowNodes.reduce((s, n) => s + n.x, 0) / rowNodes.length;
    for (let i = 1; i < rowNodes.length; i++) {
      const prev = rowNodes[i - 1];
      const cur = rowNodes[i];
      const minX = prev.x + ROW_MIN_SPACING_X;
      if (cur.x < minX) cur.x = minX;
    }
    const postCentroid = rowNodes.reduce((s, n) => s + n.x, 0) / rowNodes.length;
    const shift = preCentroid - postCentroid;
    for (const n of rowNodes) n.x += shift;
  }
}
