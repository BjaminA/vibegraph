// System view — thread-interaction mode (cross-thread calls).
//
// A pure derivation, the thread-graph analogue of buildSystemLayout: the
// envelope's threads[] + entryPoints[] -> a thread-to-thread graph where a
// DIRECTED edge means "thread A reaches thread B's entry-point head" — i.e.
// thread A invokes the function that is itself the start of thread B (e.g. a
// `route` thread calls `db.insert`, which is a `public_api` entry point with
// its own thread).
//
// Everything here is derivable from data the webview already holds; no IR /
// schema change. Deterministic (no d3-force) so the layout is test-stable and
// reads L-R like the rest of the system view.

import { Position, MarkerType, type Node, type Edge } from "@xyflow/react";
import type { EntryPoint, ProjectThread } from "../types";
import type { CrossingIndexRecord, CrossingRecord } from "../../shared/protocol";
import type { ThreadNode } from "../threads";
import { entryLabelSuffixes } from "../../shared/entry_labels.ts";

export interface ThreadGraphNode {
  entryPointId: string;
  label: string;
  kind: EntryPoint["kind"];
  file: string;
}

export interface ThreadCallEdge {
  from: string; // caller thread's entryPointId
  to: string; // callee thread's entryPointId (whose head the caller reaches)
  count: number; // distinct call sites in the caller that reach `to`'s head
}

/** M-XLANG.3 - a thread-to-thread hop ACROSS the language boundary: an
 *  HTTP call in one language whose path is served by a route in another.
 *  Drawn apart from a `tcall` on purpose. A tcall is a call this project
 *  can follow; a crossing is a claim it can only weigh, and an ambiguous
 *  one draws to every candidate rather than picking one. */
export interface ThreadCrossingEdge {
  from: string;
  to: string;
  method: string | null;
  path: string;
  confidence: CrossingRecord["confidence"];
}

export interface ThreadGraph {
  nodes: ThreadGraphNode[];
  edges: ThreadCallEdge[];
  /** M-XLANG.3 - cross-language hops, empty when no index was passed. */
  crossings: ThreadCrossingEdge[];
}

/** M-FLOW.4 — one thread's cross-thread adjacency: the same-language calls
 *  AND the hops (HTTP, command, tool). The contract's "reaches / reached by"
 *  line read `edges` alone, so a page running a backend script through the
 *  platform reached "(none)" while its own crossing named the script — and
 *  the script's contract could not say who runs it. The reverse trace is
 *  this function read from `to`. */
export function threadAdjacency(graph: ThreadGraph, entryPointId: string): { reaches: string[]; reachedBy: string[] } {
  const reaches = new Set<string>();
  const reachedBy = new Set<string>();
  for (const e of graph.edges) {
    if (e.from === entryPointId) reaches.add(e.to);
    if (e.to === entryPointId) reachedBy.add(e.from);
  }
  for (const c of graph.crossings) {
    if (c.from === entryPointId) reaches.add(c.to);
    if (c.to === entryPointId) reachedBy.add(c.from);
  }
  return { reaches: [...reaches].sort(), reachedBy: [...reachedBy].sort() };
}

// file::irNodeId — node IDs are module-relative ("module/foo.fn") and collide
// across files, so the head lookup MUST be keyed on file + irNodeId.
function headKey(file: string, irNodeId: string): string {
  return `${file}::${irNodeId}`;
}

/**
 * Derive the cross-thread call graph: one node per thread that has a resolved
 * entry point, one directed edge per (caller, callee-head) pair.
 */
