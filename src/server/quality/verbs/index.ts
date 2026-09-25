// Quality layer, Run 3: the five verbs Run 1 forced, registered in one
// place. Wired into the live pre-check path (server.ts evaluateRoutedChecks)
// since the calibration review: a stated constraint may carry any of the
// eight verbs (constraint_store.ts validates against all of them), and a
// Run 1 verb REJECTS only when its calibration record reads MAY-GATE
// (standings.ts); otherwise its verdict is an advisory line. Also reached
// through scripts/quality_check.mjs and scripts/quality_calibrate.mjs.

import { CheckRegistry } from "../check_registry.ts";
import { guards, type GuardsOp } from "./guards.ts";
import { notInLoop, type NotInLoopOp } from "./not_in_loop.ts";
import { handlesFailure, type HandlesFailureOp } from "./handles_failure.ts";
import { annotated, type AnnotatedOp } from "./annotated.ts";
import { coChanges, type CoChangesOp } from "./co_changes.ts";

export { guards, notInLoop, handlesFailure, annotated, coChanges };

/** The five Run 1 verbs' operand shapes (check_grammar.json minus the three M-GRAMMAR verbs). */
export type Run1Check = GuardsOp | NotInLoopOp | HandlesFailureOp | AnnotatedOp | CoChangesOp;
export const RUN1_RULES = ["guards", "not-in-loop", "handles-failure", "annotated", "co-changes"] as const;

export function registerRun1Verbs(registry: CheckRegistry): CheckRegistry {
  registry.register(guards);
  registry.register(notInLoop);
  registry.register(handlesFailure);
  registry.register(annotated);
  registry.register(coChanges);
  return registry;
}

export function newRegistry(): CheckRegistry {
  return registerRun1Verbs(new CheckRegistry());
}

let shared: CheckRegistry | null = null;
/** One registry per process for the server's pre-checks. */
export function run1Registry(): CheckRegistry {
  if (!shared) shared = newRegistry();
  return shared;
}

/** Boundary validation for a stated constraint's check: the verb's own
 *  isOperands, so a malformed operand set is refused, never coerced. */
export function isRun1Check(v: unknown): v is Run1Check {
  if (!v || typeof v !== "object") return false;
  const rule = (v as { rule?: unknown }).rule;
  if (typeof rule !== "string") return false;
  const def = run1Registry().get(rule);
  return !!def && def.isOperands(v);
}

export function describeRun1Check(check: Run1Check): string {
  return run1Registry().get(check.rule)!.describe(check);
}
