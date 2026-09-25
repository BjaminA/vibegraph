// PLAN-M-RUNTIME phase 3 — the PURE half of the trace overlay: the wire
// shapes, the (file, line) -> node join, and the per-node lookup.
//
// Webview-safe: no node imports. The tooltip and the server read a node's
// observations through THIS function or they drift — the same rule that put
// stack_attribution.ts in shared/ after a tooltip and a contract disagreed
// about what a boundary went through.
//
// STALENESS IS A FLAG HERE, NOT A COMPUTATION. Only the server has the
// files, so it stamps `staleFiles` on each run when it projects the store
// into the envelope; every reader downstream reports what that says. One
// place decides, everyone else agrees — and it cannot go stale itself,
// because it is recomputed on every projection rather than stored.

import type {
  NodeObservationRecord, ObservationStoreRecord, ObservedCalleeRecord, TraceRunRecord,
} from "./protocol.ts";

export type { NodeObservationRecord, ObservationStoreRecord, ObservedCalleeRecord, TraceRunRecord };

export const OBSERVATIONS_VERSION = 1;

/** An observation resolved for ONE node, with the provenance a reader needs
 *  to judge it. `stale` is a caveat, never a reason to hide it. */
export interface ResolvedObservation extends NodeObservationRecord {
  entryPointId: string;
  at: string;
  inputs: string;
  outcome: string;
  stale: boolean;
}

/**
 * Every observation any run has for one node.
 *
 * Plural on purpose: two entry points can both reach the same call site and
 * dispatch to different things, and that disagreement is the single most
 * informative thing a trace overlay can report. Merging them would destroy
 * it; picking one would invent a winner. Newest first, so the most recent
 * evidence reads first — which is an ordering, not a ranking.
 */
export function observationsForNode(
  store: ObservationStoreRecord | null | undefined,
  file: string | null | undefined,
  irNodeId: string | null | undefined,
): ResolvedObservation[] {
  if (!store || !file || !irNodeId) return [];
  const out: ResolvedObservation[] = [];
  for (const run of Object.values(store.runs ?? {})) {
    const obs = run.observations?.[file]?.[irNodeId];
    if (!obs) continue;
    out.push({
      ...obs,
      entryPointId: run.entryPointId,
      at: run.at,
      inputs: run.inputs,
      outcome: run.outcome,
      stale: (run.staleFiles ?? []).includes(file),
    });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** A raw site from scripts/trace_run.py, before it is joined to the IR. */
export interface TracedSite {
  file: string;
  line: number;
  callees: ObservedCalleeRecord[];
}

/** The IR facts the join needs. Deliberately minimal so this stays pure and
 *  a caller can feed it a fixture as easily as a live envelope. */
export interface JoinNode {
  id: string;
  line?: number | null;
  type?: string | null;
}

/** Node types that can be the site of a call. A `function_def`'s line is its
 *  `def`, not a call — joining there would label the definition with
 *  whatever its first statement happened to invoke. */
const CALL_SITE_TYPES = new Set(["call", "assignment", "return", "augmented"]);

/**
 * Join traced sites onto IR nodes: (file, line) -> node id.
 *
 * The line a call is WRITTEN on is the only key the two sides share — the
 * tracer has no idea what an IR node is, and the IR has no idea a run
 * happened. Both agree on where the source text sits, so that is the join.
 *
 * A line can carry more than one node (`out = eng.run()` is an assignment
 * whose value is a call), and every one of them gets the observation:
 * deciding which node "really" made the call would be a guess, and a
 * consumer keying on either id is entitled to find it.
 *
 * Nodes with no line, and lines with no node, are simply not joined — a
 * trace of a file VibeGraph never parsed reports nothing, rather than
 * inventing an anchor for it.
 */
export function joinTraceToNodes(
  sites: TracedSite[],
  nodesByFile: Record<string, JoinNode[]>,
): Record<string, Record<string, NodeObservationRecord>> {
  const out: Record<string, Record<string, NodeObservationRecord>> = {};
  for (const site of sites) {
    const nodes = nodesByFile[site.file];
    if (!nodes?.length || !site.callees?.length) continue;
    for (const n of nodes) {
      if (typeof n.line !== "number" || n.line !== site.line) continue;
      if (n.type && !CALL_SITE_TYPES.has(n.type)) continue;
      (out[site.file] ??= {})[n.id] = { line: site.line, callees: site.callees };
    }
  }
  return out;
}

/** "2026-09-10" from an ISO stamp — the date is the useful half of a run's
 *  provenance in a one-line label, and a wall of milliseconds is not. */
export function runDate(iso: string): string {
  return (iso ?? "").slice(0, 10);
}
