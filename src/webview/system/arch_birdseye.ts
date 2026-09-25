// The Bird's-eye lens: the architecture as a dozen named boxes, the picture
// Archify's agent draws by reading, built only from the derived model.
//
//   * who reaches the system: a Browser ACTOR in front of every web app (a
//     Next.js page is served to a browser by the framework's contract; the
//     actor is labelled as that inference, never as a parsed fact);
//   * the processes that carry the flow: every cluster with a hop to or
//     from another box, and every DISPATCHER (the script the others are run
//     through, arch_model.ts). A cluster no hop touches is counted, not drawn;
//   * what they talk to: each tool NAMED (not folded into a category box),
//     the most-called tool of every category first, then by calls, up to
//     TOOL_CAP. The rest are counted;
//   * one arrow per pair of boxes, labelled with its dominant protocol.
//
// Pure: the model in, a smaller model out. Positions are still archLayout's.

import type { ArchEdgeRecord, ArchModelRecord, ArchNodeRecord } from "../../shared/protocol.ts";
import { stampHierarchy } from "../../shared/arch_hierarchy.ts";

export const TOOL_CAP = 8;
export const HUB_CAP = 3;

export interface BirdseyeResult {
  model: ArchModelRecord;
  hiddenTools: string[];
  hiddenClusters: string[];
}

/** The deploy unit a cluster sits in: the first segment of its package root
 *  ("." for the project root). Clusters in one unit ship together. */
const unitOf = (n: ArchNodeRecord) => (n.root ? n.root.split("/")[0] : ".");

/** Fold every cluster into the largest one of its deploy unit: the Next.js
 *  app and the helper scripts beside it are one box at this height, as are
 *  an MCP server and its scripts. Edges are re-pointed; self-loops dropped;
 *  groups re-point to the keeper. */
function foldUnits(full: ArchModelRecord): { model: ArchModelRecord; absorbed: Map<string, ArchNodeRecord[]> } {
  const clusters = full.nodes.filter((n) => n.kind === "cluster");
  const unitById = new Map(clusters.map((c) => [c.id, unitOf(c)]));
  // A process with a HOP to another process of its own unit is part of the
  // flow this lens exists to show, so it keeps its own box (2026-09-25: the
  // fleet example's two HTTP APIs, its CLI and its scripts all live at the
  // project root, and folding them left one box called "Library").
  const onFlow = new Set<string>();
  for (const e of full.edges) {
    if (e.kind === "uses" || e.from === e.to) continue;
    const a = unitById.get(e.from), b = unitById.get(e.to);
    if (a !== undefined && a === b) { onFlow.add(e.from); onFlow.add(e.to); }
  }
  const keeperOf = new Map<string, ArchNodeRecord>();
  const byUnit = new Map<string, ArchNodeRecord[]>();
  for (const c of clusters) {
    if (onFlow.has(c.id)) { keeperOf.set(c.id, c); continue; }
    byUnit.set(unitOf(c), [...(byUnit.get(unitOf(c)) ?? []), c]);
  }
  const folded = new Map<string, ArchNodeRecord>();
  for (const list of byUnit.values()) {
    const size = (n: ArchNodeRecord) => n.entryPoints?.length ?? 0;
    const keeper = [...list].sort((a, b) => size(b) - size(a) || a.id.localeCompare(b.id))[0];
    for (const c of list) keeperOf.set(c.id, keeper);
    if (list.length === 1) continue;
    const eps = list.reduce((k, c) => k + size(c), 0);
    folded.set(keeper.id, {
      ...keeper,
      entryPoints: list.flatMap((c) => c.entryPoints ?? []),
      threads: [...new Set(list.flatMap((c) => c.threads))],
      sublabel: `${eps} entry points · ${list.length - 1} more process${list.length === 2 ? "" : "es"} folded in`,
      notes: [...(keeper.notes ?? []), `Bird's-eye folds ${list.filter((c) => c !== keeper).map((c) => c.label).join(", ")} into this box (same deploy unit, ${unitOf(keeper)}).`],
    });
  }
  const to = (id: string) => keeperOf.get(id)?.id ?? id;
  const nodes = full.nodes
    .filter((n) => n.kind !== "cluster" || keeperOf.get(n.id)?.id === n.id)
    .map((n) => folded.get(n.id) ?? n);
  const edges = full.edges
    .map((e) => ({ ...e, from: to(e.from), to: to(e.to) }))
    .filter((e) => e.from !== e.to);
  const groups = full.groups.map((g) => ({ ...g, wraps: [...new Set(g.wraps.map(to))] }));
  const absorbed = new Map<string, ArchNodeRecord[]>();
  for (const c of clusters) { const k = keeperOf.get(c.id); if (k && k.id !== c.id) absorbed.set(k.id, [...(absorbed.get(k.id) ?? []), c]); }
  return { model: { ...full, nodes, edges, groups }, absorbed };
}

