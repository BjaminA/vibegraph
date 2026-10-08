// THE BRIEF ON DISK (2026-10-08): `.vibegraph/brief.json`. A model's brief is
// PROPOSED; a person ratifies or rejects it section by section (spec, groups,
// scopes, path) — never an agent (the CLI's person-only steps, the inbox).
//
//   spec     ratified here: the lines the map card, architecture.md and the
//            hooks carry
//   groups   ratified INTO .vibegraph/architecture.json: renames, new groups,
//            moved members and names become stated groups / names there, so
//            the map and drift keep one source
//   scopes   ratified into architecture.json's scopes (In → Process → Out)
//   path     ratified into architecture.json's primary path
//
// A ratified line is STALE when exactly what it cites changed (B7): the hash
// kept at proposal time no longer matches the item's content now, or the code
// a cited rule guards changed — each said apart, with what it was. A source
// that cannot be read now is NOT KNOWN, never "changed" (briefWithStaleness).

import * as fs from "fs";
import * as path from "path";
import type { BriefBody, BriefHashes, BriefLine, BriefRecord, BriefSection } from "../shared/brief_types.ts";
import { loadArchStore, saveArchStore, type ArchStore, type StatedGroup } from "./arch_store.ts";
import { hash16, type BriefFacts } from "./brief_facts.ts";

export const BRIEF_FILE = path.join(".vibegraph", "brief.json");

export function loadBrief(root: string): BriefRecord {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, BRIEF_FILE), "utf-8"));
    if (raw?.version === "1") return raw as BriefRecord;
  } catch { /* none yet */ }
  return { version: "1" };
}

export function saveBrief(root: string, rec: BriefRecord): void {
  const p = path.join(root, BRIEF_FILE);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(`${p}.tmp`, JSON.stringify(rec, null, 2) + "\n", "utf-8");
  fs.renameSync(`${p}.tmp`, p);
}

/** A new proposal. A scopes batch (`only: "scopes"`) ADDS to a pending one. */
export function proposeBrief(rec: BriefRecord, proposed: NonNullable<BriefRecord["proposed"]>, only?: string): BriefRecord {
  const mergeHashes = (a: NonNullable<BriefRecord["proposed"]>, b: NonNullable<BriefRecord["proposed"]>) => ({
    hashes: { ...a.hashes, ...b.hashes }, basis: { ...(a.basis ?? {}), ...(b.basis ?? {}) }, codeHashes: { ...(a.codeHashes ?? {}), ...(b.codeHashes ?? {}) }, scheme: b.scheme,
  });
  if (only === "scopes" && rec.proposed) {
    const have = new Set(rec.proposed.scopes.map((s) => s.box));
    return { ...rec, proposed: { ...rec.proposed, scopes: [...rec.proposed.scopes, ...proposed.scopes.filter((s) => !have.has(s.box))], refused: [...rec.proposed.refused, ...proposed.refused], ...mergeHashes(rec.proposed, proposed) } };
  }
  if (only && rec.proposed) {
    // one section re-asked: replace that section, keep the rest of the pending proposal
    const p = { ...rec.proposed };
    if (only === "spec") { p.spec = proposed.spec; p.notes = proposed.notes; }
    if (only === "groups") { p.groups = proposed.groups; p.names = proposed.names; }
    if (only === "path") p.primaryPath = proposed.primaryPath;
    return { ...rec, proposed: { ...p, refused: [...p.refused, ...proposed.refused], ...mergeHashes(rec.proposed, proposed), model: proposed.model, at: proposed.at } };
  }
  return { ...rec, proposed };
}

/** What a section of the pending proposal holds, in one line (for the inbox and the CLI). */
export function sectionSummary(p: NonNullable<BriefRecord["proposed"]>, s: BriefSection): string | null {
  if (s === "spec") { const n = p.spec.function.length + p.spec.method.length + p.spec.feature.length; return n ? `${p.spec.function.length} function · ${p.spec.method.length} method · ${p.spec.feature.length} feature line(s)` : null; }
  if (s === "groups") { const n = p.groups.filter((g) => g.op !== "keep").length + Object.keys(p.names).length; return n ? `${p.groups.filter((g) => g.op !== "keep").length} group change(s) · ${Object.keys(p.names).length} name(s)` : null; }
  if (s === "scopes") return p.scopes.length ? `${p.scopes.length} scope(s): ${p.scopes.map((x) => x.box).slice(0, 4).join(", ")}${p.scopes.length > 4 ? ", …" : ""}` : null;
  return p.primaryPath ? `start here: ${p.primaryPath.steps.join(" → ")}` : null;
}

