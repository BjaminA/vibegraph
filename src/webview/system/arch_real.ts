// The REAL map, said in the project's own words (2026-10-06, system views).
// The derived model knows the code; the plan and the declared topology know
// what the code IS. Once plan check says a planned item is realised, the real
// box carries the plan's name — and what only the topology knows is drawn
// from it. GUI only, like arch_plan.ts: the server's model is never changed.
//
//   processes   a realised planned process names its box (the plan's label;
//               the code's stays as `derivedLabel`) and badges who it runs as
//   stores      one card per store (the plan's or the declaration's name, its
//               declared zone count and writers); the code's zone boxes sit in
//               its group, each with the declared zones it covers and who may
//               write them; zones only ONE identity writes get a trust box
//   outside     a process that serves calls (routes, a .listen()) that nothing
//               in the project calls has a caller in front of it — the plan's
//               external process when one has a boundary to it
//   decisions   each declared state machine / decision tree is a card, joined
//               to the process that evaluates it when the declaration says
//   flows       the plan's flows as named paths (process → zone → process),
//               to highlight; never drawn as new edges
//
// Every item is matched by IDENTITY (`planKeys`): a zone by its families, a
// process by its entry points or path, a store by its id — never by label, so
// the Overlay finds them here instead of drawing them a second time.

import { countLive, isCatalogueWord, type LiveInventory } from "../../shared/live_inventory.ts";
import type { ArchModelRecord, ArchNodeRecord, ArchEdgeRecord, ArchGroupRecord } from "../../shared/protocol";
import type { Plan, PlanReconcile } from "../../shared/plan_types";
import type { Topology, TopoZone } from "../../shared/topology_types";
import { whoMay, threadsOfFunction } from "../../shared/topology_query.ts";
import { unifies } from "../../shared/name_pattern.ts";
import { stampHierarchy } from "../../shared/arch_hierarchy.ts";
import { realisedTargets, locatedOnly } from "./arch_plan.ts";

interface ThreadLike { entryPointId: string | null; nodes: any[] }
export interface RealInputs { plan?: Plan | null; rec?: PlanReconcile | null; topology?: Topology | null; threads?: ThreadLike[]; /** M8: what `topology live` saved */ inventory?: { at: string; command: string; inventory: LiveInventory } | null }
export interface RealFlow { id: string; label: string; verdict: string; nodes: string[]; edges: string[]; steps: Array<{ text: string; found: boolean }> }
export type RealModel = ArchModelRecord & { realFlows: RealFlow[] };

export const STORE_CARD = "store:";
const live = <T extends { status?: string }>(xs: T[] | undefined) => (xs ?? []).filter((x) => x.status !== "dropped");
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fileOf = (ep: string) => ep.replace(/:[^:]*$/, "");
const badge = (id: string, title: string) => ({ id, label: id, title });

/** The declared zones a code zone (or a plan zone) covers, by family. */
function coveredZones(t: Topology | null | undefined, inStore: (z: TopoZone) => boolean, holds: string[]): TopoZone[] {
  if (!t) return [];
  const fams = (z: TopoZone) => [z.id, ...(z.holds ?? []), ...(t.families ?? []).filter((f) => f.zone === z.id).map((f) => f.id)];
  return (t.zones ?? []).filter((z) => inStore(z) && holds.some((h) => fams(z).some((f) => unifies(h, f))));
}
// M8: a catalogue WORD (`any-writer`, `owner-of-entry`) is a rule, not a writer — never counted
const writersOf = (t: Topology | null | undefined, zones: TopoZone[]) =>
  t ? uniq(zones.flatMap((z) => whoMay(t, z.id, "write").map((w) => w.principal))).filter((p) => !isCatalogueWord(p)).sort() : [];

