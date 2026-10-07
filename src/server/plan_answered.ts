// OPEN QUESTIONS A DECISION MAY HAVE ANSWERED (2026-10-07, field report).
// Promoting the planned rule `one-http-funnel` (it named `pkg/net/`)
// settled the open question "package at the repository root or tools/lib/?",
// and the question stayed open with nothing linking the two. Words would not
// have found it — the question never says `pkg` — so this reads
// LOCATIONS: the alternatives a question offers (paths it names, and
// "repository root") against the paths agreed modules and processes live at
// and promoted rules name.
//
// Said as "possibly answered by …" — a person closes the question; nothing
// here closes anything.

import type { Plan } from "../shared/plan_types.ts";

export interface PossibleAnswer { question: string; by: string; how: string }

const ROOT_WORDS = /\b(repo(sitory)?|project)['’]?s? root\b|\bat the root\b|\btop[- ]level\b/i;
const PATH = /(?:^|[\s`'"(])((?:[\w.-]+\/)+[\w.-]*)/g;

const norm = (p: string) => p.replace(/^\.?\//, "").replace(/\/+$/, "");

function pathsIn(text: string): string[] {
  return [...text.matchAll(PATH)].map((m) => norm(m[1])).filter(Boolean);
}

/** The paths a decided item stands for, with how to say it. */
function decidedPaths(plan: Plan): Array<{ by: string; path: string }> {
  const out: Array<{ by: string; path: string }> = [];
  const agreed = (s?: string) => s === "agreed";
  for (const m of (plan as { modules?: Array<{ id: string; at?: string; status?: string }> }).modules ?? []) {
    if (agreed(m.status) && m.at) out.push({ by: m.id, path: norm(m.at) });
  }
  for (const p of plan.processes ?? []) {
    const at = (p as { at?: string }).at;
    if (agreed(p.status) && at) out.push({ by: p.id, path: norm(at) });
  }
  for (const r of plan.policies ?? []) {
    if (r.status !== "promoted" && r.status !== "agreed") continue;
    const by = r.constraintId ? `${r.id} (promoted as ${r.constraintId})` : r.id;
    const texts = [r.text, ...(r.files ?? []), JSON.stringify(r.check ?? {})];
    for (const p of new Set(texts.flatMap(pathsIn))) out.push({ by, path: p });
  }
  return out;
}

export function possiblyAnswered(plan: Plan): PossibleAnswer[] {
  const decided = decidedPaths(plan);
  if (!decided.length) return [];
  const out: PossibleAnswer[] = [];
  for (const q of plan.open ?? []) {
    const alts = pathsIn(q.text);
    const offersRoot = ROOT_WORDS.test(q.text);
    if (!alts.length && !offersRoot) continue;
    for (const d of decided) {
      const alt = alts.find((a) => d.path === a || d.path.startsWith(`${a}/`));
      if (alt) { out.push({ question: q.id, by: d.by, how: `${d.by} names \`${d.path}/\`, under \`${alt}/\`` }); break; }
      // a decision placed at a NEW top-level folder answers "at the repository root"
      const top = d.path.split("/")[0];
      if (offersRoot && !alts.some((a) => a.split("/")[0] === top)) {
        out.push({ question: q.id, by: d.by, how: `${d.by} names \`${d.path}/\`, at the repository root` });
        break;
      }
    }
  }
  return out;
}