/** Group changes and names, applied to the architecture store as STATED. */
export function applyBriefGroups(store: ArchStore, groups: BriefBody["groups"], names: BriefBody["names"], model: string): ArchStore {
  const out: ArchStore = { ...store, groups: store.groups.map((g) => ({ ...g, wraps: [...g.wraps] })), names: { ...store.names } };
  const note = (cites: string[]) => `from the brief (${model}); evidence: ${cites.join(", ") || "none — INFERRED"}`;
  for (const g of groups) {
    if (g.op === "keep") continue;
    const moving = g.members ?? [];
    for (const other of out.groups) if (other.id !== g.id) other.wraps = other.wraps.filter((w) => !moving.includes(w));
    const cur = out.groups.find((x) => x.id === g.id);
    if (g.op === "add" && !cur) out.groups.push({ id: g.id, kind: g.kind ?? "process", label: g.label ?? g.id, wraps: moving, note: note(g.cites) } as StatedGroup);
    else if (cur) {
      if (g.op === "rename" && g.label) { cur.label = g.label; delete cur.labelFrom; }
      if (moving.length) cur.wraps = [...new Set([...cur.wraps, ...moving])];
      cur.note = [cur.note, note(g.cites)].filter(Boolean).join("; ");
    }
  }
  for (const [box, n] of Object.entries(names)) out.names[box] = n.name;
  return out;
}

/** A person decides one section (or all of them). Returns what changed, or why not. */
export function decideBrief(root: string, section: BriefSection | "all", decision: "ratify" | "reject", who: string, now: Date = new Date()): { ok: boolean; detail: string } {
  const rec = loadBrief(root);
  const p = rec.proposed;
  if (!p) return { ok: false, detail: "no brief is waiting for a decision (`vibegraph-knowledge brief` drafts one)" };
  const sections = section === "all" ? (["spec", "groups", "scopes", "path"] as BriefSection[]).filter((s) => sectionSummary(p, s)) : [section];
  if (!sections.length || sections.some((s) => !sectionSummary(p, s))) return { ok: false, detail: `the pending brief has no ${section} section` };
  const at = now.toISOString();
  const ratified = rec.ratified ?? { at, by: who, model: p.model, hashes: {} };
  let arch: ArchStore | null = null;
  const done: string[] = [];
  for (const s of sections) {
    if (decision === "ratify") {
      if (s === "spec") {
        // a re-brief of stale lines replaces exactly those, keeping the rest
        const keep = (part: keyof BriefBody["spec"]) => (p.restates && ratified.spec ? ratified.spec[part].filter((l) => !p.restates!.includes(l.text)) : []);
        ratified.spec = p.restates && ratified.spec
          ? { function: [...keep("function"), ...p.spec.function], method: [...keep("method"), ...p.spec.method], feature: [...keep("feature"), ...p.spec.feature] }
          : p.spec;
        // per citation: its hash, its content as it was (scheme 2) and the
        // code a cited rule guards — a citation with no `basis` is 0.29.0's
        for (const l of allLines(p.spec)) for (const c of l.cites) {
          if (p.hashes[c]) ratified.hashes[c] = p.hashes[c];
          if (p.basis?.[c] !== undefined) (ratified.basis ??= {})[c] = p.basis[c];
          else if (ratified.basis) delete ratified.basis[c];
          if (p.codeHashes?.[c]) (ratified.codeHashes ??= {})[c] = p.codeHashes[c];
          else if (ratified.codeHashes) delete ratified.codeHashes[c];
        }
        if (p.scheme) ratified.scheme = p.scheme;
      }
      if (s === "groups") { arch = applyBriefGroups(arch ?? loadArchStore(root), p.groups, p.names, p.model); }
      if (s === "scopes") {
        arch ??= loadArchStore(root);
        arch.scopes = { ...(arch.scopes ?? {}) };
        for (const sc of p.scopes) {
          arch.scopes[sc.box] = { node: sc.box, ratified: { at: p.at, model: p.model, summary: sc.summary, words: sc.words.map((w) => ({ word: w.word, evidence: w.cites })), in: [], out: [], refused: [], ratifiedAt: at } };
        }
        ratified.scopes = p.scopes;
      }
      if (s === "path" && p.primaryPath) {
        arch ??= loadArchStore(root);
        arch.primaryPath = p.primaryPath.steps;
        ratified.path = p.primaryPath;
      }
    }
    // the decided section leaves the proposal
    if (s === "spec") p.spec = { function: [], method: [], feature: [] };
    if (s === "groups") { p.groups = []; p.names = {}; }
    if (s === "scopes") p.scopes = [];
    if (s === "path") p.primaryPath = null;
    done.push(s);
    rec.history = [...(rec.history ?? []), { at, by: who, section: s, decision, model: p.model }].slice(-50);
  }
  if (decision === "ratify") rec.ratified = { ...ratified, at, by: who, model: p.model };
  if (arch) saveArchStore(root, arch);
  const left = (["spec", "groups", "scopes", "path"] as BriefSection[]).some((s) => sectionSummary(p, s));
  rec.proposed = left ? p : undefined;
  saveBrief(root, rec);
  return { ok: true, detail: `${decision === "ratify" ? "ratified" : "rejected"} the brief's ${done.join(", ")} (from ${p.model}, by ${who})${decision === "ratify" && done.some((s) => s !== "spec") ? " — groups, scopes and the path are now stated in .vibegraph/architecture.json" : ""}` };
}

