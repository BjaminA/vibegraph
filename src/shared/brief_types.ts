// THE BRIEF (2026-10-08): a short, cited account of what a codebase is for,
// how it holds together and its key features — written by ONE model call on
// top of everything derived for free, and kept to the rules every model claim
// in VibeGraph keeps:
//
//   * every claim cites what the model was shown (brief_facts.ts); a citation
//     it was not shown is dropped, a claim left with none is INFERRED;
//   * every claim uses a word from the vocabulary (brief-vocabulary.json, plus
//     a project's `.vibegraph/brief-vocabulary.json`); an unknown word is refused;
//   * everything stays PROPOSED until a person ratifies it, section by section;
//   * a line goes STALE when a line it cites changes (a hash per citation);
//   * what the brief leaves out is listed.
//
// Pure and webview-safe: the types, the vocabulary merge and the limits.

import core from "./brief-vocabulary.json" with { type: "json" };

export type BriefPart = "function" | "method" | "feature";
export interface BriefVocabulary { version: "1"; function: Record<string, string>; method: Record<string, string>; feature: Record<string, string> }
export const CORE_BRIEF_VOCABULARY = core as BriefVocabulary;

export const BRIEF_LIMITS = { function: 3, method: 6, feature: 6, text: 200, groups: 12, names: 16, scopes: 15, path: 8, omitted: 12 };

/** What a piece of evidence IS (B8, 2026-10-08): where a rule is applied
 *  (enforce), a test / probe / refused attempt (verify), a runtime call (use),
 *  a schema, topology, plan or stated rule (declare), prose (doc), or the
 *  person's own correction (note). */
export type EvidenceRole = "enforce" | "verify" | "use" | "declare" | "doc" | "note";
export const EVIDENCE_ROLES: EvidenceRole[] = ["enforce", "verify", "use", "declare", "doc", "note"];

/** B9 — a data claim written as a fact the map can check: who writes, reads,
 *  watches, creates or owns which zone (or family), optionally naming the
 *  partition keys; `not` for a claim of absence ("writes nothing"). */
export type ClaimVerb = "writes" | "reads" | "watches" | "creates" | "owns";
export const CLAIM_VERBS: ClaimVerb[] = ["writes", "reads", "watches", "creates", "owns"];
export interface BriefClaim {
  subject: string;
  verb: ClaimVerb;
  /** a zone id, a family, or "*" (anything — only with `not`) */
  object: string;
  partition?: string[];
  not?: boolean;
  /** set by the check: what the facts say about it */
  verdict?: "supported" | "inferred" | "declared" | "unverifiable" | "contradicted";
  why?: string;
}

/** One cited claim. `boxes`: the map boxes it happens in (the GUI lights them). */
export interface BriefLine {
  text: string;
  words: string[];
  cites: string[];
  boxes?: string[];
  /** the entry points those boxes run (the prompt hook sends a line when a
   *  prompt routes to one of them) */
  entries?: string[];
  /** the citations the validator dropped (not shown, or circular) */
  dropped?: string[];
  /** B9: the line's data claims, each with its verdict */
  claims?: BriefClaim[];
  /** set on read when a cited item changed since it was written */
  stale?: string[];
  /** B7: what changed, one line per stale citation */
  staleWhy?: string[];
  /** B13: what the review found (computed on read; never decides alone) */
  warnings?: string[];
}

export interface BriefGroupOp {
  op: "keep" | "rename" | "add" | "move";
  id: string;
  label?: string;
  kind?: string;
  members?: string[];
  cites: string[];
}

export interface BriefScope { box: string; summary: string; words: Array<{ word: string; cites: string[] }>; cites: string[] }

export interface BriefBody {
  spec: { function: BriefLine[]; method: BriefLine[]; feature: BriefLine[] };
  groups: BriefGroupOp[];
  names: Record<string, { name: string; cites: string[] }>;
  scopes: BriefScope[];
  primaryPath: { steps: string[]; cites: string[] } | null;
  omitted: string[];
}

export type BriefSection = "spec" | "groups" | "scopes" | "path";
export const BRIEF_SECTIONS: BriefSection[] = ["spec", "groups", "scopes", "path"];

/** B7 — how a citation was hashed. 2: the cited item's own canonical content
 *  (a rule's text, check and scope; a source line and its neighbours; an
 *  edge's ends and operation), with a rule's guarded code hashed APART in
 *  `codeHashes`. A record with no scheme was written by 0.29.0. */
export interface BriefHashes {
  scheme?: 2;
  hashes: Record<string, string>;
  /** the cited content as it was, shortened (what the card's "was" shows) */
  basis?: Record<string, string>;
  /** rule id → the hash of the code its check guards, and the functions */
  codeHashes?: Record<string, { hash: string; names: string[] }>;
}

export interface BriefRecord {
  version: "1";
  /** the proposal waiting for a person, if any */
  proposed?: BriefBody & BriefHashes & { model: string; at: string; refused: Array<{ item: string; reason: string }>; estimate?: number;
    /** a re-brief of STALE lines: ratifying replaces only these (by text) */
    restates?: string[];
    /** B13: the person's notes this draft was asked to reconcile */
    notes?: string[] };
  /** what a person ratified, by section */
  ratified?: Partial<{ spec: BriefBody["spec"]; scopes: BriefScope[]; path: BriefBody["primaryPath"] }> & BriefHashes & { at: string; by: string; model: string };
  /** a short record of decisions */
  history?: Array<{ at: string; by: string; section: string; decision: "ratify" | "reject"; model: string }>;
}

/** The shipped words plus a project's additions (new words only). */
export function mergeBriefVocabulary(extra: unknown, base: BriefVocabulary = CORE_BRIEF_VOCABULARY): { vocab: BriefVocabulary; errors: string[] } {
  const errors: string[] = [];
  const vocab: BriefVocabulary = { version: "1", function: { ...base.function }, method: { ...base.method }, feature: { ...base.feature } };
  if (extra === undefined || extra === null) return { vocab, errors };
  if (typeof extra !== "object") return { vocab, errors: ["brief-vocabulary.json must be an object"] };
  for (const part of ["function", "method", "feature"] as const) {
    const add = (extra as Record<string, unknown>)[part];
    if (add === undefined) continue;
    if (!add || typeof add !== "object" || Array.isArray(add)) { errors.push(`\`${part}\` must map words to meanings`); continue; }
    for (const [w, meaning] of Object.entries(add as Record<string, unknown>)) {
      if (!/^[a-z][a-z0-9-]{1,30}$/.test(w)) { errors.push(`${part} word "${w}": lower-case letters, digits and dashes only`); continue; }
      if (typeof meaning !== "string" || !meaning.trim() || meaning.length > 200) { errors.push(`${part} word "${w}": its meaning must be a sentence of at most 200 characters`); continue; }
      if (vocab[part][w]) { errors.push(`${part} word "${w}" is already defined — a project adds words, it does not redefine them`); continue; }
      vocab[part][w] = meaning.trim();
    }
  }
  return { vocab, errors };
}
