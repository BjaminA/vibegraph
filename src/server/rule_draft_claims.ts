// A drafted rule's CLAIMS, decided before the rule is stored (2026-10-22, the
// root-cause handoff RC1). The model states what the code does as typed
// claims beside the sentence (`claims` in the reply, src/shared/rule_claim_types.ts);
// each one is decided against the IR (rule_claims.ts) and the gate acts on the
// verdict, never on the prose:
//
//   VERIFIED      stored as a check clause, so every later edit decides it again
//   CONTRADICTED  with the set the code shows: the rule's sentence is rewritten
//                 from the code and the clause carries what the model said (`was`)
//                 over a folder: narrowed to the files that keep it (`wasSubject`)
//                 with nothing the code can correct: the rule is refused
//   UNVERIFIABLE  the rule stays prose and the note says the claim was not
//                 decided; refused when its own reason names what it leaves out
//
// A sentence that states what the code does ("only", "never") with no claim
// and no check is labelled as decided by nothing.

import { checkClaim, correctedText, whyContradicts, type ClaimFacts } from "./rule_claims.ts";
import { CLAIM_PREDICATES, isClaimCheck, listInWords, type ClaimCheck } from "../shared/rule_claim_types.ts";

export interface ClaimGate {
  /** the rule's sentence, rewritten from the code when a claim was corrected */
  text: string;
  /** the clauses to store with the rule */
  clauses: ClaimCheck[];
  /** a folder claim narrowed: the files the rule now holds over */
  narrowedFiles?: string[];
  notes: string[];
  /** set when the code contradicts the rule and cannot correct it */
  refuse?: string;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : []);
const STATES_BEHAVIOUR = /\b(only|never|always|nothing but|exclusively|no other)\b/i;

/** The claims a reply gave for one rule, well-formed or dropped (said in a note). */
function claimsIn(raw: unknown, notes: string[]): ClaimCheck[] {
  const out: ClaimCheck[] = [];
  for (const r of (Array.isArray(raw) ? raw : []).slice(0, 4) as Array<Record<string, unknown>>) {
    const c = { rule: "claim", predicate: r?.predicate, subject: strings(r?.subject), objects: strings(r?.objects) };
    if (isClaimCheck(c)) out.push(c);
    else notes.push(`a claim was dropped: not one of ${CLAIM_PREDICATES.join(" / ")} with a subject and objects`);
  }
  return out;
}

export function gateClaims(raw: unknown, text: string, why: string, facts: ClaimFacts | undefined, hasCheck: boolean): ClaimGate {
  const notes: string[] = [];
  const claims = claimsIn(raw, notes);
  const gate: ClaimGate = { text, clauses: [], notes };
  if (!claims.length) {
    if (!hasCheck && STATES_BEHAVIOUR.test(text)) notes.push("it states what the code does, and nothing checked it against the code");
    return gate;
  }
  if (!facts) { notes.push("its claims were not decided: no code facts were available"); return gate; }
  for (const c of claims) {
    const v = checkClaim(c, facts);
    if (v.verdict === "verified") { gate.clauses.push(c); continue; }
    if (v.verdict === "unverifiable") {
      const self = whyContradicts(c, why);
      if (self) { gate.refuse = `${self}; the code could not decide it (${v.reason})`; return gate; }
      notes.push(`a claim could not be decided on this code, so it is not checked: ${v.reason}`);
      continue;
    }
    if (!v.corrected) { gate.refuse = `the code contradicts it: ${v.reason}`; return gate; }
    gate.clauses.push(v.corrected);
    if (v.corrected.was) gate.text = correctedText(gate.text, v.corrected);
    if (v.corrected.wasSubject) {
      gate.narrowedFiles = [...new Set([...(gate.narrowedFiles ?? []), ...v.corrected.subject])];
      notes.push(`narrowed to ${listInWords(v.corrected.subject.slice(0, 4))}${v.corrected.subject.length > 4 ? ` +${v.corrected.subject.length - 4}` : ""}: ${v.reason} breaks it`);
    } else notes.push("its claim was corrected from the code"); // the clause carries what was said (`was`)
  }
  return gate;
}