export function deriveThreadCalls(
  threads: ProjectThread[],
  entryPoints: EntryPoint[],
  crossings?: CrossingIndexRecord | null,
): ThreadGraph {
  const epById = new Map(entryPoints.map((e) => [e.id, e]));
  // Every entry point's head function, keyed by where it lives.
  const head = new Map<string, string>();
  for (const e of entryPoints) head.set(headKey(e.file, e.irNodeId), e.id);

  const nodes: ThreadGraphNode[] = [];
  for (const t of threads) {
    if (!t.entryPointId) continue; // manual/seed-less threads have no head identity
    const ep = epById.get(t.entryPointId);
    if (!ep) continue;
    nodes.push({ entryPointId: ep.id, label: ep.label, kind: ep.kind, file: ep.file });
  }

  // count distinct (from -> to) call-site hits.
  const counts = new Map<string, number>();
  for (const t of threads) {
    const from = t.entryPointId;
    if (!from) continue;
    for (const n of t.nodes as ThreadNode[]) {
      // Only function-entry nodes carry a (file, irNodeId) we can match to a
      // head; the thread's own seed maps back to `from` and is filtered out.
      if (n.kind !== "step" && n.kind !== "seed") continue;
      if (!n.file || !n.irNodeId) continue;
      const to = head.get(headKey(n.file, n.irNodeId));
      if (!to || to === from) continue;
      const key = `${from}|${to}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const edges: ThreadCallEdge[] = [...counts.entries()].map(([key, count]) => {
    const [from, to] = key.split("|");
    return { from, to, count };
  });

  // M-XLANG.3 - the cross-language hops. One edge per (caller thread,
  // candidate route): an AMBIGUOUS crossing draws to every candidate,
  // because drawing one would be the claim the join refused to make.
  const crossingEdges: ThreadCrossingEdge[] = [];
  for (const c of crossings?.all ?? []) {
    for (const t of c.targets) {
      if (c.entryPointId === t.entryPointId) continue;
      crossingEdges.push({
        from: c.entryPointId, to: t.entryPointId,
        method: c.method, path: c.path, confidence: c.confidence,
      });
    }
  }

  return { nodes, edges, crossings: crossingEdges };
}

// L-R layered spacing — mirrors buildSystemLayout's COL/ROW idiom.
const COL_GAP = 320;
const ROW_GAP = 110;
const THREAD_ACCENT = "var(--accent-thread)";
// M-XLANG.3 - a crossing is a different KIND of claim from a call, so it
// gets its own hue as well as its own dash (confidence is visible, the
// PLAN-v5 aesthetic rule the `calls` edges already follow).
const CROSSING_ACCENT = "var(--accent-config)";

/**
 * Build react-flow nodes + edges for the thread-interaction graph. Layering is
 * a longest-path relaxation capped at node-count iterations, so it is
 * cycle-safe and deterministic: callers (no incoming call) sit left, callees
 * step rightward.
 */
export function buildThreadInteractionLayout(
  threads: ProjectThread[],
  entryPoints: EntryPoint[],
  crossings?: CrossingIndexRecord | null,
): { nodes: Node[]; edges: Edge[] } {
  const g = deriveThreadCalls(threads, entryPoints, crossings);
  const nodeIds = new Set(g.nodes.map((n) => n.entryPointId));
  // Keep only edges whose both endpoints are real nodes (defensive).
  const callEdges = g.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  const crossEdges = g.crossings.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  // Longest-path layering, capped to bound cycles. Roots stay at layer 0.
  const layer = new Map<string, number>();
  for (const n of g.nodes) layer.set(n.entryPointId, 0);
  const cap = g.nodes.length;
  for (let iter = 0; iter < cap; iter++) {
    let changed = false;
    for (const e of [...callEdges, ...crossEdges]) {
      const next = (layer.get(e.from) ?? 0) + 1;
      if (next > (layer.get(e.to) ?? 0) && next <= cap) {
        layer.set(e.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const rowInLayer: Record<number, number> = {};
  const suffixes = entryLabelSuffixes(g.nodes.map((n) => ({ id: n.entryPointId, label: n.label, file: n.file })));
  const nodes: Node[] = g.nodes.map((gn) => {
    const l = layer.get(gn.entryPointId) ?? 0;
    const row = rowInLayer[l] ?? 0;
    rowInLayer[l] = row + 1;
    return {
      id: gn.entryPointId,
      type: "threadInteraction",
      position: { x: l * COL_GAP, y: row * ROW_GAP },
      data: { label: gn.label, suffix: suffixes.get(gn.entryPointId), kind: gn.kind, file: gn.file, entryPointId: gn.entryPointId },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: true,
    };
  });

  const edges: Edge[] = callEdges.map((e) => ({
    id: `tcall:${e.from}->${e.to}`,
    source: e.from,
    target: e.to,
    type: "default", // bezier — curves, not corners
    markerEnd: { type: MarkerType.ArrowClosed, color: THREAD_ACCENT, width: 16, height: 16 },
    label: e.count > 1 ? `${e.count}x` : undefined,
    data: { count: e.count },
    style: { stroke: THREAD_ACCENT, strokeWidth: 1.5, opacity: 0.7 },
    labelStyle: { fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-ui)" },
    labelBgStyle: { fill: "var(--bg-canvas)", opacity: 0.8 },
  }));

  // M-XLANG.3 - cross-language hops, drawn APART from resolved calls:
  // dashed, in the config accent, and labelled with the method + path
  // rather than a call count. An ambiguous one is marked, and draws to
  // every candidate: the picture must not look more certain than the join.
  for (const e of crossEdges) {
    edges.push({
      id: `crossing:${e.from}->${e.to}:${e.path}`,
      source: e.from,
      target: e.to,
      type: "default",
      markerEnd: { type: MarkerType.ArrowClosed, color: CROSSING_ACCENT, width: 16, height: 16 },
      label: `${e.method ?? "?"} ${e.path}${e.confidence === "ambiguous" ? " (ambiguous)" : ""}`,
      data: { crossing: true, confidence: e.confidence, path: e.path },
      style: {
        stroke: CROSSING_ACCENT,
        strokeWidth: 1.5,
        strokeDasharray: "5 4",
        opacity: e.confidence === "ambiguous" ? 0.5 : 0.75,
      },
      labelStyle: { fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" },
      labelBgStyle: { fill: "var(--bg-canvas)", opacity: 0.85 },
    });
  }

  return { nodes, edges };
}