export function enrichReal(real: ArchModelRecord, inp: RealInputs = {}): RealModel {
  const { plan = null, rec = null, topology: t = null, threads = [], inventory = null } = inp;
  const nodes = new Map(real.nodes.map((n) => [n.id, { ...n }]));
  const edges: ArchEdgeRecord[] = [...real.edges];
  const groups: ArchGroupRecord[] = [...(real.groups ?? [])];
  const key = (n: ArchNodeRecord, k: string) => { n.planKeys = uniq([...(n.planKeys ?? []), k]); };
  const addBadge = (n: ArchNodeRecord, b: { id: string; label: string; title: string }) => {
    if (!(n.badges ?? []).some((x) => x.id === b.id)) n.badges = [...(n.badges ?? []), b];
  };
  const finding = (section: string, id: string) => rec?.findings.find((f) => f.section === section && f.id === id);
  const principalLabel = (id: string) => live(plan?.principals).find((p) => p.id === id)?.label ?? t?.principals?.find((p) => p.id === id)?.label ?? id;

  // ── processes: the plan's name on the box that realises it ──
  const boxOf = new Map<string, string>(); // planned process id → real box
  if (plan) {
    const targets = realisedTargets(plan, rec, real);
    const byBox = new Map<string, string[]>();
    for (const p of live(plan.processes)) {
      const box = targets.get(`processes:${p.id}`);
      if (!box) continue;
      boxOf.set(p.id, box);
      byBox.set(box, [...(byBox.get(box) ?? []), p.id]);
    }
    for (const [box, ids] of byBox) {
      const n = nodes.get(box)!;
      const ps = ids.map((id) => plan.processes.find((p) => p.id === id)!);
      n.derivedLabel ??= n.label;
      n.label = ps.length === 1 ? ps[0].label : `${ps[0].label} +${ps.length - 1}`;
      n.labelSource = "plan";
      const located = ps.every(locatedOnly);
      if (located) n.sublabel = `located, not anchored · ${n.sublabel}`;
      n.notes = [
        `the plan's ${ps.map((p) => `${p.label} (${p.id})`).join(", ")} — ${located ? "LOCATED here by its `at` path, not anchored: give it `entryPoints` to name the process that runs it" : "realised here, anchored by its entry points"}; the code calls it ${n.derivedLabel}`,
        ...(n.notes ?? []),
      ];
      n.essential = true; // the plan says it is its own process: never folded into another
      for (const p of ps) {
        key(n, `processes:${p.id}`);
        // M4: the plan NAMES an identity, never asserts one — only an
        // anchored process whose code shows an identity source gets its badge
        const created = n.identity?.find((i) => i.kind === "created");
        if (p.runsAs && created) {
          // the code makes an identity for each run: that is who it runs as,
          // whatever the plan names — said, not hidden
          addBadge(n, badge("own identity per run", created.evidence));
          n.notes = [...(n.notes ?? []), `the plan says it runs as ${p.runsAs}; the code creates its own identity for each run (${created.evidence})`];
        } else if (p.runsAs && !located && n.identity?.length) addBadge(n, badge(p.runsAs, `runs as ${principalLabel(p.runsAs)} — the code shows: ${n.identity.map((i) => i.evidence).join("; ")}`));
        else if (p.runsAs) n.notes = [...(n.notes ?? []), `the plan says it runs as ${p.runsAs}; ${located ? "it is only located, so the badge is not drawn" : "nothing in the code shows its identity"}`];
      }
    }
  }
  // ── identities from evidence (arch_identity.ts), on every process ──
  for (const n of nodes.values()) {
    if (n.kind !== "cluster" || !n.identity?.length || n.badges?.length) continue;
    const created = n.identity.find((i) => i.kind === "created");
    if (created) { addBadge(n, badge("own identity per run", created.evidence)); continue; }
    for (const i of n.identity.slice(0, 3)) addBadge(n, badge(i.name, `${i.kind === "given" ? "given by the process that starts it" : "read by it"}: ${i.evidence}`));
  }

  // ── stores ──
  // A store's identity: its id, or a tool the plan says it is reached through
  // (the derived layer names a store after its SDK when nothing groups it).
  const alias = new Map<string, string>();
  for (const s of live(plan?.stores)) for (const r of s.reachedThrough) alias.set(r.toLowerCase(), s.id);
  const canon = (id: string) => alias.get(id.toLowerCase()) ?? id;
  const storeIds = uniq([...(t?.stores ?? []).map((s) => canon(s.id)), ...live(plan?.stores).map((s) => s.id),
    ...[...nodes.values()].filter((n) => n.zoneOf).map((n) => canon(n.zoneOf!.store))]);
  for (const sid of storeIds) {
    const inStore = (z: TopoZone) => canon(z.store) === sid;
    const pst = live(plan?.stores).find((s) => s.id === sid);
    const tst = t?.stores?.find((s) => s.id === sid);
    const zoneNodes = [...nodes.values()].filter((n) => n.zoneOf && canon(n.zoneOf.store) === sid);
    const through = new Set((pst?.reachedThrough ?? []).map((r) => r.toLowerCase()));
    const absorbed = [...nodes.values()].filter((n) => n.kind === "tool" && !n.zoneOf && through.has((n.tool ?? "").toLowerCase()));
    // Drawn on evidence only: a declaration, a zone the code touches, or the
    // tool it is reached through. Anything else stays the plan's ghost.
    if (!tst && !zoneNodes.length && !absorbed.length) continue;
    const declared = (t?.zones ?? []).filter(inStore);
    const writers = writersOf(t, declared);
    const card = `${STORE_CARD}${sid}`;
    // M8: declared next to live — what `topology live` found provisioned
    const lc = inventory && tst && declared.length ? countLive(declared, inventory.inventory) : null;
    const ids = inventory?.inventory.identities.length ?? 0;
    nodes.set(card, {
      id: card, kind: "tool", category: "database", source: tst ? "stated" : "derived", essential: true,
      label: pst?.label ?? tst?.label ?? sid,
      sublabel: [lc ? `${lc.declared} declared · ${lc.provisioned.length} provisioned` : plural(declared.length || zoneNodes.length, "zone"), ...(writers.length ? [plural(writers.length, "writer")] : []), ...(absorbed.length ? [`via ${absorbed.map((a) => a.label).join(", ")}`] : [])].join(" · "),
      threads: [], refs: [], planKeys: pst ? [`stores:${sid}`] : [],
      notes: [
        ...(tst ? [`declared by the project's topology${tst.label && tst.label !== (pst?.label ?? sid) ? ` as "${tst.label}"` : ""}: ${plural(declared.length, "zone")}${writers.length ? `, written by ${writers.join(", ")}` : ""}`] : []),
        ...(zoneNodes.length ? [`the code reads and writes ${plural(zoneNodes.length, "zone group")} of it (drawn in its box)`] : []),
        ...(absorbed.length ? [`reached through ${absorbed.map((a) => a.label).join(", ")} — folded into this card at Bird's-eye`] : []),
        ...(lc ? [`live (${inventory!.at.slice(0, 16)}, \`${inventory!.command}\`): ${lc.provisioned.length} of ${lc.declared} declared zones provisioned${ids ? `, read as ${ids} identit${ids === 1 ? "y" : "ies"}` : ""}`,
          ...(lc.missing.length ? [`never provisioned: ${lc.missing.slice(0, 12).join(", ")}${lc.missing.length > 12 ? ` +${lc.missing.length - 12}` : ""}`] : []),
          ...(lc.undeclared.length ? [`live but not declared: ${lc.undeclared.slice(0, 8).join(", ")}${lc.undeclared.length > 8 ? ` +${lc.undeclared.length - 8}` : ""}`] : [])] : []),
      ],
    });
    for (const a of absorbed) nodes.get(a.id)!.storeOf = card;
    for (const tl of live(plan?.stack)) if (canon(tl.tool) === sid || tl.tool.toLowerCase() === sid.toLowerCase()) key(nodes.get(card)!, `stack:${tl.tool}`);
    // its zones: identity = the families they hold
    const byWriter = new Map<string, string[]>();
    for (const z of zoneNodes) {
      const n = nodes.get(z.id)!;
      n.storeOf = card;
      const pz = (pst?.zones ?? []).find((x) => x.holds.some((h) => z.zoneOf!.holds.some((f) => unifies(h, f))));
      const cov = coveredZones(t, inStore, z.zoneOf!.holds);
      const w = cov.length ? writersOf(t, cov) : (pz?.writers ?? []);
      if (pz) { key(n, `stores:${sid}/${pz.id}`); n.derivedLabel ??= n.label; n.label = pz.label ?? pz.id; n.labelSource = "plan"; }
      n.sublabel = [cov.length ? plural(cov.length, "zone") : `holds ${z.zoneOf!.holds.slice(0, 2).join(", ")}`, w.length ? `writers ${w.slice(0, 3).join(", ")}${w.length > 3 ? ` +${w.length - 3}` : ""}` : "no writer declared"].join(" · ");
      for (const p of w) addBadge(n, badge(p, `may write ${n.label}${cov.length ? ` (${cov.map((c) => c.id).slice(0, 4).join(", ")}${cov.length > 4 ? ", …" : ""})` : ""}`));
      if (w.length === 1) byWriter.set(w[0], [...(byWriter.get(w[0]) ?? []), z.id]);
    }
    // writers on the card itself, so Bird's-eye (which folds the zones) still shows them
    const cardNode = nodes.get(card)!;
    for (const p of writers.length ? writers : uniq(zoneNodes.flatMap((z) => (nodes.get(z.id)!.badges ?? []).map((b) => b.id)))) addBadge(cardNode, badge(p, `may write ${cardNode.label}`));
    // zones one identity alone writes: a trust box; the store box around all
    const wrapped = new Set(groups.flatMap((g) => g.wraps));
    const free = zoneNodes.map((z) => z.id).filter((id) => !wrapped.has(id));
    const trustIds: string[] = [];
    for (const [who, zs] of [...byWriter].sort((a, b) => a[0].localeCompare(b[0]))) {
      const mine = zs.filter((z) => free.includes(z));
      if (!mine.length) continue;
      const gid = `trust:${sid}:${who}`;
      groups.push({ id: gid, kind: "trust", label: `written only by ${who}`, wraps: mine, source: t ? "stated" : "derived" });
      trustIds.push(gid);
    }
    const inTrust = new Set(trustIds.flatMap((g) => groups.find((x) => x.id === g)!.wraps));
    groups.push({ id: `storegroup:${sid}`, kind: "store", label: `${cardNode.label} (store)`, wraps: [card, ...free.filter((z) => !inTrust.has(z)), ...trustIds], source: tst ? "stated" : "derived" });
  }

  // ── outside callers ──
  const clusterIds = new Set([...nodes.values()].filter((n) => n.kind === "cluster").map((n) => n.id));
  const called = new Set(edges.filter((e) => e.kind !== "uses" && e.from !== e.to && clusterIds.has(e.from)).map((e) => e.to));
  const claimedBy = new Map<string, string>(); // box → actor
  for (const ext of live(plan?.processes).filter((p) => p.kind === "external_http")) {
    const targets = uniq(live(plan?.boundaries).filter((b) => b.from === ext.id).map((b) => boxOf.get(b.to)).filter((x): x is string => !!x));
    if (!targets.length) continue;
    const id = `actor:plan:${ext.id}`;
    nodes.set(id, {
      id, kind: "actor", category: "external", source: "derived", essential: true, label: ext.label,
      sublabel: `outside caller · ${targets.map((b) => nodes.get(b)!.label).join(", ")}`, threads: [], refs: [], planKeys: [`processes:${ext.id}`],
      notes: [`the plan's ${ext.label} (${ext.id}), calling ${targets.map((b) => nodes.get(b)!.label).join(", ")}${ext.serves ? ` — serves: ${ext.serves}` : ""}`, "Drawn because the box it calls is built; who calls it is the plan's word, not a parsed call."],
    });
    for (const b of targets) {
      const bd = live(plan?.boundaries).find((x) => x.from === ext.id && boxOf.get(x.to) === b);
      edges.push({ id: `${id}->${b}:http`, from: id, to: b, kind: "http", protocol: bd?.protocol ?? "HTTP", protocolBasis: `the plan's boundary ${bd?.id ?? ""} (${ext.id} → ${bd?.to ?? ""})${nodes.get(b)!.serves ? `; the code serves it (${nodes.get(b)!.serves!.how === "routes" ? "routes" : ".listen()"} in ${nodes.get(b)!.serves!.files.join(", ")})` : ""}`, count: 1, threads: [], confidence: "path", refs: [], source: "derived" });
      claimedBy.set(b, id);
    }
  }
  for (const c of [...nodes.values()]) {
    if (c.kind !== "cluster" || !c.serves || called.has(c.id) || claimedBy.has(c.id)) continue;
    const id = `actor:outside:${c.id}`;
    nodes.set(id, {
      id, kind: "actor", category: "external", source: "derived", essential: true, label: "Outside callers",
      sublabel: `call ${c.label} — nothing in the project does`, threads: [], refs: [],
      notes: [`${c.label} ${c.serves.how === "routes" ? "serves routes" : "listens"} (${c.serves.files.join(", ")}) and no project process calls it: its callers are outside the code.`],
    });
    edges.push({ id: `${id}->${c.id}:http`, from: id, to: c.id, kind: "http", protocol: c.serves.how === "routes" ? "HTTP" : "HTTP (listens)", protocolBasis: `${c.serves.files.join(", ")} ${c.serves.how === "routes" ? "serves routes" : "calls .listen()"}; no project hop reaches it`, count: 1, threads: [], confidence: "path", refs: [], source: "derived" });
  }

  // ── decision structures ──
  const clusterOfEntry = (ep: string) => [...nodes.values()].find((n) => n.kind === "cluster" && n.entryPoints?.includes(ep))?.id;
  const clusterOfFile = (file: string) => [...nodes.values()].find((n) => n.kind === "cluster" && (n.entryPoints ?? []).some((ep) => fileOf(ep).split("/").slice(0, -1).join("/") === file.split("/").slice(0, -1).join("/")))?.id
    ?? [...nodes.values()].find((n) => n.kind === "cluster" && n.root && file.startsWith(`${n.root}/`))?.id;
  const placeDecision = (fns: string[], cite?: string) => {
    const hits = new Map<string, number>();
    for (const fn of uniq(fns)) for (const ep of threadsOfFunction(fn, threads)) { const c = clusterOfEntry(ep); if (c) hits.set(c, (hits.get(c) ?? 0) + 1); }
    if (!hits.size && cite) {
      // the threads that REACH the file it is declared in (a running process
      // that walks it outranks the library folder it sits in)
      const file = cite.replace(/:\d+$/, "");
      for (const t of threads as Array<ThreadLike & { filesReached?: string[] }>) {
        if (!t.entryPointId || !(t.filesReached ?? []).includes(file)) continue;
        const c = clusterOfEntry(t.entryPointId);
        // weighted by the steps that RUN in that file, not by reaching it
        const steps = (t.nodes ?? []).filter((x: any) => x.file === file).length;
        if (c) hits.set(c, (hits.get(c) ?? 0) + Math.max(1, steps));
      }
      if (!hits.size) { const c = clusterOfFile(file); if (c) hits.set(c, 1); }
    }
    // a structure is enforced where it RUNS: a runtime process outranks a
    // CLI or library that shares its logic (M3)
    const weight = (c: string) => (nodes.get(c)?.runtime ? 1000 : 0);
    return [...hits].sort((a, b) => (b[1] + weight(b[0])) - (a[1] + weight(a[0])))[0]?.[0];
  };
  type Dec = { id: string; kind: "state machine" | "decision tree"; label: string; sub: string; fns: string[]; cite?: string; shape: string[]; also?: string[] };
  const listed: Dec[] = [
    ...(t?.stateMachines ?? []).map((m) => ({ id: m.id, kind: "state machine" as const, label: m.id, shape: m.transitions.map((x) => `${x.from}>${x.to}`), sub: `state machine · ${plural(m.states?.length ?? uniq(m.transitions.flatMap((x) => [x.from, x.to])).length, "state")} · ${plural(m.transitions.length, "transition")}`, fns: m.evaluatedBy ? [m.evaluatedBy] : [], cite: m.cite as string | undefined })),
    ...(t?.decisionTrees ?? []).map((d) => ({ id: d.id, kind: "decision tree" as const, label: d.id, shape: d.nodes.map((x) => x.id), sub: `decision tree · ${plural(d.nodes.filter((x) => x.yes || x.no).length, "gate")} · ${plural(d.nodes.filter((x) => !x.yes && !x.no).length, "outcome")}`, fns: d.nodes.map((x) => x.evaluatedBy).filter((x): x is string => !!x), cite: d.cite as string | undefined })),
  ];
  // One structure, two readings: the declaration's and the one the code's
  // shape gives (data_arch). Same kind and the same transitions / nodes (by
  // ≥ 80%) is ONE card — the declaration's name (read first), the code's
  // place (its cite and evaluating functions).
  const same = (a: Dec, b: Dec) => {
    if (a.kind !== b.kind || !a.shape.length || !b.shape.length) return false;
    const sa = new Set(a.shape), common = b.shape.filter((x) => sa.has(x)).length;
    return common / Math.max(a.shape.length, b.shape.length) >= 0.8;
  };
  const decisions: Dec[] = [];
  for (const d of listed) {
    const first = decisions.find((x) => same(x, d));
    if (!first) { decisions.push({ ...d }); continue; }
    first.fns = uniq([...first.fns, ...d.fns]);
    first.cite ??= d.cite;
    first.also = [...(first.also ?? []), d.id];
  }
  for (const d of decisions) {
    const id = `decision:${d.kind === "state machine" ? "sm" : "dt"}:${d.id}`;
    const at = placeDecision(d.fns, typeof d.cite === "string" ? d.cite : undefined);
    nodes.set(id, {
      id, kind: "tool", category: "pipeline", source: "stated", essential: true, label: d.label, sublabel: d.sub,
      decision: { kind: d.kind, id: d.id }, threads: [], refs: [],
      notes: [`declared by the project's topology${d.cite ? ` at ${d.cite}` : ""}${d.also?.length ? `; the code's own reading of it (${d.also.join(", ")}) is this same card` : ""}; the Decisions lens draws it whole`, at ? `evaluated in ${nodes.get(at)!.label}${d.fns.length ? ` (${uniq(d.fns).slice(0, 3).join(", ")})` : ""}` : "the declaration does not say which code evaluates it (no evaluatedBy, no cite)"],
    });
    if (at) edges.push({ id: `${at}->${id}:enforces`, from: at, to: id, kind: "uses", protocol: "enforces", protocolBasis: `evaluates the ${d.kind} ${d.id}${d.fns.length ? ` (${uniq(d.fns).slice(0, 3).join(", ")})` : ""}`, count: 1, threads: [], confidence: "path", refs: [], source: "stated" });
  }

  // ── flows: named paths over what is drawn ──
  const zoneBox = (zone: string) => [...nodes.values()].find((n) => n.planKeys?.includes(`stores:${zone}`))?.id ?? (nodes.has(`${STORE_CARD}${zone.split("/")[0]}`) ? `${STORE_CARD}${zone.split("/")[0]}` : undefined);
  const realFlows: RealFlow[] = [];
  for (const f of live(plan?.flows)) {
    const fd = finding("flows", f.id);
    const path = new Set<string>(); const on = new Set<string>();
    f.steps.forEach((s, i) => {
      const box = boxOf.get(s.process), z = zoneBox(s.zone);
      if (box) path.add(box);
      if (z) path.add(z);
      if (box && z) for (const e of edges) if ((e.from === box && e.to === z) || (e.from === z && e.to === box)) on.add(e.id);
      void i;
    });
    realFlows.push({
      id: f.id, label: ((f as { label?: string }).label ?? f.serves ?? f.id), verdict: fd?.verdict ?? "unverified",
      nodes: [...path], edges: [...on],
      steps: f.steps.map((s, i) => ({ text: `${s.process} ${s.op}s ${s.zone}${s.family ? ` (${s.family})` : ""}`, found: fd?.steps?.[i]?.found ?? false })),
    });
  }

  const model = stampHierarchy({ ...real, nodes: [...nodes.values()], edges, groups });
  return { ...model, realFlows };
}
