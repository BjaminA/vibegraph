// B5 — THE REPLY, CHECKED (2026-10-08). Zero tokens. A model's brief is kept
// only as far as the facts it was shown support it:
//
//   citations   kept when shown (brief_facts.ts), else dropped and named; a
//               box's own id is not evidence for its own name (circular)
//   words       a spec line needs at least one word from its part of the
//               vocabulary; unknown words are refused; a line with none left
//               is refused; scope words must be operation words
//   boxes       every box, member and scope target must exist; a scope only
//               for a SILENT box the model was shown
//   groups      every member once; a group with no valid citation is refused
//   limits      3 function / 6 method / 6 feature lines, short text
//   left out    the model's own `omitted`, plus what the facts pack left out
//
//   checks      every spec line passes brief_checks.ts (B8 evidence roles, B9
//               data claims against the map, B11 absolute words): an error
//               refuses the line with its reason
//   notes       a note the person gave ("brief again with notes") that no line
//               cites and `omitted` does not answer is reported as refused
//
// A claim left with no citation is INFERRED (empty `cites`), drawn faded. The
// result carries a hash per kept citation, taken from exactly what it cites
// (scheme 2, brief_facts.ts), the content shortened (what the card's "was"
// shows) and the hash of the code each cited rule guards: a cited item that
// changes later makes the line STALE, saying what changed (brief_store.ts).

import type { BriefFacts } from "./brief_facts.ts";
import { hash16 } from "./brief_facts.ts";
import { BRIEF_LIMITS, CLAIM_VERBS, type BriefBody, type BriefClaim, type BriefGroupOp, type BriefLine, type BriefRecord, type BriefScope, type BriefVocabulary, type BriefPart, type ClaimVerb } from "../shared/brief_types.ts";
import type { Vocabulary } from "../shared/node_io.ts";
import { boundLabel } from "./arch_propose.ts";
import { GROUP_KINDS } from "./arch_store.ts";
import type { BriefOnly } from "./brief_prompt.ts";
import { briefCoverage, checkLine } from "./brief_checks.ts";

/** A claim as the model wrote it, shape-checked (its verdict comes from the map). */
function parseClaims(raw: unknown, item: string, refused: Array<{ item: string; reason: string }>): BriefClaim[] {
  if (!Array.isArray(raw)) return [];
  const out: BriefClaim[] = [];
  raw.slice(0, 8).forEach((c: any, i: number) => {
    const subject = typeof c?.subject === "string" ? c.subject.trim() : "";
    const verb = typeof c?.verb === "string" ? c.verb.trim().toLowerCase() : "";
    const object = typeof c?.object === "string" ? c.object.trim() : "";
    if (!subject || !object || !CLAIM_VERBS.includes(verb as ClaimVerb)) { refused.push({ item: `${item}.claims[${i}]`, reason: `a claim needs a subject box, a verb (${CLAIM_VERBS.join(" / ")}) and an object zone` }); return; }
    const partition = Array.isArray(c?.partition) ? c.partition.filter((p: unknown): p is string => typeof p === "string" && !!p.trim()).slice(0, 4) : [];
    out.push({ subject, verb: verb as ClaimVerb, object, ...(partition.length ? { partition } : {}), ...(c?.not === true ? { not: true } : {}) });
  });
  return out;
}

type Proposed = NonNullable<BriefRecord["proposed"]>;

const str = (x: unknown, max: number) => (typeof x === "string" ? x.trim().replace(/\s+/g, " ").slice(0, max) : "");
const strs = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string" && !!y.trim()).map((y) => y.trim()) : []);

