// EDITING a software spec (2026-09-30, from a real spec's hand edit). A
// person — or a model, from its terminal — changes the spec; this decides
// what the change may keep and says who made it:
//   - the result must validate, keep its tool and its sources (sources come
//     from `software add`, never an edit), and every quote must still be in
//     the saved documents — or nothing is written;
//   - every item added or changed is marked with who did it (`by`), so a
//     person's knowledge reads as STATED, never as the drafting model's
//     INFERRED;
//   - a person's edit keeps a ratified spec ratified (they are the one who
//     ratifies); a model's edit sends it back to DRAFT, for a person to read;
//   - each edit is one line in the spec's `changes`.
// Pure except loading the sources and saving.

import type { SoftwareSpec, SpecItemBy } from "../shared/software_types.ts";
import { SOFTWARE_CAPS } from "../shared/software_types.ts";
import { validateSpec, saveSpec, readSources } from "./software_store.ts";
import { verifyQuotes } from "./software_draft.ts";

type Keyed = Record<string, unknown> & { by?: SpecItemBy };
const SECTIONS: Array<[keyof SoftwareSpec, string, string]> = [
  ["operations", "name", "operation"], ["states", "of", "state"], ["permissions", "name", "permission"],
  ["rules", "id", "rule"], ["unknowns", "id", "unknown"],
];
const bare = (x: Keyed) => { const { by: _by, ...rest } = x; return JSON.stringify(rest); };

export interface EditResult { spec?: SoftwareSpec; changes: string[]; error?: string }

export function applySpecEdit(root: string, before: SoftwareSpec, after: unknown, by: SpecItemBy, now: Date = new Date()): EditResult {
  const invalid = validateSpec(after);
  if (invalid) return { changes: [], error: invalid };
  const next = structuredClone(after) as SoftwareSpec;
  if (next.tool !== before.tool) return { changes: [], error: "the tool's name cannot change in an edit (remove it and add it again)" };
  if (JSON.stringify(next.sources) !== JSON.stringify(before.sources)) return { changes: [], error: "sources come from `software add --from`, not from an edit" };
  const bad = verifyQuotes(next, readSources(root, before).map((t) => t.text));
  if (bad.length) return { changes: [], error: `these quotes are not in the saved documents: ${bad.join(", ")} — a quote must be verbatim, or null` };

  const changes: string[] = [];
  for (const [section, key, label] of SECTIONS) {
    const was = new Map(((before[section] as Keyed[] | undefined) ?? []).map((i) => [String(i[key]), i]));
    const now2 = (next[section] as Keyed[] | undefined) ?? [];
    for (const item of now2) {
      const old = was.get(String(item[key]));
      if (!old) { item.by = by; changes.push(`${label} ${item[key]} added`); }
      else if (bare(old) !== bare(item)) { item.by = by; changes.push(`${label} ${item[key]} changed`); }
      else if (old.by) item.by = old.by; else delete item.by;
      was.delete(String(item[key]));
    }
    for (const k of was.keys()) changes.push(`${label} ${k} removed`);
  }
  for (const f of ["definition", "definitionCite", "role", "vendor"] as const) {
    if (JSON.stringify(next[f] ?? null) !== JSON.stringify(before[f] ?? null)) changes.push(`${f} changed`);
  }
  if (JSON.stringify(next.identity) !== JSON.stringify(before.identity)) changes.push("identity changed");
  if (!changes.length) return { spec: before, changes };

  // Status and provenance are the edit's to set, never the edited file's.
  next.status = by === "human" ? before.status : "draft";
  if (next.status === "ratified" && before.ratifiedAt) next.ratifiedAt = before.ratifiedAt; else delete next.ratifiedAt;
  next.gate = before.gate;
  next.draftedBy = before.draftedBy;
  next.draftedAt = before.draftedAt;
  const at = now.toISOString();
  next.changes = [...(before.changes ?? []), { at, by, change: changes.join("; ").slice(0, 400) },
    ...(by === "agent" && before.status === "ratified" ? [{ at, by, change: "back to DRAFT: a model edited it, a person ratifies again" }] : [])].slice(-SOFTWARE_CAPS.changes);
  const saved = saveSpec(root, next);
  if (saved.error) return { changes: [], error: saved.error };
  return { spec: next, changes };
}

/** The quick edits: a rule or an unknown, without opening the whole file. */
export function editRule(spec: SoftwareSpec, sub: "add" | "update" | "remove", v: { id?: string; text?: string; why?: string; check?: unknown; core?: boolean; cite?: string | null }): { next?: SoftwareSpec; error?: string } {
  const next = structuredClone(spec);
  if (sub === "add") {
    if (!v.text || !v.why) return { error: "a rule needs --text and --why (the reason is what carries it to a case it did not foresee)" };
    let n = next.rules.length + 1;
    const ids = new Set(next.rules.map((r) => r.id));
    while (ids.has(`s${n}`)) n++;
    next.rules.push({ id: v.id ?? `s${n}`, text: v.text, why: v.why, cite: v.cite ?? null, check: (v.check as never) ?? null, ...(v.core ? { core: true } : {}) });
    return { next };
  }
  const i = next.rules.findIndex((r) => r.id === v.id);
  if (i < 0) return { error: `no rule ${v.id ?? "(give --id)"}` };
  if (sub === "remove") { next.rules.splice(i, 1); return { next }; }
  const r = next.rules[i];
  if (v.text !== undefined) r.text = v.text;
  if (v.why !== undefined) r.why = v.why;
  if (v.check !== undefined) r.check = v.check as never;
  if (v.cite !== undefined) r.cite = v.cite;
  if (v.core !== undefined) { if (v.core) r.core = true; else delete r.core; }
  return { next };
}

export function editUnknown(spec: SoftwareSpec, sub: "add" | "remove", v: { id?: string; question?: string; mattersFor?: string }): { next?: SoftwareSpec; error?: string } {
  const next = structuredClone(spec);
  const list = next.unknowns ?? [];
  if (sub === "add") {
    if (!v.question) return { error: "an unknown needs --question" };
    let n = list.length + 1;
    const ids = new Set(list.map((u) => u.id));
    while (ids.has(`u${n}`)) n++;
    list.push({ id: v.id ?? `u${n}`, question: v.question, ...(v.mattersFor ? { mattersFor: v.mattersFor } : {}) });
  } else {
    const i = list.findIndex((u) => u.id === v.id);
    if (i < 0) return { error: `no unknown ${v.id ?? "(give --id)"}` };
    list.splice(i, 1);
  }
  next.unknowns = list;
  return { next };
}
