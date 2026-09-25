// Type-level negatives for src/server/quality/check_registry.ts.
//
// Compiled by test/quality_schemas.test.mjs with `tsc --noEmit`. Every
// `@ts-expect-error` line below is a shape the registry must REFUSE; tsc
// fails the build if any of them compiles, which is what the test asserts.
// The two positive bindings at the end keep the file from being trivially
// all-errors. This file is a test vector, not a config.

import type { CheckResult, CheckDefinition, QualityFacts } from "../../../src/server/quality/check_registry.ts";

const derived = { kind: "derived", by: "test", commit: "0000000", at: "2026-09-12T00:00:00.000Z" } as const;

// @ts-expect-error a bare boolean is not a verdict
export const r1: CheckResult = true;

// @ts-expect-error a pass must say what it did not follow
export const r2: CheckResult = { verdict: "pass", reason: "x", notFollowed: [], offenders: [], provenance: derived };

// @ts-expect-error a violation must name at least one offender
export const r3: CheckResult = { verdict: "violated", reason: "x", offenders: [], provenance: derived };

// (the directive sits on the line ABOVE the property that errors, because
// tsc reports a bad property at the property, not at the binding)
export const r4: CheckResult = {
  verdict: "pass", reason: "x", notFollowed: ["order not checked"], offenders: [],
  // @ts-expect-error a model's judgement is not a provenance a check may carry
  provenance: { kind: "model_judgement", model: "m", promptHash: "h", at: "now", entersGate: false },
};

export const r5: CheckResult = {
  verdict: "pass", reason: "x", notFollowed: ["order not checked"], offenders: [],
  // @ts-expect-error a worker's self-report is not a provenance a check may carry
  provenance: { kind: "self_report", by: "worker", loadBearing: false, entersGate: false },
};

// @ts-expect-error an offender must be a file:node reference, not a bare word
export const r6: CheckResult = { verdict: "violated", reason: "x", offenders: ["notify"], provenance: derived };

export const d1: CheckDefinition<{ rule: "x" }> = {
  rule: "x", costClass: "local", forcedBy: ["AS-1"],
  isOperands: (v: unknown): v is { rule: "x" } => true,
  preconditions: () => null,
  // @ts-expect-error evaluate may not return a boolean
  evaluate: () => true,
  describe: () => "x",
};

export const d2: CheckDefinition<{ rule: "y" }> = {
  rule: "y", costClass: "local",
  // @ts-expect-error a verb with no forcing assertion does not exist
  forcedBy: [],
  isOperands: (v: unknown): v is { rule: "y" } => true,
  preconditions: () => null,
  evaluate: (_f: QualityFacts) => ({ verdict: "pass", reason: "r", notFollowed: ["n"], offenders: [], provenance: derived }),
  describe: () => "y",
};

// positive: the shapes that ARE allowed
export const ok1: CheckResult = { verdict: "pass", reason: "r", notFollowed: ["order not checked"], offenders: [], provenance: derived };
export const ok2: CheckResult = {
  verdict: "violated", reason: "r", offenders: ["telemetry/ingest.py:module/ingest.fn/notify.call"], provenance: derived,
};
export const ok3: CheckResult = {
  verdict: "unverifiable", reason: "r", cause: "dynamic", at: ["telemetry/alerts.py:module/evaluate.fn/self_hook.call"], offenders: [], provenance: derived,
};
