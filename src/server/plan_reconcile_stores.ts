// THE PLAN's STORES against the code (2026-10-01). A shared store — a
// database, a sync service, an object store, a queue — is a RESOURCE the
// processes reach, never a process: it has no files of its own to find, so a
// store modelled as a process read "unanchored" or "drifted" and every
// boundary into it "orphaned" once someone dropped it. A store is realised
// when the code uses what the plan says it is reached THROUGH: a tool (an
// SDK, a data library), a project funnel wrapping one, or a project folder.

import type { Plan, PlanBoundary, PlanFinding, PlanStore, PlanZone } from "../shared/plan_types.ts";
import { ACCESS_LIMITS, siteZone, storeAccessSites, type AccessSite } from "./store_access.ts";
import type { StackIndex } from "./stack.ts";
import { unifies } from "../shared/name_pattern.ts";
import { edgeInto, type ImportEdge, type WorkspacePackage } from "./import_graph.ts";

export const STORE_LIMITS = [
  ...ACCESS_LIMITS,
  "a zone is realised when an access call names it (its id, its `routedBy` literal, or one of its families held by no other zone), or when the router function the plan names holds its id as a literal",
  "a store is realised when any name it is reached through is used: a tool the stack index knows, a project funnel wrapping one, or a project folder / workspace package (its own files, and every file whose import resolves into it)",
];

export interface StoreReach {
  /** the names that matched, as the code spells them */
  matched: string[];
  /** every parsed file that uses one of them */
  files: string[];
}

/** Which files reach a store, and through which of its names. A name is a
 *  tool (an SDK, a data library), a project funnel wrapping one, a project
 *  folder (`packages/store-client/`) or a workspace package by name
 *  (`@acme/store-client`) — a folder and its package name are one thing. */
