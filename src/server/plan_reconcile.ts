// THE PLAN against the code (2026-09-30). One deterministic pass, zero tokens,
// that turns a plan from a document that goes stale into a spec the code is
// measured against. Each live item gets a verdict:
//
//   realised    the code has it
//   drifted     the code has something, and it differs (the detail says how)
//   not-built   nothing in the code yet
//   unanchored  the plan gives nothing to look for (a process with no `at`
//               and no directory of its name)
//   unverified  both ends of a boundary exist; the hop itself is not checked
//   pass / violated / unverifiable / prose   a planned rule, run through the
//               SAME checkers `check` uses — as advice: it gates nothing
//
// Matching is by name and path, and says so. What it cannot see is listed in
// `limits` on every result, never implied away.

import type { Plan, PlanFinding, PlanReconcile, PlanVerdict, PlanProcess } from "../shared/plan_types.ts";
import type { StackIndex } from "./stack.ts";
import { buildQualityFacts } from "./quality/facts.ts";
import { checkConstraint, isConstraintCheck } from "./constraint_grammar.ts";
import { newRegistry, isRun1Check } from "./quality/verbs/index.ts";
import { statedScopeFiles } from "./constraint_store.ts";
import { matchThreadEntry, suggestEntries, whyMissing } from "./plan_thread_match.ts";
import { PRINCIPAL_LIMITS, principalFindings, type SiteIdentity, type SitePlacer } from "./plan_principals.ts";
import { IdentityIndex } from "./identities.ts";
import { isTestFile } from "../shared/path_match.ts";
import { FLOW_LIMITS, flowFindings, indirectHops } from "./plan_flows.ts";
import { expandModuleRefs } from "./plan_layers.ts";
import { applyAssumptions } from "./plan_assumptions.ts";
import { MODULE_LIMITS, entryFiles, moduleFindings, processOwnership, threadProcess } from "./plan_modules.ts";
import { importGraph, workspacePackages, type ImportEdge, type WorkspacePackage } from "./import_graph.ts";
import { STORE_LIMITS, storeBoundaryFinding, storeFindings, storeHint } from "./plan_reconcile_stores.ts";
import { familyMatches, type AccessSite } from "./store_access.ts";
import { deriveDataArchitecture } from "./data_arch.ts";
import { covers } from "./data_topology.ts";
import { listSpecs } from "./software_store.ts";

export const PLAN_RECONCILE_LIMITS = [
  "matching is by name and path: a planned thread matches the entry point its `entryPoint` names, else one whose label or name reads like its id; a step matches a node on that thread whose label or qualified name contains it; suggestions for an unmatched thread are a word-match guess",
  "the ORDER of a thread's steps is not compared, only their presence",
  "a boundary's payload keys (`carries`) are not compared against the code",
  "a process→process boundary is `unverified` even when both ends are built: the hop between them is not followed",
  "a planned rule's verdict is advice; only a promoted rule (in constraints.json) is checked by `check` and the hooks",
  "an assumption's state is its latest RECORDED evidence (a person runs the command and records what it showed); VibeGraph never runs it",
  ...STORE_LIMITS,
  ...PRINCIPAL_LIMITS,
  ...FLOW_LIMITS,
  ...MODULE_LIMITS,
];

interface EnvLike {
  files: Record<string, any>;
  entryPoints: Array<{ id: string; label?: string; qualifiedName?: string; kind?: string; metadata?: Record<string, unknown> }>;
  threads: Array<{ entryPointId: string | null; nodes: any[]; filesReached?: string[] }>;
}

const slug = (s: string) => s.toLowerCase().replace(/[-_ ]+/g, "");

