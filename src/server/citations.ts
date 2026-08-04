// A3 (PLAN-v6) — grounded-citation validator.
//
// The companion to the in-prompt citation contract (prompt.ts): given a chunk
// of Claude's prose and the set of node ids that actually exist in the IR, find
// every node-id-shaped token it cited and split them into grounded (a real
// node) vs ungrounded (a hallucinated citation — a claim with nothing to point
// to). Pure: the caller supplies the known-id universe from the live IR.
//
// Node-id grammar (schemas/ir.schema.json:36-40): always starts with `module`,
// slash-separated segments of `<name>.<kind>` or `<kind>@<n>` — chars are
// letters, digits, `_`, `.`, `@`. A bare `module` (no segment) is NOT a
// citation. We match in prose whether or not it sits in backticks.

const NODE_ID_RE = /\bmodule(?:\/[A-Za-z0-9_.@]+)+/g;

export interface CitationCheck {
  /** Every distinct node-id-shaped token cited in the text. */
  cited: string[];
  /** Cited ids that exist in the IR. */
  grounded: string[];
  /** Cited ids that do NOT exist — hallucinated citations. */
  ungrounded: string[];
  /** True when nothing was cited that the IR can't back. */
  ok: boolean;
}

/** Every distinct node-id-shaped token in the text. The single source for the
 *  pinned grammar — remit matching (thread_remit.ts) reuses this so a routed
 *  citation and a validated citation can never disagree on what counts. */
export function extractNodeIdTokens(text: string): string[] {
  return [...new Set(text.match(NODE_ID_RE) ?? [])];
}

export function validateCitations(text: string, knownNodeIds: Iterable<string>): CitationCheck {
  const known = knownNodeIds instanceof Set ? knownNodeIds : new Set(knownNodeIds);
  const cited = extractNodeIdTokens(text);
  const grounded = cited.filter((id) => known.has(id));
  const ungrounded = cited.filter((id) => !known.has(id));
  return { cited, grounded, ungrounded, ok: ungrounded.length === 0 };
}

// gen-cwd-fix Step 3 — the grounding gate for a PERSISTED artifact whose
// prompt demands node-id citations (the C1 thread-skill). The deepest risk the
// Plan-v6 verification surfaced is plausible-but-ungrounded LLM output getting
// written to disk and later auto-injected. A skill must cite at least one REAL
// node id and zero hallucinated ones to be persisted — tuned (≥1 grounded, 0
// ungrounded) so it rejects confabulation without demanding every line cite.
// Pure over validateCitations so the honest-failure path is a deterministic
// node:test with no claude in the loop. NOT applied to the README (its prompt
// is plain prose and does not ask for citations).
export function isGroundedSkill(text: string, knownNodeIds: Iterable<string>): boolean {
  const check = validateCitations(text, knownNodeIds);
  return check.grounded.length >= 1 && check.ungrounded.length === 0;
}
