// Questions the declared topology answers (2026-10-02) — one implementation
// for the CLI (`topology who-writes|can-write|touches`), the rules, and the
// Resources lens. Pure and webview-safe.
//
// A grant names a principal or `role:<name>`; a role reaches every principal
// that holds it. A THREAD touches a family when one of its nodes carries the
// family's name (or a literal matching its pattern) as a LITERAL — a name the
// code computes is not seen, and every answer says so.

import type { Topology, TopoGrant } from "./topology_types.ts";
import { covers } from "./name_pattern.ts";

export const TOPOLOGY_QUERY_LIMITS = [
  "who may write / read is the DECLARED grants, roles expanded to the principals that hold them; what the code actually writes is the plan's write matrix (plan check), not this",
  "a thread touches a family when one of its nodes carries the family's id, or a literal matching its pattern, as a literal; a computed name is not seen",
];

// M1: one pattern type — `*` globs and `{Hole}`s alike (name_pattern.ts)
const zoneMatch = (pattern: string, zone: string) => covers(pattern, zone);

/** The principals a grant's `who` reaches. */
export function grantees(t: Topology, who: string): string[] {
  if (who.startsWith("role:")) {
    const role = who.slice(5);
    return (t.principals ?? []).filter((p) => p.roles?.includes(role)).map((p) => p.id);
  }
  return [who];
}

export interface Access { principal: string; via: string; grant: TopoGrant }

/** Who may write (or read) a zone, each with the grant that says so. */
export function whoMay(t: Topology, zone: string, access: "read" | "write"): Access[] {
  const out: Access[] = [];
  for (const g of t.grants ?? []) {
    if (g.access !== access || !zoneMatch(g.zone, zone)) continue;
    const ps = grantees(t, g.who);
    // a role no declared principal holds is still an answer: the role itself
    if (!ps.length && g.who.startsWith("role:")) { out.push({ principal: g.who.slice(5), via: `${g.who} (no declared principal holds it)`, grant: g }); continue; }
    for (const p of ps) out.push({ principal: p, via: g.who === p ? "direct" : g.who, grant: g });
  }
  return out;
}

/** The zones a principal may write (or read), each with the grant. */
export function mayAccess(t: Topology, principal: string, access: "read" | "write"): Array<{ zone: string; via: string; grant: TopoGrant }> {
  const roles = new Set((t.principals ?? []).find((p) => p.id === principal)?.roles ?? []);
  const out: Array<{ zone: string; via: string; grant: TopoGrant }> = [];
  for (const g of t.grants ?? []) {
    if (g.access !== access) continue;
    const hit = g.who === principal || (g.who.startsWith("role:") && roles.has(g.who.slice(5)));
    if (!hit) continue;
    const zones = g.zone.includes("*") ? (t.zones ?? []).filter((z) => zoneMatch(g.zone, z.id)).map((z) => z.id) : [g.zone];
    for (const z of zones) out.push({ zone: z, via: g.who === principal ? "direct" : g.who, grant: g });
  }
  return out;
}

/** The zone a family lives in: declared on the family, else the one zone that `holds` it. */
export function zoneOfFamily(t: Topology, family: string): string | undefined {
  const f = (t.families ?? []).find((x) => x.id === family);
  if (f?.zone) return f.zone;
  const holders = (t.zones ?? []).filter((z) => (z.holds ?? []).some((h) => covers(h, family)));
  return holders.length === 1 ? holders[0].id : undefined;
}

interface ThreadLike { entryPointId: string | null; nodes: any[] }

const LIT = /(["'`])((?:(?!\1).)*)\1/g;
function literalsOf(n: any): string[] {
  const texts = [...(Array.isArray(n.args) ? n.args : []), n.preview, n.label, ...(Array.isArray(n.literals) ? n.literals : [])].filter((x) => typeof x === "string");
  const out: string[] = [];
  for (const t of texts) for (const m of t.matchAll(LIT)) if (!m[2].includes("${")) out.push(m[2]);
  return out;
}

/** The threads that name a family as a literal, with where: any IR node
 *  inside a function the thread walks (its seed and steps) whose arguments
 *  carry the family's id, or a literal matching its pattern. */
export function threadsTouching(t: Topology, family: string, threads: ThreadLike[], files: Record<string, { nodes?: any[] }> = {}): Array<{ entryPointId: string; at: string }> {
  const f = (t.families ?? []).find((x) => x.id === family);
  const test = (s: string) => s === family || (!!f?.pattern && covers(f.pattern, s)) || covers(family, s);
  const out: Array<{ entryPointId: string; at: string }> = [];
  for (const th of threads) {
    if (!th.entryPointId) continue;
    let at: string | null = null;
    for (const n of th.nodes) {
      if ((n.kind !== "step" && n.kind !== "seed") || !n.file || !n.irNodeId) continue;
      const scope = n.irNodeId === "module" ? (id: string) => !id.includes(".fn/") : (id: string) => id.startsWith(`${n.irNodeId}/`);
      const hit = (files[n.file]?.nodes ?? []).find((x) => scope(String(x.id)) && literalsOf(x).some(test));
      if (hit) { at = `${n.file}:${hit.line ?? "?"} ${n.label ?? ""}`.trim(); break; }
    }
    if (at) out.push({ entryPointId: th.entryPointId, at });
  }
  return out;
}

/** The threads a function lives on (a router, a decision node's evaluator). */
export function threadsOfFunction(fn: string, threads: ThreadLike[]): string[] {
  const last = fn.split(".").pop()!;
  return threads.filter((th) => th.entryPointId && th.nodes.some((n) => (n.kind === "step" || n.kind === "seed") && (n.label === last || String(n.irNodeId ?? "").endsWith(`/${last}.fn`)))).map((th) => th.entryPointId as string);
}
