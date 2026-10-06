// SEMANTIC ZOOM for every map mode (2026-10-06, system views). Real, Plan and
// Overlay all read the lens as a LEVEL, and a level only ever folds or drops —
// so going from detail to overview to Bird's-eye never adds a box.
//
//   birdseye  processes, stores, outside callers, decision structures, trust
//             boundaries; a store's zones and the SDKs it is reached through
//             fold into its card; every plan item not built (and every planned
//             tool) folds into ONE chip, "N planned, not built"
//   overview  adds the zones, grouped per store, with counts and writers
//   detail    everything (the Tools / Payloads lenses)
//
// Pure: a model in, a smaller model out. Placement stays archLayout's.

import type { ArchModelRecord, ArchNodeRecord, ArchEdgeRecord } from "../../shared/protocol";

export type MapLevel = "birdseye" | "overview" | "detail";
export const NOT_BUILT = "plan:not-built";

export function levelOf(lens: string): MapLevel {
  if (lens === "birdseye") return "birdseye";
  if (lens === "tools" || lens === "payloads") return "detail";
  return "overview";
}

/** Re-point edges through `into` (folded id → keeper), drop self-loops, and
 *  merge what lands on one pair into one edge. */
function repoint(edges: ArchEdgeRecord[], into: Map<string, string>): ArchEdgeRecord[] {
  const out = new Map<string, ArchEdgeRecord>();
  for (const e of edges) {
    const from = into.get(e.from) ?? e.from, to = into.get(e.to) ?? e.to;
    if (from === to) continue;
    if (from === e.from && to === e.to) { if (!out.has(e.id)) out.set(e.id, e); continue; }
    const id = `${from}->${to}:${e.kind}:folded`;
    const cur = out.get(id);
    if (!cur) out.set(id, { ...e, id, from, to, members: [e.id], details: undefined, payloads: undefined, payloadSummary: undefined });
    else {
      cur.members = [...(cur.members ?? []), e.id];
      cur.count += e.count;
      if (!cur.protocol.split(" / ").includes(e.protocol)) cur.protocol = `${cur.protocol} / ${e.protocol}`;
      cur.threads = [...new Set([...cur.threads, ...e.threads])];
    }
  }
  return [...out.values()];
}

/** The model at a level. `plan` = the Plan view (everything is a ghost, so
 *  the realised ghosts stay boxes there). */
export function atLevel<M extends ArchModelRecord>(model: M, level: MapLevel, opts: { plan?: boolean } = {}): M {
  if (level !== "birdseye") return model;
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const into = new Map<string, string>();
  // a store's zones and SDKs → its card (a planned zone's card may itself fold below)
  for (const n of model.nodes) if (n.storeOf && byId.has(n.storeOf) && n.id !== n.storeOf) into.set(n.id, n.storeOf);
  // an unclassified tool says least: not drawn at this height (Tools draws it)
  for (const n of model.nodes) if (n.kind === "tool" && n.category === "unknown" && !n.essential && n.source !== "planned") into.set(n.id, "");
  // plan items not built, planned tools, the unowned-threads card → one chip
  const ghost = (n: ArchNodeRecord) => n.source === "planned";
  const folded: ArchNodeRecord[] = [];
  for (const n of model.nodes) {
    if (!ghost(n) || into.has(n.id)) continue;
    const realised = n.planVerdict === "realised";
    if (opts.plan && realised && n.kind === "cluster") continue;       // the Plan view's built processes stay
    if (opts.plan && realised && n.storeOf === undefined && n.id.includes("store:")) continue; // …and its built stores
    folded.push(n);
    into.set(n.id, NOT_BUILT);
  }
  // follow chains (a planned zone → a planned store that folds into the chip)
  const resolve = (id: string, seen = 0): string => { const t = into.get(id); return t && seen < 4 ? resolve(t, seen + 1) : id; };
  for (const k of [...into.keys()]) if (into.get(k)) into.set(k, resolve(k));
  if (!into.size) return model;
  const nodes = model.nodes.filter((n) => !into.has(n.id));
  const dropped = new Set([...into].filter(([, v]) => !v).map(([k]) => k));
  if (folded.length) {
    // an ITEM the code lacks (the threads card is a holder, not an item)
    const notBuilt = folded.filter((n) => n.planVerdict !== undefined && n.planVerdict !== "realised");
    const others = folded.filter((n) => !notBuilt.includes(n));
    nodes.push({
      id: NOT_BUILT, kind: "cluster", category: "unknown", source: "planned", essential: true,
      label: notBuilt.length ? `${notBuilt.length} planned, not built` : `${others.length} more planned`,
      sublabel: [...notBuilt, ...others].map((n) => n.label).slice(0, 6).join(", ") + (folded.length > 6 ? `, +${folded.length - 6}` : ""),
      threads: [], refs: [],
      notes: [
        ...(notBuilt.length ? [`not built yet: ${notBuilt.map((n) => n.label).join(", ")}`] : []),
        ...(others.length ? [`also folded here at this height: ${others.map((n) => n.label).join(", ")}`] : []),
        "Zoom in (Overview, or Tools / Payloads) to draw each one.",
      ],
    });
  }
  const kept = new Set(nodes.map((n) => n.id));
  const groups = model.groups
    .map((g) => ({ ...g, wraps: g.wraps.filter((w) => kept.has(w) || model.groups.some((x) => x.id === w)) }))
    .filter((g) => g.wraps.some((w) => kept.has(w)) || g.wraps.length > 0 && g.wraps.every((w) => model.groups.some((x) => x.id === w)));
  // a group left wrapping only emptied groups goes too
  const live = new Set<string>();
  const hasMember = (gid: string, depth = 0): boolean => {
    const g = groups.find((x) => x.id === gid);
    return !!g && depth < 8 && g.wraps.some((w) => kept.has(w) || hasMember(w, depth + 1));
  };
  for (const g of groups) if (hasMember(g.id)) live.add(g.id);
  return {
    ...model,
    nodes,
    edges: repoint(model.edges.filter((e) => !dropped.has(e.from) && !dropped.has(e.to)), into),
    groups: groups.filter((g) => live.has(g.id)).map((g) => ({ ...g, wraps: g.wraps.filter((w) => kept.has(w) || live.has(w)) })),
  };
}

/** Boxes a laid-out level draws (cards, not group frames) — for the tests. */
export const boxCount = (nodes: Array<{ type?: string }>) => nodes.filter((n) => n.type === "archNode").length;
