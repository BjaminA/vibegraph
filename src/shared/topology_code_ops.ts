// WHAT THE CODE DOES TO EACH DECLARED ZONE (2026-10-07, field review: a
// declared zone read "in: — · out: —" while the code writes it). The declared
// topology says who MAY read or write a zone (grants); the derived map's
// store-zone boxes (arch_data_zones.ts) say which PROCESSES do. Joined here,
// once, for the Resources lens and for topology.md: the same zone by name, or
// a derived zone holding the same families (patterns like
// `request_{Role}__{Person}` cover their instances).
//
// Pure and webview-safe.

import type { ArchModelRecord } from "./protocol";
import type { Topology } from "./topology_types";

const patternRe = (p: string) => new RegExp(`^${p.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, ".+")}$`);
const familyCovers = (a: string, b: string) => a === b || patternRe(a).test(b) || patternRe(b).test(a);

/** zone id → operation (write / read / watch / attempt) → process labels. */
export function codeOpsByZone(t: Topology, derived: ArchModelRecord | null | undefined): Map<string, Map<string, string[]>> {
  const out = new Map<string, Map<string, string[]>>();
  if (!derived) return out;
  const label = new Map(derived.nodes.map((n) => [n.id, n.label]));
  const dz = derived.nodes.filter((n) => n.id.startsWith("zone:"));
  for (const z of t.zones ?? []) {
    const holds = z.holds ?? [];
    const match = dz.filter((d) => d.label === z.id || ((d as { zoneOf?: { holds: string[] } }).zoneOf?.holds ?? []).some((h) => holds.some((x) => familyCovers(h, x))));
    if (!match.length) continue;
    const ops = new Map<string, string[]>();
    for (const e of derived.edges) {
      if (!e.protocol || !match.some((d) => d.id === e.to)) continue;
      const who = label.get(e.from) ?? e.from;
      const list = ops.get(e.protocol) ?? [];
      if (!list.includes(who)) list.push(who);
      ops.set(e.protocol, list);
    }
    if (ops.size) out.set(z.id, ops);
  }
  return out;
}

const OP_WORD: Record<string, string> = { write: "written by", read: "read by", watch: "watched by", attempt: "refused attempts by" };

/** "written by A; read by B, C" — or null when the code touches the zone nowhere seen. */
export function codeOpsText(ops: Map<string, string[]> | undefined): string | null {
  if (!ops?.size) return null;
  return ["write", "read", "watch", "attempt"].filter((o) => ops.has(o)).map((o) => `${OP_WORD[o]} ${ops.get(o)!.join(", ")}`).join("; ");
}