/** The first JSON object in a reply (a fence or prose around it is tolerated). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const src = fenced ?? text;
  const a = src.indexOf("{"), b = src.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(src.slice(a, b + 1)); } catch { return null; }
}

export function parseBrief(text: string, facts: BriefFacts, vocab: BriefVocabulary, opVocab: Vocabulary, meta: { model: string; only?: BriefOnly; now?: () => Date; absolutes?: string[] }): { brief: Proposed | null; error?: string } {
  const raw = extractJson(text) as Record<string, any> | null;
  if (!raw || typeof raw !== "object") return { brief: null, error: "the reply holds no JSON object" };
  const refused: Proposed["refused"] = [];
  const kept = new Set<string>();
  const keepCites = (list: unknown, item: string, self?: string): { cites: string[]; dropped: string[] } => {
    const cites: string[] = [], dropped: string[] = [];
    for (const c of strs(list)) {
      if (self && c === self) { dropped.push(c); continue; }
      if (facts.cites.has(c)) { if (!cites.includes(c)) cites.push(c); kept.add(c); } else dropped.push(c);
    }
    if (dropped.length) refused.push({ item, reason: `citation(s) not among the facts shown${self ? " (or the item's own id)" : ""}: ${dropped.slice(0, 4).join(", ")}${dropped.length > 4 ? ", …" : ""}` });
    return { cites, dropped };
  };

  // spec
  const spec: BriefBody["spec"] = { function: [], method: [], feature: [] };
  for (const part of ["function", "method", "feature"] as BriefPart[]) {
    const lines = Array.isArray(raw.spec?.[part]) ? raw.spec[part] : [];
    lines.forEach((l: any, i: number) => {
      const item = `spec.${part}[${i}]`;
      if (spec[part].length >= BRIEF_LIMITS[part]) { refused.push({ item, reason: `over the limit of ${BRIEF_LIMITS[part]} ${part} lines` }); return; }
      const t = str(l?.text, BRIEF_LIMITS.text + 40);
      if (!t) { refused.push({ item, reason: "no text" }); return; }
      const words = strs(l?.words).map((w) => w.toLowerCase());
      const known = words.filter((w) => vocab[part][w]);
      const unknown = words.filter((w) => !vocab[part][w]);
      if (unknown.length) refused.push({ item, reason: `word(s) not in the ${part} vocabulary: ${unknown.join(", ")}` });
      if (!known.length) { refused.push({ item, reason: `"${t.slice(0, 60)}" uses no ${part} word from the vocabulary — refused` }); return; }
      const lineRefused: Proposed["refused"] = [];
      const { cites, dropped } = keepCites(l?.cites, item);
      const boxes = strs(l?.boxes).filter((b) => facts.boxes.has(b));
      const entries = [...new Set(boxes.flatMap((b) => facts.boxEntries.get(b) ?? []))];
      const claims = parseClaims(l?.claims, item, lineRefused);
      const line: BriefLine = { text: t.length > BRIEF_LIMITS.text ? boundLabelTo(t, BRIEF_LIMITS.text) : t, words: known, cites, ...(boxes.length ? { boxes } : {}), ...(entries.length ? { entries } : {}), ...(dropped.length ? { dropped } : {}), ...(claims.length ? { claims } : {}) };
      const checked = checkLine(part, line, facts, { absolutes: meta.absolutes });
      refused.push(...lineRefused);
      if (checked.errors.length) { for (const e of checked.errors) refused.push({ item, reason: `"${t.slice(0, 60)}" refused: ${e}` }); return; }
      spec[part].push(line);
    });
  }

  // groups and names
  const groups: BriefGroupOp[] = [];
  const placed = new Map<string, string>();
  (Array.isArray(raw.groups) ? raw.groups : []).forEach((g: any, i: number) => {
    const item = `groups[${i}]`;
    if (groups.length >= BRIEF_LIMITS.groups) { refused.push({ item, reason: `over the limit of ${BRIEF_LIMITS.groups} group changes` }); return; }
    const op = ["keep", "rename", "add", "move"].includes(g?.op) ? g.op : null;
    const id = str(g?.id, 60);
    if (!op || !/^[A-Za-z0-9][\w:.-]{0,59}$/.test(id)) { refused.push({ item, reason: "a group change needs an op (keep / rename / add / move) and an id" }); return; }
    const existing = facts.groups.find((x) => x.id === id);
    if ((op === "keep" || op === "rename" || op === "move") && !existing) { refused.push({ item, reason: `no group ${id} to ${op}` }); return; }
    if (op === "add" && existing) { refused.push({ item, reason: `group ${id} exists — rename or move instead of add` }); return; }
    const { cites } = keepCites(g?.cites, item);
    if (op !== "keep" && !cites.length) { refused.push({ item, reason: `${op} ${id}: no valid citation — a group change needs one` }); return; }
    const members: string[] = [];
    for (const m of strs(g?.members)) {
      if (!facts.boxes.has(m)) { refused.push({ item, reason: `member ${m} is not a box on the map` }); continue; }
      if (placed.has(m) && placed.get(m) !== id) { refused.push({ item, reason: `member ${m} is already in ${placed.get(m)} — every box sits in one group` }); continue; }
      placed.set(m, id); members.push(m);
    }
    const kind = GROUP_KINDS.includes(g?.kind) ? g.kind : undefined;
    if (op === "add" && !members.length) { refused.push({ item, reason: `add ${id}: no member that exists` }); return; }
    groups.push({ op, id, ...(op === "rename" || op === "add" ? { label: boundLabel(str(g?.label, 120) || id) } : {}), ...(kind ? { kind } : {}), ...(members.length ? { members } : {}), cites });
  });
  const names: BriefBody["names"] = {};
  for (const [box, n] of Object.entries(raw.names && typeof raw.names === "object" ? raw.names : {})) {
    const item = `names.${box}`;
    if (!facts.boxes.has(box)) { refused.push({ item, reason: `no box ${box}` }); continue; }
    if (Object.keys(names).length >= BRIEF_LIMITS.names) { refused.push({ item, reason: `over the limit of ${BRIEF_LIMITS.names} names` }); continue; }
    const name = boundLabel(str((n as any)?.name, 120));
    if (!name) { refused.push({ item, reason: "no name" }); continue; }
    names[box] = { name, cites: keepCites((n as any)?.cites, item, box).cites };
  }

  // scopes — silent boxes only
  const ops = new Set(opVocab.words.map((w) => w.id));
  const scopes: BriefScope[] = [];
  (Array.isArray(raw.scopes) ? raw.scopes : []).forEach((s: any, i: number) => {
    const item = `scopes[${i}]`;
    const box = str(s?.box, 200);
    if (!facts.silent.includes(box)) { refused.push({ item, reason: `${box || "(no box)"} is not one of the silent boxes shown` }); return; }
    if (scopes.length >= BRIEF_LIMITS.scopes) { refused.push({ item, reason: `over the limit of ${BRIEF_LIMITS.scopes} scopes` }); return; }
    const words = (Array.isArray(s?.words) ? s.words : []).flatMap((w: any) => {
      const word = str(w?.word, 40).toLowerCase();
      if (!ops.has(word)) { refused.push({ item, reason: `operation word "${word}" is not in the vocabulary` }); return []; }
      return [{ word, cites: keepCites(w?.cites, `${item}.${word}`, box).cites }];
    });
    scopes.push({ box, summary: str(s?.summary, 240), words, cites: keepCites(s?.cites, item, box).cites });
  });

  // path and omitted
  let primaryPath: BriefBody["primaryPath"] = null;
  if (raw.primaryPath && Array.isArray(raw.primaryPath.steps)) {
    const steps = strs(raw.primaryPath.steps).filter((st) => {
      const ok = facts.boxes.has(st) || facts.entries.has(st);
      if (!ok) refused.push({ item: "primaryPath", reason: `step ${st} is not a box or an entry point` });
      return ok;
    }).slice(0, BRIEF_LIMITS.path);
    if (steps.length) primaryPath = { steps, cites: keepCites(raw.primaryPath.cites, "primaryPath").cites };
  }
  const omitted = [...strs(raw.omitted).map((o) => (o.length > 300 ? boundLabelTo(o, 300) : o)).slice(0, BRIEF_LIMITS.omitted), ...facts.leftOut];

  const asked = (s: BriefOnly) => !meta.only || meta.only === s;
  const empty = !spec.function.length && !spec.method.length && !spec.feature.length && !groups.length && !Object.keys(names).length && !scopes.length && !primaryPath;
  if (empty) return { brief: null, error: `nothing in the reply survived the checks${refused.length ? `: ${refused.slice(0, 3).map((r) => `${r.item} — ${r.reason}`).join("; ")}` : ""}` };
  // a note no line follows and `omitted` does not answer
  if (facts.notes.length && asked("spec")) {
    for (const n of briefCoverage(spec, facts, omitted).notes) refused.push({ item: `note:${n}`, reason: `the person's note "${facts.notes[n - 1].slice(0, 80)}" is not answered — no line cites note:${n} and omitted does not say why` });
  }
  const hashes: Record<string, string> = {};
  const basis: Record<string, string> = {};
  const codeHashes: NonNullable<Proposed["codeHashes"]> = {};
  for (const c of kept) {
    const content = facts.cites.get(c) ?? "";
    hashes[c] = hash16(content);
    basis[c] = content.replace(/\s+/g, " ").slice(0, 160);
    const code = facts.code.get(c);
    if (code) codeHashes[c] = code;
  }
  return {
    brief: {
      spec: asked("spec") ? spec : { function: [], method: [], feature: [] },
      groups: asked("groups") ? groups : [], names: asked("groups") ? names : {},
      scopes: asked("scopes") ? scopes : [], primaryPath: asked("path") ? primaryPath : null,
      omitted, model: meta.model, at: (meta.now ?? (() => new Date()))().toISOString(), refused, scheme: 2, hashes, basis, codeHashes, estimate: facts.estimate,
      ...(facts.notes.length ? { notes: facts.notes } : {}),
    },
  };
}

function boundLabelTo(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:·—-]+$/, "")}…`;
}
