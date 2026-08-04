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
import type { ThreadNode } from "../threads";

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

export interface ThreadGraph {
  nodes: ThreadGraphNode[];
  edges: ThreadCallEdge[];
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

  return { nodes, edges };
}

// L-R layered spacing — mirrors buildSystemLayout's COL/ROW idiom.
const COL_GAP = 320;
const ROW_GAP = 110;
const THREAD_ACCENT = "var(--accent-thread)";

/**
 * Build react-flow nodes + edges for the thread-interaction graph. Layering is
 * a longest-path relaxation capped at node-count iterations, so it is
 * cycle-safe and deterministic: callers (no incoming call) sit left, callees
 * step rightward.
 */
export function buildThreadInteractionLayout(
  threads: ProjectThread[],
  entryPoints: EntryPoint[],
): { nodes: Node[]; edges: Edge[] } {
  const g = deriveThreadCalls(threads, entryPoints);
  const nodeIds = new Set(g.nodes.map((n) => n.entryPointId));
  // Keep only edges whose both endpoints are real nodes (defensive).
  const callEdges = g.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  // Longest-path layering, capped to bound cycles. Roots stay at layer 0.
  const layer = new Map<string, number>();
  for (const n of g.nodes) layer.set(n.entryPointId, 0);
  const cap = g.nodes.length;
  for (let iter = 0; iter < cap; iter++) {
    let changed = false;
    for (const e of callEdges) {
      const next = (layer.get(e.from) ?? 0) + 1;
      if (next > (layer.get(e.to) ?? 0) && next <= cap) {
        layer.set(e.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const rowInLayer: Record<number, number> = {};
  const nodes: Node[] = g.nodes.map((gn) => {
    const l = layer.get(gn.entryPointId) ?? 0;
    const row = rowInLayer[l] ?? 0;
    rowInLayer[l] = row + 1;
    return {
      id: gn.entryPointId,
      type: "threadInteraction",
      position: { x: l * COL_GAP, y: row * ROW_GAP },
      data: { label: gn.label, kind: gn.kind, file: gn.file, entryPointId: gn.entryPointId },
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

  return { nodes, edges };
}
