// A SOFTWARE SPEC (2026-09-30, Ben: "I hand vibegraph the documents - it
// understands the underlying software … crystallises a specific
// software/synapse.json spec … then can reliably propose architecture with the
// software in mind"). One file per tool, `.vibegraph/software/<tool>.json`:
// what the tool IS, how to recognise it in code, its operations, the states
// its things move through, the permissions it asks for, and its rules — each
// item QUOTING the documents it came from. Drafted by a model behind a
// citation gate (a quote not in the sources is dropped; an item with no quote
// is kept and labelled inferred), ratified by a person, then reused by the
// stack index, the plan, the hooks and the checks. Webview-safe: types only.

import type { StackRole } from "./stack_taxonomy.ts";

export type SoftwareStatus = "draft" | "ratified";
export type OperationKind = "read" | "write" | "call" | "subscribe" | "admin";

// 2026-09-30 (second pass, from a real spec's edit): a spec is a REFERENCE
// for someone else's tool, so the tool decides how much there is to know —
// the discipline moved from what a spec STORES to what a session is SENT:
// up to 30 rules stored, at most 8 marked `core`, and only core headlines go
// to a hooked session (the rest on demand). A rule stays one line; its WHY
// may run longer, because the reason is what carries a rule to a case it did
// not foresee.
export const SOFTWARE_CAPS = {
  operations: 40,
  states: 10,
  permissions: 12,
  rules: 30,
  core: 8,
  unknowns: 15,
  packages: 12,
  line: 200,
  why: 400,
  definition: 300,
  cite: 300,
  /** a quote must be long enough to mean something */
  citeMin: 12,
  sources: 12,
  changes: 20,
} as const;

/** Who put an item here. Absent = the drafting model (quoted, or INFERRED
 *  when `cite` is null); `human` = a person stated or changed it; `agent` = a
 *  model edited it after drafting (e.g. a Claude session, from its terminal). */
export type SpecItemBy = "human" | "agent";

/** `cite` is a verbatim quote from a source; null = not in the docs. */
interface Cited { cite: string | null; by?: SpecItemBy }

export interface SoftwareOperation extends Cited {
  name: string;
  does: OperationKind;
  /** what it acts on, in the tool's own words ("blob document") */
  on?: string;
  note?: string;
}

/** `sequence`: states a thing moves through (DRAFT → READY); `choice`: options
 *  to pick one of (map | array | text | blob). Absent = sequence. */
export interface SoftwareState extends Cited { of: string; values: string[]; kind?: "sequence" | "choice" }
export interface SoftwarePermission extends Cited { name: string; for?: string }

export interface SoftwareRule extends Cited {
  id: string;
  text: string;
  why: string;
  /** one of the few rules a hooked session is always told (at most 8) */
  core?: boolean;
  /** the checkable half, in the constraint grammar; `{name}` placeholders are
   *  filled with the project's own names when the rule enters a plan */
  check?: Record<string, unknown> | null;
}

/** A question the documents do NOT answer — so nobody assumes the answer. */
export interface SoftwareUnknown { id: string; question: string; mattersFor?: string; by?: SpecItemBy }

export interface SpecChange { at: string; by: SpecItemBy; change: string }

export interface SoftwareSource {
  /** the URL or file it was read from */
  ref: string;
  sha256: string;
  fetched: string;
  /** the saved text, relative to .vibegraph/software/, that quotes are checked against */
  saved: string;
}

export interface SoftwareSpec {
  version: "1";
  tool: string;
  vendor?: string;
  role: StackRole;
  definition: string;
  definitionCite: string | null;
  identity: { packages: string[]; calls: string[] };
  operations: SoftwareOperation[];
  states: SoftwareState[];
  permissions: SoftwarePermission[];
  rules: SoftwareRule[];
  /** questions the docs leave open (optional; absent = none recorded) */
  unknowns?: SoftwareUnknown[];
  sources: SoftwareSource[];
  status: SoftwareStatus;
  /** edits after drafting, newest last */
  changes?: SpecChange[];
  draftedBy?: string;
  draftedAt?: string;
  ratifiedAt?: string;
  /** what the citation gate did to the draft, kept for the person ratifying */
  gate?: { dropped: string[]; inferred: string[] };
}

/** Every quoted item of a spec, with a label saying where it sits. */
export function citedItems(s: SoftwareSpec): Array<{ where: string; cite: string | null }> {
  return [
    { where: "definition", cite: s.definitionCite },
    ...s.operations.map((o) => ({ where: `operation ${o.name}`, cite: o.cite })),
    ...s.states.map((x) => ({ where: `states of ${x.of}`, cite: x.cite })),
    ...s.permissions.map((p) => ({ where: `permission ${p.name}`, cite: p.cite })),
    ...s.rules.map((r) => ({ where: `rule ${r.id}`, cite: r.cite })),
  ];
}
