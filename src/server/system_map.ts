// The SYSTEM MAP (2026-09-25, Ben: "shouldn't be called archify — our
// version from VibeGraph, including all the toggles: bird's-eye, overview,
// flows… the most distilled, concise view of the whole system that a Claude
// agent will find the most useful"). `architecture.vibegraph.json`, format
// `vibegraph.system-map`, schema `schemas/system_map.schema.json`.
//
// What it is: the architecture model (every box, edge, group, the protocol on
// every edge and the fact it was read from, what crosses it), plus everything
// the System view can toggle to, as DATA rather than pixels:
//   * views     — each map lens (Bird's-eye, Overview, Tools, Flows,
//                 Payloads, Trust) as the ids it selects, through the SAME
//                 function the GUI and architecture.html use (arch_lens.ts);
//                 a box a lens reshapes (Bird's-eye's folded process, the
//                 Overview's category box) carries its full record there;
//   * hierarchy — groups → nested groups → members, resolved once;
//   * startHere — the stated / proposed primary path and its story beats;
//   * subsystems— the System view's subsystem tier (backend / frontend / db /
//                 cache / external hosts), when the envelope has one;
//   * threads   — which thread calls or hops into which (the Threads toggle).
// Every record keeps its `source` (derived / stated / proposed), so a reader
// can tell a fact from a statement from a model's suggestion.
//
// No geometry: positions are for eyes, and architecture.html holds them.
// Byte-stable: no timestamps, the model's own ordering.

import type {
  ArchEdgeRecord, ArchGroupRecord, ArchModelRecord, ArchNodeRecord, EntryPoint, SystemTier,
} from "../shared/protocol.ts";
import { ARCH_CATEGORY_LABEL } from "../shared/arch_protocol.ts";
import { stampHierarchy, resolveHierarchy } from "../shared/arch_hierarchy.ts";
import { ARCH_LENSES, ARCH_LENS_LABEL, ARCH_LENS_PURPOSE, lensSelection, type ArchLens } from "../webview/system/arch_lens.ts";
import { storyBeats } from "../webview/system/arch_trace.ts";
import type { ThreadGraph } from "../webview/system/threadInteraction.ts";

export const SYSTEM_MAP_FORMAT = "vibegraph.system-map";
export const SYSTEM_MAP_VERSION = 1;

export interface SystemMapContext {
  title: string;
  commit?: string | null;
  tool?: string;
  entryPoints?: EntryPoint[];
  system?: SystemTier | null;
  threadGraph?: ThreadGraph | null;
}

export interface SystemMapView {
  label: string;
  purpose: string;
  nodes: string[];
  edges: string[];
  /** records this lens reshapes or adds (a folded process, a category box, the Browser actor). */
  reshaped: { nodes: ArchNodeRecord[]; edges: ArchEdgeRecord[] };
  /** what this lens leaves out, named. */
  hidden: { tools: string[]; processes: string[] };
}

export interface SystemMapGroupTree {
  id: string;
  label: string;
  kind: string;
  source: ArchGroupRecord["source"];
  evidence?: string[];
  members: string[];
  groups: SystemMapGroupTree[];
}

export interface SystemMap {
  format: typeof SYSTEM_MAP_FORMAT;
  version: typeof SYSTEM_MAP_VERSION;
  title: string;
  generator: string;
  commit: string | null;
  summary: Record<string, number>;
  legend: Record<string, Record<string, string>>;
  startHere: { primaryPath: ArchModelRecord["primaryPath"] | null; story: Array<{ title: string; caption: string; nodes: string[]; edges: string[] }> };
  hierarchy: { groups: SystemMapGroupTree[]; ungrouped: string[] };
  nodes: ArchNodeRecord[];
  edges: ArchEdgeRecord[];
  groups: ArchGroupRecord[];
  views: Record<ArchLens, SystemMapView>;
  entryPoints: Array<{ id: string; kind: string; label: string; file: string; framework?: string; summary?: string; process?: string }>;
  subsystems: SystemTier | null;
  /** the Threads toggle: thread → thread calls (same language) and hops (HTTP / command / tool, across processes). */
  threads: { calls: Array<{ from: string; to: string; count: number }>; hops: Array<{ from: string; to: string; path: string; method: string | null; confidence: string }> } | null;
  unplaced: ArchModelRecord["unplaced"];
  notes: string[];
  proposal: ArchModelRecord["proposal"] | null;
}

