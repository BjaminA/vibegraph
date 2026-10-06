// The architecture map's PLAN views (2026-09-30): the hypothetical project
// drawn with the real map's own boxes and router, as GHOSTS — `source:
// "planned"`, dashed, chipped "planned". GUI only, like the Configuration and
// Journeys lenses: the model is built here from `.vibegraph/plan.json` (served
// with its plan-vs-code verdicts by plan-state) and drawn through the Tools
// lens's layout.
//
//   Plan     — the plan alone: planned processes, planned tools, boundaries.
//   Overlay  — the real map with the plan on it. A planned item the code has
//              REALISED is not drawn twice: its real box carries a "planned ✓"
//              chip and everything the plan says about it; only what the code
//              does not have yet is a dashed ghost.
//
// 2026-10-01 — the plan's CONTENT reaches the map, not only its boxes: each
// process card holds its planned threads (a chip opens them as dashed step
// chains coloured by verdict, missing steps struck through); planned rules and
// open questions sit on the item they are `about`; a boundary reads "· N keys"
// with the keys on hover; and a boundary whose ends sit in two different
// STATED trust zones says it crosses them. Every planned item is drawn exactly
// once — on its ghost, on the real box that realised it, or, for what has no
// place on the map, in the counts `planModel` returns as `unplaced`.

import type { ArchModelRecord, ArchNodeRecord, ArchEdgeRecord, ArchGroupRecord, PlanFlowRecord } from "../../shared/protocol";
import type { ArchCategory } from "../../shared/arch_protocol";
import type { Plan, PlanFinding, PlanReconcile, PlanSection } from "../../shared/plan_types";

export type PlanView = "real" | "plan" | "overlay";
export const PLAN_ID = "plan:";
/** The card that holds planned threads no process owns. */
export const UNOWNED_THREADS = `${PLAN_ID}threads`;

const PROCESS_CATEGORY: Record<string, ArchCategory> = {
  frontend: "frontend", backend: "backend", db: "database", cache: "cache", external_http: "external", library: "backend",
};
const ROLE_CATEGORY: Record<string, ArchCategory> = {
  db: "database", cache: "cache", queue: "queue", "model-api": "model", "http-client": "external", cloud: "cloud",
  platform: "platform", "web-framework": "backend", frontend: "frontend", "agent-protocol": "agent", data: "pipeline",
};
/** 2026-10-01 — a planned store's card category. */
const STORE_CATEGORY: Record<string, ArchCategory> = {
  database: "database", "document-store": "database", "object-store": "storage", queue: "queue", cache: "cache", sync: "platform", kv: "database", other: "storage",
};
const EMPTY_UNPLACED: ArchModelRecord["unplaced"] = { tests: 0, unmatchedHops: 0, toolsPresentNotCalled: [], unattributedBoundaries: 0 };
const TRUST_KINDS = new Set(["trust", "zone"]);

export interface PlanDrawOpts {
  /** box ids whose planned threads are shown open */
  expanded?: ReadonlySet<string>;
}

/** What the plan says that the map could not place, said rather than dropped. */
export interface PlanUnplaced { rules: string[]; questions: string[]; boundaries: string[] }

function finding(rec: PlanReconcile | null, section: PlanSection, id: string): PlanFinding | undefined {
  return rec?.findings.find((f) => f.section === section && f.id === id);
}
const live = <T extends { status?: string }>(xs: T[]) => xs.filter((x) => x.status !== "dropped");
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Planned process / tool → the REAL box that realises it (overlay only). A
 *  process is placed by the entry points plan-check found in its files (the
 *  cluster holding most of them); a tool by its tool node. A realised process
 *  with no entry point has nothing to place it by and stays a ghost. */
