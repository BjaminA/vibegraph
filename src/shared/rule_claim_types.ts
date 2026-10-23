// RULE CLAIMS (2026-10-22, the root-cause handoff RC1: "anything a model writes
// about code is a claim until the IR confirms it"). A rule a model drafts may
// carry typed claims beside its prose: what a script runs, what a function
// writes, what a folder imports or never calls, what a box reaches. Each is
// decided against the IR (src/server/rule_claims.ts) before the rule is stored; a
// confirmed claim is stored as a check clause, `{rule: "claim", …}`, so it is
// decided again after every edit. Webview-safe: the Rules panel words it.

export const CLAIM_PREDICATES = ["runs-only", "writes-only", "imports-only", "never-calls", "reaches"] as const;
export type ClaimPredicate = typeof CLAIM_PREDICATES[number];

export interface ClaimCheck {
  rule: "claim";
  predicate: ClaimPredicate;
  /** files, folders (ending "/"), a function as `path:function`, or an entry point id */
  subject: string[];
  objects: string[];
  /** corrected from the code: the set the model gave before the IR corrected it */
  was?: string[];
  /** narrowed by the code: the subject the model gave before counterexamples narrowed it */
  wasSubject?: string[];
}

const MAX_ITEMS = 40;
const okItem = (s: unknown, max: number): s is string => typeof s === "string" && !!s.trim() && s.length <= max && !s.split(/[\\/]/).includes("..");
const okList = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= MAX_ITEMS && v.every((s) => okItem(s, max));

/** A claim as a check clause: refused when malformed, never coerced. */
export function isClaimCheck(x: unknown): x is ClaimCheck {
  if (!x || typeof x !== "object") return false;
  const c = x as Record<string, unknown>;
  return c.rule === "claim" && (CLAIM_PREDICATES as readonly string[]).includes(c.predicate as string)
    && okList(c.subject, 200) && okList(c.objects, 160)
    && (c.was === undefined || okList(c.was, 160)) && (c.wasSubject === undefined || okList(c.wasSubject, 200));
}

/** "a", "a and b", "a, b and c" */
export function listInWords(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

const NEVER: Record<string, string> = { network: "the network", http: "the network", fs: "the file system", db: "a database", subprocess: "another program", log: "a logger" };

/** The claim as one sentence (no final full stop). */
export function claimInWords(c: Pick<ClaimCheck, "predicate" | "subject" | "objects">): string {
  const s = listInWords(c.subject);
  const o = listInWords(c.objects.map((x) => (c.predicate === "never-calls" ? NEVER[x] ?? x : x)));
  switch (c.predicate) {
    case "runs-only": return `${s} runs only ${o}`;
    case "writes-only": return `${s} writes only ${o}`;
    case "imports-only": return `${s} imports only ${o} of the project's own modules`;
    case "never-calls": return `${s} never calls ${o}`;
    case "reaches": return `${s} reaches ${o}`;
  }
}

/** What the code changed in the model's claim, in words, or null. */
export function claimCorrectionInWords(c: ClaimCheck): string | null {
  const parts: string[] = [];
  if (c.was) parts.push(`Claude said ${listInWords(c.was)}; the code shows ${listInWords(c.objects)}`);
  if (c.wasSubject) parts.push(`Claude said ${listInWords(c.wasSubject)}; it holds in ${listInWords(c.subject)}`);
  return parts.length ? `Corrected from the code: ${parts.join(". ")}.` : null;
}
