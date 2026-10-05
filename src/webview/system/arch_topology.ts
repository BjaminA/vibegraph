// The DECLARED TOPOLOGY on the map (2026-10-02): two GUI-only lenses drawn
// through the map's own layout, like Configuration and Journeys.
//
//   Resources  stores → zones (cards inside a store box) → document families,
//              principals with read / write edges to the zones their grants
//              reach (a role expanded to its holders, the grant's file:line on
//              hover); each zone names its router and the threads it is on.
//              With a live inventory, drift is drawn: a zone only the platform
//              has, a grant only the platform has, a declared grant it lacks.
//   Decisions  decision trees (yes / no edges, outcomes) and state machines
//              (transitions with who may make them); a node's evidence edge goes
//              to the family it reads, the family to its zone, and the zone says
//              who may write it — "decision node → evidence → zone → writers".
//
// Every id is `topo:` so nothing here can collide with the derived model.

import type { ArchModelRecord, ArchNodeRecord, ArchEdgeRecord, ArchGroupRecord } from "../../shared/protocol";
import type { ArchCategory } from "../../shared/arch_protocol";
import type { TopologyModel, Topology } from "../../shared/topology_types";
import type { TopologyDrift, TraceStep } from "../../shared/topology_analysis";
import { grantees, whoMay, zoneOfFamily, threadsOfFunction } from "../../shared/topology_query.ts";

export const TOPO = "topo:";
const EMPTY: ArchModelRecord["unplaced"] = { tests: 0, unmatchedHops: 0, toolsPresentNotCalled: [], unattributedBoundaries: 0 };
interface ThreadLike { entryPointId: string | null; nodes: any[] }

const card = (id: string, label: string, category: ArchCategory, sublabel: string, notes: string[], extra: Partial<ArchNodeRecord> = {}): ArchNodeRecord =>
  ({ id, kind: "tool", label, sublabel, category, threads: [], refs: [], notes, source: "stated", ...extra } as ArchNodeRecord);
const edge = (from: string, to: string, protocol: string, basis: string, extra: Partial<ArchEdgeRecord> = {}): ArchEdgeRecord =>
  ({ id: `${TOPO}e:${from}>${to}:${protocol}`, from, to, kind: "uses", protocol, protocolBasis: basis, count: 1, threads: [], confidence: "path", refs: [], source: "stated", ...extra } as ArchEdgeRecord);

export const zoneId = (z: string) => `${TOPO}zone:${z}`;
export const famId = (f: string) => `${TOPO}fam:${f}`;
export const prId = (p: string) => `${TOPO}pr:${p}`;
export const dnId = (tree: string, n: string) => `${TOPO}dt:${tree}:${n}`;
export const stId = (sm: string, s: string) => `${TOPO}sm:${sm}:${s}`;

function familyCards(t: Topology, nodes: ArchNodeRecord[], edges: ArchEdgeRecord[], only?: Set<string>) {
  for (const f of t.families ?? []) {
    if (only && !only.has(f.id)) continue;
    const z = zoneOfFamily(t, f.pattern ?? f.id) ?? zoneOfFamily(t, f.id);
    nodes.push(card(famId(f.id), f.id, "pipeline", `family${f.pattern ? ` · ${f.pattern}` : ""}`, [...(f.cite ? [`declared at ${f.cite}`] : [])]));
    if (z) edges.push(edge(famId(f.id), zoneId(z), "lives in", `${f.id} lives in zone ${z}`));
  }
}