export const allLines = (spec: BriefBody["spec"]): BriefLine[] => [...spec.function, ...spec.method, ...spec.feature];

const oneLine = (s: string, n = 90) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** What changed under one citation, or null when nothing did (B7). */
export function citationChange(c: string, saved: BriefHashes, facts: Pick<BriefFacts, "cites" | "code" | "legacy">): string | null {
  if (!facts.cites.has(c)) return `${c} is no longer among the facts (removed, or out of the facts pack)`;
  const now = facts.cites.get(c) ?? "";
  const was = saved.hashes[c];
  if (was) {
    if (saved.basis?.[c] !== undefined) {
      if (was !== hash16(now)) return c.startsWith("rule:") ? `${c} changed — its text, check or scope (was: "${oneLine(saved.basis[c])}")` : `${c} changed — was: "${oneLine(saved.basis[c])}", now: "${oneLine(now)}"`;
    } else {
      // written by 0.29.0: fresh if it matches any way that version hashed it
      const ok = was === hash16(now) || (facts.legacy.get(c) ?? []).some((b) => hash16(b) === was);
      if (!ok) return `${c} changed (written before 0.29.1, which kept no record of what it was)`;
    }
  }
  const code = saved.codeHashes?.[c];
  const nowCode = facts.code.get(c);
  // the code is compared only when it can be read now: not known is not changed
  if (code && nowCode && code.hash !== nowCode.hash) return `the code ${c} guards changed: ${code.names.slice(0, 3).join(", ") || "its functions"}`;
  return null;
}

/** The ratified spec with each line's STALE citations marked against the facts now. */
export function briefWithStaleness(rec: BriefRecord, facts: Pick<BriefFacts, "cites" | "code" | "legacy"> | null): BriefRecord["ratified"] {
  const r = rec.ratified;
  if (!r?.spec || !facts) return r;
  const mark = (l: BriefLine): BriefLine => {
    const why: string[] = [], stale: string[] = [];
    for (const c of l.cites) { const w = citationChange(c, r, facts); if (w) { stale.push(c); why.push(w); } }
    return stale.length ? { ...l, stale, staleWhy: why } : l;
  };
  return { ...r, spec: { function: r.spec.function.map(mark), method: r.spec.method.map(mark), feature: r.spec.feature.map(mark) } };
}

/** The ratified spec as the page an agent reads first (architecture.md). */
export function briefMarkdown(r: BriefRecord["ratified"]): string[] {
  if (!r?.spec || !allLines(r.spec).length) return [];
  const line = (l: BriefLine) => `- ${l.text}${l.stale?.length ? ` **[STALE: ${(l.staleWhy ?? ["a line it cites changed"])[0]}]**` : ""}${l.cites.length ? ` _(${l.cites.slice(0, 4).join(", ")}${l.cites.length > 4 ? ", …" : ""})_` : " _(INFERRED — no citation)_"}`;
  const out = ["## Brief", "", `> Written by ${r.model}, ratified by ${r.by} on ${r.at.slice(0, 10)}. Every line cites what the model was shown; a STALE line rests on code that changed since.`, ""];
  for (const [title, part] of [["Function", "function"], ["Method", "method"], ["Key features", "feature"]] as const) {
    if (!r.spec[part].length) continue;
    out.push(`**${title}**`, ...r.spec[part].map(line), "");
  }
  return out;
}
