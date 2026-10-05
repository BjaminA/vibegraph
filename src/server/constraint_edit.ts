// Amending a stated rule (2026-10-01, from a real repo: "promoted rules can't
// be amended" — `plan edit` refuses a promoted rule, there was no command to
// change a constraint, and the CLAUDE.md block tells an agent not to edit
// .vibegraph/). So a rule had to be removed and restated, losing its id, or
// edited by hand with no record.
//
//   edit      a PERSON's change, applied at once, recorded field by field
//             (who, when, before → after, why) — the plan's changelog shape.
//   propose   an AGENT's change (MCP, `--as agent`, or any Claude Code run of
//             the CLI): stored beside the rule as a pending proposal, never
//             applied — the rule keeps gating as it stands until a person
//             accepts. A hook that blocks names this command.
//   accept    a person applies a proposal (recorded with its id);
//   reject    drops it.
//
// Every change and every proposal is validated as the WHOLE rule it would
// produce, through the same validateConstraintInput a new rule passes — a
// proposal that would leave a malformed rule is refused when made, not when
// accepted.

import type { Constraint, ConstraintInput } from "./constraint_store.ts";
import { loadConstraints, saveConstraints, validateConstraintInput } from "./constraint_store.ts";

export type ConstraintActor = "human" | "agent";
/** The editable fields; a field given replaces the old value whole. */
export interface ConstraintPatch {
  text?: string;
  scope?: ConstraintInput["scope"];
  note?: string;
  check?: unknown;
  checks?: unknown[];
}
/** `who` (2026-10-05) — the person's name (src/server/person.ts), when a person made it. */
export interface ConstraintChange { at: string; by: ConstraintActor; who?: string; field: string; before: unknown; after: unknown; why?: string; fromProposal?: string }
export interface ConstraintProposal { id: string; at: string; by: ConstraintActor; patch: ConstraintPatch; why: string }

export const CHANGES_KEPT = 20;
export const PROPOSALS_OPEN = 10;
const FIELDS: readonly (keyof ConstraintPatch)[] = ["text", "scope", "note", "check", "checks"];