export function realisedTargets(plan: Plan, rec: PlanReconcile | null, real: ArchModelRecord | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!real || !rec) return out;
  // 2026-10-06 (M3) — ANCHORED first: a plan process naming its own entry
  // points (ids or files) is the box that runs them, whatever its `at` says.
  for (const p of live(plan.processes)) {
    const eps = p.entryPoints ?? [];
    if (!eps.length) continue;
    const hit = real.nodes.filter((n) => n.kind === "cluster" && (n.entryPoints ?? []).some((e) => eps.includes(e) || eps.includes(e.replace(/:[^:]*$/, ""))));
    if (hit.length) out.set(`processes:${p.id}`, hit.sort((a, b) => (b.runtime ? 1 : 0) - (a.runtime ? 1 : 0))[0].id);
  }
  for (const p of live(plan.processes)) {
    if (out.has(`processes:${p.id}`)) continue;
    const f = finding(rec, "processes", p.id);
    if (f?.verdict !== "realised" || !f.entryPoints?.length) continue;
    // a box an ANCHORED plan process already names is not this one's; on a
    // tie a running process outranks a group of one-shot scripts
    const anchoredBoxes = new Set(live(plan.processes).filter((x) => (x.entryPoints ?? []).length).map((x) => out.get(`processes:${x.id}`)).filter(Boolean));
    let best: { id: string; n: number; rt: boolean } | null = null;
    for (const n of real.nodes) {
      if (n.kind !== "cluster" || !n.entryPoints?.length || anchoredBoxes.has(n.id)) continue;
      const k = f.entryPoints.filter((e) => n.entryPoints!.includes(e)).length;
      const rt = !!n.runtime;
      if (k && (!best || k > best.n || (k === best.n && rt && !best.rt))) best = { id: n.id, n: k, rt };
    }
    if (best) out.set(`processes:${p.id}`, best.id);
  }
  // 2026-10-06 — identity by PATH: a realised process with an `at` the entry
  // points did not place goes to the cluster whose entry files sit under it.
  for (const p of live(plan.processes)) {
    if (out.has(`processes:${p.id}`) || !p.at || finding(rec, "processes", p.id)?.verdict !== "realised") continue;
    const at = p.at.replace(/\/$/, "");
    let best: { id: string; n: number } | null = null;
    for (const n of real.nodes) {
      if (n.kind !== "cluster") continue;
      const k = (n.entryPoints ?? []).filter((e) => { const f = e.replace(/:[^:]*$/, ""); return f === at || f.startsWith(`${at}/`); }).length;
      if (k && (!best || k > best.n)) best = { id: n.id, n: k };
    }
    if (best) out.set(`processes:${p.id}`, best.id);
  }
  for (const t of live(plan.stack)) {
    if (finding(rec, "stack", t.tool)?.verdict !== "realised") continue;
    const node = real.nodes.find((n) => n.kind === "tool" && (n.tool ?? "").toLowerCase() === t.tool.toLowerCase());
    if (node) out.set(`stack:${t.tool}`, node.id);
  }
  return out;
}

/** A plan process placed only by its `at` path or the files under it —
 *  LOCATED, not anchored: it names where code lives, not which process runs
 *  it (a logic library is not the service that runs it). */
export const locatedOnly = (p: { entryPoints?: string[] }) => !(p.entryPoints ?? []).length;

/** node id → the label of the stated/proposed trust zone around it. */
function trustZones(real: ArchModelRecord | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!real) return out;
  const byId = new Map(real.groups.map((g) => [g.id, g]));
  const cover = (gid: string, seen = new Set<string>()): string[] => {
    if (seen.has(gid)) return [];
    seen.add(gid);
    return (byId.get(gid)?.wraps ?? []).flatMap((w) => (byId.has(w) ? cover(w, seen) : [w]));
  };
  for (const g of real.groups) if (TRUST_KINDS.has(g.kind)) for (const n of cover(g.id)) if (!out.has(n)) out.set(n, g.label);
  return out;
}

