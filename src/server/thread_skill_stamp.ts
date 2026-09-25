// M-CRYSTAL.2 — the ONE thread-skill stamp, as a pure function.
//
// A skill is stamped with the thread's CODE and the RULES routed to it
// (M-WHY): a changed rule can make its teaching wrong exactly as a changed
// step can. server.ts computed both halves inside closures over its live
// state, which meant nothing outside the server could tell whether a stored
// skill was fresh — and the export (a reader with no server) had to either
// guess or leave skills behind. It left them behind.
//
// ONE function for read AND write, on purpose: M-WHY's first cut computed
// the composite on the read side only, so every skill read stale forever
// (test:skill-ratify caught it). The server delegates here; the CLI calls
// here; a stamp written by one is readable by the other.
//
// ADDITIVE: a thread with NO routed rules stamps exactly `sourceHashOf(ir)`,
// what every skill was stamped with before M-WHY, so a project that states
// no rules never sees a skill go stale for a feature it does not use.
import { sourceHashOf } from "./readme_store.ts";
import type { Constraint } from "./constraint_store.ts";
import { describeCheck, isConstraintCheck } from "./constraint_grammar.ts";
import { describeRun1Check, isRun1Check } from "./quality/verbs/index.ts";

/** The routed rules as the skill's drafting input AND the rules half of
 *  the stamp. Deliberately the FULL sentence, not the structured half: the
 *  machine half catches a violation after it is written, and the sentence is
 *  what stops it being written — "a flapping sensor once paged the on-call
 *  forty times in a minute" is what makes a worker design the next paging
 *  path correctly, including one no check anticipated. Empty when nothing
 *  routes. The text is byte-for-byte what server.ts stamped before this
 *  module existed: changing it would stale every ratified skill. */
export function skillRulesBlock(routed: readonly Constraint[]): string {
  if (!routed.length) return "";
  return [
    "",
    "STATED RULES that govern this thread (human/orchestrator decisions, NOT read from the code —",
    "the code cannot say why they exist, which is exactly why they must survive in this skill):",
    ...routed.map((c) => `- [${c.id}, ${c.source}-stated, ${c.kind}] ${c.text}`
      + (c.check ? `\n  (machine-checkable: ${isConstraintCheck(c.check) ? describeCheck(c.check) : isRun1Check(c.check) ? describeRun1Check(c.check) : "unknown check shape"})` : "")),
  ].join("\n");
}

/** The stamp: the thread IR's hash alone when no rules route, else the IR
 *  hash joined to the hash of the rules block. `""` for a missing thread. */
export function threadSkillStamp(threadIR: unknown, rulesBlock: string): string {
  if (!threadIR) return "";
  if (!rulesBlock) return sourceHashOf(threadIR);
  return `${sourceHashOf(threadIR)}|${sourceHashOf({ rules: rulesBlock })}`;
}
