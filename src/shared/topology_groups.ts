// ZONES IN GROUPS, GRANTS AS A GRID (2026-10-12, field report: 54 zones and
// 641 grants as flat lists — "group zones by type, collapsed, and show
// permissions as a role × zone grid, which is how a security reviewer reads
// them"). A zone group is the zones one family pattern expands to
// (`record_{Type}` → record_CandidateTarget, record_PidAssessment, …), else the
// zones sharing a name prefix (`request_…`). Pure and webview-safe.

import type { Topology } from "./topology_types";
import { grantees } from "./topology_query.ts";

export interface ZoneGroup { id: string; label: string; zones: string[] }

/** 2026-10-12 (field review: "grant edges are still a solid wall") — above
 *  this many write edges the map says them on the cards and the access grid
 *  opens first: the grid is the readable view of that many. */
export const GRANT_EDGE_CAP = 48;

const patternRe = (p: string) => new RegExp(`^${p.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, ".+")}$`);

/** Groups of at least `min` zones; a zone sits in one group at most. */
export function zoneGroupsOf(t: Topology, min = 3): ZoneGroup[] {
  const zones = (t.zones ?? []).map((z) => z.id);
  const taken = new Set<string>();
  const out: ZoneGroup[] = [];
  const add = (id: string, label: string, members: string[]) => {
    const free = members.filter((z) => !taken.has(z));
    if (free.length < min) return;
    free.forEach((z) => taken.add(z));
    out.push({ id, label, zones: free.sort() });
  };
  // a declared family pattern with a hole covers its instances
  for (const f of t.families ?? []) {
    const p = f.pattern ?? f.id;
    if (!/\{[^}]+\}/.test(p)) continue;
    const re = patternRe(p);
    add(p, p, zones.filter((z) => re.test(z)));
  }
  // else a shared prefix before the first separator
  const byPrefix = new Map<string, string[]>();
  for (const z of zones) {
    const m = /^([A-Za-z0-9]+)[_\-./]/.exec(z);
    if (m) byPrefix.set(m[1], [...(byPrefix.get(m[1]) ?? []), z]);
  }
  for (const [p, list] of byPrefix) add(`${p}_*`, `${p}_*`, list);
  return out;
}

/** principal → zone → "W" | "R" | "WR", over every grant (roles expanded). */
export function accessGrid(t: Topology): { principals: string[]; cell: (p: string, z: string) => string } {
  const m = new Map<string, Map<string, Set<string>>>();
  for (const g of t.grants ?? []) for (const who of grantees(t, g.who)) {
    const row = m.get(who) ?? new Map<string, Set<string>>();
    const s = row.get(g.zone) ?? new Set<string>();
    s.add(g.access === "write" ? "W" : "R");
    row.set(g.zone, s);
    m.set(who, row);
  }
  return {
    principals: [...m.keys()].sort(),
    cell: (p, z) => { const s = m.get(p)?.get(z); return s ? ["W", "R"].filter((x) => s.has(x)).join("") : ""; },
  };
}