/**
 * The plan as map records. With `real` (the Overlay), realised items decorate
 * the real boxes and edges instead of being drawn again; `real` is null for
 * the Plan view, where everything is a ghost.
 */
export function planRecords(plan: Plan, rec: PlanReconcile | null, real: ArchModelRecord | null, opts: PlanDrawOpts = {}):
  { nodes: ArchNodeRecord[]; edges: ArchEdgeRecord[]; groups: ArchGroupRecord[]; decorate: Map<string, Partial<ArchNodeRecord>>; decorateEdges: Map<string, Partial<ArchEdgeRecord>>; unplaced: PlanUnplaced } {
  const targets = realisedTargets(plan, rec, real);
  // 2026-10-06 — what the real model already IS, by identity (arch_real.ts
  // stamps `planKeys`): never drawn a second time.
  const claimed = new Map<string, string>();
  for (const n of real?.nodes ?? []) for (const k of n.planKeys ?? []) if (!claimed.has(k)) claimed.set(k, n.id);
  for (const [k, id] of claimed) if (k.startsWith("processes:") || k.startsWith("stack:")) targets.set(k, id);
  const status = (s: string) => (s === "agreed" ? "agreed" : "proposed");
  const nodes: ArchNodeRecord[] = [];
  const groups: ArchGroupRecord[] = [];
  const decorate = new Map<string, Partial<ArchNodeRecord>>();
  const where = new Map<string, string>(); // planned id → the box id it is drawn on
  const deco = (id: string) => { if (!decorate.has(id)) decorate.set(id, {}); return decorate.get(id)!; };

  for (const p of live(plan.processes)) {
    const f = finding(rec, "processes", p.id);
    const target = targets.get(`processes:${p.id}`);
    if (target) {
      where.set(p.id, target);
      deco(target).plannedAs = { id: p.id, label: p.label, verdict: f?.verdict ?? "realised" };
      continue;
    }
    const id = `${PLAN_ID}${p.id}`;
    where.set(p.id, id);
    if (real && f?.verdict === "realised") deco(id).plannedAs = { id: p.id, label: p.label, verdict: "realised" };
    nodes.push({
      id, kind: "cluster", label: p.label, source: "planned", planVerdict: f?.verdict ?? "unverified",
      sublabel: `planned ${p.kind} · ${status(p.status)}${f ? ` · ${f.verdict}` : ""}${p.at ? ` · ${p.at}` : ""}${p.runsAs ? ` · runs as ${p.runsAs}` : ""}${p.uses?.length ? ` · uses ${p.uses.join(", ")}` : ""}`,
      category: PROCESS_CATEGORY[p.kind] ?? "unknown", threads: [], refs: [],
      notes: [p.serves ? `serves: ${p.serves}` : "serves: (not said)", ...(f ? [`${f.verdict}: ${f.detail}`] : [])],
    });
  }
  for (const t of live(plan.stack)) {
    const f = finding(rec, "stack", t.tool);
    const target = targets.get(`stack:${t.tool}`);
    if (target) {
      where.set(t.tool, target);
      deco(target).plannedAs = { id: t.tool, label: t.tool, verdict: f?.verdict ?? "realised" };
      continue;
    }
    const id = `${PLAN_ID}tool:${t.tool}`;
    where.set(t.tool, id);
    // Realised, but the real map draws no box for it (a web framework is not a
    // boundary): one card, chipped "planned ✓", rather than drawn nowhere.
    if (real && f?.verdict === "realised") deco(id).plannedAs = { id: t.tool, label: t.tool, verdict: "realised" };
    nodes.push({
      id, kind: "tool", label: t.tool, tool: t.tool, role: t.role, source: "planned", planVerdict: f?.verdict ?? "unverified",
      sublabel: `planned ${t.role} · ${status(t.status)}${f ? ` · ${f.verdict}` : ""}`,
      category: ROLE_CATEGORY[t.role] ?? "unknown", threads: [], refs: [],
      notes: [...(t.why ? [`why: ${t.why}`] : []), ...(f ? [`${f.verdict}: ${f.detail}`] : [])],
    });
  }

  // ── stores: shared resources, one card each (a realised store marks the
  // real tool box it is reached through, when the map draws one) ──
  for (const st of live(plan.stores ?? [])) {
    const f = finding(rec, "stores", st.id);
    const names = new Set(st.reachedThrough.map((n) => n.toLowerCase()));
    const realBox = (claimed.has(`stores:${st.id}`) ? real!.nodes.find((n) => n.id === claimed.get(`stores:${st.id}`)) : undefined)
      ?? (real && f?.verdict === "realised" ? real.nodes.find((n) => n.kind === "tool" && names.has((n.tool ?? "").toLowerCase())) : undefined);
    let box: string;
    if (realBox) {
      box = realBox.id;
      deco(realBox.id).plannedAs = { id: st.id, label: st.label ?? st.id, verdict: f!.verdict };
    } else {
      box = `${PLAN_ID}store:${st.id}`;
      if (real && f?.verdict === "realised") deco(box).plannedAs = { id: st.id, label: st.label ?? st.id, verdict: "realised" };
      nodes.push({
        id: box, kind: "tool", label: st.label ?? st.id, source: "planned", planVerdict: f?.verdict ?? "unverified",
        sublabel: `planned ${st.kind} store · ${status(st.status)}${f ? ` · ${f.verdict}` : ""}`,
        category: STORE_CATEGORY[st.kind] ?? "storage", threads: [], refs: [],
        notes: [`reached through ${st.reachedThrough.join(", ")}`, ...(st.serves ? [`serves: ${st.serves}`] : []), ...(f ? [`${f.verdict}: ${f.detail}`] : [])],
      });
    }
    where.set(st.id, box);
    // Zones: a card each, inside one group box with the store, so a write
    // edge lands on the zone it writes.
    if (!st.zones?.length) continue;
    const zoneIds: string[] = [];
    for (const z of st.zones) {
      const zf = finding(rec, "stores", `${st.id}/${z.id}`);
      // A zone the real model already draws (matched by its families): that
      // box carries the plan's word; no second card.
      const realZone = claimed.get(`stores:${st.id}/${z.id}`);
      if (realZone) {
        where.set(`${st.id}/${z.id}`, realZone);
        deco(realZone).plannedAs = { id: `${st.id}/${z.id}`, label: z.label ?? z.id, verdict: zf?.verdict ?? "realised" };
        continue;
      }
      // Who may write it (the plan) and, when the code breaks that, who does.
      const wf = finding(rec, "stores", `${st.id}/${z.id}:writers`);
      const zid = `${PLAN_ID}zone:${st.id}/${z.id}`;
      zoneIds.push(zid);
      where.set(`${st.id}/${z.id}`, zid);
      nodes.push({
        id: zid, kind: "tool", label: z.label ?? z.id, source: "planned", planVerdict: zf?.verdict ?? "unverified", storeOf: box,
        sublabel: `zone · ${z.holds.join(", ")}${zf ? ` · ${zf.verdict}` : ""}${z.writers?.length ? ` · writers ${z.writers.join(", ")}` : ""}${wf?.verdict === "violated" ? " · WRITER VIOLATED" : ""}`,
        category: STORE_CATEGORY[st.kind] ?? "storage", threads: [], refs: [],
        notes: [
          `holds ${z.holds.join(", ")}`,
          ...(z.writers?.length ? [`writers: ${z.writers.join(", ")}`] : []),
          ...(z.readers?.length ? [`readers: ${z.readers.join(", ")}`] : []),
          ...(z.routedBy ? [`routed by ${z.routedBy}`] : []),
          ...(zf ? [`${zf.verdict}: ${zf.detail}`] : []),
          ...(wf ? [`writers ${wf.verdict}: ${wf.detail}`] : []),
        ],
      });
    }
    // A real store's box already holds its zones: a planned zone the code
    // does not have yet joins that box; a ghost store gets its own.
    if (!box.startsWith(PLAN_ID)) {
      const g = real?.groups.find((x) => x.kind === "store" && x.wraps.includes(box));
      if (g && zoneIds.length) groups.push({ ...g, id: `${PLAN_ID}storegroup:${st.id}`, wraps: zoneIds, parent: g.id, source: "planned", label: "planned zones" });
      else if (zoneIds.length) groups.push({ id: `${PLAN_ID}storegroup:${st.id}`, kind: "store", label: `${st.label ?? st.id}: planned zones`, wraps: zoneIds, source: "planned" });
      continue;
    }
    groups.push({ id: `${PLAN_ID}storegroup:${st.id}`, kind: "store", label: `${st.label ?? st.id} (${st.kind})`, wraps: [box, ...zoneIds], source: "planned" });
  }

  // ── threads, on the box of the process that owns them ──
  const realClusterOf = (ep: string | undefined) => (ep && real ? real.nodes.find((n) => n.kind === "cluster" && n.entryPoints?.includes(ep))?.id : undefined);
  for (const t of live(plan.threads)) {
    const f = finding(rec, "threads", t.id);
    const missing = new Set(f?.missing ?? []);
    const flow: PlanFlowRecord = {
      id: t.id, verdict: f?.verdict ?? "unverified",
      steps: t.primary.map((s) => ({ text: s, missing: missing.has(s) })),
      ...(f?.entryPointId ? { entryPointId: f.entryPointId } : {}),
    };
    // Its process's box; else the real cluster its entry point sits in; else
    // the card for threads no process owns.
    // A thread with no `process` goes to the process whose own files hold
    // the entry point it starts from (plan check says which).
    const box = (t.process && where.get(t.process)) || (f?.process && where.get(f.process)) || realClusterOf(f?.entryPointId) || UNOWNED_THREADS;
    where.set(t.id, box);
    (deco(box).planFlows ??= []).push(flow);
  }
  if (decorate.get(UNOWNED_THREADS)?.planFlows?.length) {
    nodes.push({
      id: UNOWNED_THREADS, kind: "cluster", label: "Planned threads", source: "planned",
      sublabel: "threads the plan gives no process", category: "unknown", threads: [], refs: [],
      notes: ["give a thread a `process` to draw it on that process's box"],
    });
  }

  // ── boundaries ──
  const zones = trustZones(real);
  const edges: ArchEdgeRecord[] = [];
  const decorateEdges = new Map<string, Partial<ArchEdgeRecord>>();
  const edgeOf = new Map<string, string>(); // boundary id → the edge id it is drawn as
  const unplaced: PlanUnplaced = { rules: [], questions: [], boundaries: [] };
  for (const b of live(plan.boundaries)) {
    // A boundary that names a zone lands on that zone's card.
    const from = where.get(b.from), to = (b.zone && where.get(`${b.to}/${b.zone}`)) || where.get(b.to);
    if (!from || !to) { unplaced.boundaries.push(`${b.id} (${b.from} → ${b.to}: ${!from ? b.from : b.to} is not on the map)`); continue; }
    const f = finding(rec, "boundaries", b.id);
    const crosses = zones.get(from) && zones.get(to) && zones.get(from) !== zones.get(to) ? `${zones.get(from)} → ${zones.get(to)}` : undefined;
    const extra: Partial<ArchEdgeRecord> = { planBoundary: b.id, ...(b.carries?.length ? { planCarries: b.carries } : {}), ...(crosses ? { crossesTrust: crosses } : {}) };
    // A realised boundary between two real boxes the map already joins is the
    // real edge: decorated, not drawn a second time.
    const realEdge = f?.verdict === "realised" && !from.startsWith(PLAN_ID) && !to.startsWith(PLAN_ID)
      ? real?.edges.find((e) => e.from === from && e.to === to) : undefined;
    if (realEdge) {
      decorateEdges.set(realEdge.id, { ...(decorateEdges.get(realEdge.id) ?? {}), ...extra });
      edgeOf.set(b.id, realEdge.id);
      continue;
    }
    const id = `${PLAN_ID}${b.id}`;
    edgeOf.set(b.id, id);
    edges.push({
      id, from, to, kind: plan.processes.some((p) => p.id === b.to) ? "http" : "uses",
      protocol: b.protocol ?? "planned",
      protocolBasis: `planned boundary ${b.id} (${status(b.status)})${f ? ` — ${f.verdict}: ${f.detail}` : ""}`,
      count: 1, threads: [], confidence: "path", refs: [], source: "planned", ...extra,
    });
  }

  // ── indirect hops: processes that meet only in a store, joined by a
  // dashed edge labelled with what they share ──
  for (const h of rec?.indirectHops ?? []) {
    const from = where.get(h.from), to = where.get(h.to);
    if (!from || !to) continue;
    const via = `${h.store}${h.zone ? `/${h.zone}` : ""}${h.family ? ` · ${h.family}` : ""}`;
    edges.push({
      id: `${PLAN_ID}hop:${h.from}>${h.to}:${via}`, from, to, kind: "uses",
      protocol: `via ${via}`, protocolBasis: `indirect: ${h.from} writes at ${h.write}; ${h.to} reads/watches at ${h.read}`,
      count: 1, threads: [], confidence: "path", refs: [], source: "planned", planHop: via,
    });
  }

  // ── rules and questions, on what they are about ──
  const atOf = new Map(live(plan.processes).filter((p) => p.at).map((p) => [p.id, p.at!]));
  const placeFor = (about: string | undefined, files?: string[]): { node?: string; edge?: string } => {
    if (about) {
      if (edgeOf.has(about)) return { edge: edgeOf.get(about) };
      if (where.has(about)) return { node: where.get(about) };
      return {};
    }
    // No `about`: a rule's files place it on the ONE process whose code they are in.
    const hit = [...atOf].filter(([, at]) => (files ?? []).some((f) => f.startsWith(at) || at.startsWith(f)));
    return hit.length === 1 ? { node: where.get(hit[0][0]) } : {};
  };
  for (const p of plan.policies) {
    if (p.status === "dropped") continue;
    const at = placeFor(p.about, p.files);
    const text = `${p.id}: ${p.text}`;
    if (at.edge) (decorateEdges.get(at.edge) ?? (decorateEdges.set(at.edge, {}), decorateEdges.get(at.edge)!)).planRules = [...(decorateEdges.get(at.edge)?.planRules ?? []), text];
    else if (at.node) (deco(at.node).planRules ??= []).push(text);
    else unplaced.rules.push(text);
  }
  for (const q of plan.open) {
    const at = placeFor(q.about);
    const text = `${q.id}: ${q.text}`;
    if (at.edge) (decorateEdges.get(at.edge) ?? (decorateEdges.set(at.edge, {}), decorateEdges.get(at.edge)!)).planQuestions = [...(decorateEdges.get(at.edge)?.planQuestions ?? []), text];
    else if (at.node) (deco(at.node).planQuestions ??= []).push(text);
    else unplaced.questions.push(text);
  }

  for (const [id, d] of decorate) if (d.planFlows?.length) d.planFlowsOpen = !!opts.expanded?.has(id);
  // Ghosts carry their own decorations; the real boxes get theirs in overlayModel.
  const ghosts = nodes.map((n) => ({ ...n, ...(decorate.get(n.id) ?? {}) }));
  const ghostEdges = edges.map((e) => ({ ...e, ...(decorateEdges.get(e.id) ?? {}) }));
  return { nodes: ghosts, edges: ghostEdges, groups, decorate, decorateEdges, unplaced };
}

