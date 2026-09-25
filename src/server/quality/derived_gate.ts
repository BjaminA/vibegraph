// When a DERIVED quality-model binding may reject a packet.
//
// A STATED constraint gates on its own terms: a human said the rule, so a
// violation is a violation whoever wrote the code. A derived dimension has
// no such mandate. It is inferred from the stack the project already uses,
// and the codebase it is inferred from usually violates it somewhere
// already — that is why RUN3 §11 recorded "derived bindings never gate"
// while no verb had a standing at all.
//
// Four verbs now carry ratified records and Ben ruled on 2026-09-21 that a
// calibrated dimension may gate (PLAN-HISTORY). Two conditions make that
// safe, and both are needed:
//
//   1. EVERY binding in the dimension is calibrated (model.ts sets the
//      mode). A gate whose members are judged on different evidence is
//      not one gate.
//   2. The violation names an offender the packet INTRODUCED. Measured on
//      h2h3 arm A: its p1 carried a derived resolvability violation naming
//      three functions whose parameters were unannotated before the run
//      began. Gating on that would have rejected correct work, which is
//      the failure this whole layer exists to avoid — a false violation is
//      worse than a false pass, because a gate that rejects correct work
//      gets worked around.
//
// An inherited violation is not discarded. It still lands as an advisory
// line with its offenders, so the codebase's standing debt stays visible;
// it just does not stop the packet that happened to walk past it.

/** One offender, as a baseline stores it: `file:nodeId`. */
export type OffenderRef = string;

/**
 * The offenders present now and absent from the baseline.
 *
 * `undefined` baseline means no baseline was captured, which is NOT the
 * same as an empty one: an empty baseline says "this check reported
 * nothing before the run", while a missing one says "nobody looked". The
 * first lets every current offender gate; the second gates nothing.
 */
export function newOffenders(
  current: readonly OffenderRef[],
  baseline: readonly OffenderRef[] | undefined,
): OffenderRef[] | undefined {
  if (baseline === undefined) return undefined;
  const before = new Set(baseline);
  return current.filter((o) => !before.has(o));
}

export interface DerivedGateInput {
  /** The dimension's mode, from the derived quality model. */
  mode: "advisory" | "gate-blocking";
  /** Does the verb's own standing allow it to reject (standings.ts)? */
  verbMayGate: boolean;
  verdict: "pass" | "violated" | "unverifiable";
  current: readonly OffenderRef[];
  baseline: readonly OffenderRef[] | undefined;
}

export interface DerivedGateDecision {
  /** May this binding REJECT the packet? */
  gates: boolean;
  /** The offenders that entitle it to, empty when none do. */
  newOffenders: OffenderRef[] | undefined;
  /** Why, in the words the evidence carries. */
  why: string;
}

export function derivedGate(input: DerivedGateInput): DerivedGateDecision {
  const fresh = newOffenders(input.current, input.baseline);
  if (input.mode !== "gate-blocking") {
    return { gates: false, newOffenders: fresh, why: "the dimension is advisory: not every binding it carries is calibrated" };
  }
  if (!input.verbMayGate) {
    return { gates: false, newOffenders: fresh, why: "the verb's calibration standing does not allow it to reject" };
  }
  if (fresh === undefined) {
    return { gates: false, newOffenders: undefined, why: "no baseline was captured at the objective gate, so nothing can be shown to be new" };
  }
  if (input.verdict !== "violated") {
    return { gates: false, newOffenders: fresh, why: `the verdict is ${input.verdict}, and only a violation rejects` };
  }
  if (!fresh.length) {
    return { gates: false, newOffenders: fresh, why: `every offender was already there before the run (${input.current.length}) — a rule nobody stated does not reject a packet for code it inherited` };
  }
  return { gates: true, newOffenders: fresh, why: `${fresh.length} offender(s) this packet introduced: ${fresh.join(", ")}` };
}
