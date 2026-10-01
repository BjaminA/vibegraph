// Which real entry point a PLANNED thread is (2026-10-01, from a real repo:
// "a plan thread only matches when its id equals the entry id, so
// human-named threads ('provision-tenant') never match").
//
//   1. `entryPoint`, when the thread names one: an entry-point id, or a file
//      path matched to that file's entry (its module seed or `main` first;
//      several other entries are an AMBIGUITY, said with the candidates);
//   2. else its id read as an entry point would read (label, qualified name,
//      id, route, "METHOD /route") — the original rule.
// An unmatched thread gets the closest entry points (`suggestEntries`), and a
// drifted one a reason per missing step (`whyMissing`), where the IR can say.

import type { Plan, PlanThread } from "../shared/plan_types.ts";

export interface EntryLike { id: string; label?: string; qualifiedName?: string; kind?: string; metadata?: Record<string, unknown> }
export interface ThreadLike { entryPointId: string | null; nodes: any[]; filesReached?: string[] }

export const norm = (s: string) => s.toLowerCase().replace(/<([^>]+)>|\{([^}]+)\}|\[([^\]]+)\]/g, (_m, a, b, c) => `:${a ?? b ?? c}`).replace(/["'`]/g, "").replace(/\s+/g, " ").trim();

const fileOf = (epId: string) => epId.slice(0, epId.lastIndexOf(":"));

function readsAs(e: EntryLike): (string | null | undefined)[] {
  const m = e.metadata ?? {};
  const route = typeof m.route === "string" ? m.route : typeof m.path === "string" ? m.path : null;
  const method = typeof m.method === "string" ? m.method : null;
  return [e.label, e.qualifiedName, e.id, e.id.split(":").pop(), route, route && method ? `${method} ${route}` : null];
}

/** The entry point a planned thread is, or why none / which ones. */
export function matchThreadEntry(t: PlanThread, entryPoints: readonly EntryLike[]): { ep?: EntryLike; via?: "entryPoint" | "id"; ambiguous?: string[]; named?: string } {
  if (t.entryPoint) {
    const exact = entryPoints.find((e) => e.id === t.entryPoint);
    if (exact) return { ep: exact, via: "entryPoint" };
    const inFile = entryPoints.filter((e) => fileOf(e.id) === t.entryPoint!.replace(/^\.\//, ""));
    const seed = inFile.find((e) => e.id.endsWith(":module")) ?? inFile.find((e) => e.id.endsWith(":main"));
    if (seed) return { ep: seed, via: "entryPoint" };
    if (inFile.length === 1) return { ep: inFile[0], via: "entryPoint" };
    if (inFile.length > 1) return { ambiguous: inFile.map((e) => e.id), named: t.entryPoint };
    return { named: t.entryPoint };
  }
  const want = norm(t.id);
  const ep = entryPoints.find((e) => readsAs(e).some((x) => x && norm(x) === want));
  return ep ? { ep, via: "id" } : {};
}

const STOP = new Set(["src", "lib", "app", "ts", "tsx", "js", "mjs", "py", "sh", "rs", "module", "main", "index", "fn", "the", "and", "for", "bin", "test", "tests"]);
/** Words of an id / path / step: split on case, digits and punctuation. */
export function words(s: string): string[] {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ing|ion|s)$/, ""));
}

/** The closest real entry points to a planned thread that matched none:
 *  shared words between the thread (id, entry kind, primary steps, its
 *  process's `at`) and each entry point (id, label, file), a file under the
 *  process's folder breaking ties. A guess, said as one. */
export function suggestEntries(t: PlanThread, plan: Plan, entryPoints: readonly EntryLike[], n = 3): string[] {
  const at = t.process ? plan.processes.find((p) => p.id === t.process)?.at : undefined;
  const mine = new Set([...words(t.id), ...words(t.entry), ...t.primary.flatMap((s) => words(s.split(":").pop() ?? s))]);
  if (!mine.size) return [];
  const scored = entryPoints.map((e) => {
    const theirs = new Set([...words(e.id), ...words(e.label ?? ""), ...words(e.qualifiedName ?? "")]);
    let score = 0;
    for (const w of mine) if (theirs.has(w)) score += 2;
    if (at && e.id.startsWith(at.replace(/^\.\//, ""))) score += 1;
    if (t.entry && e.kind && norm(t.entry) === norm(e.kind)) score += 1;
    return { id: e.id, score };
  }).filter((x) => x.score >= 2);
  return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, n).map((x) => x.id);
}

/** Why a primary step is not on the thread, where the IR can say. */
export function whyMissing(step: string, thread: ThreadLike | undefined, files: Record<string, any>, epId: string): string {
  const name = (step.split(":").pop() ?? step).trim();
  const lower = name.toLowerCase();
  const short = lower.split(".").pop() ?? lower;
  // A dynamic/unresolved call whose METHOD is the step's name may be it — the
  // IR cannot say which function runs, so "may", never "is".
  const gap = (thread?.nodes ?? []).find((n: any) => ["dynamic", "unresolved"].includes(n.kind) && String(n.label ?? "").toLowerCase().replace(/\(.*$/, "").split(".").pop() === short);
  if (gap) return `may be reached only through a ${gap.kind} call (\`${gap.label}\`) the IR does not follow`;
  for (const [file, ir] of Object.entries(files)) {
    for (const n of ir?.nodes ?? []) {
      if (n.type !== "function_def") continue;
      const qual = String(n.id).split("/").filter((s: string) => s.endsWith(".class") || s.endsWith(".fn")).map((s: string) => s.replace(/\.(class|fn)$/, "")).join(".").toLowerCase();
      if (qual === lower || qual.endsWith(`.${lower}`) || String(n.name ?? "").toLowerCase() === lower) {
        return `defined in ${file}${n.line ? `:${n.line}` : ""}, but nothing on ${epId}'s thread reaches it`;
      }
    }
  }
  return "not defined anywhere the parser read (not built yet, or spelled differently)";
}