export function planModel(plan: Plan, rec: PlanReconcile | null, opts: PlanDrawOpts = {}): ArchModelRecord & { planUnplaced: PlanUnplaced } {
  const { nodes, edges, groups, unplaced } = planRecords(plan, rec, null, opts);
  return { version: "1", nodes, edges, groups, unplaced: EMPTY_UNPLACED, notes: [`the plan, revision ${plan.revision} — hypothetical, not the code`], planUnplaced: unplaced };
}

/** The real model with the plan on it: realised items decorate their real
 *  boxes and edges; what the code does not have yet is added as ghosts. */
export function overlayModel(real: ArchModelRecord, plan: Plan, rec: PlanReconcile | null, opts: PlanDrawOpts = {}): ArchModelRecord & { planUnplaced: PlanUnplaced } {
  const r = planRecords(plan, rec, real, opts);
  const nodes = real.nodes.map((n) => (r.decorate.has(n.id) && !n.id.startsWith(PLAN_ID) ? { ...n, ...r.decorate.get(n.id) } : n));
  const edges = real.edges.map((e) => (r.decorateEdges.has(e.id) ? { ...e, ...r.decorateEdges.get(e.id) } : e));
  const marked = [...r.decorate.values()].filter((d) => d.plannedAs).length;
  return {
    ...real, nodes: [...nodes, ...r.nodes], edges: [...edges, ...r.edges], groups: [...(real.groups ?? []), ...r.groups], planUnplaced: r.unplaced,
    notes: [...(real.notes ?? []), `the plan on the code: ${marked} realised item(s) marked "planned ✓" on their real box, ${r.nodes.length} planned item(s) the code does not have yet (dashed)`],
  };
}

