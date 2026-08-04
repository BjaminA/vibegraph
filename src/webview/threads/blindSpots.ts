// A1 (PLAN-v6) — per-thread honesty roll-up. Turns the IR's honesty work
// into an active capability: "what in this thread is NOT statically known".
//
// PURE and view-side: given an extracted Thread plus a way to read parse-time
// effectKind, it buckets the thread's nodes into the honesty categories the IR
// already tracks. The MCP tool (vibegraph_thread_blind_spots) wires it to the
// server's IR; the deferred view badge will render the SAME roll-up — no
// rework. Read-only: it states IR facts, never runs anything, never needs the
// effect floor (that is run-to-node's job).
//
// The dynamic-vs-unresolved split is LOAD-BEARING and preserved here:
//   resolutionGaps (unresolved) — the linker couldn't resolve it; often a
//     fixable import/link gap, NOT runtime-determined.
//   runtimeDispatch (dynamic)   — genuine runtime dispatch (getattr / a
//     runtime-bound receiver); an inherent property, not an extraction gap.
//   uncaptured                  — the statement hides calls the parser did NOT
//     decompose into IR (chains/comprehensions/literals): genuinely incomplete.
// `effects` is a SEPARATE axis (known-but-impure), not a blind spot.

import type { Thread, ThreadNode } from "./types";

export interface BlindSpotEntry {
  id: string;
  irNodeId: string | null;
  file: string | null;
  label: string;
}

export interface DynamicEntry extends BlindSpotEntry {
  receiverBoundKind?: "local-call" | "param" | "loop";
  receiverBoundFrom?: string;
}

export interface EffectEntry extends BlindSpotEntry {
  effectKind: string;
}

export interface ThreadBlindSpots {
  seed: { file: string; irNodeId: string; qualifiedName: string };
  totals: {
    nodes: number;
    resolutionGaps: number;
    runtimeDispatch: number;
    uncaptured: number;
    effects: number;
  };
  /** No resolution gaps AND no uncaptured nests — the thread is as complete as
   *  static analysis can make it. (runtimeDispatch does NOT count against this:
   *  a dynamic terminal is correctly identified, not a gap.) */
  staticallyComplete: boolean;
  resolutionGaps: BlindSpotEntry[];
  runtimeDispatch: DynamicEntry[];
  uncaptured: BlindSpotEntry[];
  effects: EffectEntry[];
  notes: string[];
}

const NOTES = [
  "resolutionGaps (unresolved): the linker could not resolve these — often a fixable import/link gap, NOT runtime-determined.",
  "runtimeDispatch (dynamic): genuine runtime dispatch (getattr / a runtime-bound receiver) — an inherent property, not an extraction gap.",
  "uncaptured: the statement hides calls the parser did NOT decompose into the IR (chains/comprehensions/literals) — the thread is genuinely incomplete here.",
  "effects: parse-time effectKind at this thread's own steps (a string-match heuristic, NOT interprocedural) — for an authoritative per-run verdict use vibegraph_run_thread_to_node's effect floor.",
  "dynamic/unresolved terminals are untraceable hops: the thread may continue (or reach another subsystem) past them, invisibly to static analysis.",
];

/**
 * Build the honesty roll-up for one thread. `effectKindFor` reads parse-time
 * effectKind from the per-file IR by (file, irNodeId) — effectKind does NOT
 * ride on thread nodes, so the join is the caller's job.
 */
export function computeThreadBlindSpots(
  thread: Thread,
  effectKindFor: (file: string | null, irNodeId: string | null) => string | null,
): ThreadBlindSpots {
  const entry = (n: ThreadNode): BlindSpotEntry => ({
    id: n.id, irNodeId: n.irNodeId, file: n.file, label: n.label,
  });

  const resolutionGaps: BlindSpotEntry[] = [];
  const runtimeDispatch: DynamicEntry[] = [];
  const uncaptured: BlindSpotEntry[] = [];
  const effects: EffectEntry[] = [];

  for (const n of thread.nodes) {
    if (n.kind === "unresolved") resolutionGaps.push(entry(n));
    if (n.kind === "dynamic") {
      runtimeDispatch.push({
        ...entry(n),
        receiverBoundKind: n.receiverBoundKind,
        receiverBoundFrom: n.receiverBoundFrom,
      });
    }
    // Orthogonal to kind: a step/external node can also hide undecomposed calls.
    if (n.nestsInnerCalls && !n.nestExtracted) uncaptured.push(entry(n));

    const ek = effectKindFor(n.file, n.irNodeId);
    if (ek) effects.push({ ...entry(n), effectKind: ek });
  }

  return {
    seed: thread.seed,
    totals: {
      nodes: thread.nodes.length,
      resolutionGaps: resolutionGaps.length,
      runtimeDispatch: runtimeDispatch.length,
      uncaptured: uncaptured.length,
      effects: effects.length,
    },
    staticallyComplete: resolutionGaps.length === 0 && uncaptured.length === 0,
    resolutionGaps,
    runtimeDispatch,
    uncaptured,
    effects,
    notes: NOTES,
  };
}

/**
 * C1 (PLAN-v6) — render the roll-up as a deterministic "Not statically known"
 * markdown block, appended to a generated thread-skill as IR FACT (never
 * LLM-authored, so it can't be hallucinated or omitted). One honest line per
 * blind spot, or an explicit "statically complete" note when there are none.
 */
export function formatBlindSpotsBlock(r: ThreadBlindSpots): string {
  const lines = ["## Not statically known (IR fact — auto-generated, do not edit)"];
  if (r.staticallyComplete && r.totals.runtimeDispatch === 0) {
    lines.push("", "This thread is statically complete: no resolution gaps, runtime dispatch, or uncaptured calls.");
  } else {
    if (r.resolutionGaps.length) {
      lines.push("", "**Resolution gaps** (the linker could not resolve these — possibly fixable):");
      for (const g of r.resolutionGaps) lines.push(`- \`${g.id}\` — ${g.label}`);
    }
    if (r.runtimeDispatch.length) {
      lines.push("", "**Runtime dispatch** (genuine — resolved only at run time, not a gap):");
      for (const d of r.runtimeDispatch) {
        const bound = d.receiverBoundFrom ? ` (receiver from ${d.receiverBoundFrom})` : "";
        lines.push(`- \`${d.id}\` — ${d.label}${bound}`);
      }
    }
    if (r.uncaptured.length) {
      lines.push("", "**Uncaptured** (the statement hides calls NOT in the IR — the path is incomplete here):");
      for (const u of r.uncaptured) lines.push(`- \`${u.id}\` — ${u.label}`);
    }
  }
  if (r.effects.length) {
    lines.push("", "**Side effects on the path** (parse-time; the run-to-node floor is authoritative per run):");
    for (const e of r.effects) lines.push(`- \`${e.id}\` — ${e.label} [${e.effectKind}]`);
  }
  return lines.join("\n");
}
