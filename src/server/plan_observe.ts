// AN OBSERVED SKELETON (2026-10-06, direction review M2, step 1). A project
// with no plan still has a direction its code already takes: the processes it
// runs, who each runs as, the stores and zones it reads and writes. This reads
// them off the derived map — zero tokens — as plan operations an AGENT would
// make, so every item lands PROPOSED, `groundedIn` the fact it came from.
// What a plan has no section for (decision structures, outside callers) stays
// on the map and is listed, not invented.
//
// The person then states the objective (or adopts a drafted one), and agrees
// the few lines that matter; the rest stays proposed until touched.

import type { ArchModelRecord, ArchNodeRecord } from "../shared/protocol.ts";
import type { Plan } from "../shared/plan_types.ts";
import { PLAN_CAPS } from "../shared/plan_types.ts";
import { identityOf, rootOf } from "../shared/arch_fact_label.ts";
import type { PlanOp } from "./plan_ops.ts";

export const OBSERVED_OBJECTIVE = "Not stated yet: observed from the code. A person states what this project is for.";
const SERVES = "observed in the code: say what part of the objective it serves";
const slug = (s: string) => s.toLowerCase().replace(/^\$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "x";
const fileOf = (ep: string) => ep.replace(/:[^:]*$/, "");

/** The id a process gets: its entry file's name for a runtime process, its package otherwise. */
function processId(c: ArchNodeRecord): string {
  if (c.runtime && c.entryPoints?.length) return slug(fileOf(c.entryPoints[0]).split("/").pop()!.replace(/\.[^.]+$/, ""));
  return slug(`${rootOf(c) === "." ? "root" : rootOf(c)}-${c.id.split(":")[1] ?? "code"}`);
}
const kindOf = (c: ArchNodeRecord): "frontend" | "backend" | "library" =>
  /frontend|page|web|react|next/i.test(c.id + (c.frameworks ?? []).join(" ")) ? "frontend" : c.entryPoints?.length ? "backend" : "library";

export function observeSkeleton(model: ArchModelRecord, plan: Plan | null): { ops: PlanOp[]; notes: string[] } {
  const ops: PlanOp[] = [];
  const notes: string[] = [];
  const has = (section: keyof Plan, id: string) => ((plan?.[section] as Array<{ id?: string }> | undefined) ?? []).some((x) => x.id === id);
  const clusters = model.nodes.filter((n) => n.kind === "cluster" && n.entryPoints?.length)
    .sort((a, b) => Number(!!b.runtime) - Number(!!a.runtime) || a.id.localeCompare(b.id));
  // one id per process: `server` twice (three packages each run a server.ts)
  // becomes `<package>-server`; a plan process already covering the same
  // entry file IS this process
  const planned = (plan?.processes ?? []);
  const covers = (pid: string, c: ArchNodeRecord) => planned.some((p) => p.id === pid && (p.entryPoints ?? []).some((e) => c.entryPoints!.some((x) => fileOf(x) === fileOf(e))));
  const idOf = new Map<string, string>();
  const taken = new Set<string>();
  const baseCount = new Map<string, number>();
  for (const c of clusters) baseCount.set(processId(c), (baseCount.get(processId(c)) ?? 0) + 1);
  for (const c of clusters) {
    const base = processId(c);
    let id = base;
    if (!covers(id, c) && (baseCount.get(base)! > 1 || taken.has(id) || planned.some((p) => p.id === id))) id = slug(`${rootOf(c) === "." ? "root" : rootOf(c)}-${base}`);
    for (let i = 2; !covers(id, c) && (taken.has(id) || planned.some((p) => p.id === id)); i++) id = `${slug(`${rootOf(c)}-${base}`)}-${i}`;
    taken.add(id);
    idOf.set(c.id, id);
  }
  const processId_ = (c: ArchNodeRecord) => idOf.get(c.id)!;
  // principals: one per identity the code shows
  const principalOf = new Map<string, string>();
  for (const c of clusters) {
    const who = identityOf(c);
    if (!who) continue;
    const pid = c.identity![0].kind === "created" ? `${processId_(c)}-run` : slug(who);
    principalOf.set(c.id, pid);
    if (has("principals", pid) || ops.some((o) => o.op === "add" && o.section === "principals" && (o.item as any).id === pid)) continue;
    ops.push({ op: "add", section: "principals", item: { id: pid, kind: "service", label: c.identity![0].kind === "created" ? `own identity per run of ${processId_(c)}` : `runs as ${who}`, groundedIn: `observed: ${c.identity![0].evidence}`.slice(0, 400) } });
  }
  // processes: what runs, where, as whom
  let kept = 0;
  for (const c of clusters) {
    const id = processId_(c);
    if (covers(id, c)) continue;
    if (kept >= PLAN_CAPS.processes) { notes.push(`${c.label}: over the cap of ${PLAN_CAPS.processes} processes — not proposed`); continue; }
    kept++;
    const how = c.runtime ? c.runtime.how.map((h) => (h === "spawned" ? `started by ${(c.runtime!.by ?? []).join(", ")}` : `listens${c.runtime!.port ? ` on ${c.runtime!.port}` : ""}`)).join("; ") : `${c.entryPoints!.length} entry point(s)`;
    ops.push({ op: "add", section: "processes", item: {
      id, kind: kindOf(c), label: c.label.slice(0, 80), serves: SERVES,
      at: c.runtime ? fileOf(c.entryPoints![0]) : `${rootOf(c) === "." ? "" : `${rootOf(c)}/`}`.replace(/^$/, "./"),
      entryPoints: c.entryPoints!.slice(0, 8), ...(principalOf.has(c.id) ? { runsAs: principalOf.get(c.id) } : {}),
      groundedIn: `observed: ${c.id} — ${how}`.slice(0, 400),
    } });
  }
  // stores and their zones: what the code reads and writes
  const zones = model.nodes.filter((n) => n.zoneOf);
  const stores = new Map<string, ArchNodeRecord[]>();
  for (const z of zones) stores.set(z.zoneOf!.store, [...(stores.get(z.zoneOf!.store) ?? []), z]);
  for (const [sid, zs] of stores) {
    const id = slug(sid);
    if (has("stores", id)) continue;
    if (zs.length > PLAN_CAPS.zones) notes.push(`store ${sid}: ${zs.length} zone groups, the first ${PLAN_CAPS.zones} proposed (the cap)`);
    const via = [...new Set(model.edges.filter((e) => zs.some((z) => z.id === e.to)).map((e) => model.nodes.find((n) => n.id === e.from)).filter((n): n is ArchNodeRecord => !!n && n.kind === "tool").map((n) => n.tool ?? n.label))];
    ops.push({ op: "add", section: "stores", item: {
      id, kind: "document-store", label: sid, reachedThrough: via.length ? via.slice(0, 4) : [sid],
      zones: zs.slice(0, PLAN_CAPS.zones).map((z) => ({ id: slug(z.label), holds: z.zoneOf!.holds.slice(0, 6) })),
      groundedIn: `observed: ${zs.length} zone(s) the code reads or writes`,
    } });
  }
  const decisions = model.nodes.filter((n) => n.decision).length;
  if (decisions) notes.push(`${decisions} decision structure(s) are on the map (Decisions lens); a plan has no section for them`);
  return { ops, notes };
}