export function birdseyeModel(input: ArchModelRecord): BirdseyeResult {
  const { model: full, absorbed } = foldUnits(input);
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const hops = full.edges.filter((e) => e.kind !== "uses");

  // processes: clusters on a hop (or a web app), and the dispatchers a box
  // OUTSIDE their own cluster reaches — the front doors — best first, capped.
  // a private production codebase has six hubs; the one its web app and MCP server run is the
  // one a reader needs at this height.
  const onHop = new Set(hops.flatMap((e) => [e.from, e.to]));
  const score = (n: ArchNodeRecord) => (n.dispatches ?? []).reduce((k, g) => k + g.scripts.length, 0) * (n.callers?.length ?? 0);
  const frontDoors = full.nodes
    .filter((n) => n.kind === "hub" && hops.some((e) => e.to === n.id && e.from !== n.cluster && !e.from.startsWith("hub:")))
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))
    .slice(0, HUB_CAP);
  // A box that FOLDED a web app in is a web app at this height, whatever the
  // family of the larger process it was folded into (next_demo: the web app,
  // an MCP server and scripts ship as one unit, and the keeper is not "web");
  // `absorbed` is what foldUnits actually folded into each keeper.
  const isWeb = (n: ArchNodeRecord) => n.kind === "cluster" && (n.family === "web" || (absorbed.get(n.id) ?? []).some((c) => c.family === "web"));
  let processes = [
    ...full.nodes.filter((n) => n.kind === "cluster" && (onHop.has(n.id) || isWeb(n))),
    ...frontDoors,
  ];
  // With no hop between processes and no web app, "the processes that carry
  // the flow" is every process — never an empty picture (found 2026-09-25:
  // a one-unit project's Bird's-eye drew nothing at all).
  if (!processes.length) processes = full.nodes.filter((n) => n.kind === "cluster");
  const keptProc = new Set(processes.map((n) => n.id));
  const hiddenClusters = full.nodes.filter((n) => (n.kind === "cluster" || n.kind === "hub") && !keptProc.has(n.id)).map((n) => n.id);

  // tools: named, best of each category first, then by calls
  const callsTo = new Map<string, number>();
  for (const e of full.edges) if (e.kind === "uses" && keptProc.has(e.from)) callsTo.set(e.to, (callsTo.get(e.to) ?? 0) + e.count);
  const ranked = full.nodes.filter((n) => n.kind === "tool" && callsTo.has(n.id))
    .sort((a, b) => (callsTo.get(b.id)! - callsTo.get(a.id)!) || a.id.localeCompare(b.id));
  const pick: ArchNodeRecord[] = [];
  const seenCat = new Set<string>();
  // One per KNOWN category first — an unclassified tool says least, so it
  // only fills what is left (a private production codebase: it had pushed AWS S3 off the picture).
  for (const t of ranked) if (t.category !== "unknown" && !seenCat.has(t.category) && pick.length < TOOL_CAP) { pick.push(t); seenCat.add(t.category); }
  for (const t of ranked) if (!pick.includes(t) && pick.length < TOOL_CAP) pick.push(t);
  const keptTools = new Set(pick.map((t) => t.id));
  const hiddenTools = ranked.filter((t) => !keptTools.has(t.id)).map((t) => t.id.replace(/^tool:/, ""));

  // actors: a Browser in front of each web app
  const actors: ArchNodeRecord[] = [];
  const actorEdges: ArchEdgeRecord[] = [];
  for (const web of processes.filter(isWeb)) {
    const id = `actor:browser:${web.id}`;
    const pages = web.entryPoints?.length ?? 0;
    actors.push({
      id, kind: "actor", label: "Browser", sublabel: `reaches ${pages} entry point${pages === 1 ? "" : "s"}`,
      category: "external", source: "derived", threads: [], refs: [],
      notes: ["Inferred from the framework: a Next.js app's pages and routes are served to a browser. Not a parsed call."],
    });
    actorEdges.push({
      id: `${id}->${web.id}:http:HTTPS`, from: id, to: web.id, kind: "http", protocol: "HTTPS",
      protocolBasis: "a Next.js app is served over HTTP(S) to a browser — the framework's contract, not a parsed call",
      count: pages, threads: [], confidence: "path", refs: [], source: "derived",
    });
  }

  // one arrow per pair, the protocol that carries most of it
  const keep = new Set([...keptProc, ...keptTools]);
  const pairs = new Map<string, ArchEdgeRecord[]>();
  for (const e of full.edges) {
    if (!keep.has(e.from) || !keep.has(e.to)) continue;
    const k = `${e.from}\u0000${e.to}`;
    pairs.set(k, [...(pairs.get(k) ?? []), e]);
  }
  const merged: ArchEdgeRecord[] = [...pairs.values()].map((list) => {
    if (list.length === 1) return list[0];
    const top = [...list].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))[0];
    return {
      ...top,
      id: `${top.from}->${top.to}:merged`,
      count: list.reduce((k, e) => k + e.count, 0),
      threads: [...new Set(list.flatMap((e) => e.threads))].sort(),
      refs: list.flatMap((e) => e.refs).slice(0, 8),
      protocolBasis: `${list.length} kinds of hop merged; the label is the one carrying most (${top.protocol}, ${top.count}): ${top.protocolBasis}`,
      members: list.map((e) => e.id),
      details: undefined,
    };
  });

  const nodes = [...actors, ...full.nodes.filter((n) => keep.has(n.id))];
  const drawn = new Set(nodes.map((n) => n.id));
  return {
    // Folding re-points groups, so the stamped hierarchy is re-resolved on
    // the model this lens draws (a folded box can land in a deeper group).
    model: stampHierarchy({
      ...full,
      nodes,
      edges: [...actorEdges, ...merged],
      // A group keeps only what this lens draws.
      groups: full.groups.map((g) => ({ ...g, wraps: g.wraps.filter((w) => drawn.has(w) || full.groups.some((x) => x.id === w)) }))
        .filter((g) => g.wraps.length),
    }),
    hiddenTools,
    hiddenClusters: hiddenClusters.map((id) => byId.get(id)?.label ?? id),
  };
}
