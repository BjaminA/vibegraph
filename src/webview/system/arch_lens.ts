// What each architecture LENS selects — the one definition the GUI map
// (archLayout.ts), the HTML artifact (arch_html.ts) and the agent-facing
// system map (server/system_map.ts) all read, so a lens cannot mean one thing
// on screen and another in a file. Pure and free of react-flow: selection
// only, never position (placement stays archLayout's).
//
// Lenses select what is drawn, never what is TRUE: the same model, six
// readings (the header of archLayout.ts says what each is for).

import type { ArchModelRecord, ArchNodeRecord, ArchEdgeRecord } from "../../shared/protocol.ts";
import { collapseTools } from "./arch_collapse.ts";
import { birdseyeModel } from "./arch_birdseye.ts";
import { resolveHierarchy, type ArchHierarchy } from "../../shared/arch_hierarchy.ts";

export type ArchLens = "birdseye" | "overview" | "tools" | "flows" | "payloads" | "trust";
export const ARCH_LENSES: readonly ArchLens[] = ["birdseye", "overview", "tools", "flows", "payloads", "trust"];

export const ARCH_LENS_LABEL: Record<ArchLens, string> = {
  birdseye: "Bird's-eye", overview: "Overview", tools: "Tools", flows: "Flows", payloads: "Payloads", trust: "Trust",
};

/** One line per lens: what it answers. Shared by the map's files. */
export const ARCH_LENS_PURPOSE: Record<ArchLens, string> = {
  birdseye: "the system in a dozen named boxes: who reaches it, the processes and dispatchers that carry the flow, the most-called tools, one arrow per pair",
  overview: "every process and every call into a tool, tools folded into one box per category",
  tools: "every process and every tool it calls, one edge per call relation",
  flows: "processes only, and the hops between them (HTTP, command, MCP tool)",
  payloads: "every edge labelled with what crosses it: the keys the code spells, or its call text",
  trust: "only the edges that cross a stated or proposed deployment / trust boundary",
};

/** Lenses that fold tools into one box per category. */
export const COLLAPSING_LENSES: readonly ArchLens[] = ["overview", "trust"];

export function lensKeeps(lens: ArchLens, n: ArchNodeRecord): boolean {
  return lens !== "flows" || n.kind === "cluster" || n.kind === "hub";
}
export function lensKeepsEdge(lens: ArchLens, e: ArchEdgeRecord, crosses?: (e: ArchEdgeRecord) => boolean): boolean {
  if (lens === "tools") return e.kind === "uses";
  if (lens === "flows") return e.kind !== "uses";
  if (lens === "trust") return !!crosses?.(e);
  return true;
}

export interface LensSelection {
  /** the model this lens reads: the full one, or Bird's-eye's / the folded one. */
  model: ArchModelRecord;
  nodes: ArchNodeRecord[];
  edges: ArchEdgeRecord[];
  hiddenTools: string[];
  hiddenClusters: string[];
  hierarchy: ArchHierarchy;
}

export function lensSelection(full: ArchModelRecord, lens: ArchLens, opts: { collapseTools?: boolean } = {}): LensSelection {
  const collapse = opts.collapseTools !== false && COLLAPSING_LENSES.includes(lens);
  const bird = lens === "birdseye" ? birdseyeModel(full) : null;
  const { model, hiddenTools } = bird ?? (collapse ? collapseTools(full) : { model: full, hiddenTools: [] as string[] });
  const kept = model.nodes.filter((n) => lensKeeps(lens, n));
  const keptIds = new Set(kept.map((n) => n.id));
  const hierarchy = resolveHierarchy(model);
  const crosses = (e: ArchEdgeRecord) => hierarchy.chainOf(e.from).join(">") !== hierarchy.chainOf(e.to).join(">");
  const edges = model.edges.filter((e) => lensKeepsEdge(lens, e, crosses) && keptIds.has(e.from) && keptIds.has(e.to));
  // A tool no kept edge reaches is dropped; processes always stay.
  const touched = new Set(edges.flatMap((e) => [e.from, e.to]));
  const nodes = kept.filter((n) => n.kind === "cluster" || n.kind === "hub" || touched.has(n.id));
  return { model, nodes, edges, hiddenTools, hiddenClusters: bird?.hiddenClusters ?? [], hierarchy };
}