function underPrefix(file: string, at: string): boolean {
  const a = at.replace(/^\.\//, "");
  return file === a || file.startsWith(a.endsWith("/") ? a : `${a}/`);
}

/** The parsed files a planned process owns: its `at` prefix, or a directory
 *  of its name. `null` = nothing to look for. */
export function processFiles(p: PlanProcess, files: string[]): { files: string[]; how: string } | null {
  if (p.at) return { files: files.filter((f) => underPrefix(f, p.at!)), how: `under ${p.at}` };
  const want = new Set([slug(p.id), slug(p.label)]);
  const dirs = new Set<string>();
  for (const f of files) for (const seg of f.split("/").slice(0, -1)) if (want.has(slug(seg))) dirs.add(f.slice(0, f.indexOf(seg) + seg.length));
  if (!dirs.size) return null;
  const found = files.filter((f) => [...dirs].some((d) => underPrefix(f, d)));
  return { files: found, how: `in a directory named like it (${[...dirs].join(", ")})` };
}

/** Module 8 (2026-10-02): a process is an entry point plus what its thread
 *  reaches, not a folder. When an entry point NAMED like the process lives
 *  outside its `at`, say where it runs from and which folders its thread
 *  reaches — the deployable in one package driving the logic in another. */
function runsFrom(p: PlanProcess, env: EnvLike, files: string[]): string {
  const names = new Set([slug(p.id), ...(p.runsAs ? [slug(p.runsAs)] : [])]);
  const stem = (f: string) => slug((f.split("/").pop() ?? "").replace(/\.[^.]+$/, ""));
  const outside = env.entryPoints.filter((e) => names.has(stem(e.id.split(":")[0])) && !(p.at && underPrefix(e.id.split(":")[0], p.at)));
  if (!outside.length) return "";
  const reached = new Map<string, number>();
  for (const e of outside) for (const t of env.threads.filter((x) => x.entryPointId === e.id)) {
    for (const f of new Set((t.nodes ?? []).map((n: any) => n.file).filter(Boolean) as string[])) {
      const dir = f.split("/").slice(0, -1).join("/") || ".";
      if (files.includes(f)) reached.set(dir, (reached.get(dir) ?? 0) + 1);
    }
  }
  const dirs = [...reached.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d, n]) => `${d}/ (${n})`);
  return `; runs from ${outside.map((e) => e.id.split(":")[0]).join(", ")} (an entry point named like it, outside its \`at\`)${dirs.length ? `, whose thread reaches ${dirs.join(", ")}` : ""} — set \`entryPoints\` and \`uses\` to say so`;
}

/** A write runs in the processes whose threads reach the function holding it
 *  (an entry point maps to a planned process by the plan's \`entryPoints\`, else
 *  by the process that owns the entry's file). */
