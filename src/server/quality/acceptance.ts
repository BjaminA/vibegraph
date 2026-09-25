// Quality layer, Run 3: the packet's closing bar, COMPUTED UP FRONT from
// the envelope and shipped in it (schemas/quality/acceptance.json). Pure;
// orchestration.ts will call it at packet creation once the calibration
// records exist (not wired in Run 3: nothing new gates before a human
// has reviewed its false positives).
//
// Invariants are the lines preCheckReport already produces plus RUN1 4.2's
// two. Checks are the routed constraints' checkable halves and every
// applicable quality-model binding. What gates: a stated constraint whose
// verb is one the live grammar already evaluates (callers-only,
// import-only, calls-through) gates today and keeps gating; a stated
// constraint using a Run 1 verb gates only once that verb is calibrated
// (`calibrated`); a derived binding never gates here (its dimension is
// advisory by schema until calibrated).

import { evaluatePredicate, type Predicate, type TaskFacts } from "./predicate.ts";
import type { StackProfile } from "./profile.ts";
import type { QualityModel } from "./model.ts";

interface ConstraintLike { id: string; check?: object; checks?: object[] }
export interface AcceptanceInput {
  packetId: string;
  entryPointId: string;
  scope: { files: string[]; declaredBy: "brief" | "thread" };
  routedConstraints: ConstraintLike[];
  profile?: StackProfile | null;
  model?: QualityModel | null;
  /** Verbs whose calibration record a human has ratified. */
  calibrated?: ReadonlySet<string>;
  task?: TaskFacts;
  /** Stated exceptions to invariants, with the brief's provenance. */
  exceptions?: Array<{ kind: string; reason: string; provenance: { kind: "stated"; source: "human" | "orchestrator" | "agent"; id: string; at: string } }>;
  mandatoryEvidence?: Array<"derived" | "observed" | "stated">;
  commit: string;
}

const BY = "src/server/quality/acceptance.ts";
const LIVE_GRAMMAR = new Set(["callers-only", "import-only", "calls-through"]);
const INVARIANTS = [
  "edits-inside-scope", "every-edited-file-reparsed", "entry-point-signature-unchanged", "bytes-changed", "no-forbidden-tool",
  "no-new-resolution-gaps", "no-new-runtime-dispatch", "no-new-uncaptured", "no-new-unattributed-boundary", "loosening-loud",
];

export function computeAcceptance(input: AcceptanceInput) {
  const calibrated = input.calibrated ?? new Set<string>();
  const exceptions = new Map((input.exceptions ?? []).map((e) => [e.kind, e]));
  const invariants = INVARIANTS.map((kind) => {
    const ex = exceptions.get(kind);
    return ex ? { kind, exception: { reason: ex.reason, provenance: ex.provenance } } : { kind };
  });

  const checks: Array<{ check: Record<string, unknown>; mode: "advisory" | "gate-blocking"; mustBe: "pass" | "pass-or-reviewed-unverifiable"; basis: Record<string, unknown> }> = [];
  const advisories: Array<{ kind: string; text: string }> = [];
  for (const c of input.routedConstraints) {
    for (const cl of [...(c.checks ?? []), ...(c.check ? [c.check] : [])] as Record<string, unknown>[]) {
      const rule = String(cl.rule);
      const gates = LIVE_GRAMMAR.has(rule) || calibrated.has(rule);
      checks.push({ check: cl, mode: gates ? "gate-blocking" : "advisory", mustBe: "pass-or-reviewed-unverifiable", basis: { constraintId: c.id } });
      if (!gates) advisories.push({ kind: "uncalibrated-check", text: `${c.id}'s \`${rule}\` clause is advisory until the verb's calibration is ratified` });
    }
  }
  if (input.model && input.profile) {
    const scope = { profile: input.profile, entryPointId: input.entryPointId, task: input.task };
    for (const d of input.model.dimensions) {
      if (!evaluatePredicate(d.applies_when as Predicate, scope)) continue;
      for (const b of d.checks) {
        const cal: { commit: string } | { unknown: true; reason: string } = "commit" in b.calibration
          ? { commit: b.calibration.commit }
          : { unknown: true, reason: b.calibration.reason };
        const gates = d.mode === "gate-blocking" && "commit" in cal;
        checks.push({ check: b.check, mode: gates ? "gate-blocking" : "advisory", mustBe: "pass-or-reviewed-unverifiable", basis: { dimension: d.id, calibration: cal } });
        if (!gates) advisories.push({ kind: "uncalibrated-check", text: `${d.id}: \`${String(b.check.rule)}\` applies here and is advisory` });
      }
    }
  }
  advisories.push({ kind: "tests-touched", text: "a delta that touches no test file is named, never rejected (an instance test did not stop a class recurring here)" });

  const evidenceRequired = [...new Set(["derived", ...(input.routedConstraints.length ? ["stated"] : []), ...(input.mandatoryEvidence ?? [])])] as Array<"derived" | "observed" | "stated">;
  const gating = checks.filter((c) => c.mode === "gate-blocking");
  const closingBar = [
    `edits inside ${input.scope.files.join(", ")}`,
    "every edited file re-parsed",
    exceptions.has("entry-point-signature-unchanged") ? "signature change stated by the brief" : "entry-point signature unchanged",
    "nothing loosened",
    gating.length ? `${gating.length} stated check(s) pass or are reviewed: ${gating.map((c) => (c.basis as { constraintId?: string }).constraintId ?? String(c.check.rule)).join(", ")}` : "no gating check",
    `${checks.length - gating.length} advisory check(s) named, never rejecting`,
    `evidence ${evidenceRequired.join("+")}`,
  ].join("; ");

  return {
    version: "1.0" as const,
    packetId: input.packetId,
    entryPointId: input.entryPointId,
    provenance: { kind: "derived" as const, by: BY, commit: input.commit, at: new Date().toISOString() },
    computedAt: new Date().toISOString(),
    scope: input.scope,
    invariants,
    checks,
    evidenceRequired,
    advisories,
    closingBar,
  };
}
