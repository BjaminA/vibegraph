// WHAT A BRIEF MUST COVER (2026-10-08, the Brief review's B12). Zero tokens.
//
//   rules     every rule a PERSON stated is the system's own account of what
//             matters: each must be cited by a brief line, or named in
//             `omitted` with a reason
//   salient   the mechanisms that matter most, ranked from facts alone — how
//             many stated rules name a file (through their checks) and how many
//             threads reach it (code every reader goes through is core); the
//             model is told the top few and must cover them
//   docs      the project's own doc lines, ranked by how much they talk about
//             THIS code (its boxes, entry points, zones, rule ids, plan words),
//             a tool's own feedback and reference folders left out by default
//             (the first brief here was shown 32 lines of VibeGraph's own
//             feedback log out of 40, and none of the handover)

import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchModelRecord } from "../shared/protocol.ts";
import type { Plan } from "../shared/plan_types.ts";
import type { Constraint } from "./constraint_store.ts";
import type { ModelSource } from "./model_source.ts";
import { docFiles } from "./stack_classify.ts";
import { isVerifyFile } from "./brief_data.ts";

export interface RuleSite { file: string; line: number; name: string }
export interface SalientFile { file: string; score: number; why: string; sites: RuleSite[] }

/** The functions a rule's check names (`target`, `guard`), any verb. */
export function ruleTargets(c: Pick<Constraint, "check" | "checks">): string[] {
  const names = new Set<string>();
  for (const k of [c.check, ...(c.checks ?? [])]) {
    for (const v of [(k as { target?: unknown } | undefined)?.target, (k as { guard?: unknown } | undefined)?.guard]) {
      for (const s of Array.isArray(v) ? v : [v]) if (typeof s === "string" && !s.includes("*")) names.add(s);
    }
  }
  return [...names].sort();
}

/** The files a rule's check scopes to (`files` on callers-only and the like). */
const ruleFiles = (c: Pick<Constraint, "check" | "checks">): string[] =>
  [c.check, ...(c.checks ?? [])].flatMap((k) => ((k as { files?: unknown } | undefined)?.files as string[] | undefined) ?? []).filter((f) => typeof f === "string");

/** The rules people stated (what the brief must cover). */
export const humanRules = (constraints: Constraint[]): Constraint[] => constraints.filter((c) => c.source === "human");

export function salientFiles(src: ModelSource | null, constraints: Constraint[], sites: Map<string, RuleSite[]>, k = 5): SalientFile[] {
  if (!src) return [];
  const named = new Map<string, Set<string>>();
  for (const c of constraints) {
    const files = [...(sites.get(c.id) ?? []).map((s) => s.file), ...ruleFiles(c)];
    for (const f of files) named.set(f, new Set([...(named.get(f) ?? []), c.id]));
  }
  const reach = new Map<string, number>();
  const threads = (src.threads ?? []).filter((t) => t.entryPointId && !isVerifyFile(String(t.entryPointId).split(":")[0]));
  for (const t of threads) for (const f of new Set(t.filesReached ?? [])) reach.set(f, (reach.get(f) ?? 0) + 1);
  const T = threads.length;
  const out: SalientFile[] = [];
  for (const file of new Set([...named.keys(), ...reach.keys()])) {
    if (isVerifyFile(file) || !src.files[file]) continue;
    const rules = [...(named.get(file) ?? [])].sort();
    const n = reach.get(file) ?? 0;
    // entry files are reached by their own thread: a file counts by REACH only
    // when several processes' threads go through it
    if (!rules.length && (n < 3 || n < T * 0.4)) continue;
    const defs = (src.files[file].nodes ?? []).filter((x: any) => x?.type === "function_def" && typeof x.name === "string" && typeof x.line === "number");
    const fromRules = (sites.get(rules[0] ?? "") ?? []).filter((s) => s.file === file);
    const pick: RuleSite[] = [...fromRules, ...defs.filter((d: any) => !fromRules.some((s) => s.name === d.name)).map((d: any) => ({ file, line: d.line, name: d.name }))].slice(0, 3);
    const why = [rules.length ? `named by ${rules.length === 1 ? "rule" : "rules"} ${rules.join(", ")}` : "", n ? `reached by ${n} of ${T} threads` : ""].filter(Boolean).join("; ");
    out.push({ file, score: rules.length * 5 + n, why, sites: pick });
  }
  return out.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, k);
}

export interface DocLine { file: string; line: number; text: string; score: number }

/** A tool's own feedback and reference folders, never the project's account of itself. */
const DEFAULT_DOC_EXCLUDE = [/(^|\/)\.vibegraph\//, /vibegraph/i, /(^|\/)node_modules\//, /(^|\/)CHANGELOG\.md$/i];

export function briefDocs(root: string, model: ArchModelRecord, constraints: Constraint[], plan: Plan | null | undefined, opts: { exclude?: string[]; max?: number; perFile?: number } = {}): DocLine[] {
  const max = opts.max ?? 40, perFile = opts.perFile ?? 12;
  const terms = new Set<string>();
  const add = (s: string | undefined) => { const t = (s ?? "").toLowerCase().trim(); if (t.length > 3) terms.add(t); };
  for (const n of model.nodes) {
    if (n.tool) add(n.tool);
    if (n.zoneOf) add(n.label);
    for (const ep of n.entryPoints ?? []) add(path.basename(ep.split(":")[0]).replace(/\.\w+$/, ""));
  }
  for (const pr of plan?.processes ?? []) { add(pr.id); add(pr.label); }
  for (const w of (plan?.objective ?? "").split(/\W+/)) if (w.length > 5) add(w);
  const ruleIds = new Set(constraints.map((c) => c.id.toLowerCase()));
  const excluded = (rel: string) => DEFAULT_DOC_EXCLUDE.some((re) => re.test(rel)) || (opts.exclude ?? []).some((x) => rel === x || rel.startsWith(x.endsWith("/") ? x : `${x}/`));
  const all: DocLine[] = [];
  for (const abs of docFiles(root, { maxFiles: 80, depth: 3 })) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (excluded(rel)) continue;
    let text: string;
    try { if (fs.statSync(abs).size > 512 * 1024) continue; text = fs.readFileSync(abs, "utf-8"); } catch { continue; }
    const lines = text.split(/\r?\n/);
    const mine: DocLine[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l.length < 16 || l.length > 400) continue;
      const lower = l.toLowerCase();
      let score = 0;
      for (const t of terms) if (lower.includes(t)) score++;
      for (const m of lower.matchAll(/\b(c\d+)\b/g)) if (ruleIds.has(m[1])) score += 2;
      if (score >= 2) mine.push({ file: rel, line: i + 1, text: l.slice(0, 240), score });
    }
    all.push(...mine.sort((a, b) => b.score - a.score).slice(0, perFile));
  }
  return all.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line).slice(0, max);
}