function zoneCards(t: Topology, threads: ThreadLike[], nodes: ArchNodeRecord[], groups: ArchGroupRecord[], drift?: TopologyDrift | null) {
  for (const st of t.stores ?? []) {
    const zs = (t.zones ?? []).filter((z) => z.store === st.id);
    for (const z of zs) {
      const writers = [...new Set(whoMay(t, z.id, "write").map((w) => w.principal))];
      const routers = (t.routers ?? []).filter((r) => r.zones?.includes(z.id));
      const onThreads = routers.flatMap((r) => threadsOfFunction(r.function, threads));
      const missingLive = drift?.missingZones.includes(z.id);
      nodes.push(card(zoneId(z.id), z.id, "database", `zone · ${(z.holds ?? []).join(", ") || "—"} · writers ${writers.join(", ") || "none"}${missingLive ? " · NOT ON THE PLATFORM" : ""}`, [
        `writable by ${writers.join(", ") || "no one declared"}`,
        ...(routers.length ? [`routed by ${routers.map((r) => r.function).join(", ")}${onThreads.length ? ` — on ${[...new Set(onThreads)].join(", ")}` : ""}`] : []),
        ...(z.cite ? [`declared at ${z.cite}`] : []),
      ]));
    }
    for (const u of (drift?.undeclaredZones ?? [])) nodes.push(card(zoneId(u), u, "database", "zone · ON THE PLATFORM, NOT DECLARED", ["the live inventory has this zone; no declaration does"], { source: "proposed" }));
    groups.push({ id: `${TOPO}store:${st.id}`, kind: "store", label: `${st.id}${st.kind ? ` (${st.kind})` : ""}`, wraps: [...zs.map((z) => zoneId(z.id)), ...(drift?.undeclaredZones ?? []).map(zoneId)], source: "stated" });
  }
}

/** Above this many read edges (after the universal ones are folded), reads are
 *  said on the cards and drawn only for the focused zone or principal: every
 *  edge is an SVG path and a label, and past this the map stops being readable
 *  and stops panning smoothly. */
export const READ_EDGE_CAP = 150;

/** The Resources lens. `focus` — the selected card's id: its reads are drawn
 *  even where the others are folded. */
export function resourcesModel(m: TopologyModel, threads: ThreadLike[] = [], drift?: TopologyDrift | null, opts: { focus?: string | null } = {}): ArchModelRecord {
  const t = m.topology;
  const nodes: ArchNodeRecord[] = [];
  const edges: ArchEdgeRecord[] = [];
  const groups: ArchGroupRecord[] = [];
  zoneCards(t, threads, nodes, groups, drift);
  familyCards(t, nodes, edges);
  for (const p of t.principals ?? []) {
    nodes.push(card(prId(p.id), p.id, p.kind === "service" ? "agent" : "external", `${p.kind ?? "principal"}${p.roles?.length ? ` · ${p.roles.join(", ")}` : ""}`, [...(p.cite ? [`declared at ${p.cite}`] : [])]));
  }
  const live = new Set([...(drift?.extraGrants ?? [])]);
  const missing = new Set(drift?.missingGrants ?? []);
  // Plain reads (no drift) are collected per zone; foldReads decides which to draw.
  const reads = new Map<string, ArchEdgeRecord[]>();
  for (const g of t.grants ?? []) {
    for (const who of grantees(t, g.who)) {
      const flag = missing.has(`${g.who} ${g.access} ${g.zone}`) ? " · declared, NOT on the platform" : "";
      const e = edge(prId(who), zoneId(g.zone), `${g.access}${flag}`, `${g.who} ${g.access} ${g.zone}${g.who !== who ? ` (${who} holds ${g.who})` : ""}${g.cite ? ` — ${g.cite}` : ""}`, { topoAccess: g.access, ...(flag ? { topoDrift: "missing" } : {}) } as never);
      if (g.access !== "read" || flag) { edges.push(e); continue; }
      const list = reads.get(g.zone) ?? [];
      if (!list.some((x) => x.id === e.id)) list.push(e);
      reads.set(g.zone, list);
    }
  }
  const folded = foldReads(t, reads, nodes, opts.focus ?? null);
  edges.push(...folded.drawn);
  for (const k of live) {
    const [who, access, zone] = k.split(" ");
    for (const p of grantees(t, who).length ? grantees(t, who) : [who]) {
      if (!nodes.some((n) => n.id === prId(p))) nodes.push(card(prId(p), p, "external", "principal · ON THE PLATFORM ONLY", [], { source: "proposed" }));
      edges.push(edge(prId(p), zoneId(zone), `${access} · on the platform, NOT declared`, `the live inventory grants ${who} ${access} on ${zone}; no declaration does`, { topoAccess: access, topoDrift: "extra" } as never));
    }
  }
  const notes = [`declared topology — ${m.status.map((s) => `${s.source.id}: ${s.state}`).join(", ")}`];
  if (folded.note) notes.push(folded.note);
  if (drift) notes.push("live drift drawn: zones / grants only the platform has, declared grants it lacks");
  return { version: "1", nodes, edges, groups, unplaced: EMPTY, notes };
}