export const SYSTEM_MAP_LEGEND: SystemMap["legend"] = {
  source: {
    derived: "read from the code by a deterministic rule; true of this commit",
    stated: "a person wrote it in .vibegraph/architecture.json (or stated a tool's role); a decision, not a fact the code shows",
    proposed: "a model suggested it and no person has ratified it; `evidence` names what it cited, none = INFERRED",
  },
  nodeKind: {
    cluster: "a process: entry points of one framework family under one package root",
    hub: "a dispatcher: the script other processes run everything through",
    tool: "a boundary: a tool a process's threads call to leave the process (db, cache, queue, platform, model API, cloud, HTTP)",
    actor: "Bird's-eye only: who reaches a web app (inferred from the framework's contract)",
  },
  edgeKind: {
    uses: "a process's threads call a tool (count = call sites)",
    http: "an HTTP call in one process matched to the route that serves it in another",
    command: "a process runs another's script by path",
    tool: "an MCP callTool matched to the tool's registration",
  },
  confidence: {
    called: "seen called in a thread",
    "path+method": "both path and method matched on both sides",
    path: "the path matched; the method was not parsed on both sides",
    ambiguous: "more than one candidate matched; every candidate is kept",
  },
  category: { ...ARCH_CATEGORY_LABEL },
};

function groupTree(model: ArchModelRecord): SystemMap["hierarchy"] {
  const h = resolveHierarchy(model);
  const byId = new Map(model.groups.map((g) => [g.id, g]));
  const kids = new Map<string, string[]>();
  for (const g of model.groups) {
    const p = h.groupParent.get(g.id);
    if (p) kids.set(p, [...(kids.get(p) ?? []), g.id]);
  }
  const members = new Map<string, string[]>();
  const ungrouped: string[] = [];
  for (const n of model.nodes) {
    const g = h.nodeGroup.get(n.id);
    if (g) members.set(g, [...(members.get(g) ?? []), n.id]);
    else ungrouped.push(n.id);
  }
  const build = (id: string, seen: Set<string>): SystemMapGroupTree => {
    const g = byId.get(id)!;
    seen.add(id);
    return {
      id, label: g.label, kind: g.kind, source: g.source,
      ...(g.evidence ? { evidence: g.evidence } : {}),
      members: members.get(id) ?? [],
      groups: (kids.get(id) ?? []).filter((k) => !seen.has(k)).map((k) => build(k, seen)),
    };
  };
  const seen = new Set<string>();
  const roots = model.groups.filter((g) => !h.groupParent.has(g.id)).map((g) => build(g.id, seen));
  return { groups: roots, ungrouped };
}

function view(model: ArchModelRecord, lens: ArchLens): SystemMapView {
  const sel = lensSelection(model, lens);
  const nodeById = new Map(model.nodes.map((n) => [n.id, JSON.stringify(n)]));
  const edgeById = new Map(model.edges.map((e) => [e.id, JSON.stringify(e)]));
  return {
    label: ARCH_LENS_LABEL[lens],
    purpose: ARCH_LENS_PURPOSE[lens],
    nodes: sel.nodes.map((n) => n.id),
    edges: sel.edges.map((e) => e.id),
    reshaped: {
      nodes: sel.nodes.filter((n) => nodeById.get(n.id) !== JSON.stringify(n)),
      edges: sel.edges.filter((e) => edgeById.get(e.id) !== JSON.stringify(e)),
    },
    hidden: { tools: sel.hiddenTools, processes: sel.hiddenClusters },
  };
}

