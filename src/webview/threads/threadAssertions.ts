// B4 (PLAN-v6) — behavioural-contract extraction. VibeGraph's test discipline
// (every milestone ships a fixture-backed test) as an agent capability: derive
// the POSITION / ORDER / EFFECT assertions a thread must satisfy, grounded in
// the IR — not a smoke test. The agent renders these into a real test (any
// format); the assertions themselves are deterministic IR fact, not LLM prose.
//
// Pure, view-side (mirrors blindSpots.ts): given a Thread + an effectKind
// lookup, produce the ordered execution path, the effects on it, the terminals
// by kind, and human-readable invariant strings ready to drop into a test.

import type { Thread, ThreadNode } from "./types";

const ORDER_KINDS = new Set(["seed", "step"]);
const TERMINAL_KINDS = new Set(["external", "dynamic", "unresolved"]);

export interface OrderedStep {
  position: number;
  kind: string;
  label: string;
  irNodeId: string | null;
}

export interface EffectAssertion {
  position: number | "terminal";
  label: string;
  effectKind: string;
}

export interface ThreadAssertions {
  thread: { qualifiedName: string; seedIrNodeId: string };
  /** The execution path (seed + steps), in extraction order. */
  order: OrderedStep[];
  /** Side effects on the path, joined from the per-file IR. */
  effects: EffectAssertion[];
  /** Terminals grouped by kind — the boundaries the thread can't trace past. */
  terminals: { external: string[]; dynamic: string[]; unresolved: string[] };
  /** Human-readable, testable invariants — what a regression test would check. */
  invariants: string[];
}

export function computeThreadAssertions(
  thread: Thread,
  effectKindFor: (file: string | null, irNodeId: string | null) => string | null,
): ThreadAssertions {
  const ordered = thread.nodes.filter((n) => ORDER_KINDS.has(n.kind));
  const order: OrderedStep[] = ordered.map((n, i) => ({
    position: i + 1, kind: n.kind, label: n.label, irNodeId: n.irNodeId,
  }));

  const effects: EffectAssertion[] = [];
  for (const [i, n] of ordered.entries()) {
    const ek = effectKindFor(n.file, n.irNodeId);
    if (ek) effects.push({ position: i + 1, label: n.label, effectKind: ek });
  }
  for (const n of thread.nodes.filter((n) => TERMINAL_KINDS.has(n.kind))) {
    const ek = effectKindFor(n.file, n.irNodeId);
    if (ek) effects.push({ position: "terminal", label: n.label, effectKind: ek });
  }

  const byKind = (k: string): string[] =>
    thread.nodes.filter((n: ThreadNode) => n.kind === k).map((n) => n.label);
  const terminals = { external: byKind("external"), dynamic: byKind("dynamic"), unresolved: byKind("unresolved") };

  const qn = thread.seed.qualifiedName;
  const invariants: string[] = [`thread '${qn}' has ${order.length} ordered step(s)`];
  for (const s of order) invariants.push(`step ${s.position} is ${s.kind} '${s.label}'`);
  for (const e of effects) {
    invariants.push(`${e.position === "terminal" ? "a terminal" : `step ${e.position}`} ('${e.label}') touches ${e.effectKind}`);
  }
  for (const k of ["dynamic", "unresolved", "external"] as const) {
    const labels = terminals[k];
    if (labels.length) invariants.push(`${labels.length} ${k} terminal(s): ${labels.join(", ")}`);
  }

  return {
    thread: { qualifiedName: qn, seedIrNodeId: thread.seed.irNodeId },
    order,
    effects,
    terminals,
    invariants,
  };
}
