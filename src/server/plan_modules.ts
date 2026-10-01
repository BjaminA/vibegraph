// LIBRARY vs DEPLOYABLE (2026-10-01). A process used to be anchored to ONE
// folder (`at`), but a deployable often lives in one folder and its logic in
// another — a pure logic package plus the runtime host script that runs it —
// so the plan checked the wrong files and its threads piled up under "threads
// the plan gives no process". Now:
//
//   modules     code units: `at` (a folder) and a kind (library | app | tool)
//   processes   deployables: `entryPoints` (the files / entry ids it starts
//               from), `uses` (the modules it runs), `runsAs`; `at` still works
//
// A process OWNS the files of its own `at` and its entry points (its core),
// and USES the files of its modules. Who wrote a line of code is answered by
// the core first; a library file belongs to a process only when exactly one
// process uses it — shared logic is shared, and is never pinned on whichever
// process came first.

import type { Plan, PlanFinding, PlanProcess } from "../shared/plan_types.ts";

export const MODULE_LIMITS = [
  "a process's files are its own `at`, the files of its `entryPoints` and the modules it `uses`; a file in a module several processes use is attributed to none of them",
];

const underPrefix = (file: string, at: string) => {
  const a = at.replace(/^\.\//, "").replace(/\/$/, "");
  return file === a || file.startsWith(`${a}/`);
};

/** The files an entry-point reference names: an entry id (`file:fn`) or a file path. */
export function entryFiles(refs: readonly string[] | undefined, files: readonly string[]): string[] {
  const out = new Set<string>();
  for (const r of refs ?? []) {
    const file = files.includes(r) ? r : files.find((f) => r.startsWith(`${f}:`));
    if (file) out.add(file);
  }
  return [...out];
}

export interface Ownership {
  /** process → every file it runs (core ∪ used modules); null = nothing to look for */
  owned: Map<string, string[] | null>;
  /** file → the ONE process it belongs to (core first, else a module only it uses) */
  ownerOf: Map<string, string>;
  /** module id → its parsed files */
  moduleFiles: Map<string, string[]>;
}

export function processOwnership(plan: Plan, files: string[], coreOf: (p: PlanProcess) => string[] | null): Ownership {
  const moduleFiles = new Map<string, string[]>();
  for (const m of (plan.modules ?? []).filter((x) => x.status !== "dropped")) moduleFiles.set(m.id, files.filter((f) => underPrefix(f, m.at)));
  const owned = new Map<string, string[] | null>();
  const core = new Map<string, string[]>();
  const live = plan.processes.filter((p) => p.status !== "dropped");
  for (const p of live) {
    const atFiles = coreOf(p);
    const eps = entryFiles(p.entryPoints, files);
    const mine = [...new Set([...(atFiles ?? []), ...eps])];
    const used = (p.uses ?? []).flatMap((u) => moduleFiles.get(u) ?? []);
    core.set(p.id, mine);
    owned.set(p.id, atFiles === null && !p.entryPoints?.length && !p.uses?.length ? null : [...new Set([...mine, ...used])]);
  }
  const ownerOf = new Map<string, string>();
  // Core files: the longest `at` wins a file two cores share.
  for (const p of [...live].sort((a, b) => (b.at?.length ?? 0) - (a.at?.length ?? 0))) for (const f of core.get(p.id) ?? []) if (!ownerOf.has(f)) ownerOf.set(f, p.id);
  // A module file goes to its one user; a module two processes use goes to neither.
  const users = new Map<string, Set<string>>();
  for (const p of live) for (const u of p.uses ?? []) for (const f of moduleFiles.get(u) ?? []) {
    if (!users.has(f)) users.set(f, new Set());
    users.get(f)!.add(p.id);
  }
  for (const [f, who] of users) if (!ownerOf.has(f) && who.size === 1) ownerOf.set(f, [...who][0]);
  return { owned, ownerOf, moduleFiles };
}

export function moduleFindings(plan: Plan, own: Ownership, entryPoints: Array<{ id: string }>): PlanFinding[] {
  const out: PlanFinding[] = [];
  for (const m of (plan.modules ?? []).filter((x) => x.status !== "dropped")) {
    const files = own.moduleFiles.get(m.id) ?? [];
    const users = plan.processes.filter((p) => p.status !== "dropped" && p.uses?.includes(m.id)).map((p) => p.id);
    const eps = entryPoints.filter((e) => files.some((f) => e.id.startsWith(`${f}:`)));
    const usedBy = users.length ? `; used by ${users.join(", ")}` : "; no process uses it";
    out.push(files.length
      ? { section: "modules", id: m.id, verdict: "realised", detail: `${files.length} file(s) under ${m.at} (${m.kind}${eps.length ? `, ${eps.length} entry point(s)` : ""})${usedBy}` }
      : { section: "modules", id: m.id, verdict: "not-built", detail: `no parsed file under ${m.at}${usedBy}` });
  }
  return out;
}

/** The process a thread belongs to: the one it names, else the one whose own
 *  files hold the entry point it starts from. */
export function threadProcess(named: string | undefined, entryPointId: string | undefined, own: Ownership): string | undefined {
  if (named) return named;
  if (!entryPointId) return undefined;
  const file = entryPointId.split(":")[0];
  return own.ownerOf.get(file);
}
