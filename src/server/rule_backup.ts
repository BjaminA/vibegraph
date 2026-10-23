// RULES A PERSON RATIFIED, KEPT OUTSIDE THE PROJECT (2026-10-22, the
// root-cause handoff RC5: "re-initialisation forgets ratified rules"). A
// person who removed `.vibegraph/` and set the project up again lost every
// rule they had ratified, and nothing offered them back. Each save of
// constraints.json now also keeps the ratified rules in the project's cache
// folder (scripts/cache_dir.mjs), merged across saves; a rule removed on
// purpose stays in the backup, which is why the backup is only ever OFFERED
// back (`constraints restore`), never re-applied. A backed-up copy a person
// kept by hand beside the file (`.vibegraph/constraints*.json` other than
// constraints.json) is read too.

import * as fs from "fs";
import * as path from "path";
import { cacheDirFor } from "../../scripts/cache_dir.mjs";

export interface BackedUpRule { id: string; kind: string; text: string; scope: unknown; check?: unknown; checks?: unknown; policy?: unknown; cite?: unknown; savedAt: string; from: string }

const backupFile = (root: string) => path.join(cacheDirFor(path.resolve(root)), "rules-backup.json");

/** Merge this save's ratified rules into the backup (by text: an id can be reused). */
export function backupRatified(root: string, list: ReadonlyArray<{ id: string; kind: string; text: string; scope: unknown; source: string; check?: unknown; checks?: unknown; policy?: unknown; cite?: unknown }>): void {
  const human = list.filter((c) => c.source === "human");
  if (!human.length) return;
  try {
    const file = backupFile(root);
    const prior = readJson(file);
    const byText = new Map(prior.map((r) => [r.text, r]));
    const now = new Date().toISOString();
    for (const c of human) {
      byText.set(c.text, { id: c.id, kind: c.kind, text: c.text, scope: c.scope, ...(c.check ? { check: c.check } : {}), ...(c.checks ? { checks: c.checks } : {}), ...(c.policy ? { policy: c.policy } : {}), ...(c.cite ? { cite: c.cite } : {}), savedAt: now, from: "the cache backup" });
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: "1", rules: [...byText.values()] }, null, 2) + "\n");
  } catch { /* a backup that cannot be written never blocks the save */ }
}

function readJson(file: string): BackedUpRule[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    const rules = Array.isArray(raw?.rules) ? raw.rules : Array.isArray(raw?.constraints) ? raw.constraints : [];
    return rules.filter((r: unknown): r is BackedUpRule => !!r && typeof (r as BackedUpRule).text === "string" && typeof (r as BackedUpRule).kind === "string");
  } catch { return []; }
}

/** Every rule a person ratified before, from the backup and from copies beside constraints.json. */
export function backedUpRules(root: string): BackedUpRule[] {
  const out = readJson(backupFile(root));
  const dir = path.join(root, ".vibegraph");
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter((n) => /^constraints.*\.json/i.test(n) && n !== "constraints.json"); } catch { names = []; }
  for (const n of names) {
    for (const r of readJson(path.join(dir, n))) {
      if ((r as { source?: string }).source && (r as { source?: string }).source !== "human") continue;
      if (!out.some((x) => x.text === r.text)) out.push({ ...r, savedAt: "", from: `.vibegraph/${n}` });
    }
  }
  return out;
}
