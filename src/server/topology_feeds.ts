// DECLARED FEEDS — rung 2 of the run-time ladder (2026-10-08). Zero tokens.
// Where the code decides at run time what a process reaches (names from
// configuration, another service, a feed the static reading cannot follow),
// the project's own topology generator may DECLARE it:
//
//   { "process": "decider", "watches": "inbox_{Role}__{User}", "via": "inboxFeed" }
//
// It is shown as DECLARED (never derived), on the map and in the Brief's data
// facts, and it closes the plan gap it answers. It is STALE when a function it
// names in `via` is no longer defined anywhere in the code — a rename, a
// deletion — checked against the parse every time, nothing stored.

import type { ArchModelRecord } from "../shared/protocol.ts";
import type { Plan } from "../shared/plan_types.ts";
import type { Topology } from "../shared/topology_types.ts";
import { planProcessBoxes } from "./brief_data.ts";

export interface DeclaredFeed {
  index: number;
  process: string;
  boxes: string[];
  op: "watch" | "read" | "write";
  family: string;
  via: string[];
  /** why it is STALE: the `via` functions the code no longer defines */
  stale?: string;
  cite: string;
}

/** Every declared feed, resolved to its boxes and checked against the code. */
export function declaredFeeds(t: Topology | null | undefined, model: ArchModelRecord, plan: Plan | null | undefined, files: Record<string, { nodes?: any[] }> | null): DeclaredFeed[] {
  const byPlan = planProcessBoxes(plan, model);
  const ids = new Set(model.nodes.map((n) => n.id));
  const defined = new Set<string>();
  for (const ir of Object.values(files ?? {})) for (const n of ir.nodes ?? []) if (n?.type === "function_def" && typeof n.name === "string") defined.add(n.name);
  return (t?.feeds ?? []).map((f, index) => {
    const op = f.watches !== undefined ? "watch" : f.reads !== undefined ? "read" : "write";
    const family = String(f.watches ?? f.reads ?? f.writes ?? "");
    const via = (Array.isArray(f.via) ? f.via : f.via ? [f.via] : []).map(String);
    const boxes = byPlan.get(f.process) ?? (ids.has(f.process) ? [f.process] : []);
    const missing = files ? via.filter((v) => !defined.has(v.split(".").pop() ?? v)) : [];
    return {
      index, process: f.process, boxes, op, family, via, cite: f.cite ?? `topology:feed:${index}`,
      ...(missing.length ? { stale: `it names ${missing.join(", ")}, which the code no longer defines` } : {}),
    };
  });
}

/** The map edges declared feeds add where the code shows no such edge. */
export function feedEdges(feeds: DeclaredFeed[], model: ArchModelRecord): ArchModelRecord["edges"] {
  const out: ArchModelRecord["edges"] = [];
  for (const f of feeds) {
    if (f.stale) continue;
    const zones = model.nodes.filter((n) => n.zoneOf && (n.id === f.family || n.label === f.family || n.id.endsWith(`/${f.family}`) || n.zoneOf.holds.includes(f.family))).map((n) => n.id);
    for (const box of f.boxes) for (const z of zones) {
      if (model.edges.some((e) => e.from === box && e.to === z && e.protocol === f.op)) continue;
      out.push({
        id: `${box}->${z}:feed:${f.index}`, from: box, to: z, kind: "uses", protocol: f.op,
        protocolBasis: `declared by the project's topology (feed ${f.index}${f.via.length ? `, via ${f.via.join(", ")}` : ""}) — the code alone does not show it`,
        count: 1, threads: [], confidence: "called", source: "stated", evidence: "declared", refs: [],
      });
    }
  }
  return out;
}