/** The label a planned (or plan-decorated) edge shows: its protocol, "· N
 *  keys" (the keys on hover), its rules and questions, a trust crossing. */
export function planEdgeLabel(m: ArchEdgeRecord, base: string): { label: string; full: string } {
  const bits = [base];
  if (m.planCarries?.length) bits.push(plural(m.planCarries.length, "key"));
  if (m.planRules?.length) bits.push(plural(m.planRules.length, "rule"));
  if (m.planQuestions?.length) bits.push(`${m.planQuestions.length} open`);
  // A trust crossing is the line's colour plus the hover text: the router
  // sized the label spot for a short label.
  const full = [
    ...(m.planCarries?.length ? [`carries: ${m.planCarries.join(", ")}`] : []),
    ...(m.planRules ?? []), ...(m.planQuestions ?? []).map((q) => `open — ${q}`),
    ...(m.crossesTrust ? [`crosses the stated trust zones ${m.crossesTrust}`] : []),
  ].join("\n");
  return { label: bits.join(" · "), full: full || base };
}

/** Dashed, quieter edges for the planned ones; a plan-decorated real edge
 *  keeps its line and gains the plan's label bits. A trust crossing is drawn
 *  in the warning tone. */
export function ghostPlannedEdges<E extends { id: string; style?: any; label?: any; data?: any }>(edges: E[], model: ArchModelRecord): E[] {
  const byId = new Map(model.edges.map((e) => [e.id, e]));
  return edges.map((e) => {
    const m = byId.get(e.id);
    const planned = e.id.startsWith(PLAN_ID);
    if (!m || (!planned && !m.planCarries && !m.planRules && !m.planQuestions && !m.crossesTrust)) return e;
    const base = planned ? m.protocol : String(e.label ?? m.protocol);
    const { label, full } = planEdgeLabel(m, base);
    const style = {
      ...e.style,
      ...(planned ? { strokeDasharray: "6 4", opacity: 0.75 } : {}),
      ...(m.crossesTrust ? { stroke: "var(--accent-warning)" } : {}),
    };
    return { ...e, label, data: { ...e.data, fullLabel: full }, style };
  });
}