function sitePlacer(plan: Plan, env: EnvLike, ownerOf: Map<string, string>): SitePlacer {
  const files = Object.keys(env.files);
  const procs = plan.processes.filter((p) => p.status !== "dropped");
  const byId = new Map(procs.map((p) => [p.id, p]));
  const reach = new Map<string, Set<string>>();
  const threadOf = new Map<string, any>();
  for (const t of env.threads) {
    const ep = t.entryPointId;
    if (!ep || isTestFile(ep.split(":")[0])) continue;
    threadOf.set(ep, t);
    for (const n of t.nodes ?? []) {
      if (!n?.file || !n?.irNodeId) continue;
      const k = `${n.file}::${n.irNodeId}`;
      if (!reach.has(k)) reach.set(k, new Set());
      reach.get(k)!.add(ep);
    }
  }
  /** M4: the call path a thread takes from its seed to a function, for audit. */
  const pathTo = (ep: string, file: string, fnId: string): string | undefined => {
    const t = threadOf.get(ep);
    if (!t) return undefined;
    const nodes = new Map<string, any>((t.nodes ?? []).map((n: any) => [n.id, n]));
    const goal = (t.nodes ?? []).find((n: any) => n.file === file && n.irNodeId === fnId);
    const seed = (t.nodes ?? []).find((n: any) => n.kind === "seed");
    if (!goal || !seed) return undefined;
    const prev = new Map<string, string>();
    const queue = [seed.id];
    const seen = new Set(queue);
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === goal.id) break;
      for (const e of t.edges ?? []) {
        if (e.from !== cur || seen.has(e.to) || e.kind === "contains") continue;
        seen.add(e.to); prev.set(e.to, cur); queue.push(e.to);
      }
    }
    if (!prev.has(goal.id) && goal.id !== seed.id) return undefined;
    const steps: string[] = [];
    for (let c: string | undefined = goal.id; c; c = prev.get(c)) { const n = nodes.get(c); if (n && n.kind !== "container") steps.unshift(n.label ?? c); }
    return steps.length > 7 ? [...steps.slice(0, 3), "…", ...steps.slice(-3)].join(" → ") : steps.join(" → ");
  };
  const procOfEntry = (ep: string): string | undefined => {
    const file = ep.split(":")[0];
    const declared = procs.find((p) => (p.entryPoints ?? []).some((e) => e === ep || e === file || entryFiles([e], files).includes(file)));
    return declared?.id ?? ownerOf.get(file);
  };
  return (s) => {
    const nodes = (env.files[s.file]?.nodes ?? []) as Array<{ id: string; type: string; line?: number; endLine?: number }>;
    const fn = nodes.filter((n) => n.type === "function_def" && (n.line ?? 0) <= s.line && (n.endLine ?? 0) >= s.line)
      .sort((a, b) => ((a.endLine ?? 0) - (a.line ?? 0)) - ((b.endLine ?? 0) - (b.line ?? 0)))[0];
    const eps = fn ? reach.get(`${s.file}::${fn.id}`) : undefined;
    if (!eps?.size) return null;
    const byProc = new Map<string, string>();
    // a process's DECLARED entry point speaks for it first
    const declared = (ep: string) => procs.some((p) => (p.entryPoints ?? []).some((e) => e === ep || e === ep.split(":")[0]));
    for (const ep of [...eps].sort((a, b) => Number(declared(b)) - Number(declared(a)))) { const id = procOfEntry(ep); if (id && !byProc.has(id)) byProc.set(id, ep); }
    return [...byProc].map(([id, ep]) => ({ id, runsAs: byId.get(id)?.runsAs, via: pathTo(ep, s.file, fn!.id) }));
  };
}

const slugId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** M6: the identity a planned process signs in as, read from where its entry
 *  points build their clients — PROPOSED as runsAs, never applied. */
function signsInAs(p: PlanProcess, plan: Plan, env: EnvLike, files: string[], ix: IdentityIndex): string {
  const entries = [...new Set([...entryFiles(p.entryPoints, files), ...(p.entryPoints?.length ? [] : env.entryPoints.map((e) => e.id.split(":")[0]).filter((f) => p.at && underPrefix(f, p.at)))])].filter((f) => !isTestFile(f));
  if (!entries.length) return "";
  const ids = new Map<string, string>();
  const many: string[] = [];
  for (const f of entries) {
    const r = ix.entryIdentities(f);
    for (const i of r.identities) if (!ids.has(i.id)) ids.set(i.id, `${i.source}, ${i.cite}`);
    many.push(...r.many.map((m) => `${f}: ${m}`));
  }
  if (!ids.size && !many.length) return "";
  if (ids.size === 1 && !many.length) {
    const [id, why] = [...ids][0];
    const principal = (plan.principals ?? []).find((x) => slugId(x.id) === slugId(id));
    const note = p.runsAs ? (principal && principal.id !== p.runsAs ? ` — the plan says runsAs ${p.runsAs}` : "") : principal ? ` — propose runsAs: ${principal.id}` : ` — no planned principal is named ${id}`;
    return `; signs in as ${id} (${why})${note}`;
  }
  return `; signs in as ${ids.size + (many.length ? 1 : 0) > 1 || many.length ? "several identities" : ""}: ${[...ids].map(([id, why]) => `${id} (${why})`).join(", ")}${many.length ? `${ids.size ? "; " : ""}acts as many: ${many.slice(0, 3).join("; ")}` : ""}`;
}

/** M6: a write's own identity — the client it goes through, or (in an entry
 *  point's own file) the one identity that entry signs in as. */
