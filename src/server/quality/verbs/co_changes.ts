// `co-changes` (RUN1.md 3.5): if the run's combined delta changes `when`,
// it must also change `require`. Forced by AS-21, fleet c6, AS-5. Over the
// server-collected delta, never the IR alone; for calibration, a git
// commit's file list is a delta too (scripts/quality_calibrate.mjs).
//
// The RUN, not the packet, is the unit: the brief may have put the two
// changes in different packets by design, so a packet reviewed before the
// requiring packet ran is `not-yet`, never `violated`.

import { derivedBy, type CheckDefinition, type CheckResult, type NodeRef, type QualityFacts, type RunDelta, type Unverifiable } from "../check_registry.ts";

export interface CoChangesOp { rule: "co-changes"; when: string; require: string }

const BY = "quality/verbs/co_changes.ts";
const OPERAND = /^[^:]*[./][^:]*(:module(\/[^/]+)*)?$/;

function isOp(v: unknown): v is CoChangesOp {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return r.rule === "co-changes" && typeof r.when === "string" && OPERAND.test(r.when) && typeof r.require === "string" && OPERAND.test(r.require)
    && Object.keys(r).every((k) => ["rule", "when", "require"].includes(k));
}

function matches(operand: string, e: RunDelta["entries"][number]): boolean {
  if (operand.includes(":")) return e.nodeId !== null && `${e.file}:${e.nodeId}` === operand;
  return e.file === operand;
}

export const coChanges: CheckDefinition<CoChangesOp> = {
  rule: "co-changes",
  costClass: "delta",
  forcedBy: ["AS-21", "c6", "AS-5"],
  isOperands: isOp,
  describe: (op) => `a change to ${op.when} ships with a change to ${op.require}`,
  preconditions(facts, _op): Unverifiable | null {
    const provenance = derivedBy(BY, facts);
    if (!facts.runDelta || !facts.runDelta()) {
      return { verdict: "unverifiable", reason: "no run delta was supplied: co-changes reads the run's server-collected diffs, not the IR", cause: "precondition", at: [], offenders: [], provenance };
    }
    return null;
  },
  evaluate(facts: QualityFacts, op: CoChangesOp): CheckResult {
    const provenance = derivedBy(BY, facts);
    const delta = facts.runDelta!()!;
    const trigger = delta.entries.filter((e) => matches(op.when, e));
    if (!trigger.length) {
      return {
        verdict: "pass",
        reason: `${op.when} did not change in this run; the rule did not bind`,
        notFollowed: ["nothing changed the trigger, so the requirement was never tested", "the CONTENT of a change is never judged here (that the migration matches the schema is a run, not a delta)"],
        offenders: [], provenance,
      };
    }
    const required = delta.entries.filter((e) => matches(op.require, e));
    if (required.length) {
      return {
        verdict: "pass",
        reason: `${op.when} changed (${[...new Set(trigger.map((t) => t.packetId))].join(", ")}) and so did ${op.require} (${[...new Set(required.map((t) => t.packetId))].join(", ")})`,
        notFollowed: ["the CONTENT of the change is not judged (that the required change matches the triggering one is a run, not a delta)", "ordering between the two changes is not judged"],
        offenders: [], provenance,
      };
    }
    const at = trigger.map((t) => `${t.file}:${t.nodeId ?? "module"}` as NodeRef);
    if (!delta.complete) {
      return { verdict: "unverifiable", reason: `${op.when} changed but ${op.require} has not yet; packets are still to run`, cause: "not-yet", at, offenders: [], provenance };
    }
    // The VIOLATED branch carries its limits too, and it is the one a human
    // acts on. Measured 2026-09-23 on the M-SKILLS.3 resilience drill: both
    // arms persisted a new counter in a NEW TABLE (`create table if not
    // exists`), which lands correctly on an existing database and needs no
    // migration — and this fired on both, because the trigger is the FILE,
    // not the shape of the change. A reader who acted on that verdict would
    // have asked for a migration nothing needed. That is why the verb is
    // DEMOTE in standings.json and may never reject; the reason now says so
    // rather than leaving it to a reader who has only this line.
    // `notFollowed` is a field of PASS by design — a pass must say what it
    // could not follow — so the limit rides the REASON here, which is the
    // line a human actually reads on a violation.
    const limit = op.when.includes(":")
      ? " (whether that node's change actually required the co-change is not judged)"
      : " (the trigger is the FILE, not the shape of the change: adding a NEW table and adding a column to an existing one read identically here, and only the second needs a migration)";
    return {
      verdict: "violated",
      reason: `${op.when} changed (${[...new Set(trigger.map((t) => t.packetId))].join(", ")}) and ${op.require} did not, anywhere in the run${limit}`,
      offenders: [at[0], ...at.slice(1)],
      provenance,
    };
  },
};
