// M-RUN2.3 — detect "this thread reads a data file that doesn't exist yet".
//
// Two honest tiers, both DETECTION-ONLY (nothing executes here):
//  - pre-run: fs-kind offenses from the effect scan whose call line names a
//    string-literal data path that is missing on disk. A heuristic over the
//    source LINE (never over runtime values) — it may miss non-literal
//    paths, and that is fine: the post-run tier catches those.
//  - post-run: a runtime FileNotFoundError's quoted path, when it stays
//    inside the project. After-the-fact, never guessed.
//
// The result only ever OFFERS synthesis; consent + the sandbox rule live
// elsewhere (effect_consent.ts / runThreadToNodeCore).

import * as fs from "fs";
import * as path from "path";
import type { EffectOffense } from "../../shared/protocol";

export interface MissingDataFile {
  path: string;   // project-relative
  file: string;   // source file of the reading call
  line: number;   // line of the reading call
}

// A quoted path with a data-ish extension. Deliberately narrow: better to
// miss an exotic name (post-run tier catches it) than to offer nonsense.
const DATA_PATH_RE = /['"]([\w./-]+\.(?:csv|tsv|json|jsonl|txt|dat|db|sqlite3?|log|npy|npz|parquet))['"]/g;

export function safeRelPath(projectRoot: string, p: string): string | null {
  return safeRel(projectRoot, p);
}

function safeRel(projectRoot: string, p: string): string | null {
  const abs = path.resolve(projectRoot, p);
  const rel = path.relative(projectRoot, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null; // escapes the project
  return rel;
}

export function detectMissingDataFiles(
  offenses: EffectOffense[],
  projectRoot: string,
  readLine: (file: string, line: number) => string | null,
): MissingDataFile[] {
  const out: MissingDataFile[] = [];
  const seen = new Set<string>();
  for (const o of offenses) {
    if (o.kind !== "effect" || o.effectKind !== "fs" || !o.file || !o.line) continue;
    const src = readLine(o.file, o.line);
    if (!src) continue;
    for (const m of src.matchAll(DATA_PATH_RE)) {
      const rel = safeRel(projectRoot, m[1]);
      if (!rel || seen.has(rel)) continue;
      if (!fs.existsSync(path.join(projectRoot, rel))) {
        seen.add(rel);
        out.push({ path: rel, file: o.file, line: o.line });
      }
    }
  }
  return out;
}

const FNF_RE = /FileNotFoundError[^\n]*?['"]([\w./-]+)['"]/;

export function missingPathFromStderr(stderr: string, projectRoot: string): string | null {
  const m = stderr.match(FNF_RE);
  if (!m) return null;
  const rel = safeRel(projectRoot, m[1]);
  if (!rel) return null;
  return fs.existsSync(path.join(projectRoot, rel)) ? null : rel;
}