function siteIdentityOf(plan: Plan, ix: IdentityIndex, env: EnvLike): SiteIdentity {
  const entryFilesSet = new Set(env.entryPoints.map((e) => e.id.split(":")[0]));
  return (s) => {
    const entry = entryFilesSet.has(s.file) ? s.file : null;
    let ans = ix.siteIdentity(s.file, s.line, entry);
    if (!ans && entry) {
      const r = ix.entryIdentities(entry);
      if (r.many.length) ans = { many: r.many[0] };
      else if (r.identities.length === 1) ans = { identity: r.identities[0] };
      else if (r.identities.length > 1) return { unplaced: `${entry} signs in as several identities (${r.identities.map((i) => i.id).join(", ")}) and this write's client is not followed` };
    }
    if (!ans) return null;
    if (ans.many) return { unplaced: `acts as many identities — ${ans.many}` };
    const id = ans.identity!;
    const principal = (plan.principals ?? []).find((x) => slugId(x.id) === slugId(id.id));
    return principal ? { principal: principal.id, why: `${id.source}, ${id.cite}` } : { unplaced: `signs in as ${id.id} (${id.source}, ${id.cite}) — no planned principal is named ${id.id}` };
  };
}

/** The data operations the derived layer placed (data_arch.ts) join a planned
 *  store's access sites when a zone of the store holds their family, so the
 *  write matrix sees writes made through the project's own funnels and
 *  injected ports instead of reading "no write to it yet". */
function mergeDerivedSites(plan: Plan, sites: Map<string, AccessSite[]>, ops: Array<{ file: string; line: number; op: "write" | "read" | "watch"; family: string; port?: string }>): void {
  if (!(plan.stores ?? []).some((s) => (s.zones ?? []).length)) return;
  for (const s of plan.stores ?? []) {
    const list = sites.get(s.id) ?? [];
    for (const o of ops) {
      if (!(s.zones ?? []).some((z) => z.holds.some((h) => familyMatches(h, o.family) || covers(h, o.family) || covers(o.family, h)))) continue;
      if (list.some((x) => x.file === o.file && x.line === o.line)) continue;
      list.push({ file: o.file, nodeId: "", line: o.line, fn: o.port ? `through ${o.port}` : "(derived)", callee: o.port ?? "(derived data operation)", op: o.op, family: o.family, computed: false });
    }
    sites.set(s.id, list);
  }
}

