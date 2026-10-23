// THE ONE SOURCE WALK (2026-10-22, the root-cause handoff RC2). The server,
// the CLI pipeline and the envelope cache each walked the project with their
// own loop, and none said what it passed over except whole folders. This walk
// is shared: it returns the files to parse (registered by extension, or
// admitted by evidence, source_admission.ts) and the coverage ledger
// (src/shared/coverage_ledger.ts) of everything else it saw.
//
// Skips as before: dot folders, npm's folder, compiled output (recorded with
// its file count) and what `.vibegraphignore` names (recorded too).

import * as fs from "fs";
import * as path from "path";
import { COMPILED_OUTPUT_DIRS, admissionFor, languageForFile, shouldSkipDir } from "./languages.ts";
import { projectIgnore, type ProjectIgnore } from "./project_ignore.ts";
import { admitSources } from "./source_admission.ts";
import { unreadKindOf, type CoverageLedger, type LedgerGroup } from "../shared/coverage_ledger.ts";
import { inlineScripts } from "../../scripts/frontends/inline_scripts.mjs";

export interface WalkedSource { rel: string; full: string; langId: string; admittedBy?: string; lines?: number }
export interface SourceWalk { sources: WalkedSource[]; skippedDirs: Record<string, number>; ledger: CoverageLedger }

const MAX_COUNT_BYTES = 8 * 1024 * 1024;

/** Lines in a file (a final line with no break counts); 0 when unreadable or huge. */
export function countLines(full: string): number {
  try {
    if (fs.statSync(full).size > MAX_COUNT_BYTES) return 0;
    const buf = fs.readFileSync(full);
    if (!buf.length) return 0;
    let k = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) k++;
    return buf[buf.length - 1] === 10 ? k : k + 1;
  } catch { return 0; }
}

function countFiles(dir: string): number {
  let k = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) k += countFiles(path.join(dir, e.name));
    else if (e.isFile()) k += 1;
  }
  return k;
}

/** Every file the project holds that the walk visits, with what it is. */
export function walkSources(root: string, opts: { ig?: ProjectIgnore } = {}): SourceWalk {
  const ig = opts.ig ?? projectIgnore(root);
  const skippedDirs: Record<string, number> = {};
  const own: WalkedSource[] = [];
  const candidates: string[] = [];
  const rest: string[] = [];
  const fullOf = new Map<string, string>();
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (ig.skipDir(rel)) { skippedDirs[rel] = countFiles(full); continue; }
        if (!shouldSkipDir(entry.name)) { visit(full); continue; }
        if (COMPILED_OUTPUT_DIRS.includes(entry.name)) skippedDirs[rel] = countFiles(full);
        continue;
      }
      if (!entry.isFile() || ig.skipFile(rel)) continue;
      fullOf.set(rel, full);
      const lang = languageForFile(entry.name, full);
      if (lang) own.push({ rel, full, langId: lang.id });
      else if (admissionFor(entry.name) && !entry.name.toLowerCase().endsWith(".d.ts")) candidates.push(rel);
      else rest.push(rel);
    }
  };
  visit(root);

  const all = [...own.map((s) => s.rel), ...candidates, ...rest];
  const decided = admitSources(root, candidates, own.map((s) => s.rel), all, (rel) => fullOf.get(rel) ?? path.join(root, rel));
  const sources = [...own];
  for (const rel of candidates) {
    const why = decided.admitted.get(rel);
    if (why) sources.push({ rel, full: fullOf.get(rel)!, langId: admissionFor(rel)!.lang.id, admittedBy: why });
  }
  sources.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  // the ledger
  const ledger: CoverageLedger = { parsed: { files: 0, lines: 0, byLanguage: {} }, admitted: [], pages: [], failed: [], deferred: [], notRead: [], skippedDirs, other: 0 };
  for (const s of sources) {
    const page = admissionFor(s.rel)?.by === "embedded";
    const lines = page ? inlineScripts(fs.readFileSync(s.full, "utf-8")).reduce((k, x) => k + x.endLine - x.line + 1, 0) : countLines(s.full);
    s.lines = lines;
    const by = (ledger.parsed.byLanguage[s.langId] ??= { files: 0, lines: 0 });
    by.files += 1; by.lines += lines; ledger.parsed.files += 1; ledger.parsed.lines += lines;
    if (s.admittedBy) (page ? ledger.pages : ledger.admitted).push({ file: s.rel, lines, reason: s.admittedBy });
  }
  for (const [rel, reason] of decided.deferred) ledger.deferred.push({ file: rel, lines: countLines(fullOf.get(rel)!), reason });
  const groups = new Map<string, LedgerGroup>();
  const workflows = (() => { try { return fs.readdirSync(path.join(root, ".github", "workflows")).map((f) => `.github/workflows/${f}`); } catch { return []; } })();
  for (const rel of [...rest, ...workflows]) {
    const kind = unreadKindOf(rel);
    if (!kind) { ledger.other += 1; continue; }
    const g = groups.get(kind) ?? { kind, files: 0, lines: 0, examples: [] };
    g.files += 1; g.lines += countLines(fullOf.get(rel) ?? path.join(root, rel));
    if (g.examples.length < 3) g.examples.push(rel);
    groups.set(kind, g);
  }
  ledger.notRead = [...groups.values()].sort((a, b) => b.lines - a.lines);
  ledger.deferred.sort((a, b) => b.lines - a.lines);
  return { sources, skippedDirs, ledger };
}

/** After the parse: a file with no IR moves from read to failed. */
export function settleLedger(ledger: CoverageLedger, parseErrors: Record<string, string>, sources: readonly WalkedSource[]): CoverageLedger {
  const failed = Object.entries(parseErrors);
  if (!failed.length) return ledger;
  const byRel = new Map(sources.map((s) => [s.rel, s]));
  const out: CoverageLedger = { ...ledger, parsed: { ...ledger.parsed, byLanguage: { ...ledger.parsed.byLanguage } }, failed: [...ledger.failed] };
  for (const [file, reason] of failed) {
    const src = byRel.get(file);
    const lang = src?.langId ?? null;
    const lines = src?.lines ?? 0;
    out.failed.push({ file, lines, reason: reason.slice(0, 200) });
    out.parsed.files -= 1; out.parsed.lines -= lines;
    if (lang && out.parsed.byLanguage[lang]) out.parsed.byLanguage[lang] = { files: out.parsed.byLanguage[lang].files - 1, lines: out.parsed.byLanguage[lang].lines - lines };
  }
  return out;
}