/** Which read edges to draw. A zone every principal may read says so on its
 *  card ("read by all N") instead of N edges; if the reads left still exceed
 *  READ_EDGE_CAP they are said on the cards too. The focused zone or principal
 *  keeps its reads drawn. Writes and drift are never folded: each one says
 *  something different. */
function foldReads(t: Topology, reads: Map<string, ArchEdgeRecord[]>, nodes: ArchNodeRecord[], focus: string | null): { drawn: ArchEdgeRecord[]; note: string | null } {
  const principals = nodes.filter((n) => n.id.startsWith(`${TOPO}pr:`)).map((n) => n.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const universal = new Set<string>();
  for (const [z, list] of reads) {
    const from = new Set(list.map((e) => e.from));
    if (principals.length >= 3 && principals.every((p) => from.has(p))) universal.add(z);
  }
  const rest = [...reads].filter(([z]) => !universal.has(z)).reduce((s, [, l]) => s + l.length, 0);
  const said = (z: string) => universal.has(z) || rest > READ_EDGE_CAP;
  const drawn: ArchEdgeRecord[] = [];
  let total = 0, hidden = 0;
  for (const [z, list] of reads) {
    total += list.length;
    if (!said(z)) { drawn.push(...list); continue; }
    for (const e of list) if (focus === zoneId(z) || e.from === focus) drawn.push(e); else hidden++;
    const zc = byId.get(zoneId(z));
    if (!zc) continue;
    const names = list.map((e) => e.from.slice(`${TOPO}pr:`.length));
    zc.sublabel = `${zc.sublabel} · read by ${universal.has(z) ? `all ${principals.length}` : names.length}`;
    zc.notes = [...(zc.notes ?? []), universal.has(z)
      ? `readable by every principal (${principals.length}) — select the zone to draw them`
      : `readable by ${names.slice(0, 6).join(", ")}${names.length > 6 ? ` +${names.length - 6}` : ""} — select the zone to draw them`];
  }
  // A principal that may read every zone says it once, on its own card.
  const zoneCount = (t.zones ?? []).length;
  if (universal.size) for (const p of principals) {
    const n = [...reads.values()].filter((l) => l.some((e) => e.from === p)).length;
    const pc = byId.get(p);
    if (pc && zoneCount && n === zoneCount) pc.sublabel = `${pc.sublabel} · reads every zone`;
  }
  if (!hidden) return { drawn, note: null };
  return { drawn, note: `${hidden} of ${total} read grants are said on the cards, not drawn${universal.size ? ` (${universal.size} zones every principal may read)` : ""} — select a zone or principal to draw its reads; writes are always drawn` };
}

/** The Decisions lens. */
export function decisionsModel(m: TopologyModel, threads: ThreadLike[] = []): ArchModelRecord {
  const t = m.topology;
  const nodes: ArchNodeRecord[] = [];
  const edges: ArchEdgeRecord[] = [];
  const groups: ArchGroupRecord[] = [];
  const readFamilies = new Set<string>();
  const readZones = new Set<string>();
  for (const d of t.decisionTrees ?? []) {
    for (const n of d.nodes) {
      const on = n.evaluatedBy ? threadsOfFunction(n.evaluatedBy, threads) : [];
      nodes.push(card(dnId(d.id, n.id), n.outcome ? `→ ${n.outcome}` : n.id, n.outcome ? "platform" : "scripts", n.outcome ? "outcome" : n.question ?? "decision", [
        ...(n.question ? [n.question] : []), ...(n.evaluatedBy ? [`evaluated by ${n.evaluatedBy}${on.length ? ` — on ${on.join(", ")}` : ""}`] : []), ...(n.cite ? [`declared at ${n.cite}`] : []),
      ]));
      for (const k of ["yes", "no"] as const) if (n[k]) edges.push(edge(dnId(d.id, n.id), dnId(d.id, n[k]!), k, `${n.id} → ${k} → ${n[k]}`));
      for (const r of n.reads ?? []) {
        if (r.startsWith("zone:")) { readZones.add(r.slice(5)); edges.push(edge(dnId(d.id, n.id), zoneId(r.slice(5)), "reads", `${n.id} reads zone ${r.slice(5)}`)); continue; }
        const fam = (t.families ?? []).find((f) => f.id === r || f.pattern === r)?.id ?? r;
        readFamilies.add(fam);
        edges.push(edge(dnId(d.id, n.id), famId(fam), "reads", `${n.id} reads its evidence from ${r}`));
      }
    }
    groups.push({ id: `${TOPO}tree:${d.id}`, kind: "decision tree", label: `decision tree ${d.id}`, wraps: d.nodes.map((n) => dnId(d.id, n.id)), source: "stated" });
  }
  for (const sm of t.stateMachines ?? []) {
    const states = [...new Set([...(sm.states ?? []), ...sm.transitions.flatMap((x) => [x.from, x.to])])];
    for (const s of states) nodes.push(card(stId(sm.id, s), s, "pipeline", `state of ${sm.family ?? sm.id}`, []));
    for (const tr of sm.transitions) {
      edges.push(edge(stId(sm.id, tr.from), stId(sm.id, tr.to), tr.roles?.length ? tr.roles.join(", ") : "any", `${tr.from} → ${tr.to}${tr.roles?.length ? ` by ${tr.roles.join(", ")}` : ""}${tr.requires?.length ? `; requires ${tr.requires.join(", ")}` : ""}${tr.cite ? ` — ${tr.cite}` : ""}`));
      for (const r of tr.requires ?? []) if ((t.families ?? []).some((f) => f.id === r)) { readFamilies.add(r); edges.push(edge(stId(sm.id, tr.to), famId(r), "requires", `${tr.from} → ${tr.to} requires ${r}`)); }
    }
    groups.push({ id: `${TOPO}machine:${sm.id}`, kind: "state machine", label: `state machine ${sm.id}${sm.evaluatedBy ? ` (applied by ${sm.evaluatedBy})` : ""}`, wraps: states.map((s) => stId(sm.id, s)), source: "stated" });
  }
  // The evidence: only the families read, their zones, and who may write them.
  familyCards(t, nodes, edges, readFamilies);
  const zones = new Set([...readZones, ...[...readFamilies].map((f) => zoneOfFamily(t, (t.families ?? []).find((x) => x.id === f)?.pattern ?? f) ?? zoneOfFamily(t, f)).filter((z): z is string => !!z)]);
  const full = { nodes: [] as ArchNodeRecord[], groups: [] as ArchGroupRecord[] };
  zoneCards({ ...t, zones: (t.zones ?? []).filter((z) => zones.has(z.id)) }, threads, full.nodes, full.groups);
  nodes.push(...full.nodes);
  groups.push(...full.groups.filter((g) => g.wraps.length));
  return { version: "1", nodes, edges, groups, unplaced: EMPTY, notes: ["decision trees and state machines, each node linked to the evidence it reads, the zone that holds it and who may write that zone"] };
}

/** The ids one trace step touches: its actor, its zone, its decision node or state. */
export function traceIds(t: Topology, step: TraceStep | undefined): Set<string> {
  const out = new Set<string>();
  if (!step) return out;
  const e = step.event;
  out.add(prId(e.actor));
  if (e.zone) out.add(zoneId(e.zone));
  if (e.decision && e.action === "decide") { const [tree, rest = ""] = e.decision.split(":"); out.add(dnId(tree, rest.split("=")[0])); }
  if (e.decision && e.action === "transition") { const m = /^([^:]+):([^>]+)>(.+)$/.exec(e.decision); if (m) { out.add(stId(m[1], m[2])); out.add(stId(m[1], m[3])); } }
  return out;
}

/** Read edges dashed, write solid; drift in the warning / error tone. */
export function styleTopologyEdges<E extends { id: string; style?: any }>(edges: E[], model: ArchModelRecord): E[] {
  const byId = new Map(model.edges.map((e) => [e.id, e as ArchEdgeRecord & { topoAccess?: string; topoDrift?: string }]));
  return edges.map((e) => {
    const m = byId.get(e.id);
    if (!m) return e;
    const style = { ...e.style };
    if (m.topoAccess === "read" || m.protocol === "reads" || m.protocol === "lives in") style.strokeDasharray = "5 4";
    if (m.topoDrift === "extra") style.stroke = "var(--accent-error)";
    else if (m.topoDrift === "missing") { style.stroke = "var(--accent-warning)"; style.strokeDasharray = "2 4"; }
    return { ...e, style };
  });
}