export function reconcilePlan(plan: Plan, env: EnvLike, stack: StackIndex, root: string, commit = "plan"): PlanReconcile {
  const findings: PlanFinding[] = [];
  let idMemo: IdentityIndex | null = null;
  const identities = () => (idMemo ??= new IdentityIndex(env.files, stack as never, root));
  const add = (f: PlanFinding) => findings.push(f);
  const files = Object.keys(env.files);
  const live = <T extends { status?: string }>(xs: T[]) => xs.filter((x) => x.status !== "dropped");

  // ── processes: a deployable's own files (`at`, its entry points) and the
  // modules it uses ──
  const own = processOwnership(plan, files, (p) => processFiles(p, files)?.files ?? null);
  const owned = own.owned;
  for (const p of live(plan.processes)) {
    const m = processFiles(p, files);
    const all = owned.get(p.id);
    // A database or cache modelled as a process keeps its verdict and is told what it is.
    const hint = p.kind === "db" || p.kind === "cache" ? ` — ${storeHint(p.id)}` : "";
    const deployable = !!(p.entryPoints?.length || p.uses?.length);
    const parts = [
      m ? `${m.files.length} file(s) ${m.how}` : "",
      p.entryPoints?.length ? `${entryFiles(p.entryPoints, files).length} of ${p.entryPoints.length} entry point file(s) found` : "",
      p.uses?.length ? `uses ${p.uses.map((u) => `${u} (${own.moduleFiles.get(u)?.length ?? 0} file(s))`).join(", ")}` : "",
    ].filter(Boolean).join("; ");
    if (all === null) add({ section: "processes", id: p.id, verdict: "unanchored", detail: `no \`at\` and no directory of its name — add \`at\` (where its code will live), or its \`entryPoints\` and the modules it \`uses\`, to check it${hint}` });
    else if (!all.length) add({ section: "processes", id: p.id, verdict: "not-built", detail: deployable ? `no parsed file yet: ${parts}${hint}` : `no parsed file ${m!.how}${hint}` });
    else if (m && !m.files.length && !env.entryPoints.some((e) => own.ownerOf.get(e.id.split(":")[0]) === p.id)) {
      // 2026-10-02 — the modules it will use exist, but nothing of its own runs
      // them: "realised (0 files)" said a process was built when only its libraries were.
      add({ section: "processes", id: p.id, verdict: "not-built", detail: `nothing of its own yet: ${parts} — no file ${m.how} and no entry point runs it${hint}` });
    } else {
      // Its entry points: the ones in files it owns (never a shared library's).
      const eps = env.entryPoints.filter((e) => own.ownerOf.get(e.id.split(":")[0]) === p.id);
      const head = deployable ? parts : `${m!.files.length} file(s) ${m!.how}`;
      add({ section: "processes", id: p.id, verdict: "realised", detail: `${head}${eps.length ? `, ${eps.length} entry point(s)` : ", no entry point yet"}${runsFrom(p, env, files)}${signsInAs(p, plan, env, files, identities())}${hint}`, ...(eps.length ? { entryPoints: eps.slice(0, 50).map((e) => e.id) } : {}) });
    }
  }
  for (const f of moduleFindings(plan, own, env.entryPoints)) add(f);

  // ── stack ──
  const realTools = stack.tools.filter((t) => t.origin !== "project");
  const toolByName = new Map(realTools.map((t) => [t.tool.toLowerCase(), t]));
  // A planned tool's names: itself, and the client libraries it is reached
  // through (`via`) — code using `yjs` realises a `docstore` reached via yjs.
  // 2026-10-02 (field report) — and the packages its RATIFIED software spec
  // names as its identity, and what a planned store of the same name is reached
  // through: a platform SDK that carries the database realises the database.
  const specs = listSpecs(root).filter((x) => x.status === "ratified");
  const viaWhy = new Map<string, string>();
  const namesOf = (tool: string) => {
    const spec = specs.find((x) => x.tool.toLowerCase() === tool.toLowerCase());
    const store = (plan.stores ?? []).find((x) => x.id.toLowerCase() === tool.toLowerCase() && x.status !== "dropped");
    for (const pkg of spec?.identity.packages ?? []) viaWhy.set(`${tool}|${pkg.toLowerCase()}`, `its software spec names ${pkg}`);
    for (const r of store?.reachedThrough ?? []) if (!viaWhy.has(`${tool}|${r.toLowerCase()}`)) viaWhy.set(`${tool}|${r.toLowerCase()}`, `the store ${store!.id} is reached through it`);
    return [tool, ...(plan.stack.find((x) => x.tool === tool)?.via ?? []), ...(spec?.identity.packages ?? []), ...(store?.reachedThrough ?? [])];
  };
  const realOf = (tool: string) => namesOf(tool).map((n) => toolByName.get(n.toLowerCase())).filter((r): r is NonNullable<typeof r> => !!r);
  for (const t of live(plan.stack)) {
    const real = toolByName.get(t.tool.toLowerCase());
    const through = real ? [] : realOf(t.tool);
    if (through.length) {
      const why = [...new Set(through.map((r) => viaWhy.get(`${t.tool}|${r.tool.toLowerCase()}`)).filter(Boolean))];
      add({ section: "stack", id: t.tool, verdict: "realised", detail: `reached through ${[...new Set(through.map((r) => r.tool))].join(", ")} (used in ${new Set(through.flatMap((r) => r.files)).size} file(s))${why.length ? ` — ${why.join("; ")}` : ""}` });
    } else if (real) {
      // A role no table knows (`unknown`) is silence, not a contradiction.
      add(real.role === t.role || real.role === "unknown"
        ? { section: "stack", id: t.tool, verdict: "realised", detail: `used in ${real.files.length} file(s)${real.role === "unknown" ? ` (no table knows its role; planned as ${t.role})` : ""}` }
        : { section: "stack", id: t.tool, verdict: "drifted", detail: `planned as ${t.role}; the code reads it as ${real.role}` });
    } else {
      const same = realTools.filter((r) => r.role === t.role).map((r) => r.tool);
      add(same.length
        ? { section: "stack", id: t.tool, verdict: "drifted", detail: `not used; for ${t.role} the code uses ${same.slice(0, 4).join(", ")}` }
        : { section: "stack", id: t.tool, verdict: "not-built", detail: "not imported or called anywhere yet" });
    }
  }

  // ── stores: resources, reached through tools / funnels / folders ──
  // The import graph is built only when a plan section needs it.
  let graphMemo: { graph: ImportEdge[]; packages: WorkspacePackage[] } | null = null;
  const graphOf = () => (graphMemo ??= (() => { const packages = workspacePackages(root); return { graph: importGraph(env.files, packages), packages }; })());
  // what the code says about stores (data_arch.ts), derived once
  const da = (plan.stores ?? []).length ? deriveDataArchitecture(env.files, stack as any, env.threads as any) : null;
  const st = (plan.stores ?? []).length ? storeFindings(plan, stack, env.files, graphOf().graph, graphOf().packages, da ? { zones: da.topology.zones ?? [], ops: da.operations } : undefined) : { findings: [], reach: new Map(), sites: new Map() };
  for (const f of st.findings) add(f);
  if (da) mergeDerivedSites(plan, st.sites, da.operations);
  const storeById = new Map((plan.stores ?? []).map((x) => [x.id, x]));
  // ── principals: who runs as whom, and who writes which zone ──
  const who = (plan.principals ?? []).length || (plan.stores ?? []).some((x) => x.zones?.some((z) => z.writers)) ? principalFindings(plan, st.sites, own.ownerOf, sitePlacer(plan, env, own.ownerOf), siteIdentityOf(plan, identities(), env)) : null;
  for (const f of who?.findings ?? []) add(f);
  // ── coordination through the stores: the hops the code has, the flows planned ──
  const procOf = own.ownerOf;
  const hops = (plan.stores ?? []).length ? indirectHops(plan, st.sites, procOf) : [];
  for (const f of flowFindings(plan, st.sites, procOf)) add(f);

  // ── boundaries ──
  const plannedTools = new Map(plan.stack.map((t) => [t.tool, t]));
  const boundaryVerdict = new Map<string, PlanVerdict>();
  const dropped = new Set(plan.processes.filter((p) => p.status === "dropped").map((p) => p.id));
  for (const b of live(plan.boundaries)) {
    const fromFiles = owned.get(b.from);
    const toIsProcess = plan.processes.some((p) => p.id === b.to);
    let f: PlanFinding;
    const gone = [b.from, b.to].filter((x) => dropped.has(x));
    const store = storeById.get(b.to);
    if (gone.length) {
      // Not "not built": it never will be, as written — an end was dropped.
      // A dropped db/cache was usually dropped for not being a process: say what it is.
      const dbs = gone.filter((x) => ["db", "cache"].includes(plan.processes.find((p) => p.id === x)?.kind ?? ""));
      f = { section: "boundaries", id: b.id, verdict: "orphaned", detail: `${gone.join(" and ")} ${gone.length === 1 ? "was" : "were"} dropped from the plan — drop this boundary, or point it at another process${dbs.length ? `; ${storeHint(dbs[0])}` : ""}` };
    } else if (store && store.status !== "dropped") {
      f = storeBoundaryFinding(b, store, st.reach.get(store.id), fromFiles, st.sites.get(store.id));
    } else if (toIsProcess) {
      const toFiles = owned.get(b.to);
      const built = (x: string[] | null | undefined) => !!x && x.length > 0;
      f = built(fromFiles) && built(toFiles)
        ? { section: "boundaries", id: b.id, verdict: "unverified", detail: `${b.from} and ${b.to} are both built; the hop between them is not followed` }
        : { section: "boundaries", id: b.id, verdict: "not-built", detail: `${[b.from, b.to].filter((x) => !built(owned.get(x))).join(" and ")} not built yet` };
    } else {
      const reals = realOf(b.to);
      const realFiles = [...new Set(reals.flatMap((r) => r.files))];
      const how = reals.length && reals[0].tool.toLowerCase() !== b.to.toLowerCase() ? ` (through ${reals.map((r) => r.tool).join(", ")})` : "";
      if (!reals.length) f = { section: "boundaries", id: b.id, verdict: "not-built", detail: `${b.to} is not used anywhere yet${plannedTools.has(b.to) ? "" : " (and it is not a planned tool)"}` };
      else if (!fromFiles) f = { section: "boundaries", id: b.id, verdict: "unverified", detail: `${b.to}${how} is used, but ${b.from} has no location to check it from` };
      else {
        const from = new Set(fromFiles);
        const hits = realFiles.filter((x) => from.has(x));
        f = hits.length
          ? { section: "boundaries", id: b.id, verdict: "realised", detail: `${b.from} reaches ${b.to}${how} in ${hits.slice(0, 3).join(", ")}${hits.length > 3 ? ", …" : ""}` }
          : { section: "boundaries", id: b.id, verdict: "drifted", detail: `${b.to}${how} is used, but not from ${b.from}'s files (${realFiles.slice(0, 3).join(", ")})` };
      }
    }
    boundaryVerdict.set(b.id, f.verdict);
    add(f);
  }

  // ── threads ──
  for (const t of live(plan.threads)) {
    // Its `entryPoint` first, else its id read as an entry point (plan_thread_match.ts).
    const m = matchThreadEntry(t, env.entryPoints);
    const ep = m.ep;
    if (!ep) {
      if (m.ambiguous) { add({ section: "threads", id: t.id, verdict: "unanchored", detail: `entryPoint ${m.named} names a file with ${m.ambiguous.length} entry points — give one: ${m.ambiguous.join(", ")}`, suggestions: m.ambiguous.slice(0, 3) }); continue; }
      const sug = suggestEntries(t, plan, env.entryPoints);
      add({
        section: "threads", id: t.id, verdict: "not-built",
        detail: `${m.named ? `entryPoint ${m.named} is no entry point the code has` : "no entry point reads like it yet"}${sug.length ? ` — did you mean ${sug.join(", ")}? (set it as the thread's \`entryPoint\`)` : ""}`,
        ...(sug.length ? { suggestions: sug } : {}),
      });
      continue;
    }
    const thread = env.threads.find((x) => x.entryPointId === ep.id);
    const labels = (thread?.nodes ?? []).map((n: any) => String(n.label ?? "").toLowerCase());
    // A step's own name forms, from its id: `module/Writer.class/write.fn` is
    // also `Writer.write` — the spelling a plan uses for a method, which the
    // label (`write`) alone never matched.
    const qualified = new Set<string>();
    for (const n of (thread?.nodes ?? []) as any[]) {
      if (n.kind !== "step" && n.kind !== "seed") continue;
      const segs = String(n.irNodeId ?? "").split("/").filter((s) => s.endsWith(".class") || s.endsWith(".fn")).map((s) => s.replace(/\.(class|fn)$/, ""));
      for (let i = 0; i < segs.length; i++) qualified.add(segs.slice(i).join(".").toLowerCase());
    }
    const called = new Set((stack.byThreadCalled?.[ep.id] ?? stack.byThread[ep.id] ?? []).map((x) => x.toLowerCase()));
    const missing: string[] = [];
    for (const step of t.primary) {
      const [head, ...rest] = step.split(":");
      const b = plan.boundaries.find((x) => x.id === head);
      if (b) {
        if (!namesOf(b.to).some((n) => called.has(n.toLowerCase())) && boundaryVerdict.get(b.id) !== "realised" && boundaryVerdict.get(b.id) !== "unverified") missing.push(step);
        continue;
      }
      const name = (rest.length ? rest.join(":") : head).trim().toLowerCase();
      if (!name || !(qualified.has(name) || labels.some((l) => l.includes(name)))) missing.push(step);
    }
    add(missing.length
      ? (() => {
        const missingWhy = Object.fromEntries(missing.map((s) => [s, plan.boundaries.some((b) => b.id === s.split(":")[0]) ? `the thread never calls ${plan.boundaries.find((b) => b.id === s.split(":")[0])!.to}` : whyMissing(s, thread, env.files, ep.id)]));
        const proc = threadProcess(t.process, ep.id, own);
        return { section: "threads" as const, id: t.id, verdict: "drifted" as const, detail: `entry point ${ep.id} exists; not found on its thread: ${missing.map((s) => `${s} (${missingWhy[s]})`).join("; ")}`, entryPointId: ep.id, missing, missingWhy, ...(proc ? { process: proc } : {}) };
      })()
      : { section: "threads", id: t.id, verdict: "realised", detail: `entry point ${ep.id}; every primary step found`, entryPointId: ep.id, ...(threadProcess(t.process, ep.id, own) ? { process: threadProcess(t.process, ep.id, own) } : {}) });
  }

  // ── planned rules, as advice ──
  const pols = live(plan.policies);
  if (pols.length) {
    let facts: ReturnType<typeof buildQualityFacts> | null = null;
    const registry = newRegistry();
    for (const p of pols) {
      if (p.status === "promoted") { add({ section: "policies", id: p.id, verdict: "prose", detail: `promoted to ${p.constraintId} — \`check\` and the hooks run it now` }); continue; }
      if (!p.check) { add({ section: "policies", id: p.id, verdict: "prose", detail: "no check — a reader's job" }); continue; }
      // A layer rule may name planned modules; the grammar reads folders.
      const check = expandModuleRefs(p.check, plan)!;
      facts ??= buildQualityFacts({ envelope: env as never, root, commit, stack });
      let r: { verdict: string; reason: string } | null = null;
      if (isConstraintCheck(check)) r = checkConstraint(facts as never, check);
      else if (isRun1Check(check)) {
        // A `files`-scoped verb reads the files the rule names (statedScopeFiles).
        const own = (p.check as { scope?: string }).scope === "files" ? statedScopeFiles({ scope: { files: p.files ?? [] } } as never, files) : [];
        r = registry.run((own.length ? { ...facts, scopeFiles: own } : facts) as never, check as never);
      }
      add(r
        ? { section: "policies", id: p.id, verdict: r.verdict as PlanVerdict, detail: `${r.reason} (advice — a planned rule blocks nothing)` }
        : { section: "policies", id: p.id, verdict: "unverifiable", detail: "the check matches no verb in the constraint grammar" });
    }
  }

  // ── what the plan assumes, and the evidence run for it ──
  applyAssumptions(plan, findings);

  const counts: Partial<Record<PlanVerdict, number>> = {};
  for (const f of findings) counts[f.verdict] = (counts[f.verdict] ?? 0) + 1;
  return { revision: plan.revision, findings, counts, limits: PLAN_RECONCILE_LIMITS, offObjective: offObjective(plan), ...(who?.matrix.length ? { writeMatrix: who.matrix } : {}), ...(hops.length ? { indirectHops: hops } : {}) };
}

// ── staying on the objective: a word-match guess, said as one ────────────

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "onto", "each", "every", "all", "any", "are", "was", "were", "has", "have", "its", "their", "our", "your", "them", "they", "can", "will", "should", "must", "within", "about", "over", "under", "when", "than", "then", "one", "per", "via", "not", "but", "also", "more", "less", "who", "what", "which", "how", "see", "get", "use", "make"]);
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");
export function objectiveWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem).filter((w) => w.length >= 3));
}

/** Processes and threads whose `serves` shares no meaningful word with the
 *  objective. A GUESS: words are not meaning ("latency" serves "within a
 *  minute" and shares nothing), so it is a prompt to look, never a verdict. */
export function offObjective(plan: Plan): Array<{ section: "processes" | "threads"; id: string; serves: string }> {
  const obj = objectiveWords(plan.objective);
  if (!obj.size) return [];
  const out: Array<{ section: "processes" | "threads"; id: string; serves: string }> = [];
  const look = (section: "processes" | "threads", id: string, serves: string | null) => {
    if (!serves) return;
    if (![...objectiveWords(serves)].some((w) => obj.has(w))) out.push({ section, id, serves });
  };
  for (const p of plan.processes) if (p.status !== "dropped") look("processes", p.id, p.serves);
  for (const t of plan.threads) if (t.status !== "dropped") look("threads", t.id, t.serves);
  return out;
}
