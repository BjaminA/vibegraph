// Thread view — top-level container (M4b wave 3).
//
// Self-contained: takes a Thread JSON, owns its own ReactFlowProvider,
// renders the force-directed graph with custom thread nodes/edges.
// Diagram view stays on its own ReactFlow instance; the two never share
// state through React, only through the document-level vg-* event bus
// (wave 4 wiring).
//
// Ambiguity markers per PLAN.md S1.3:
//   - conditional edges -> dashed stroke (same dash density M3 uses for
//     reference edges, so the two readings rhyme).
//   - external / dynamic / return nodes carry their own iconography
//     (see ThreadNode.tsx).

import React, { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { MoveVertical, MoveHorizontal, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MarkerType,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { VgMiniMap, threadNodeColor } from "../Minimap";
import { belowChipStrip } from "../ChipStrip";

import { ThreadNode } from "./ThreadNode";
import { ThreadContainerNode, TARGET_PORTS } from "./ThreadContainerNode";
import { ThreadEdge, type ThreadEdgeData } from "./ThreadEdge";
import { ThreadNodeTooltip, type AnchorRect } from "./ThreadNodeTooltip";
import { useThreadLayout, type ThreadOrientation } from "./useThreadLayout";
import { deriveNests, collapseNests, nestFlowEdges } from "./collapse";
import { planRunToNode } from "./runToNode";
import { bridge } from "../types";
import { accentForThreadNode } from "./colour_for_node";
import { iconForNode } from "./icon_for_node";
import { resolveEdgeLabel } from "./edge_args";
import { computeFileGroups } from "./depthCues";
import {
  ExternalEffectsPanel,
  PANEL_W_EXPANDED,
  PANEL_W_COLLAPSED,
  type EditContext,
} from "./ExternalEffectsPanel";
import type { Thread, ThreadNode as ThreadNodeData } from "./types";
import type { ProjectFileData, EntryPoint, AstNode } from "../../shared/protocol";

// M17.3 — `threadContainer` is the bordered-region renderer for
// try/except/finally/while ancestors of call sites. ThreadView computes
// its position + size from the descendants' layout positions and feeds
// them through this custom node type. ThreadNode handles every other
// kind (seed / step / external / dynamic / return).
const nodeTypes = { threadNode: ThreadNode, threadContainer: ThreadContainerNode };
// U2: register the custom bezier-with-glow edge. The default react-flow
// straight-line + inline-stroke pattern is replaced; visual treatment
// (glow, tier-by-frequency, dashed cross-file, pulse, dim-non-focus)
// lives in motion.css keyed off the class names ThreadEdge emits.
const edgeTypes = { threadEdge: ThreadEdge };

// Read CSS tokens at module load -- same pattern as layout/edges.ts.
function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v.length > 0 ? v : fallback;
}

// U5 helpers — both look up information for a thread node at render
// time, kept narrow so ThreadView.tsx doesn't grow another dependency
// on the IR shape than necessary.

function lookupIrNode(
  n: { irNodeId: string | null; file: string | null },
  projectIR: Record<string, ProjectFileData> | null,
): AstNode | null {
  if (!n.irNodeId || !n.file || !projectIR) return null;
  const ir = projectIR[n.file];
  if (ir) {
    const found = ir.nodes.find((m) => m.id === n.irNodeId);
    if (found) return found;
  }
  // Fall through across keys for the rare "absolute vs relative" path
  // mismatch (kept for compat with older callers — same shape as the
  // colour picker's lookup).
  for (const [k, v] of Object.entries(projectIR)) {
    if (k === n.file || k.endsWith(n.file)) {
      const found = v.nodes.find((m) => m.id === n.irNodeId);
      if (found) return found;
    }
  }
  return null;
}

function findRouteMetadata(
  n: { irNodeId: string | null; file: string | null },
  entryPoints: EntryPoint[] | null,
): { method: string; path: string | null } | null {
  if (!entryPoints || !n.irNodeId) return null;
  const ep = entryPoints.find(
    (e) => e.irNodeId === n.irNodeId &&
      (!n.file || e.file === n.file || e.file.endsWith(n.file)),
  );
  if (!ep || ep.kind !== "route") return null;
  const md = (ep.metadata ?? {}) as { method?: string | string[]; route?: string };
  const method = Array.isArray(md.method) ? md.method[0] : md.method;
  if (!method) return null;
  return { method, path: md.route ?? null };
}

// Tier-by-call-frequency: terminal targets read thin, shared callees
// read thick, default reads medium. Single pass over thread.edges.
function buildEdgeTier(
  nodeByIdMap: Map<string, ThreadNodeData>,
  inDegreeMap: Map<string, number>,
  toNodeId: string,
): ThreadEdgeData["tier"] {
  const tgt = nodeByIdMap.get(toNodeId);
  const isTerminal = tgt && (tgt.kind === "external" || tgt.kind === "dynamic" || tgt.kind === "return");
  if (isTerminal) return "thin";
  const incoming = inDegreeMap.get(toNodeId) ?? 0;
  if (incoming > 1) return "thick";
  return "medium";
}

interface InnerProps {
  thread: Thread;
  width: number;
  height: number;
  projectIR: Record<string, ProjectFileData> | null;
  entryPoints: EntryPoint[] | null;
  orientation: ThreadOrientation;
  // M27-era fix (user report): with the editor docked, the canvas is a
  // narrow strip and the floating minimap reads as a big dark rectangle
  // sitting ON TOP of thread nodes. Hide it while the editor is open —
  // its keep-the-shape-in-view value is gone at strip width anyway.
  hideMiniMap: boolean;
  // M-NEST L2 — nest expand state (collapsed by default). `expandAll` is the
  // global toggle; `expandedNests` is the per-outer-node open set.
  expandAll: boolean;
  expandedNests: Set<string>;
}

function ThreadCanvas({ thread: rawThread, width, height, projectIR, entryPoints, orientation, hideMiniMap, expandAll, expandedNests }: InnerProps) {
  // M17.3 — control-flow containers (try/except/finally/while) render as
  // bordered regions positioned around their descendants. Layout runs on
  // the regular nodes only; containers are sized post-layout from the
  // bounding box of their descendant positions. Contains-edges are
  // dropped from the rendered edge set — the visual nesting IS the
  // relationship; an explicit edge from container→child would double-
  // count the structural signal already carried by the bordered region.
  // M-NEST L2 — nest parentage, derived view-side from IR-id structure (no
  // extractor change). Drives the collapse projection + the outer-node badge.
  const nests = useMemo(() => deriveNests(rawThread.nodes), [rawThread.nodes]);
  const isNestExpanded = useCallback(
    (outerId: string) => expandAll || expandedNests.has(outerId),
    [expandAll, expandedNests],
  );

  const thread = useMemo<Thread>(() => {
    // Annotate the outer nodes so the badge survives collapse, then collapse
    // unexpanded nests. Containers are dropped from the layout set (sized
    // separately) and contains-edges dropped (the bordered region IS the
    // relationship); inner→outer flow edges are added for visible nests.
    const annotated: Thread = {
      ...rawThread,
      nodes: rawThread.nodes.map((n) => {
        const hasNested = nests.childrenByParent.has(n.id);
        const nestedParent = nests.parentByChild.get(n.id);
        return hasNested || nestedParent ? { ...n, hasNested, nestedParent } : n;
      }),
    };
    const collapsed = collapseNests(annotated, nests, isNestExpanded);
    const layoutNodes = collapsed.nodes.filter((n) => n.kind !== "container");
    return {
      ...collapsed,
      nodes: layoutNodes,
      edges: [
        ...collapsed.edges.filter((e) => e.kind !== "contains"),
        ...nestFlowEdges(layoutNodes, nests),
      ],
    };
  }, [rawThread, nests, isNestExpanded]);

  // Container subset + contains-edge map; used after layout to compute
  // bounding-box react-flow nodes. Built once per rawThread.
  const containerNodes = useMemo<ThreadNodeData[]>(
    () => rawThread.nodes.filter((n) => n.kind === "container"),
    [rawThread],
  );
  const containsChildren = useMemo<Map<string, string[]>>(() => {
    const m = new Map<string, string[]>();
    for (const e of rawThread.edges) {
      if (e.kind !== "contains") continue;
      const list = m.get(e.from) ?? [];
      list.push(e.to);
      m.set(e.from, list);
    }
    return m;
  }, [rawThread]);

  // M17.3-polish — staggered enter delay per node, keyed on containment
  // depth. A node sitting inside one container fades in 50ms after that
  // container; a node two containers deep, 100ms after; and so on — so
  // the structure (boxes) reads a beat before its contents. Containment
  // is a tree (each contained id has exactly one parent container), so a
  // simple walk-up suffices. Fed to the CSS keyframe via --vg-enter-delay
  // (see .vg-thread-enter in motion.css).
  const ENTER_STAGGER_MS = 50;
  const enterDelayById = useMemo<Map<string, number>>(() => {
    const parentOf = new Map<string, string>();
    for (const [parent, children] of containsChildren) {
      for (const c of children) parentOf.set(c, parent);
    }
    const depthOf = (id: string): number => {
      let depth = 0;
      let cur = id;
      const guard = new Set<string>();
      while (parentOf.has(cur) && !guard.has(cur)) {
        guard.add(cur);
        cur = parentOf.get(cur)!;
        depth += 1;
      }
      return depth;
    };
    const m = new Map<string, number>();
    for (const n of rawThread.nodes) m.set(n.id, depthOf(n.id) * ENTER_STAGGER_MS);
    return m;
  }, [rawThread.nodes, containsChildren]);

  // M9.3 — compute per-file depth + hue once per thread, before layout
  // so useThreadLayout can apply the diagonal flow offset.
  const fileGroups = useMemo(() => computeFileGroups(thread), [thread]);
  // M17.3-polish — projectIR is consulted by useThreadLayout for the
  // vertical source-order pass (call-site line lookups). When absent
  // the hook falls back to the legacy d3-force BFS layout.
  const layout = useThreadLayout(thread, width, height, fileGroups, projectIR, undefined, orientation);
  const rf = useReactFlow();

  const nodes = useMemo<Node[]>(() => {
    const seedFile = thread.seed.file;
    return thread.nodes.map((n) => {
      const pos = layout.positions.get(n.id) ?? { x: 0, y: 0 };
      // M9.3 — per-node file hue + depth. Terminals (file=null) get
      // neither — they're library boundaries, not file groups.
      const fileHueIndex = n.file != null ? fileGroups.fileHueIndex.get(n.file) ?? null : null;
      const fileDepth = n.file != null ? fileGroups.fileDepth.get(n.file) ?? null : null;
      // U3.2 — pick the accent at the boundary so ThreadNode stays a
      // dumb renderer. Falls back gracefully if projectIR / entryPoints
      // haven't loaded yet (returns the legacy thread-kind defaults).
      const { accentVar, kindLabel } = accentForThreadNode(n, projectIR, entryPoints);

      // U5 — pick the lucide icon to match the accent family. Async
      // function_defs get a Zap overlay.
      const ir = lookupIrNode(n, projectIR);
      const { Icon, overlayIcon } = iconForNode(kindLabel, ir, n.kind);

      // U5 — cross-file halo: thread node's file differs from the
      // thread's seed file. Terminals (file=null) are NEVER cross-file
      // — they're library boundaries, not project file boundaries.
      const isCrossFile = !!(n.file && seedFile && n.file !== seedFile);

      // U5 — HTTP route decoration. If this node IS an entry point
      // with kind=route, pull method + path from the envelope's
      // metadata bag (populated by discover_entry_points.py).
      const route = findRouteMetadata(n, entryPoints);

      return {
        id: n.id,
        type: "threadNode",
        position: pos,
        // M-NA7 — the thread flow is UNCONTROLLED, so user nodes never
        // carry `measured` dimensions and xyflow's minimap wrapper bailed
        // on every node (nodeHasDimensions === false): the thread minimap
        // was rendering ZERO node dots — the "near-blank grey box" was
        // literally just the mask. initialWidth/Height give the minimap
        // (and any other user-node consumer) approximate dims; the real
        // canvas cards still size themselves from content.
        initialWidth: 200,
        initialHeight: 64,
        // M17.3-polish — staggered fade-in. Class + delay var consumed by
        // .vg-thread-enter in motion.css; delay = containment depth * 50ms.
        className: "vg-thread-enter",
        style: { ["--vg-enter-delay" as string]: `${enterDelayById.get(n.id) ?? 0}ms` },
        data: {
          kind: n.kind,
          label: n.label,
          file: n.file,
          preview: n.preview,
          // U3.1 — surface the IR node id so ThreadNode can include it in
          // hover/click events; the tooltip uses it to fetch source via
          // the existing edit-node-open WS flow.
          irNodeId: n.irNodeId,
          // M12.2 — surface IR type ("call" / "function_def" / ...) so
          // ThreadNode includes it in vg-add-component-drop payloads.
          irType: ir?.type ?? null,
          // U3.2 — pre-computed accent var + scan-friendly category label.
          accentVar,
          kindLabel,
          // U5 — visual decorations.
          Icon,
          overlayIcon,
          isCrossFile,
          routeMethod: route?.method ?? null,
          routePath: route?.path ?? null,
          // M9.3 — depth cues. fileHueIndex drives the per-file wash;
          // fileDepth is surfaced as data-* for tests/inspector and is
          // already baked into pos by useThreadLayout.
          fileHueIndex,
          fileDepth,
          // M17.1 — via-local external terminals carry the resolved
          // dotted-qualified path the external-call resolver can import.
          qualifiedTarget: n.qualifiedTarget,
          viaLocal: n.viaLocal,
          // R4 + §5.5a — dotted dynamic terminals carry where/how their
          // receiver was bound, for the honest tooltip line.
          receiverBoundFrom: n.receiverBoundFrom,
          receiverBoundKind: n.receiverBoundKind,
          // M23 — handles flip to Left/Right in horizontal mode so
          // edges flow along the main axis instead of looping
          // bottom→top between horizontally-adjacent cards.
          orientation,
          // M-NEST L2 — this node nests extracted inner calls → render the
          // expand/collapse badge; nestExpanded drives the glyph + a11y label.
          hasNested: n.hasNested ?? false,
          nestExpanded: n.hasNested ? isNestExpanded(n.id) : false,
          // M-NEST L2g — detected-but-not-extracted (chain/comprehension/
          // literal): the uncaptured-nests honesty badge.
          nestsInnerCalls: n.nestsInnerCalls ?? false,
          nestExtracted: n.nestExtracted ?? false,
        },
        draggable: true,
      };
    });
  }, [thread, layout, projectIR, entryPoints, fileGroups, enterDelayById, orientation, isNestExpanded]);

  // M17.3 — react-flow nodes for each control-flow container. Position
  // + size are derived from the bounding box of the container's leaf
  // (non-container) descendants, gathered transitively through the
  // contains-edge graph. Approximate child dimensions are used since
  // react-flow doesn't report measured sizes until after first render;
  // refinement to measured sizes is a second-pass useEffect that's out
  // of M17.3 MVP scope. Containers come FIRST in the rendered nodes
  // array so they stack behind the regular thread nodes.
  const containerReactFlowNodes = useMemo<Node[]>(() => {
    // M17.3-polish — single-column vertical layout: containers hug the
    // node width horizontally, span their children's y range vertically.
    // APPROX_NODE_H matches the typical thread card (~75px including
    // padding + label + preview). PAD_TOP carries the chip (top:-10 in
    // the chip CSS, so 18 keeps the chip clear of the previous row's
    // card by ~17px when VERTICAL_ROW_HEIGHT=110 is in effect upstream
    // in useThreadLayout).
    const APPROX_NODE_W = 200;
    const APPROX_NODE_H = 75;
    const PAD_X = 16;
    const PAD_TOP = 18;
    const PAD_BOTTOM = 10;
    // M-NA6 — an outer container must VISIBLY wrap a nested one (elif:
    // `else { if … }`). Bounds used to derive from leaf nodes only, so
    // an arm whose sole content is a nested container produced a
    // byte-identical box stacked exactly on the inner one. Union child
    // CONTAINER boxes (bottom-up), inset by a nesting margin.
    const NEST_MARGIN = 10;
    // The TOP inset also has to clear the parent's chip. Every container
    // chip straddles its own top border (chip CSS: top -10) and stands
    // ~21px tall (11px Inter at 1.35, 2px padding, 1px border), so a 10px
    // inset ran the outer label straight through the inner one — measured
    // 480px² of overlap between `FOR epoch in range(epochs)` and its
    // nested `IF shuffle` on a training thread. A chip row plus a small
    // gap makes nested labels stack in a legible staircase instead.
    const NEST_MARGIN_TOP = 26;

    const containerIds = new Set(containerNodes.map((c) => c.id));
    type Box = { minX: number; minY: number; maxX: number; maxY: number };
    const boxById = new Map<string, Box | null>();
    function boxOf(id: string, stack: Set<string>): Box | null {
      if (boxById.has(id)) return boxById.get(id) ?? null;
      if (stack.has(id)) return null; // defensive: contains cycles
      stack.add(id);
      const boxes: Box[] = [];
      for (const childId of containsChildren.get(id) ?? []) {
        if (containerIds.has(childId)) {
          const inner = boxOf(childId, stack);
          if (inner) {
            boxes.push({
              minX: inner.minX - NEST_MARGIN,
              minY: inner.minY - NEST_MARGIN_TOP,
              maxX: inner.maxX + NEST_MARGIN,
              maxY: inner.maxY + NEST_MARGIN,
            });
          }
        } else {
          const p = layout.positions.get(childId);
          if (p) boxes.push({ minX: p.x, minY: p.y, maxX: p.x + APPROX_NODE_W, maxY: p.y + APPROX_NODE_H });
        }
      }
      const box = boxes.length === 0 ? null : {
        minX: Math.min(...boxes.map((b) => b.minX)),
        minY: Math.min(...boxes.map((b) => b.minY)),
        maxX: Math.max(...boxes.map((b) => b.maxX)),
        maxY: Math.max(...boxes.map((b) => b.maxY)),
      };
      boxById.set(id, box);
      return box;
    }

    return containerNodes.flatMap<Node>((c) => {
      const box = boxOf(c.id, new Set<string>());
      if (!box) return [];
      const minX = box.minX - PAD_X;
      const minY = box.minY - PAD_TOP;
      const maxX = box.maxX + PAD_X;
      const maxY = box.maxY + PAD_BOTTOM;
      const { accentVar, kindLabel } = accentForThreadNode(c, projectIR, entryPoints);
      return [{
        id: c.id,
        type: "threadContainer",
        position: { x: minX, y: minY },
        // M17.3-polish — staggered fade-in (container appears before its
        // contents). --vg-enter-delay is read by .vg-thread-enter > *.
        className: "vg-thread-enter",
        style: {
          width: maxX - minX,
          height: maxY - minY,
          zIndex: -1,
          ["--vg-enter-delay" as string]: `${enterDelayById.get(c.id) ?? 0}ms`,
        },
        data: {
          containerKind: c.containerKind,
          label: c.label,
          accentVar,
          kindLabel,
          // M24 — flow/fork edges anchor on container handles, which
          // follow the layout's main axis.
          orientation,
        },
        selectable: false,
        draggable: false,
      } satisfies Node];
    });
  }, [containerNodes, containsChildren, layout.positions, projectIR, entryPoints, enterDelayById, orientation]);

  // M-NEST L2d — bordered backdrop around each EXPANDED nest (outer step + its
  // revealed inner calls), reusing the same bounding-box pass + ThreadContainer
  // renderer as control-flow containers. Teal (Family-1) so a nest reads as the
  // structural region it is. Built post-layout from the members' positions;
  // collapsed nests contribute nothing (their children aren't laid out).
  const nestContainerNodes = useMemo<Node[]>(() => {
    const APPROX_NODE_W = 200;
    const APPROX_NODE_H = 75;
    const PAD_X = 14;
    const PAD_TOP = 20;
    const PAD_BOTTOM = 12;
    // Transitive visible members of a nest (outer + revealed inner calls, any
    // depth). Deeper nests also get their own (nested) box — like try/finally.
    const membersOf = (outerId: string, seen: Set<string>): string[] => {
      if (seen.has(outerId)) return [];
      seen.add(outerId);
      const out = [outerId];
      for (const child of nests.childrenByParent.get(outerId) ?? []) {
        if (layout.positions.has(child)) out.push(...membersOf(child, seen));
      }
      return out;
    };
    const out: Node[] = [];
    for (const outerId of nests.childrenByParent.keys()) {
      if (!isNestExpanded(outerId) || !layout.positions.has(outerId)) continue;
      const members = membersOf(outerId, new Set<string>());
      if (members.length < 2) continue; // nothing revealed → no box
      const ps = members
        .map((id) => layout.positions.get(id))
        .filter((p): p is { x: number; y: number } => !!p);
      const minX = Math.min(...ps.map((p) => p.x)) - PAD_X;
      const minY = Math.min(...ps.map((p) => p.y)) - PAD_TOP;
      const maxX = Math.max(...ps.map((p) => p.x + APPROX_NODE_W)) + PAD_X;
      const maxY = Math.max(...ps.map((p) => p.y + APPROX_NODE_H)) + PAD_BOTTOM;
      out.push({
        id: `nest-container:${outerId}`,
        type: "threadContainer",
        position: { x: minX, y: minY },
        className: "vg-thread-enter",
        style: {
          width: maxX - minX,
          height: maxY - minY,
          zIndex: -1,
        },
        data: {
          containerKind: "nest",
          label: "nest",
          accentVar: "--accent-thread",
          orientation,
        },
        selectable: false,
        draggable: false,
      } satisfies Node);
    }
    return out;
  }, [nests, isNestExpanded, layout.positions, orientation]);

  // Bug #3 in the post-M7 cleanup pass: when a user opened a thread the
  // viewport sometimes settled on whatever the previous fitView captured
  // before the ResizeObserver-driven layout finished, so the user had
  // to manually pan / zoom. Re-fit imperatively whenever the seed
  // changes — that's the "new thread opened" boundary.
  // M23 — also re-fit on orientation toggle: the L-R layout has a very
  // different extent (long main axis, stacked lanes) and the old
  // viewport left it overflowing off-screen.
  // Legibility floor (2026-07-04 review): fitting a LONG thread into the
  // viewport can settle the zoom around 0.3-0.45 — every label unreadable,
  // the "default view reads in one second" rule broken at first paint. A
  // thread reads like a sentence: when the full fit would be illegible,
  // open at the SEED at a readable zoom instead and let pan / minimap /
  // the Controls fit button carry the tail. Threads that fit legibly keep
  // the full fit.
  useEffect(() => {
    if (!rf || !rf.fitView) return;
    const LEGIBLE_FIT_ZOOM = 0.6; // below this, labels are noise
    const LEGIBLE_START_ZOOM = 0.78;
    const fitLegibly = () => {
      // The flow is uncontrolled (nodes ride in as props), so getNodes()
      // returns the raw prop objects with no dimensions — measurements
      // live on the INTERNAL nodes.
      const measured = rf
        .getNodes()
        .map((n) => rf.getInternalNode(n.id))
        .filter((n): n is NonNullable<typeof n> => !!n?.measured?.width && !n.hidden);
      if (measured.length === 0) {
        rf.fitView({ padding: 0.2, duration: 300 });
        return;
      }
      const bounds = getNodesBounds(measured);
      const full = getViewportForBounds(bounds, width, height, 0.1, 1, 0.2);
      if (full.zoom >= LEGIBLE_FIT_ZOOM) {
        rf.fitView({ padding: 0.2, duration: 300 });
        return;
      }
      const zoom = LEGIBLE_START_ZOOM;
      // Anchor the main-axis START of the flow at the viewport edge and
      // frame the THREAD BOUNDS on the cross axis. (This used to centre
      // the SEED's lane — but the seed is always the first lane, so half
      // the canvas sat empty above it while the lower lanes clipped
      // below the fold; full-scope review 2026-07 P1.) Centre the bounds
      // when they fit at this zoom, else anchor their start at the pad —
      // the seed's lane is the first, so it stays in view either way.
      const PAD = 48;
      if (orientation === "horizontal") {
        const extent = bounds.height * zoom;
        const y = extent <= height - PAD * 2
          ? (height - extent) / 2 - bounds.y * zoom
          : PAD - bounds.y * zoom;
        rf.setViewport({ x: PAD - bounds.x * zoom, y, zoom }, { duration: 300 });
      } else {
        const extent = bounds.width * zoom;
        const x = extent <= width - PAD * 2
          ? (width - extent) / 2 - bounds.x * zoom
          : PAD - bounds.x * zoom;
        rf.setViewport({ x, y: PAD - bounds.y * zoom, zoom }, { duration: 300 });
      }
    };
    const quick = window.setTimeout(fitLegibly, 60);
    // The canvas div animates `right` over var(--motion-view-dur)
    // (280ms) when a dock opens/closes, so the quick fit can capture a
    // mid-transition width and leave the thread's tail clipped under
    // the editor (probed: fit scale matched a ~890px canvas when the
    // settled width was 616px). Second pass after the transition.
    const settled = window.setTimeout(fitLegibly, 380);
    return () => { window.clearTimeout(quick); window.clearTimeout(settled); };
    // thread.nodes is read only for the (stable) seed id — deliberately
    // NOT a dep: same-thread node additions are owned by the added-nodes
    // fit below, never a whole-thread re-fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rf, thread.seed.qualifiedName, width, height, orientation]);

  // M10R follow-up — when the SAME thread gains nodes (a save re-extracts
  // it, M18.3), bring the additions into view. A whole-thread re-fit is
  // the wrong gesture here: with the editor panel open the visible strip
  // can be too narrow for a wide L-R thread even at minZoom, so fitting
  // everything spills both ends off-screen. Fit the ADDED nodes instead —
  // the viewport travels to exactly what the edit changed, which is the
  // feedback the save needs ("nothing happened" report). Pure re-derives
  // (same ids, fresh array identity per project-update) are skipped, as
  // is the new-thread boundary (the seed-keyed whole-fit above owns it).
  const prevIdsRef = useRef<{ seed: string; ids: Set<string> } | null>(null);
  // M-NA7 (latent race, exposed by timing shifts): the fit used to be
  // scheduled with the effect's own cleanup clearing it — but a save
  // triggers TWO thread.nodes identity changes in quick succession
  // (thread-update, then the follow-on project-update rebuild), so the
  // second, added-empty run cancelled the pending fit and the new node
  // stayed off-viewport. Pending fit lives in a ref; an added-empty
  // re-run leaves it alone, and only unmount clears it.
  const pendingGrowthFit = useRef<number | null>(null);
  useEffect(() => {
    const seed = thread.seed.qualifiedName;
    const ids = new Set(thread.nodes.map((n) => n.id));
    const prev = prevIdsRef.current;
    prevIdsRef.current = { seed, ids };
    if (!rf || !rf.fitView) return;
    if (!prev || prev.seed !== seed) return; // new thread — whole-fit owns it
    const added = [...ids].filter((id) => !prev.ids.has(id));
    if (added.length === 0) return;
    if (pendingGrowthFit.current !== null) window.clearTimeout(pendingGrowthFit.current);
    pendingGrowthFit.current = window.setTimeout(() => {
      pendingGrowthFit.current = null;
      rf.fitView({ nodes: added.map((id) => ({ id })), padding: 0.4, duration: 300, maxZoom: 1 });
    }, 60);
  }, [rf, thread.nodes, thread.seed.qualifiedName]);
  useEffect(() => () => {
    if (pendingGrowthFit.current !== null) window.clearTimeout(pendingGrowthFit.current);
  }, []);

  // §5.6 — representative centre of each container, from its leaf
  // descendants' layout positions (containers hold no layout slot of
  // their own). Lets the edge port-assignment order converging edges by
  // their SOURCE position when the source is itself a container
  // (try/except → finally). Mirrors containerReactFlowNodes' leaf walk.
  const containerCenters = useMemo<Map<string, { x: number; y: number }>>(() => {
    const ids = new Set(containerNodes.map((c) => c.id));
    const leaves = (id: string, seen: Set<string>): string[] => {
      if (seen.has(id)) return [];
      seen.add(id);
      const out: string[] = [];
      for (const child of containsChildren.get(id) ?? []) {
        if (ids.has(child)) out.push(...leaves(child, seen));
        else out.push(child);
      }
      return out;
    };
    const m = new Map<string, { x: number; y: number }>();
    for (const c of containerNodes) {
      const pts = leaves(c.id, new Set<string>())
        .map((id) => layout.positions.get(id))
        .filter((p): p is { x: number; y: number } => !!p);
      if (!pts.length) continue;
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      m.set(c.id, {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      });
    }
    return m;
  }, [containerNodes, containsChildren, layout.positions]);

  const edges = useMemo<Edge[]>(() => {
    // Pre-compute the per-render lookups the ThreadEdge data shape
    // needs: node-by-id (for cross-file detection), incoming-degree
    // (for the thick tier). Both are O(thread.edges) — cheap. Built from
    // rawThread (NOT the container-filtered `thread`) so an edge whose
    // endpoint is a container — try→except, except→finally — can read
    // its target's containerKind (§5.6a error tint).
    const nodeById = new Map<string, ThreadNodeData>(rawThread.nodes.map((n) => [n.id, n]));
    const inDegree = new Map<string, number>();
    for (const e of thread.edges) {
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    }
    const arrowColour = readVar("--accent-thread", "hsl(168 60% 56%)");
    // §5.6a — the error path into an except band gets a red arrowhead to
    // match its red stroke (the only red edge in the thread).
    const errorColour = readVar("--accent-error", "hsl(358 65% 58%)");

    // §5.6 — spread converging container edges across the entry ports so
    // they don't collapse onto a single anchor and cross. Group edges
    // landing ON a container, sort each group by SOURCE cross-axis, and
    // assign a monotonic port (sources ordered top→bottom map to ports
    // ordered top→bottom = no crossing). Edge index → "t{slot}".
    const horizontal = orientation === "horizontal";
    // A node's position: leaf nodes have a layout slot; container sources
    // (try/except) don't, so fall back to their leaf-derived centre.
    const posOf = (id: string) => layout.positions.get(id) ?? containerCenters.get(id);
    const crossAxis = (id: string) => {
      const p = posOf(id);
      if (!p) return Number.POSITIVE_INFINITY; // unplaced → stable last
      return horizontal ? p.y : p.x;
    };
    const mainAxis = (id: string) => {
      const p = posOf(id);
      if (!p) return Number.POSITIVE_INFINITY;
      return horizontal ? p.x : p.y;
    };
    const incomingByContainer = new Map<string, number[]>();
    thread.edges.forEach((e, i) => {
      if (nodeById.get(e.to)?.kind !== "container") return;
      const arr = incomingByContainer.get(e.to);
      if (arr) arr.push(i);
      else incomingByContainer.set(e.to, [i]);
    });
    const targetHandleByEdge = new Map<number, string>();
    for (const idxs of incomingByContainer.values()) {
      idxs.sort((a, b) => {
        const ea = thread.edges[a], eb = thread.edges[b];
        const ca = crossAxis(ea.from), cb = crossAxis(eb.from);
        if (ca !== cb) return ca - cb;
        const ma = mainAxis(ea.from), mb = mainAxis(eb.from);
        if (ma !== mb) return ma - mb;
        return ea.from < eb.from ? -1 : ea.from > eb.from ? 1 : 0;
      });
      const k = idxs.length;
      idxs.forEach((edgeIdx, sortedPos) => {
        // k=1 → round(0.5*(N-1)) = centre port (coordinate-identical to
        // the pre-§5.6 single handle). k>1 → symmetric interior spread.
        const slot = Math.round(((sortedPos + 1) / (k + 1)) * (TARGET_PORTS - 1));
        targetHandleByEdge.set(edgeIdx, `t${slot}`);
      });
    }

    const built = thread.edges.map((e, i) => {
      const src = nodeById.get(e.from);
      const tgt = nodeById.get(e.to);
      // Cross-file iff both endpoints have a known file and they differ.
      // Terminals (external/dynamic) have file=null and shouldn't be
      // tagged cross-file — that'd false-flag every library boundary.
      const crossFile = !!(src?.file && tgt?.file && src.file !== tgt.file);
      // M9.3 — crossDepth = both endpoints have known files and their
      // file-depths differ. Implies crossFile (same-file edges share
      // a depth by definition). sameFileHueIndex tints the edge with
      // its file's wash when both endpoints share a file.
      const srcDepth = src?.file ? fileGroups.fileDepth.get(src.file) : undefined;
      const tgtDepth = tgt?.file ? fileGroups.fileDepth.get(tgt.file) : undefined;
      const crossDepth = crossFile && srcDepth !== undefined && tgtDepth !== undefined
        && srcDepth !== tgtDepth;
      const sameFileHueIndex = !crossFile && src?.file
        ? fileGroups.fileHueIndex.get(src.file) ?? null
        : null;
      // U3.3 — resolve the args label up-front so ThreadEdge stays
      // a dumb renderer. Returns null when neither call args nor the
      // target's function params resolve to anything. M24 — an explicit
      // semantic label on the edge ("always" on flow joins) takes
      // precedence over args resolution.
      const lbl = e.label
        ? { text: e.label, fullText: e.label, source: "flow" as const }
        : resolveEdgeLabel(e, thread, projectIR);
      const data: ThreadEdgeData = {
        kind: e.kind,
        irSource: e.irSource,
        crossFile,
        crossDepth,
        sameFileHueIndex,
        tier: buildEdgeTier(nodeById, inDegree, e.to),
        label: lbl?.text ?? null,
        labelFull: lbl?.fullText ?? null,
        labelSource: lbl?.source ?? null,
        // §5.6a — distinct treatments keyed on the TARGET: a return reads
        // as a curved function-exit terminal; an edge landing on an except
        // band is the error path (only red in the thread).
        toReturn: tgt?.kind === "return",
        toExcept: tgt?.kind === "container" && tgt?.containerKind === "except",
      };
      // react-flow's Edge.data is typed Record<string,unknown>; the
      // ThreadEdge component casts back. Cast at the boundary so the
      // edge type carries through.
      return {
        id: `te${i}-${e.from}-${e.to}`,
        source: e.from,
        target: e.to,
        // §5.6 — container targets resolve to a spread port; node targets
        // keep their single default handle (no id).
        ...(targetHandleByEdge.has(i) ? { targetHandle: targetHandleByEdge.get(i) } : {}),
        type: "threadEdge",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: data.toExcept ? errorColour : arrowColour,
          width: 14, height: 14,
        },
        data: data as unknown as Record<string, unknown>,
      } satisfies Edge;
    });
    // M-FS3 (full-scope review P2) — labelled edges fanning out of ONE
    // source all placed their label at the bezier midpoint, so a seed
    // with three arg-previews rendered them overprinted into a garbled
    // strip. Stagger sibling labels along their paths: spread t across
    // [0.35, 0.65] in target-order, midpoint kept for solo labels.
    const labelledBySource = new Map<string, number[]>();
    built.forEach((e, i) => {
      const d = e.data as unknown as ThreadEdgeData;
      if (d.label) {
        const group = labelledBySource.get(e.source) ?? [];
        group.push(i);
        labelledBySource.set(e.source, group);
      }
    });
    for (const idxs of labelledBySource.values()) {
      if (idxs.length < 2) continue;
      idxs.forEach((edgeIdx, pos) => {
        (built[edgeIdx].data as unknown as ThreadEdgeData).labelT =
          0.35 + (0.3 * pos) / (idxs.length - 1);
      });
    }
    return built;
    // §5.6 — layout.positions + orientation + container centres drive the
    // port assignment, so slots recompute on relayout / orientation toggle.
  }, [rawThread.nodes, thread, projectIR, fileGroups, layout.positions, orientation, containerCenters]);

  // M5 wave 3 — clicking a step / return node funnels through the
  // vg-selection bus so the diagram & code view stay in sync.
  // External terminals (library/dynamic) have no irNodeId; skip them.
  const handleNodeClick = (_: React.MouseEvent, node: { id: string }) => {
    const original = thread.nodes.find((n) => n.id === node.id);
    if (!original || !original.irNodeId || !original.file) return;
    document.dispatchEvent(new CustomEvent("vg-selection", {
      detail: {
        filePath: original.file,
        irNodeId: original.irNodeId,
        source: "thread",
      },
    }));
  };

  // M-NA7 — continuous inverse-zoom scale for the LOD labels
  // (ThreadNode/ThreadContainerNode size text via
  // calc(base * var(--vg-inv-zoom))). Written straight to the DOM on
  // every viewport move — no React state, no per-frame re-render. The
  // TIER switches ride quantized useStore selectors in the node
  // components themselves.
  const lodWrapRef = useRef<HTMLDivElement | null>(null);
  const setInvZoom = (zoom: number) => {
    lodWrapRef.current?.style.setProperty("--vg-inv-zoom", (1 / Math.max(zoom, 0.01)).toFixed(4));
  };
  useEffect(() => { setInvZoom(rf.getViewport().zoom); });

  return (
    <div ref={lodWrapRef} style={{ width: "100%", height: "100%" }}>
    <ReactFlow
      // M17.3 — containers go first so they stack behind regular nodes
      // (react-flow renders later-array entries on top). Combined here at
      // the boundary rather than in a third memo: both inputs are
      // already memoised, and the spread is cheap.
      nodes={[...containerReactFlowNodes, ...nestContainerNodes, ...nodes]}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      // M17.3-polish — bump fitView padding so containers don't graze
      // the ExternalEffectsPanel boundary. 0.3 = 30% gutter on each
      // side, which gives the bordered regions clear space from the
      // right-side panel chrome.
      fitViewOptions={{ padding: 0.3 }}
      // M23 — react-flow's default minZoom (0.5) clamps fitView on the
      // L-R layout: a long thread needs ~0.3 to fit its main axis, so
      // the fit silently stopped at 0.5 and the thread overflowed both
      // viewport edges. 0.1 lets fitView actually fit; users can still
      // zoom back in.
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
      // Don't let react-flow grab Space for pan-on-drag — it
      // preventDefault's the spacebar at the window level, which broke
      // typing in the floating Monaco editor. Drag-pan + scroll remain.
      panActivationKeyCode={null}
      style={{ background: "var(--bg-canvas)" }}
      nodesDraggable={true}
      nodesConnectable={false}
      elementsSelectable={true}
      onNodeClick={handleNodeClick}
      onMove={(_, viewport) => setInvZoom(viewport.zoom)}
    >
      <Background color="var(--border-edge)" gap={24} size={1} />
      <Controls style={{ background: "var(--bg-node)", borderColor: "var(--border-edge)" }} />
      {/* Minimap with viewport indicator. Sits bottom-right (the default).
          Threads with > ~10 nodes spill outside fitView's frame after the
          user pans/zooms; the minimap keeps the full shape in view so
          scrolling stops losing spatial context. (Bug #3, M7 cleanup.)
          Hidden while the editor is docked — see InnerProps.hideMiniMap.
          M-NA7 — wide + shallow dims match the L-R thread aspect (the
          default 200×150 squeezed a long thread into a grey smear). */}
      {!hideMiniMap && <VgMiniMap nodeColor={threadNodeColor} width={260} height={110} />}
    </ReactFlow>
    </div>
  );
}

export interface ThreadViewProps {
  thread: Thread;
  // U3.2 — accent picker needs IR (effectKind, funcName) + entryPoints
  // (route/cli/test affiliation). Both passed in as null-safe optionals
  // so the existing single-file fixtures (which don't ship envelopes)
  // still render with the legacy thread-kind defaults.
  projectIR?: Record<string, ProjectFileData> | null;
  entryPoints?: EntryPoint[] | null;
  // M18.1 — when the node editor panel is open it is the detail surface;
  // the hover/pin tooltip would only fight it (and overlay it, since the
  // tooltip sits at z 1100). Suppress tooltips while editing.
  editorOpen?: boolean;
  // W2 — the CodeView dock is also a right-edge detail surface; a pinned
  // tooltip would overlap it. Suppress/dismiss tooltips while it's open
  // too (same unmount precedent as editorOpen).
  codeOpen?: boolean;
}

// U3.1 — hover/pin tooltip state.
//
// Hover: 150ms delay before opening, so darting across the canvas
// doesn't flash a tooltip for every node the cursor crosses. Once
// open, hover-leave starts a 200ms close timer that's cancelled if
// the cursor enters the tooltip itself (so the user can mouse into
// the Monaco editor / Ask-Claude input without it vanishing).
//
// Pin: a click pins the tooltip; pinned tooltips ignore hover-leave
// entirely. Esc dismisses. Clicking another node moves the pin to
// the new node — same UX as Linear's context menus.
interface TooltipState {
  nodeId: string;
  irNodeId: string | null;
  file: string | null;
  kind: string;
  label: string;
  preview?: string | null;
  anchor: AnchorRect;
  pinned: boolean;
  // M17.1 — via-local terminals: passed through to the tooltip so
  // resolve-external-call uses the importable qualifiedTarget instead
  // of the raw `local.method` label.
  qualifiedTarget?: string;
  viaLocal?: string;
  // R4 + §5.5a — dynamic terminals on a runtime-bound local receiver.
  receiverBoundFrom?: string;
  receiverBoundKind?: "local-call" | "param" | "loop";
}

interface HoverEventDetail {
  nodeId: string;
  irNodeId: string | null;
  file: string | null;
  kind: string;
  label: string;
  preview?: string | null;
  anchor: AnchorRect | null;
  qualifiedTarget?: string;
  viaLocal?: string;
  receiverBoundFrom?: string;
  receiverBoundKind?: "local-call" | "param" | "loop";
}

const HOVER_OPEN_DELAY = 150;
const HOVER_CLOSE_DELAY = 200;

export function ThreadView({ thread, projectIR, entryPoints, editorOpen, codeOpen }: ThreadViewProps) {
  // W2 — either right-edge detail dock suppresses/dismisses the tooltip.
  const detailDockOpen = !!editorOpen || !!codeOpen;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 1200,
    height: 800,
  });
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  // M9.4 — effects panel: open by default; toggle via header + `E`.
  // Persisted preference would be nice but the M9.4 plan doesn't ask
  // for it; defer until a second concrete need appears.
  const [panelOpen, setPanelOpen] = useState<boolean>(true);

  // M21 — thread orientation toggle (PLAN-v5 §3), persisted to
  // localStorage like the side-panel's Threads|Files preference.
  // M23.4 — horizontal (branch-stacked L-R) is the DEFAULT since the
  // proper L-R landed; vertical remains one click away and sticky.
  // 2026-08-04 — the toggle is unmounted while the vertical layout gets its
  // styling pass, so this is PINNED horizontal rather than read from storage:
  // anyone whose localStorage still says "vertical" would otherwise open into
  // the unstyled view with no control to leave it. The stored key is left
  // untouched, so remounting the toggle restores each user's preference.
  const [orientation, setOrientation] = useState<ThreadOrientation>("horizontal");
  const toggleOrientation = () => {
    setOrientation((o) => {
      const next: ThreadOrientation = o === "vertical" ? "horizontal" : "vertical";
      try { localStorage.setItem("vg-thread-orientation", next); } catch { /* ignore */ }
      return next;
    });
  };

  // M-NEST L2 — nest expand state. Nests are COLLAPSED by default (clutter +
  // honesty: the outer node carries a badge). Two persisted controls mirroring
  // the orientation pattern: a global "expand all" scalar and a per-outer-node
  // open set (the first keyed-by-id localStorage map in the thread view).
  const [expandAllNests, setExpandAllNests] = useState<boolean>(() => {
    try { return localStorage.getItem("vg-thread-nests-expand-all") === "1"; } catch { return false; }
  });
  const [expandedNests, setExpandedNests] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("vg-thread-nests-expanded") || "[]")); }
    catch { return new Set(); }
  });
  const toggleExpandAllNests = () => {
    setExpandAllNests((v) => {
      const next = !v;
      try { localStorage.setItem("vg-thread-nests-expand-all", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };
  const toggleNest = useCallback((outerId: string) => {
    setExpandedNests((prev) => {
      const next = new Set(prev);
      if (next.has(outerId)) next.delete(outerId); else next.add(outerId);
      try { localStorage.setItem("vg-thread-nests-expanded", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);
  // Badge clicks dispatch vg-toggle-nest (same decoupled pattern as the
  // existing vg-expand-node affordance) — ThreadNode stays a dumb renderer.
  useEffect(() => {
    const onToggle = (e: Event) => {
      const id = (e as CustomEvent<{ nodeId: string }>).detail?.nodeId;
      if (id) toggleNest(id);
    };
    window.addEventListener("vg-toggle-nest", onToggle as EventListener);
    return () => window.removeEventListener("vg-toggle-nest", onToggle as EventListener);
  }, [toggleNest]);

  // M-RUN SM1 — a node tooltip asked to run the path to it. ThreadView owns the
  // thread + projectIR, so it computes the plan/pre-gate (planRunToNode). A
  // runnable plan goes to the server; an honest decline is surfaced locally as a
  // thread-run-result (no server round-trip), so the affordance always answers.
  useEffect(() => {
    const onRun = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        nodeId: string; irNodeId: string | null; file: string | null;
        synthArgs?: Record<string, string>; effectConsent?: string;
        // Sitting-2 — echo of a gate's trust token: grants the session-wide
        // "stop asking about unverifiable calls" before gating re-applies.
        trustUnverified?: string;
        // M-RUN2.1 — confirmed example-instance constructor args (method runs).
        synthInstanceArgs?: Record<string, string>;
        // M-RUN2.3 — a consented example data file (content-hash-bound token).
        synthData?: { path: string; content: string; consent?: string };
      };
      if (!d?.nodeId) return;
      // Auto-pin the tooltip for the node being run, so the result (or a
      // confirm gate) persists instead of vanishing on pointer-leave — a
      // run is a deliberate action, not a transient hover. (Clicking the
      // node itself opens the editor by design, so pinning rides the run.)
      setTooltip((t) => (t && t.nodeId === d.nodeId && !t.pinned ? { ...t, pinned: true } : t));
      const plan = planRunToNode({ nodeId: d.nodeId, irNodeId: d.irNodeId, file: d.file }, projectIR ?? null, thread);
      if (plan.runnable) {
        // SM2/SM3 routing. An arg-needing node goes through synth-thread-args
        // first (propose args / side-effect consent); it only RUNS once the
        // event carries synthArgs. effectConsent (from the SM3 side-effect
        // confirm) rides through on either path. A no-arg node runs directly
        // (SM1), or carries effectConsent on the confirmed effectful re-run.
        const consent = {
          ...(d.effectConsent ? { effectConsent: d.effectConsent } : {}),
          ...(d.trustUnverified ? { trustUnverified: d.trustUnverified } : {}),
        };
        if (plan.needsSynth && !d.synthArgs) {
          bridge.postMessage({ type: "synth-thread-args", payload: {
            nodeId: d.nodeId, irTargetId: plan.irTargetId, filePath: plan.filePath, entryFn: plan.entryFn, exprN: plan.exprN, ...consent,
          } });
        } else {
          bridge.postMessage({ type: "run-thread-to-node", payload: {
            nodeId: d.nodeId, irTargetId: plan.irTargetId, filePath: plan.filePath, entryFn: plan.entryFn, exprN: plan.exprN,
            ...(d.synthArgs ? { synthArgs: d.synthArgs } : {}),
            ...(d.synthInstanceArgs ? { synthInstanceArgs: d.synthInstanceArgs } : {}),
            ...(d.synthData ? { synthData: d.synthData } : {}),
            ...consent,
          } });
        }
      } else {
        document.dispatchEvent(new CustomEvent("vg-thread-run-result", { detail: {
          nodeId: d.nodeId, outcome: plan.outcome, value: null, valueOpaque: false,
          provenance: "real-input", stdout: "", stderr: "", error: plan.reason,
        } }));
      }
    };
    // M-RUN2.3 — tooltip asked Claude to draft a missing example data file:
    // resolve the run plan (for irTargetId — the reader's IR node) and post
    // the synth request; the proposal comes back as thread-data-proposal.
    const onDataDraft = (e: Event) => {
      const d = (e as CustomEvent).detail as { nodeId: string; irNodeId: string | null; file: string | null; path: string };
      if (!d?.nodeId || !d.path) return;
      const plan = planRunToNode({ nodeId: d.nodeId, irNodeId: d.irNodeId, file: d.file }, projectIR ?? null, thread);
      if (!plan.runnable) return;
      bridge.postMessage({ type: "synth-thread-data", payload: {
        nodeId: d.nodeId, irTargetId: plan.irTargetId, filePath: plan.filePath, path: d.path,
      } });
    };
    document.addEventListener("vg-run-thread-to-node", onRun);
    document.addEventListener("vg-synth-thread-data", onDataDraft);
    return () => {
      document.removeEventListener("vg-run-thread-to-node", onRun);
      document.removeEventListener("vg-synth-thread-data", onDataDraft);
    };
  }, [thread, projectIR]);

  // Whether the open thread has any extracted nest (drives the global toggle's
  // visibility — no point showing "expand all" on a thread with no nests).
  const threadHasNests = useMemo(
    () => deriveNests(thread.nodes).childrenByParent.size > 0,
    [thread],
  );

  // Open / close timers — refs so re-renders don't blow them away mid-
  // delay. clearOpen aborts a pending open if the cursor leaves before
  // 150ms; clearClose aborts the 200ms close if the cursor re-enters
  // the node or moves into the tooltip body.
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const clearOpen = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };
  const clearClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  // Track container size so the force layout knows where to centre.
  // ResizeObserver is enough -- we don't need rAF here. Panel width
  // is subtracted from the canvas width so d3-force lays out into
  // the visible region, not under the panel.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({ width: rect.width, height: rect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // M10R follow-up — the App-level editor panel OVERLAYS this view (the
  // container itself never shrinks), so fitView used to "fit" nodes
  // underneath it: a post-save thread re-extract drew its new node off
  // the visible canvas and the save read as "nothing happened". Inset
  // the canvas by the editor panel's measured width — same pattern as
  // the effects-panel inset below — so the canvas physically shrinks,
  // canvasW changes, and the existing width-keyed re-fit fires on
  // editor open/close for free. ResizeObserver tracks dock changes
  // (solo 44% ↔ co-open 33%) while the panel stays open.
  // M-NA7 — the CodeView dock tiles the same right edge (33–44% wide)
  // but was never measured, so the canvas kept drawing under it and the
  // visible strip degraded to a dead sliver when Code + Edit co-docked.
  // Measure BOTH right-edge docks (they tile side by side — widths sum).
  const [editorInsetW, setEditorInsetW] = useState(0);
  useEffect(() => {
    if (!editorOpen && !codeOpen) { setEditorInsetW(0); return; }
    const els = [
      document.querySelector("[data-node-editor-panel]"),
      document.querySelector('[data-code-view]:not([data-fullscreen="true"])'),
    ].filter((el): el is Element => !!el);
    if (els.length === 0) { setEditorInsetW(0); return; }
    const update = () =>
      setEditorInsetW(els.reduce((sum, el) => sum + Math.ceil(el.getBoundingClientRect().width), 0));
    update();
    const ro = new ResizeObserver(update);
    for (const el of els) ro.observe(el);
    return () => ro.disconnect();
  }, [editorOpen, codeOpen]);

  // M27-era fix (user report): the effects panel is positioned at
  // right:0 — when the editor dock opens it sits BEHIND the editor,
  // invisible, yet its width was still reserved out of the canvas: a
  // dead black strip adjacent to the editor exactly where thread nodes
  // had been. While the editor is open, the editor is the only right-
  // side surface — reserve its width alone and unmount the covered
  // panel (its open/closed preference survives in state).
  // M-NA7 — CodeView covers the effects panel exactly like the editor
  // does (both sit at the right edge above it), so any detail dock
  // supersedes the effects-panel reservation.
  const panelW = (detailDockOpen ? 0 : (panelOpen ? PANEL_W_EXPANDED : PANEL_W_COLLAPSED)) + editorInsetW;
  const canvasW = Math.max(200, size.width - panelW);
  // M-NA7 — below this the canvas is a dead sliver (nodes can't paint
  // meaningfully); collapse to a breadcrumb instead (NEXT-ACTIONS §4).
  const BREADCRUMB_BELOW = 280;
  const slivered = size.width > 0 && size.width - panelW < BREADCRUMB_BELOW;

  // Wire the node-level hover / click events ThreadNode emits.
  useEffect(() => {
    // M-RUN3 — affordance honesty: the tooltip only OFFERS run-to-here when
    // the node can structurally produce a value (assignment / return / call
    // in a function). planRunToNode is pure and cheap; server gates (effects,
    // synth) still happen on click as before.
    const structurallyRunnable = (d: HoverEventDetail): boolean =>
      planRunToNode({ nodeId: d.nodeId, irNodeId: d.irNodeId, file: d.file }, projectIR ?? null, thread).runnable;
    const onHover = (e: Event) => {
      if (detailDockOpen) return; // editor/CodeView is the detail surface; no tooltip
      const d = (e as CustomEvent<HoverEventDetail>).detail;
      if (!d.anchor) return;
      // If pinned, hover doesn't override — the pin owns the tooltip.
      if (tooltip?.pinned) return;
      clearClose();
      clearOpen();
      openTimer.current = window.setTimeout(() => {
        setTooltip({
          nodeId: d.nodeId,
          irNodeId: d.irNodeId,
          file: d.file,
          kind: d.kind,
          label: d.label,
          preview: d.preview,
          qualifiedTarget: d.qualifiedTarget,
          viaLocal: d.viaLocal,
          receiverBoundFrom: d.receiverBoundFrom,
          receiverBoundKind: d.receiverBoundKind,
          runnable: structurallyRunnable(d),
          anchor: d.anchor!,
          pinned: false,
        });
      }, HOVER_OPEN_DELAY);
    };
    const onLeave = (_e: Event) => {
      if (tooltip?.pinned) return;
      clearOpen();
      clearClose();
      closeTimer.current = window.setTimeout(() => {
        setTooltip(null);
      }, HOVER_CLOSE_DELAY);
    };
    const onClick = (e: Event) => {
      if (detailDockOpen) return; // editor/CodeView is the detail surface; no tooltip
      const d = (e as CustomEvent<HoverEventDetail>).detail;
      if (!d.anchor) return;
      clearOpen();
      clearClose();
      setTooltip({
        nodeId: d.nodeId,
        irNodeId: d.irNodeId,
        file: d.file,
        kind: d.kind,
        label: d.label,
        preview: d.preview,
        qualifiedTarget: d.qualifiedTarget,
        viaLocal: d.viaLocal,
        receiverBoundFrom: d.receiverBoundFrom,
        receiverBoundKind: d.receiverBoundKind,
        runnable: structurallyRunnable(d),
        anchor: d.anchor,
        pinned: true,
      });
    };
    document.addEventListener("vg-thread-node-hover", onHover);
    document.addEventListener("vg-thread-node-leave", onLeave);
    document.addEventListener("vg-thread-node-click", onClick);
    return () => {
      document.removeEventListener("vg-thread-node-hover", onHover);
      document.removeEventListener("vg-thread-node-leave", onLeave);
      document.removeEventListener("vg-thread-node-click", onClick);
      clearOpen();
      clearClose();
    };
  }, [tooltip?.pinned, detailDockOpen, projectIR, thread]);

  // M18.1 / W2 — when a detail dock (editor OR CodeView) opens, dismiss any
  // tooltip already showing. The node click that opens it pins a tooltip a
  // render before the flag propagates here; this clears that first-click
  // pin so it never lingers over the panel.
  useEffect(() => {
    if (detailDockOpen) setTooltip(null);
  }, [detailDockOpen]);

  // M26.2 — never strand a stale tooltip. The chat/MCP edit path
  // re-derives the displayed thread (App's M18.3 effect swaps in the
  // fresh copy from each envelope); re-look-up the open tooltip's node
  // in the fresh thread and update it in place. An unresolved/dynamic
  // terminal's id CHANGES when re-linking resolves it
  // (unresolved:vg_audit → db:vg_audit), so those fall back to matching
  // the resolved step by label — that's the "function the chat just
  // created" upgrading to the editor without re-hovering. Node gone
  // from the fresh thread → close rather than show dead state.
  useEffect(() => {
    setTooltip((tip) => {
      if (!tip) return tip;
      const exact = thread.nodes.find((n) => n.id === tip.nodeId);
      const next = exact ?? (
        tip.kind === "unresolved" || tip.kind === "dynamic"
          ? thread.nodes.find((n) =>
              (n.kind === "step" || n.kind === "seed") &&
              (n.label === tip.label || n.label === tip.label.split(".").pop()))
          : undefined);
      if (!next) return null;
      if (next.kind === tip.kind && next.irNodeId === tip.irNodeId && next.id === tip.nodeId) {
        return tip; // nothing changed for this node — keep state identity
      }
      return {
        ...tip,
        nodeId: next.id,
        irNodeId: next.irNodeId,
        file: next.file,
        kind: next.kind,
        label: next.label,
        qualifiedTarget: next.qualifiedTarget,
        viaLocal: next.viaLocal,
        receiverBoundFrom: next.receiverBoundFrom,
        receiverBoundKind: next.receiverBoundKind,
      };
    });
    // Re-anchor once the re-layout + fit-to-added travel (≤ 60ms lead +
    // 300ms duration) settle: the upgraded node usually moved. Keep the
    // old anchor if the DOM node isn't measurable (e.g. mid-exit).
    const t = window.setTimeout(() => {
      setTooltip((tip) => {
        if (!tip) return tip;
        const el = containerRef.current?.querySelector(
          `.react-flow__node[data-id="${CSS.escape(tip.nodeId)}"] .vg-thread-node`);
        const r = el?.getBoundingClientRect();
        if (!r || r.width === 0) return tip;
        return { ...tip, anchor: { left: r.left, top: r.top, width: r.width, height: r.height } };
      });
    }, 500);
    return () => window.clearTimeout(t);
  }, [thread]);

  // M9.4 — `E` toggles the effects panel. Suppressed when an input
  // / textarea / Monaco editor has focus so typing `e` inside the
  // Ask-Claude box doesn't collapse the panel mid-prompt.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "e" && e.key !== "E") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target as Element | null;
      if (!tgt) return;
      const tag = tgt.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if ((tgt as HTMLElement).isContentEditable) return;
      // Monaco editor catches keypresses inside its DOM tree.
      if (tgt.closest?.(".monaco-editor")) return;
      setPanelOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // M9.4 — edit context derivation. The tooltip is the "inline Monaco
  // overlay" referenced in PLAN-v2.md §2.3; when it pins itself open
  // on an editable node, the panel swaps from the effects list to a
  // full-file Monaco scrolled to the node's structural span. The
  // span comes from the projectIR here so the panel doesn't race the
  // file-source WS round-trip.
  const editContext = useMemo<EditContext | null>(() => {
    if (!tooltip?.pinned || !tooltip.irNodeId || !tooltip.file || !projectIR) return null;
    const file = tooltip.file;
    // Re-use the same path-tolerant lookup ThreadView uses for nodes.
    let ir: ProjectFileData | undefined = projectIR[file];
    if (!ir) {
      for (const [k, v] of Object.entries(projectIR)) {
        if (k === file || k.endsWith(file)) { ir = v; break; }
      }
    }
    const node = ir?.nodes.find((n) => n.id === tooltip.irNodeId);
    const span = node && node.line != null && node.endLine != null
      ? { line: node.line, endLine: node.endLine }
      : null;
    return {
      nodeId: tooltip.nodeId,
      irNodeId: tooltip.irNodeId,
      file: tooltip.file,
      span,
    };
  }, [tooltip?.pinned, tooltip?.nodeId, tooltip?.irNodeId, tooltip?.file, projectIR]);

  // Outside-click closes the tooltip (unless pinned — pinned closes via
  // X / Esc / pin-toggle only).
  useEffect(() => {
    if (!tooltip) return;
    const onDocClick = (e: MouseEvent) => {
      if (!tooltip.pinned) return;
      const target = e.target as Element | null;
      if (!target) return;
      // Click inside the tooltip — stay open.
      if ((target.closest as any)?.("[data-thread-tooltip]")) return;
      // Click inside a thread node — handled by the click handler.
      if ((target.closest as any)?.(".vg-thread-node")) return;
      setTooltip(null);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [tooltip]);

  return (
    <div
      ref={containerRef}
      data-thread-view
      data-seed-id={thread.seed.qualifiedName}
      // Orientation stays observable here now that the toggle (which used to
      // carry `data-orientation`) is unmounted — the layout invariant is a
      // property of the VIEW, not of the control that happened to set it.
      data-thread-orientation={orientation}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: panelW,
          bottom: 0,
          transition: "right var(--motion-view-dur) var(--motion-view-ease)",
        }}
      >
        {slivered ? (
          // M-NA7 — dead-sliver collapse: with Code + Edit (+ chat)
          // docked at narrow widths the remaining strip can't paint a
          // thread; a breadcrumb keeps the context honest instead of a
          // smear of clipped cards.
          <div
            data-thread-breadcrumb
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              justifyContent: "center",
              gap: 8,
              padding: "0 16px",
              background: "var(--bg-canvas)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fsm-12)",
              color: "var(--text-primary)",
              overflow: "hidden",
            }}
          >
            <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
              {thread.seed.qualifiedName}
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-11)", fontFamily: "var(--font-ui)" }}>
              {thread.nodes.filter((n) => n.kind !== "container").length} nodes — close a panel to see the thread
            </div>
          </div>
        ) : (
        <ReactFlowProvider>
          <ThreadCanvas
            thread={thread}
            width={canvasW}
            height={size.height}
            projectIR={projectIR ?? null}
            entryPoints={entryPoints ?? null}
            orientation={orientation}
            hideMiniMap={detailDockOpen}
            expandAll={expandAllNests}
            expandedNests={expandedNests}
          />
        </ReactFlowProvider>
        )}
      </div>
      {/* M21 orientation toggle — UNMOUNTED 2026-08-04. The vertical (T–B)
          layout it switched to is not styled correctly yet, and a toggle that
          lands the user in a broken view is worse than no toggle. Park, don't
          delete (see vibegraph-milestone-discipline): the `orientation` state,
          `toggleOrientation`, and every orientation-aware branch in the layout
          / node / container / edge code stay live and exercised by the
          horizontal path — remounting is one JSX block, not a rebuild.
          `orientation` is pinned to "horizontal" above so a stale
          localStorage "vertical" can't strand anyone in the unstyled view. */}

      {/* M-NEST L2 — global expand-all-nests toggle. Now the FIRST canvas-chrome
          row under the chip strip (it moved up when the orientation toggle was
          unmounted); shown only when the thread actually has nests. */}
      {threadHasNests && (
        <button
          data-thread-nests-toggle
          data-expanded={expandAllNests ? "true" : "false"}
          onClick={toggleExpandAllNests}
          title={expandAllNests ? "Collapse all nested calls" : "Expand all nested calls"}
          style={{
            position: "absolute",
            top: belowChipStrip(0),
            left: 12,
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "color-mix(in oklab, var(--bg-node) 90%, transparent)",
            border: "1px solid var(--border-edge)",
            borderRadius: 8,
            padding: "5px 10px",
            color: expandAllNests ? "var(--accent-thread)" : "var(--text-secondary)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-11)",
            cursor: "pointer",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          {expandAllNests
            ? <ChevronsDownUp size={14} strokeWidth={1.5} />
            : <ChevronsUpDown size={14} strokeWidth={1.5} />}
          nests
        </button>
      )}

      {!editorOpen && (
        <ExternalEffectsPanel
          thread={thread}
          projectIR={projectIR ?? null}
          open={panelOpen}
          onToggle={() => setPanelOpen((v) => !v)}
          editContext={editContext}
        />
      )}
      {tooltip && (
        <ThreadNodeTooltip
          {...tooltip}
          onPin={() => setTooltip((t) => t ? { ...t, pinned: !t.pinned } : t)}
          onClose={() => setTooltip(null)}
          onTooltipEnter={clearClose}
          onTooltipLeave={() => {
            if (tooltip.pinned) return;
            clearClose();
            closeTimer.current = window.setTimeout(() => setTooltip(null), HOVER_CLOSE_DELAY);
          }}
        />
      )}
    </div>
  );
}