/** The rule the patch would produce, validated whole; or the reason it cannot. */
function patched(c: Constraint, patch: ConstraintPatch): { next?: ConstraintInput; error?: string } {
  const given = FIELDS.filter((f) => patch[f] !== undefined);
  if (!given.length) return { error: `nothing to change — give one of ${FIELDS.map((f) => `--${f}`).join(", ")}` };
  const base: Record<string, unknown> = { kind: c.kind, text: c.text, scope: c.scope, ...(c.note ? { note: c.note } : {}), ...(c.policy ? { policy: c.policy } : {}), ...(c.check ? { check: c.check } : {}), ...(c.checks ? { checks: c.checks } : {}) };
  for (const f of given) base[f] = patch[f];
  // A single `check` given replaces every clause (a person re-scoping a rule
  // means the new clause, not the new one beside the old ones).
  if (patch.check !== undefined && patch.checks === undefined) delete base.checks;
  const v = validateConstraintInput(base);
  return v.ok ? { next: v.value } : { error: v.error };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A PERSON's change, applied now and recorded. An agent is refused here — it proposes. */
export function editConstraint(root: string, id: string, patch: ConstraintPatch, opts: { by: ConstraintActor; who?: string; why?: string; fromProposal?: string; now?: () => Date }):
  { constraint?: Constraint; changed?: string[]; error?: string } {
  if (opts.by !== "human") return { error: "an agent does not change a stated rule — it proposes the change (`constraint propose`), and a person accepts it" };
  const list = loadConstraints(root);
  const c = list.find((x) => x.id === id);
  if (!c) return { error: `no constraint ${id}` };
  const r = patched(c, patch);
  if (!r.next) return { error: `refused: ${r.error}` };
  const at = (opts.now?.() ?? new Date()).toISOString();
  const changes: ConstraintChange[] = [];
  const next = r.next as unknown as Record<string, unknown>;
  const cur = c as unknown as Record<string, unknown>;
  for (const f of ["text", "scope", "note", "check", "checks"]) {
    if (!same(cur[f], next[f])) changes.push({ at, by: "human", ...(opts.who ? { who: opts.who } : {}), field: f, before: cur[f] ?? null, after: next[f] ?? null, ...(opts.why ? { why: opts.why } : {}), ...(opts.fromProposal ? { fromProposal: opts.fromProposal } : {}) });
  }
  if (!changes.length) return { error: `no change: ${id} already reads that way` };
  const updated: Constraint = { ...c, ...r.next, id: c.id, source: c.source, createdAt: c.createdAt };
  for (const f of ["note", "check", "checks"] as const) if (next[f] === undefined) delete (updated as unknown as Record<string, unknown>)[f];
  updated.changes = [...(c.changes ?? []), ...changes].slice(-CHANGES_KEPT);
  if (c.proposals) updated.proposals = c.proposals;
  list[list.indexOf(c)] = updated;
  saveConstraints(root, list);
  return { constraint: updated, changed: changes.map((x) => x.field) };
}

/** A change offered for a person to accept; the rule is untouched meanwhile. */
export function proposeConstraintEdit(root: string, id: string, patch: ConstraintPatch, opts: { by: ConstraintActor; why: string; now?: () => Date }):
  { proposal?: ConstraintProposal; error?: string } {
  if (!opts.why?.trim()) return { error: "a proposal says why (--why): the person deciding it needs the reason" };
  const list = loadConstraints(root);
  const c = list.find((x) => x.id === id);
  if (!c) return { error: `no constraint ${id}` };
  const r = patched(c, patch);
  if (!r.next) return { error: `refused: ${r.error}` };
  const open = c.proposals ?? [];
  if (open.length >= PROPOSALS_OPEN) return { error: `${id} already has ${open.length} open proposals — a person decides those first (constraint show ${id})` };
  const n = Math.max(0, ...open.map((p) => Number(p.id.slice(1)) || 0), ...(c.changes ?? []).map((ch) => Number(ch.fromProposal?.slice(1)) || 0)) + 1;
  const proposal: ConstraintProposal = { id: `p${n}`, at: (opts.now?.() ?? new Date()).toISOString(), by: opts.by, patch, why: opts.why.trim().slice(0, 400) };
  c.proposals = [...open, proposal];
  saveConstraints(root, list);
  return { proposal };
}

/** A person decides a proposal: accept applies it (recorded with its id), reject drops it. */
export function decideConstraintProposal(root: string, id: string, pid: string, accept: boolean, opts: { now?: () => Date; who?: string } = {}):
  { constraint?: Constraint; error?: string } {
  const list = loadConstraints(root);
  const c = list.find((x) => x.id === id);
  if (!c) return { error: `no constraint ${id}` };
  const p = (c.proposals ?? []).find((x) => x.id === pid);
  if (!p) return { error: `${id} has no open proposal ${pid} (constraint show ${id})` };
  if (accept) {
    const r = editConstraint(root, id, p.patch, { by: "human", who: opts.who, why: `accepted ${pid} (proposed by ${p.by}): ${p.why}`, fromProposal: pid, now: opts.now });
    if (r.error) return { error: r.error };
  }
  const fresh = loadConstraints(root);
  const cur = fresh.find((x) => x.id === id)!;
  cur.proposals = (cur.proposals ?? []).filter((x) => x.id !== pid);
  if (!cur.proposals.length) delete cur.proposals;
  // A rejection is a person's decision too: it is recorded, so the history
  // says who turned the change down and why it was offered.
  if (!accept) {
    const at = (opts.now?.() ?? new Date()).toISOString();
    cur.changes = [...(cur.changes ?? []), { at, by: "human" as const, ...(opts.who ? { who: opts.who } : {}), field: "proposal", before: p.patch, after: null, why: `rejected ${pid} (proposed by ${p.by}): ${p.why}`, fromProposal: pid }].slice(-CHANGES_KEPT);
  }
  saveConstraints(root, fresh);
  return { constraint: cur };
}

/** A person ratifies an agent- or orchestrator-stated rule: it becomes
 *  human-stated, and the history says who reviewed it. */
export function ratifyConstraint(root: string, id: string, opts: { who?: string; now?: () => Date } = {}):
  { constraint?: Constraint; was?: string; error?: string } {
  const list = loadConstraints(root);
  const c = list.find((x) => x.id === id);
  if (!c) return { error: `no constraint ${id}` };
  if (c.source === "human") return { error: `${id} is already human-stated` };
  const was = c.source;
  c.source = "human";
  const at = (opts.now?.() ?? new Date()).toISOString();
  c.changes = [...(c.changes ?? []), { at, by: "human" as const, ...(opts.who ? { who: opts.who } : {}), field: "source", before: was, after: "human", why: "ratified" }].slice(-CHANGES_KEPT);
  saveConstraints(root, list);
  return { constraint: c, was };
}
