// What a brief is written from, gathered once for the CLI, the live server and
// the export (2026-10-08): the map with the stated layer on it, the declared
// topology, the rules, the plan, ratified specs, both vocabularies, the code
// behind the map — and the facts pack built from them (brief_facts.ts).

import * as fs from "fs";
import * as path from "path";
import type { ArchModelRecord } from "../shared/protocol.ts";
import type { SdkCall } from "../shared/data_arch_types.ts";
import { mergeBriefVocabulary, BRIEF_LIMITS, type BriefVocabulary, type BriefRecord } from "../shared/brief_types.ts";
import type { Vocabulary } from "../shared/node_io.ts";
import { buildBriefFacts, silentBoxes, BRIEF_FACT_LIMITS, type BriefFacts, type RuleCode } from "./brief_facts.ts";
import { linesReader } from "./node_scope.ts";
import { loadVocabulary } from "./operation_vocab.ts";
import { loadPlan } from "./plan_store.ts";
import { loadConstraints } from "./constraint_store.ts";
import { listSpecs } from "./software_store.ts";
import { loadTopology } from "./topology_store.ts";
import { loadArchStore } from "./arch_store.ts";
import { staleLabels, declaredTopology } from "./arch_label_drift.ts";
import { modelSource, type ModelSource } from "./model_source.ts";
import { sdkCallsOf } from "./sdk_effects.ts";
import { ruleTargets } from "./brief_salience.ts";
import type { Constraint } from "./constraint_store.ts";
import { loadBrief, briefWithStaleness, allLines } from "./brief_store.ts";
import { reviewBrief, reviewText } from "./brief_review.ts";

export const BRIEF_VOCAB_FILE = path.join(".vibegraph", "brief-vocabulary.json");

/** The project's brief settings: its own words (`function` / `method` /
 *  `feature`), its own absolute words (`absolutes`) and the doc paths it
 *  leaves out of the brief (`excludeDocs`). */
export function loadBriefVocabulary(root: string): { vocab: BriefVocabulary; errors: string[]; absolutes: string[]; excludeDocs: string[] } {
  let raw: any;
  try { raw = JSON.parse(fs.readFileSync(path.join(root, BRIEF_VOCAB_FILE), "utf-8")); } catch (e: any) {
    if (e?.code === "ENOENT") return { ...mergeBriefVocabulary(undefined), absolutes: [], excludeDocs: [] };
    return { ...mergeBriefVocabulary(undefined), errors: [`${BRIEF_VOCAB_FILE}: ${e?.message ?? e}`], absolutes: [], excludeDocs: [] };
  }
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim()) : []);
  return { ...mergeBriefVocabulary(raw), absolutes: list(raw?.absolutes).map((s) => s.toLowerCase()), excludeDocs: list(raw?.excludeDocs) };
}

export interface BriefInputs { facts: BriefFacts; vocab: BriefVocabulary; opVocab: Vocabulary; absolutes: string[]; errors: string[] }

/** `only: "scopes"` — the next batch of silent boxes not yet scoped. `notes` —
 *  the person's corrections, for "brief again with notes". */
export function briefInputs(root: string, model: ArchModelRecord, opts: { only?: string; pending?: BriefRecord["proposed"]; notes?: string[] } = {}): BriefInputs {
  const { vocab, errors, absolutes, excludeDocs } = loadBriefVocabulary(root);
  const op = loadVocabulary(root);
  let specs: ReturnType<typeof listSpecs> = [];
  try { specs = listSpecs(root); } catch { specs = []; }
  let constraints: ReturnType<typeof loadConstraints> = [];
  try { constraints = loadConstraints(root); } catch { constraints = []; }
  let topology = null;
  try { const m = loadTopology(root); topology = m.status.length ? m.topology : null; } catch { topology = null; }
  let silentOnly: string[] | undefined;
  if (opts.only === "scopes") {
    const done = new Set([...Object.keys(loadArchStore(root).scopes ?? {}), ...(opts.pending?.scopes ?? []).map((s) => s.box)]);
    silentOnly = silentBoxes(model, op.vocab).filter((id) => !done.has(id)).slice(0, BRIEF_LIMITS.scopes);
  }
  let stale: ReturnType<typeof staleLabels> = [];
  try { stale = staleLabels(model, loadArchStore(root), declaredTopology(root)); } catch { stale = []; }
  const readLines = linesReader(root);
  const source = modelSource(model);
  const facts = buildBriefFacts(model, {
    root, readLines, plan: loadPlan(root), topology, constraints, specs, vocab: op.vocab, silentOnly, staleLabels: stale,
    ruleCode: ruleCodeReader(source, readLines), source, grantCalls: grantCalls(source), docExclude: excludeDocs, notes: opts.notes,
  });
  return { facts, vocab, opVocab: op.vocab, absolutes, errors: [...errors, ...op.errors] };
}

