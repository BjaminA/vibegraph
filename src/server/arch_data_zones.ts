// STORE ZONES on the system map (2026-10-02, field report: "the map shows the
// SDK and yjs as tools but none of the zones the plan's store holds and plan
// check verifies"). Each zone the code really writes, reads or watches is a box,
// and each process doing so an edge labelled with the operation — from the
// derived data operations (data_arch.ts), grouped by the plan's store zones
// when a plan says how families group, else one box per derived zone. A zone
// no operation reaches is not drawn: the map shows what the code does.

import type { ArchEdgeRecord, ArchNodeRecord, ArchRef } from "../shared/protocol.ts";
import type { Plan } from "../shared/plan_types.ts";
import { deriveDataArchitecture } from "./data_arch.ts";
import { covers } from "./data_topology.ts";
import { familyMatches } from "./call_args.ts";

const MAX_REFS = 8;

interface ZoneInputs {
  files: Record<string, { nodes?: any[] }>;
  threads: Array<{ entryPointId?: string | null } & Record<string, any>>;
  stack: unknown;
  model: { nodes: ArchNodeRecord[] };
  plan?: Plan | null;
}

export function deriveDataZones(input: ZoneInputs): { nodes: ArchNodeRecord[]; edges: ArchEdgeRecord[]; notes: string[] } {
  const da = deriveDataArchitecture(input.files as any, input.stack as any, input.threads as any);
  if (!da.operations.length) return { nodes: [], edges: [], notes: [] };
  const planZones = (input.plan?.stores ?? []).filter((s) => s.status !== "dropped")
    .flatMap((s) => (s.zones ?? []).map((z) => ({ store: s.id, zone: z.id, holds: z.holds })));
  const derivedStore = da.topology.stores?.[0]?.id ?? "store";
  const groupOf = (family: string) => {
    const z = planZones.find((x) => x.holds.some((h) => familyMatches(h, family) || covers(h, family) || covers(family, h)));
    return z ? { key: `${z.store}/${z.zone}`, label: z.zone, store: z.store, holds: z.holds, planned: true }
      : { key: `${derivedStore}/${family}`, label: family, store: derivedStore, holds: [family], planned: false };
  };
  // which clusters run an entry point
  const clustersOf = new Map<string, string[]>();
  for (const c of input.model.nodes) {
    if (c.kind !== "cluster") continue;
    for (const ep of c.threads) {
      const f = ep.split(":")[0];
      clustersOf.set(f, [...new Set([...(clustersOf.get(f) ?? []), c.id])]);
    }
  }
  const zones = new Map<string, { label: string; store: string; holds: string[]; planned: boolean; refs: ArchRef[]; ops: Map<string, { refs: ArchRef[]; families: Set<string> }> }>();
  let unplaced = 0;
  for (const o of da.operations) {
    const g = groupOf(o.family);
    const ref: ArchRef = { file: o.file, text: `${o.op} ${o.family} at line ${o.line}${o.port ? ` through ${o.port}` : ""}` };
    const z = zones.get(g.key) ?? { label: g.label, store: g.store, holds: g.holds, planned: g.planned, refs: [], ops: new Map() };
    z.refs.push(ref);
    const cids = [...new Set(o.entries.flatMap((e) => clustersOf.get(e) ?? []))];
    if (!cids.length) unplaced++;
    for (const cid of cids) {
      const k = `${cid}|${o.op}`;
      const e = z.ops.get(k) ?? { refs: [], families: new Set<string>() };
      e.refs.push(ref);
      e.families.add(o.family);
      z.ops.set(k, e);
    }
    zones.set(g.key, z);
  }
  const nodes: ArchNodeRecord[] = [];
  const edges: ArchEdgeRecord[] = [];
  for (const [key, z] of [...zones].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!z.ops.size) continue;
    const id = `zone:${key}`;
    nodes.push({
      id, kind: "tool", label: z.label, sublabel: `zone of ${z.store} · ${z.holds.slice(0, 3).join(", ")}${z.holds.length > 3 ? ", …" : ""}`,
      category: "storage", source: "derived", tool: key, role: "db", origin: "project",
      threads: [], refs: z.refs.slice(0, MAX_REFS),
      notes: [
        `A zone of the store ${z.store}${z.planned ? " (grouped as the plan's store groups it)" : ""}: the families ${z.holds.join(", ")}.`,
        "Drawn from the data operations the code makes on it (data-architecture.md); the order of a write and a read is not proven.",
      ],
    } as ArchNodeRecord);
    for (const [k, e] of [...z.ops].sort((a, b) => a[0].localeCompare(b[0]))) {
      const [cid, op] = k.split("|");
      edges.push({
        id: `${cid}->${id}:uses:${op}`, from: cid, to: id, kind: "uses", protocol: op,
        protocolBasis: `the code ${op === "write" ? "writes" : op === "read" ? "reads" : "watches"} ${[...e.families].join(", ")} (${e.refs[0].file}: ${e.refs[0].text})`,
        count: e.refs.length, threads: [], confidence: "called", refs: e.refs.slice(0, MAX_REFS), source: "derived",
      });
    }
  }
  const notes = nodes.length ? [`${nodes.length} store zone(s) drawn from the code's data operations${unplaced ? `; ${unplaced} operation(s) on no drawn process are not drawn` : ""}.`] : [];
  return { nodes, edges, notes };
}
