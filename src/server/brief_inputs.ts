// What a brief is written from, gathered once for the CLI, the live server and
// the export (2026-10-08): the map with the stated layer on it, the declared
// topology, the rules, the plan, ratified specs, both vocabularies — and the
// facts pack built from them (brief_facts.ts).

import * as fs from "fs";
import * as path from "path";
import type { ArchModelRecord } from "../shared/protocol.ts";
import { mergeBriefVocabulary, BRIEF_LIMITS, type BriefVocabulary, type BriefRecord } from "../shared/brief_types.ts";
import type { Vocabulary } from "../shared/node_io.ts";
import { buildBriefFacts, silentBoxes, BRIEF_FACT_LIMITS, type BriefFacts } from "./brief_facts.ts";
import { linesReader } from "./node_scope.ts";
import { loadVocabulary } from "./operation_vocab.ts";
import { loadPlan } from "./plan_store.ts";
import { loadConstraints } from "./constraint_store.ts";
import { listSpecs } from "./software_store.ts";
import { loadTopology } from "./topology_store.ts";
import { loadArchStore } from "./arch_store.ts";
import { staleLabels, declaredTopology } from "./arch_label_drift.ts";
import { modelSource } from "./model_source.ts";
import type { Constraint } from "./constraint_store.ts";
import { loadBrief, briefWithStaleness, allLines } from "./brief_store.ts";

export const BRIEF_VOCAB_FILE = path.join(".vibegraph", "brief-vocabulary.json");

export function loadBriefVocabulary(root: string): { vocab: BriefVocabulary; errors: string[] } {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(path.join(root, BRIEF_VOCAB_FILE), "utf-8")); } catch (e: any) {
    if (e?.code === "ENOENT") return mergeBriefVocabulary(undefined);
    return { ...mergeBriefVocabulary(undefined), errors: [`${BRIEF_VOCAB_FILE}: ${e?.message ?? e}`] };
  }
  return mergeBriefVocabulary(raw);
}

export interface BriefInputs { facts: BriefFacts; vocab: BriefVocabulary; opVocab: Vocabulary; errors: string[] }

/** `only: "scopes"` — the next batch of silent boxes not yet scoped. */
export function briefInputs(root: string, model: ArchModelRecord, opts: { only?: string; pending?: BriefRecord["proposed"] } = {}): BriefInputs {
  const { vocab, errors } = loadBriefVocabulary(root);
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
  const facts = buildBriefFacts(model, { root, readLines, plan: loadPlan(root), topology, constraints, specs, vocab: op.vocab, silentOnly, staleLabels: stale, ruleCode: ruleCodeReader(modelSource(model), readLines) });
  return { facts, vocab, opVocab: op.vocab, errors: [...errors, ...op.errors] };
}

/** The source of the project functions a rule's check names (`target`,
 *  `guard`; `Class.method` or a bare name — an external `lib.fn` matches no
 *  definition and adds nothing). At most three definitions per name. */
function ruleCodeReader(files: ReturnType<typeof modelSource>, readLines: (f: string) => string[] | null): (c: Constraint) => string {
  if (!files) return () => "";
  const defs = new Map<string, Array<{ file: string; id: string; line: number; endLine: number }>>();
  for (const [file, ir] of Object.entries(files)) {
    for (const n of ir.nodes ?? []) {
      if (n?.type !== "function_def" || typeof n.name !== "string" || typeof n.line !== "number") continue;
      const list = defs.get(n.name) ?? [];
      list.push({ file, id: String(n.id ?? ""), line: n.line, endLine: typeof n.endLine === "number" ? n.endLine : n.line });
      defs.set(n.name, list);
    }
  }
  return (c) => {
    const names = new Set<string>();
    for (const k of [c.check, ...(c.checks ?? [])]) {
      for (const v of [(k as { target?: unknown } | undefined)?.target, (k as { guard?: unknown } | undefined)?.guard]) {
        for (const s of Array.isArray(v) ? v : [v]) if (typeof s === "string" && !s.includes("*")) names.add(s);
      }
    }
    const out: string[] = [];
    for (const name of [...names].sort()) {
      const [cls, fn] = name.includes(".") ? [name.slice(0, name.lastIndexOf(".")), name.slice(name.lastIndexOf(".") + 1)] : [null, name];
      const found = (defs.get(fn) ?? []).filter((d) => !cls || d.id.includes(`${cls}.class/`)).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line).slice(0, 3);
      // by structural id, never line number: an edit above a function moves it, and changes nothing it says
      for (const d of found) out.push(`${d.file} ${d.id}\n${(readLines(d.file) ?? []).slice(d.line - 1, d.endLine).join("\n")}`);
    }
    return out.join("\n");
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
  return r?.spec ? allLines(r.spec).filter((l) => l.stale?.length).map((l) => `${l.text} — ${l.stale!.slice(0, 3).join(", ")} changed`) : [];
}

export { BRIEF_FACT_LIMITS };
