// WHO MAY WRITE WHERE (2026-10-01). The rules that matter most in a system
// whose processes share a store are about identity — "only the decider
// service writes verdicts" — and the plan says them as data: a principal per
// identity, `processes[].runsAs`, `zones[].writers`. This derives the write
// matrix the code actually has (principal × zone, from the store's access
// sites in each process's files) and checks it against the plan, with the
// three verdicts every check here uses:
//
//   pass          every write the code makes to the zone is by a principal
//                 the plan lets write it (and it says what it could not see)
//   violated      a process writes a zone its principal may not — names the
//                 process, the principal, the file and line
//   unverifiable  a write the check cannot place: in no planned process, in a
//                 process with no `runsAs`, or with a computed zone in a
//                 process whose principal is not a writer — never a pass

import type { Plan, PlanFinding, WriteCell } from "../shared/plan_types.ts";
import type { AccessSite } from "./store_access.ts";
import { siteZone } from "./store_access.ts";

export const PRINCIPAL_LIMITS = [
  "who writes a zone is read from the store's access sites (calls to its `write` functions) placed in a process by the process's files (`at`); a write made through a module that is not in any process's files is counted as unplaced, and the identity a process runs as is the plan's `runsAs`, not something the code shows",
];

const at = (s: AccessSite) => `${s.file}:${s.line} ${s.fn}`;

/** `ownerOf`: file → the ONE process it belongs to (plan_modules.ts) — a
 *  file in a library several processes use belongs to none, so a write there
 *  is unplaced, never pinned on whichever process came first. */
/** Where a write runs (2026-10-02, field report): the planned processes whose
 *  threads reach the FUNCTION holding it. `null` = no thread reaches it (fall
 *  back to the file's owner); `[]` = reached only by entry points in no planned
 *  process. A file shared by two processes no longer charges one process with
 *  the other's write. */
export type SitePlacer = (s: AccessSite) => Array<{ id: string; runsAs?: string }> | null;

export function principalFindings(plan: Plan, sitesByStore: Map<string, AccessSite[]>, ownerOf: Map<string, string>, placeSite?: SitePlacer): { findings: PlanFinding[]; matrix: WriteCell[] } {
  const findings: PlanFinding[] = [];
  const procs = plan.processes.filter((p) => p.status !== "dropped");
  const byId = new Map(procs.map((p) => [p.id, p]));
  const procOf = new Map<string, { id: string; runsAs?: string }>();
  for (const [f, id] of ownerOf) procOf.set(f, { id, runsAs: byId.get(id)?.runsAs });
  const owned = new Map<string, string[]>();
  for (const [f, id] of ownerOf) owned.set(id, [...(owned.get(id) ?? []), f]);

  // ── each principal: does a built process run as it? ──
  for (const pr of (plan.principals ?? []).filter((x) => x.status !== "dropped")) {
    if (pr.kind !== "service") {
      findings.push({ section: "principals", id: pr.id, verdict: "unverified", detail: `a ${pr.kind} is an identity outside the code — it is checked only where a process runs as it` });
      continue;
    }
    const runners = procs.filter((p) => p.runsAs === pr.id);
    const built = runners.filter((p) => (owned.get(p.id) ?? []).length);
    findings.push(built.length
      ? { section: "principals", id: pr.id, verdict: "realised", detail: `${built.map((p) => p.id).join(", ")} run${built.length === 1 ? "s" : ""} as it` }
      : runners.length
        ? { section: "principals", id: pr.id, verdict: "not-built", detail: `${runners.map((p) => p.id).join(", ")} will run as it; not built yet` }
        : { section: "principals", id: pr.id, verdict: "unanchored", detail: "no process runs as it — set a process's `runsAs`" });
  }

  // ── the write matrix, and each zone's writers checked against it ──
  const cells = new Map<string, WriteCell>();
  const cell = (principal: string, zone: string, allowed: boolean) => {
    const k = `${principal}\u0000${zone}`;
    if (!cells.has(k)) cells.set(k, { principal, zone, allowed, writes: [] });
    return cells.get(k)!;
  };
  for (const st of (plan.stores ?? []).filter((x) => x.status !== "dropped")) {
    const writes = (sitesByStore.get(st.id) ?? []).filter((s) => s.op === "write");
    for (const z of st.zones ?? []) {
      const zone = `${st.id}/${z.id}`;
      const allowed = new Set(z.writers ?? []);
      for (const w of allowed) cell(w, zone, true);
      const mine = writes.filter((s) => siteZone(st, s) === z.id);
      const violations: string[] = [];
      const unplaced: string[] = [];
      for (const s of mine) {
        const placed = placeSite?.(s) ?? null;
        const ps = placed ?? (procOf.get(s.file) ? [procOf.get(s.file)!] : []);
        if (!ps.length) { unplaced.push(`${at(s)} (${placed ? "reached only from entry points in no planned process" : "in no planned process"})`); continue; }
        for (const p of ps) {
          if (!p.runsAs) { unplaced.push(`${at(s)} (${p.id} has no runsAs)`); continue; }
          cell(p.runsAs, zone, allowed.has(p.runsAs)).writes.push(at(s));
          if (z.writers && !allowed.has(p.runsAs)) violations.push(`${p.id} (runs as ${p.runsAs}) writes it at ${at(s)}${placed ? " — its thread reaches that function" : ""}`);
        }
      }
      if (!z.writers) continue;
      // A write with a computed zone, in a process that may NOT write here, could be a write here.
      const maybe = writes.filter((s) => s.computed && !siteZone(st, s)).filter((s) => {
        const ps = placeSite?.(s) ?? (procOf.get(s.file) ? [procOf.get(s.file)!] : []);
        return !ps.length || ps.some((p) => !p.runsAs || !allowed.has(p.runsAs));
      }).map((s) => `${at(s)} (zone computed)`);
      const id = `${zone}:writers`;
      const rule = `only ${[...allowed].join(", ") || "no one"} may write ${zone}`;
      if (violations.length) findings.push({ section: "stores", id, verdict: "violated", detail: `${rule}: ${violations.join("; ")}` });
      else if (unplaced.length || maybe.length) findings.push({ section: "stores", id, verdict: "unverifiable", detail: `${rule}: cannot place ${[...unplaced, ...maybe].slice(0, 4).join("; ")}` });
      else findings.push({ section: "stores", id, verdict: "pass", detail: `${rule}: ${mine.length ? `every write (${mine.length}) is by an allowed principal` : "no write to it that the access sites or the derived data operations show (a write whose name could not be reduced is not seen)"}` });
    }
  }
  return { findings, matrix: [...cells.values()].sort((a, b) => a.zone.localeCompare(b.zone) || a.principal.localeCompare(b.principal)) };
}