/** The grant / admin calls the code makes: where an access rule is APPLIED.
 *  Read once per parse (the files object changes on every re-derive). */
const grantMemo = new WeakMap<object, SdkCall[]>();
function grantCalls(src: ModelSource | null): SdkCall[] {
  if (!src?.files) return [];
  const hit = grantMemo.get(src.files);
  if (hit) return hit;
  let calls: SdkCall[] = [];
  try { calls = sdkCallsOf(src.files as never, (src.stack ?? {}) as never).filter((c) => c.effect === "grant" || c.effect === "admin"); } catch { calls = []; }
  grantMemo.set(src.files, calls);
  return calls;
}

/** What each rule's check guards: the source of the project functions it
 *  names (`target`, `guard`; `Class.method` or a bare name — an external
 *  `lib.fn` matches no definition and adds nothing), at most three
 *  definitions per name, hashed by structural id and text, never by line
 *  number (an edit above a function moves it and changes nothing it says).
 *  `legacy` is the same text in the form 0.29.0 hashed it. */
function ruleCodeReader(src: ModelSource | null, readLines: (f: string) => string[] | null): (c: Constraint) => RuleCode | null {
  if (!src?.files) return () => null;
  const defs = new Map<string, Array<{ file: string; id: string; line: number; endLine: number }>>();
  for (const [file, ir] of Object.entries(src.files)) {
    for (const n of ir.nodes ?? []) {
      if (n?.type !== "function_def" || typeof n.name !== "string" || typeof n.line !== "number") continue;
      const list = defs.get(n.name) ?? [];
      list.push({ file, id: String(n.id ?? ""), line: n.line, endLine: typeof n.endLine === "number" ? n.endLine : n.line });
      defs.set(n.name, list);
    }
  }
  return (c) => {
    const out: string[] = [];
    const names: string[] = [];
    const sites: RuleCode["sites"] = [];
    for (const name of ruleTargets(c)) {
      const [cls, fn] = name.includes(".") ? [name.slice(0, name.lastIndexOf(".")), name.slice(name.lastIndexOf(".") + 1)] : [null, name];
      const found = (defs.get(fn) ?? []).filter((d) => !cls || d.id.includes(`${cls}.class/`)).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line).slice(0, 3);
      for (const d of found) {
        out.push(`${d.file} ${d.id}\n${(readLines(d.file) ?? []).slice(d.line - 1, d.endLine).join("\n")}`);
        names.push(`${fn} (${d.file})`);
        sites.push({ file: d.file, line: d.line, name: fn });
      }
    }
    const text = out.join("\n");
    return { code: text, legacy: text, names, sites };
  };
}

/** How many calls a full brief takes, and roughly how many input tokens. */
export function briefEstimate(root: string, model: ArchModelRecord): { calls: number; tokens: number; silent: number } {
  const first = briefInputs(root, model);
  const rest = first.facts.silentRest.length;
  const batches = Math.ceil(rest / BRIEF_LIMITS.scopes);
  // a scopes batch repeats the facts pack, with its own silent boxes
  return { calls: 1 + batches, tokens: first.facts.estimate * (1 + batches), silent: first.facts.silent.length + rest };
}

/** The ratified Brief's lines whose citations changed (text, then what changed). */
export function staleBriefLines(root: string, model: ArchModelRecord): string[] {
  const rec = loadBrief(root);
  if (!rec.ratified?.spec) return [];
  const r = briefWithStaleness(rec, briefInputs(root, model).facts);
  return r?.spec ? allLines(r.spec).filter((l) => l.stale?.length).map((l) => `${l.text} — ${(l.staleWhy ?? l.stale!).slice(0, 2).join("; ")}`) : [];
}

/** The pending brief's review sheet as text (the inbox shows it beside Ratify). */
export function pendingBriefReview(root: string, model: ArchModelRecord): string[] {
  const rec = loadBrief(root);
  const p = rec.proposed;
  if (!p || !allLines(p.spec).length) return [];
  const inp = briefInputs(root, model, { notes: p.notes });
  return reviewText(reviewBrief(p.spec, inp.facts, { omitted: p.omitted, absolutes: inp.absolutes }), 12);
}

export { BRIEF_FACT_LIMITS };
