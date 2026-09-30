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

export const SOFTWARE_CAPS = {
  operations: 40,
  states: 10,
  permissions: 12,
  rules: 15,
  packages: 12,
  line: 200,
  definition: 300,
  cite: 300,
  /** a quote must be long enough to mean something */
  citeMin: 12,
  sources: 12,
} as const;

/** `cite` is a verbatim quote from a source; null = INFERRED (not in the docs). */
interface Cited { cite: string | null }

export interface SoftwareOperation extends Cited {
  name: string;
  does: OperationKind;
  /** what it acts on, in the tool's own words ("blob document") */
  on?: string;
  note?: string;
}

export interface SoftwareState extends Cited { of: string; values: string[] }
export interface SoftwarePermission extends Cited { name: string; for?: string }

export interface SoftwareRule extends Cited {
  id: string;
  text: string;
  why: string;
  /** the checkable half, in the constraint grammar; `{name}` placeholders are
   *  filled with the project's own names when the rule enters a plan */
  check?: Record<string, unknown> | null;
}

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
  sources: SoftwareSource[];
  status: SoftwareStatus;
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