/** The subsystem tier with its edges folded: one per (owner, target, kind,
 *  effect) with the count, the threads and three sample refs. The tier emits
 *  an edge per call site, each with every ref (466 KB of a private production codebase's map);
 *  the per-site form stays in the envelope. */
function foldSystemTier(tier: SystemTier): SystemTier {
  const folded = new Map<string, SystemTier["edges"][number] & { count: number; threads: string[] }>();
  for (const e of tier.edges) {
    const owner = e.from.split(":")[0];
    const key = [owner, e.to, e.kind, e.effectKind ?? "", e.confidence].join("\u0000");
    const cur = folded.get(key);
    if (cur) {
      cur.count++;
      if (e.viaThread && !cur.threads.includes(e.viaThread)) cur.threads.push(e.viaThread);
      if (cur.refs.length < 3) cur.refs.push(...e.refs.slice(0, 3 - cur.refs.length));
    } else {
      folded.set(key, {
        ...e, from: owner, viaThread: null, refs: e.refs.slice(0, 3), count: 1,
        threads: e.viaThread ? [e.viaThread] : [],
      });
    }
  }
  return { subsystems: tier.subsystems, edges: [...folded.values()] };
}

export function buildSystemMap(input: ArchModelRecord, ctx: SystemMapContext): SystemMap {
  const model = stampHierarchy(input);
  const processOf = new Map<string, string>();
  for (const n of model.nodes) if (n.kind === "cluster") for (const ep of n.entryPoints ?? []) processOf.set(ep, n.id);
  const views = Object.fromEntries(ARCH_LENSES.map((l) => [l, view(model, l)])) as Record<ArchLens, SystemMapView>;
  const story = model.primaryPath?.entryPoints.length
    ? storyBeats(model.nodes, model.edges, model.primaryPath.entryPoints)
    : [];
  const g = ctx.threadGraph ?? null;
  const count = (k: ArchNodeRecord["kind"]) => model.nodes.filter((n) => n.kind === k).length;
  return {
    format: SYSTEM_MAP_FORMAT,
    version: SYSTEM_MAP_VERSION,
    title: ctx.title,
    generator: ctx.tool ?? "VibeGraph",
    commit: ctx.commit ?? null,
    summary: {
      processes: count("cluster"),
      dispatchers: count("hub"),
      tools: count("tool"),
      edges: model.edges.length,
      hops: model.edges.filter((e) => e.kind !== "uses").length,
      groups: model.groups.length,
      entryPoints: ctx.entryPoints?.length ?? [...processOf.keys()].length,
      subsystems: ctx.system?.subsystems.length ?? 0,
    },
    legend: SYSTEM_MAP_LEGEND,
    startHere: { primaryPath: model.primaryPath ?? null, story },
    hierarchy: groupTree(model),
    nodes: model.nodes,
    edges: model.edges,
    groups: model.groups,
    views,
    entryPoints: (ctx.entryPoints ?? []).map((e) => ({
      id: e.id, kind: e.kind, label: e.label, file: e.file,
      ...(e.framework ? { framework: String(e.framework) } : {}),
      ...(e.summary ? { summary: e.summary } : {}),
      ...(processOf.has(e.id) ? { process: processOf.get(e.id)! } : {}),
    })),
    subsystems: ctx.system ? foldSystemTier(ctx.system) : null,
    threads: g ? {
      calls: g.edges.map((e) => ({ from: e.from, to: e.to, count: e.count })),
      hops: g.crossings.map((c) => ({ from: c.from, to: c.to, path: c.path, method: c.method, confidence: c.confidence })),
    } : null,
    unplaced: model.unplaced,
    notes: model.notes,
    proposal: model.proposal ?? null,
  };
}