export function storeReach(store: PlanStore, plan: Plan, stack: StackIndex, files: string[], graph: ImportEdge[], packages: WorkspacePackage[]): StoreReach {
  // A planned tool's own `via` names count for it too.
  const names = store.reachedThrough.flatMap((n) => [n, ...(plan.stack.find((t) => t.tool === n)?.via ?? [])]);
  const lower = new Set(names.map((n) => n.toLowerCase()));
  const matched = new Set<string>();
  const hit = new Set<string>();
  // Folders: named as a path, or as a workspace package's name.
  const folders = new Map<string, string>(); // folder → the name the plan used
  for (const n of names) {
    const pkg = packages.find((p) => p.name === n);
    if (pkg) folders.set(pkg.dir, n);
    else if (n.includes("/") && !n.startsWith("@")) folders.set(n.replace(/^\.\//, "").replace(/\/$/, ""), n);
  }
  for (const t of stack.tools) {
    const direct = lower.has(t.tool.toLowerCase());
    // A project funnel wrapping a named tool: its importers reach the store through it.
    const funnel = t.origin === "project" && (t.wraps ?? []).some((w) => lower.has(w.toLowerCase()));
    if (!direct && !funnel) continue;
    matched.add(direct ? t.tool : `${t.tool} (wraps ${(t.wraps ?? []).filter((w) => lower.has(w.toLowerCase())).join(", ")})`);
    for (const f of t.files) hit.add(f);
    if (t.home) hit.add(t.home);
  }
  for (const [dir, n] of folders) {
    const pre = `${dir}/`;
    const inside = files.filter((f) => f.startsWith(pre));
    const importers = graph.filter((e) => !e.from.startsWith(pre) && edgeInto(e, dir)).map((e) => e.from);
    if (!inside.length && !importers.length) continue;
    matched.add(n);
    for (const f of [...inside, ...importers]) hit.add(f);
  }
  return { matched: [...matched], files: [...hit].sort() };
}

export interface StoreCheck { findings: PlanFinding[]; reach: Map<string, StoreReach>; sites: Map<string, AccessSite[]> }

/** What the code says about the store's zones (data_arch.ts): its declared
 *  zones and the operations that touch them. */
export interface DerivedZones { zones: Array<{ id: string; cite?: string }>; ops: Array<{ file: string; line: number; op: "write" | "read" | "watch"; family: string }> }

export function storeFindings(plan: Plan, stack: StackIndex, irFiles: Record<string, any>, graph: ImportEdge[], packages: WorkspacePackage[], derived?: DerivedZones): StoreCheck {
  const files = Object.keys(irFiles);
  const findings: PlanFinding[] = [];
  const reach = new Map<string, StoreReach>();
  const sitesBy = new Map<string, AccessSite[]>();
  for (const s of (plan.stores ?? []).filter((x) => x.status !== "dropped")) {
    const r = storeReach(s, plan, stack, files, graph, packages);
    reach.set(s.id, r);
    findings.push(r.matched.length
      ? { section: "stores", id: s.id, verdict: "realised", detail: `reached through ${r.matched.join(", ")} in ${r.files.length} file(s)` }
      : { section: "stores", id: s.id, verdict: "not-built", detail: `nothing it is reached through (${s.reachedThrough.join(", ")}) is used yet` });
    const sites = storeAccessSites(s, irFiles);
    sitesBy.set(s.id, sites);
    for (const z of s.zones ?? []) findings.push(zoneFinding(s, z, sites, irFiles, derived));
  }
  return { findings, reach, sites: sitesBy };
}

const VERB = { write: "writes", read: "reads", watch: "watches" } as const;
const where = (xs: AccessSite[]) => xs.slice(0, 3).map((x) => `${x.file}:${x.line} ${x.fn} ${VERB[x.op]}`).join("; ") + (xs.length > 3 ? `; +${xs.length - 3} more` : "");

/** A zone is realised when the code's routing NAMES it: an access call with
 *  its id (or its `routedBy` literal) or one of its families as a literal, or
 *  the router function the plan names, holding its id as a literal. */
function zoneFinding(s: PlanStore, z: PlanZone, sites: AccessSite[], irFiles: Record<string, any>, derived?: DerivedZones): PlanFinding {
  const id = `${s.id}/${z.id}`;
  const mine = sites.filter((x) => siteZone(s, x) === z.id);
  if (mine.length) return { section: "stores", id, verdict: "realised", detail: `named at ${where(mine)}` };
  // M2 (2026-10-02): the zones the CODE declares (a catalogue + naming table,
  // routed by a lookup over it) are compared as patterns with what the planned
  // zone holds — not a literal in the router's body, which a table lookup never has.
  const wants = [z.id, ...z.holds];
  const declared = (derived?.zones ?? []).filter((d) => wants.some((w) => unifies(w, d.id)));
  if (declared.length) {
    const ops = (derived?.ops ?? []).filter((o) => wants.some((w) => unifies(w, o.family)));
    const opText = ops.length ? `; the code ${[...new Set(ops.map((o) => VERB[o.op]))].join(" / ")} them at ${ops.slice(0, 3).map((o) => `${o.file}:${o.line}`).join(", ")}${ops.length > 3 ? `, +${ops.length - 3} more` : ""}` : "; no operation on them is seen yet";
    return { section: "stores", id, verdict: "realised", detail: `the code declares ${declared.length > 4 ? `${declared.slice(0, 4).map((d) => d.id).join(", ")} +${declared.length - 4} more` : declared.map((d) => d.id).join(", ")} (${declared[0].cite ?? "data-architecture.md"})${opText}` };
  }
  if (z.routedBy?.startsWith("router:")) {
    const fn = z.routedBy.slice("router:".length).trim();
    const r = routerNames(fn, z.id, irFiles);
    if (r === "names") return { section: "stores", id, verdict: "realised", detail: `the router ${fn} names it` };
    if (r === "defined") return { section: "stores", id, verdict: "unverified", detail: `the router ${fn} exists but no literal in it names ${z.id} — it may compute the zone` };
    return { section: "stores", id, verdict: "not-built", detail: `no function ${fn} is defined yet (the plan names it as the router)` };
  }
  if (!s.access) return { section: "stores", id, verdict: "unanchored", detail: `give store ${s.id} its access functions (\`access: {write, read, watch}\`) so the zones can be found` };
  const computed = sites.filter((x) => x.computed);
  if (computed.length) return { section: "stores", id, verdict: "unverified", detail: `no call names it, and ${computed.length} access(es) compute their zone (${where(computed)}) — one may route here` };
  return { section: "stores", id, verdict: "not-built", detail: `no access call names it (${z.id}${z.holds.length ? ` or ${z.holds.join(", ")}` : ""}) yet` };
}

/** Does the named function exist, and does a literal in its body name the zone? */
function routerNames(fn: string, zone: string, irFiles: Record<string, any>): "names" | "defined" | "absent" {
  const [owner, method] = fn.includes(".") ? fn.split(".") : [null, fn];
  const quoted = new RegExp(`(["'\`])${zone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`);
  let found = false;
  for (const ir of Object.values(irFiles)) {
    const nodes = (ir?.nodes ?? []) as any[];
    for (const d of nodes) {
      if (d.type !== "function_def" || d.name !== method) continue;
      if (owner && !String(d.id).includes(`/${owner}.class/`)) continue;
      found = true;
      const body = nodes.filter((n) => String(n.id).startsWith(`${d.id}/`));
      const texts = body.flatMap((n) => [...(n.args ?? []), n.value, n.preview, ...(n.literals ?? []), n.returns].filter((x) => typeof x === "string"));
      if (texts.some((t) => quoted.test(t))) return "names";
    }
  }
  return found ? "defined" : "absent";
}

/** A boundary INTO a store: realised when its process's files reach the
 *  store, unverified when the store is reached elsewhere (or the process has
 *  no files to check) — never drifted at the store level: who reaches a
 *  shared store through which module is exactly what a funnel hides. A
 *  boundary that names a ZONE is checked against the access sites in its
 *  process's files: one naming the zone realises it; sites naming only OTHER
 *  zones are a real drift; computed zones leave it unverified. */
export function storeBoundaryFinding(b: PlanBoundary, store: PlanStore, reach: StoreReach | undefined, fromFiles: string[] | null | undefined, sites: AccessSite[] = []): PlanFinding {
  const zone = b.zone ? ` (zone ${b.zone})` : "";
  if (!reach?.matched.length) return { section: "boundaries", id: b.id, verdict: "not-built", detail: `store ${store.id}${zone} is not reached by the code yet` };
  if (!fromFiles?.length) return { section: "boundaries", id: b.id, verdict: "unverified", detail: `store ${store.id}${zone} is reached (${reach.matched.join(", ")}), but ${b.from} has no files to check it from` };
  const own = new Set(fromFiles);
  if (b.zone && store.access) {
    const mine = sites.filter((x) => own.has(x.file));
    const hit = mine.filter((x) => siteZone(store, x) === b.zone);
    if (hit.length) return { section: "boundaries", id: b.id, verdict: "realised", detail: `${b.from} touches ${store.id}/${b.zone} at ${where(hit)}` };
    if (mine.some((x) => x.computed)) return { section: "boundaries", id: b.id, verdict: "unverified", detail: `${b.from} touches ${store.id} with a computed zone (${where(mine.filter((x) => x.computed))})` };
    const others = [...new Set(mine.map((x) => siteZone(store, x)).filter(Boolean))];
    if (others.length) return { section: "boundaries", id: b.id, verdict: "drifted", detail: `${b.from} touches ${store.id}/${others.join(", ")}, not ${b.zone} (${where(mine)})` };
  }
  const hits = reach.files.filter((f) => own.has(f));
  return hits.length
    ? { section: "boundaries", id: b.id, verdict: b.zone && store.access ? "unverified" : "realised", detail: `${b.from} reaches store ${store.id} through ${reach.matched.join(", ")} in ${hits.slice(0, 3).join(", ")}${hits.length > 3 ? ", …" : ""}${b.zone && store.access ? `; no access call there names zone ${b.zone}` : ""}` }
    : { section: "boundaries", id: b.id, verdict: "unverified", detail: `store ${store.id}${zone} is reached in ${reach.files.slice(0, 3).join(", ")}, not from ${b.from}'s own files — through a module the parse does not tie to it?` };
}

/** The hint a db/cache PROCESS gets: it is a store. */
export function storeHint(id: string): string {
  return `a database or cache is a STORE, not a process — convert it: plan edit '{"op":"to-store","id":"${id}"}' (boundaries to it keep pointing at it)`;
}
