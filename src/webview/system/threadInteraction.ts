// The thread call graph (cross-thread calls).
//
// A pure derivation: the envelope's threads[] + entryPoints[] -> a
// thread-to-thread graph where a DIRECTED edge means "thread A reaches thread
// B's entry-point head" — i.e. thread A invokes the function that is itself
// the start of thread B (e.g. a `route` thread calls `db.insert`, which is a
// `public_api` entry point with its own thread). The contracts, the export,
// plan_work, the system map and the thread index read it.
//
// It also drew the System view's thread-interaction mode until 2026-10-20,
// when that view was removed (the architecture map's lenses answer the same
// questions); the graph stays, the layout went.

import type { EntryPoint, ProjectThread } from "../types";
import type { CrossingIndexRecord, CrossingRecord } from "../../shared/protocol";
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
