// The kinds of thing a sentence about code refers to (2026-10-05, GUI brief
// M1/M2). ONE row per kind: its hue, saturation, whether its border is
// dashed, and its name. Every chip, legend entry and verdict pill derives
// its colours from this table through a few theme tokens (styles/kinds.css),
// so adding a kind is one row and no CSS. Webview-safe, and the server uses
// the types: a plan's structured facts name the kind of every reference.
//
// A kind is assigned from a fact the analysis holds (an IR node kind, a plan
// section, a topology record, a file extension), never from the words.

export const KIND_IDS = [
  "process", "function", "module", "store", "zone", "path", "type",
  "json", "xml", "identity", "config", "external", "rule", "question",
] as const;
export type KindId = typeof KIND_IDS[number];

export interface KindSpec {
  hue: number;
  /** saturation, %; paths are everywhere, so theirs is low */
  sat: number;
  /** a part of something (a zone of a store) or not settled (a question) */
  dashed: boolean;
  label: string;
  /** what the kind covers, for the legend */
  covers: string;
}

export const KINDS: Record<KindId, KindSpec> = {
  process:  { hue: 166, sat: 70, dashed: false, label: "process",   covers: "process · service · entry point · thread" },
  function: { hue: 105, sat: 70, dashed: false, label: "function",  covers: "function · method · symbol" },
  module:   { hue: 250, sat: 70, dashed: false, label: "module",    covers: "module · library · package · tool" },
  store:    { hue: 195, sat: 70, dashed: false, label: "store",     covers: "database · store" },
  zone:     { hue: 195, sat: 70, dashed: true,  label: "zone",      covers: "zone: part of a store (table, bucket)" },
  path:     { hue: 220, sat: 22, dashed: false, label: "path",      covers: "file path · directory" },
  type:     { hue: 275, sat: 70, dashed: false, label: "type",      covers: "type · schema · contract" },
  json:     { hue: 70,  sat: 70, dashed: false, label: "JSON",      covers: "JSON payload · document" },
  xml:      { hue: 305, sat: 70, dashed: false, label: "XML",       covers: "XML · SOAP · wire format" },
  identity: { hue: 330, sat: 70, dashed: false, label: "identity",  covers: "identity · principal · role" },
  config:   { hue: 45,  sat: 70, dashed: false, label: "setting",   covers: "env var · setting · secret" },
  external: { hue: 18,  sat: 70, dashed: false, label: "external",  covers: "external service · endpoint" },
  rule:     { hue: 50,  sat: 70, dashed: false, label: "rule",      covers: "stated rule · planned rule" },
  question: { hue: 40,  sat: 70, dashed: true,  label: "question",  covers: "open question · assumption" },
};

/** A reference the analysis resolved: what it is, its id, how to show it,
 *  and `at` — what to focus when that differs from the id (a planned
 *  process's real entry point, a plan zone's declared topology zone). */
export interface ChipRef { kind: KindId; id: string; label?: string; at?: string }

/** One bullet of an item: a small-caps label and either chips joined by short
 *  verbs (a string part is a verb or a word, a ChipRef is an object) or text. */
export type FactLabel = "does" | "where" | "runs as" | "speaks" | "blocked" | "rule" | "why" | "scope" | "steps" | "holds" | "carries" | "uses" | "asks";
export interface ItemFact { label: FactLabel; parts?: Array<ChipRef | string>; text?: string }

/** A judgement, never an object: drawn as a pill with a dot (Verdict.tsx). */
export const VERDICT_STYLE: Record<string, { hue: number; sat: number; dashed?: boolean; label?: string }> = {
  pass:          { hue: 140, sat: 70 },
  realised:      { hue: 140, sat: 70 },
  violated:      { hue: 356, sat: 70 },
  refuted:       { hue: 356, sat: 70 },
  drifted:       { hue: 32,  sat: 70 },
  orphaned:      { hue: 32,  sat: 70 },
  unverifiable:  { hue: 220, sat: 15 },
  unverified:    { hue: 220, sat: 15 },
  "not-built":   { hue: 220, sat: 15, label: "not built" },
  unanchored:    { hue: 220, sat: 15 },
  prose:         { hue: 220, sat: 15, label: "prose only" },
  proposed:      { hue: 166, sat: 70, dashed: true },
  agreed:        { hue: 140, sat: 30 },
  promoted:      { hue: 140, sat: 30 },
  dropped:       { hue: 220, sat: 10 },
  human:         { hue: 140, sat: 30 },
  agent:         { hue: 32,  sat: 70, label: "agent · not reviewed" },
  orchestrator:  { hue: 32,  sat: 70, label: "orchestrator · not reviewed" },
  /** a word-match guess, said as one (the plan's off-objective hint) */
  guess:         { hue: 40,  sat: 70, dashed: true },
  confirmed:     { hue: 140, sat: 30 },
  ratified:      { hue: 140, sat: 30 },
  draft:         { hue: 166, sat: 70, dashed: true },
  /** a question's text says it is answered: a passive tag, never a button */
  answered:      { hue: 140, sat: 70 },
  partly:        { hue: 45,  sat: 70, label: "partly answered" },
  closed:        { hue: 140, sat: 30 },
};

/** The kind a file path is, from its extension: a schema is a type. */
export function kindOfPath(p: string): KindId {
  const f = p.toLowerCase();
  if (/\.schema\.json$|\.xsd$/.test(f)) return "type";
  if (/\.json$/.test(f)) return "json";
  if (/\.(xml|wsdl|soap)$/.test(f)) return "xml";
  return "path";
}
