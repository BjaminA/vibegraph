// WHICH STORE a derived zone belongs to (2026-10-08, from a Brief run on a
// multi-process repository). The code says only that a family is written
// THROUGH a client package — the derived data topology named its one store
// after the package with the most store calls, so the zones the plan did not
// group read "zone of @vendor/client-sdk" beside the plan's own store, and one
// store showed as two. The project usually says what the store is; this reads
// it, strongest first, and never guesses:
//
//   1. the declared topology places the FAMILY in a zone      → that zone
//   2. exactly one planned store is reached through the client → that store
//   3. a RATIFIED software spec lists the client as a package  → the spec's tool
//   4. nothing names it → kept, said as "the store behind <client> (unnamed)"
//
// Two planned stores reached through one client is ambiguous: neither is
// chosen, and the note says so. Zero tokens.

import type { Plan } from "../shared/plan_types.ts";
import type { Topology } from "../shared/topology_types.ts";
import type { SoftwareSpec } from "../shared/software_types.ts";
import { familyMatches } from "./call_args.ts";
import { covers } from "./data_topology.ts";

export interface StoreNaming {
  /** the store id zones are keyed under */
  id: string;
  /** how the store reads on the map */
  label: string;
  via: "plan" | "spec" | "unnamed";
  why: string;
}

/** Name the store behind a client package (rules 2–4). */
export function nameStoreBehind(client: string | null, src: { plan?: Plan | null; specs?: SoftwareSpec[] }): StoreNaming {
  if (!client) return { id: "store", label: "an unnamed store", via: "unnamed", why: "no client package is attributed to these operations" };
  const planned = (src.plan?.stores ?? []).filter((s) => s.status !== "dropped" && (s.reachedThrough ?? []).includes(client));
  if (planned.length === 1) {
    const s = planned[0];
    return { id: s.id, label: s.label ?? s.id, via: "plan", why: `the plan's store ${s.id} is reached through ${client}` };
  }
  const ambiguous = planned.length > 1 ? ` (the plan reaches ${planned.map((s) => s.id).join(" and ")} through it, so neither is chosen)` : "";
  const spec = (src.specs ?? []).find((s) => s.status === "ratified" && (s.identity?.packages ?? []).includes(client));
  if (spec && !ambiguous) return { id: spec.tool, label: spec.tool, via: "spec", why: `the ratified software spec ${spec.tool} lists ${client} as its package` };
  return {
    id: client, label: `the store behind ${client} (unnamed)`, via: "unnamed",
    why: `nothing names the store reached through ${client}${ambiguous}: add it to the plan's stores (reachedThrough ${client}) or \`vibegraph-knowledge software add\` it`,
  };
}

/** Rule 1: the declared zone that holds a family, if the declared topology has one. */
export function declaredZoneOf(family: string, declared: Topology | null | undefined): { store: string; zone: string; holds: string[] } | null {
  for (const z of declared?.zones ?? []) {
    const holds = z.holds ?? [];
    if (holds.some((h) => familyMatches(h, family) || covers(h, family) || covers(family, h))) return { store: z.store, zone: z.id, holds };
  }
  return null;
}
