// RULES OVER THE DECLARED TOPOLOGY (2026-10-02). Three verbs of the
// constraint grammar, checked against the grants the project DECLARES (its
// generators' output, src/server/topology_store.ts):
//
//   single-writer  {zone, writer}        zone Z is writable by exactly X
//                                        (a principal, or role:R = its holders)
//                                        — the CODE form, with `writes`, is
//                                        arch_checks.ts; this one has none
//   writer-subset  {zone, roles}         every principal that may write Z holds
//                                        one of these roles (or is named)
//   no-write       {principal, zone}     P may never write Z
//
// Three verdicts. UNVERIFIABLE is never a pass: no topology registered, the
// zone not declared, or the topology STALE (its inputs changed since the
// generator ran) — a verdict on a map that no longer describes the code is not
// one, so a stale check says what it would have answered and refuses to.

import type { TopologyModel } from "../shared/topology_types.ts";
import { grantees, whoMay } from "../shared/topology_query.ts";

export interface TopoSingleWriter { rule: "single-writer"; zone: string; writer: string }
export interface WriterSubset { rule: "writer-subset"; zone: string; roles: string[] }
export interface NoWrite { rule: "no-write"; principal: string; zone: string }
export type TopologyCheck = TopoSingleWriter | WriterSubset | NoWrite;

interface Result { verdict: "pass" | "violated" | "unverifiable"; reason: string; offenders: string[] }

const s = (x: unknown) => typeof x === "string" && x.length > 0;

export function isTopologyCheck(c: Record<string, unknown>): boolean {
  if (c.rule === "single-writer") return c.writes === undefined && s(c.zone) && s(c.writer);
  if (c.rule === "writer-subset") return s(c.zone) && Array.isArray(c.roles) && c.roles.length > 0 && c.roles.every(s);
  if (c.rule === "no-write") return s(c.principal) && s(c.zone);
  return false;
}

export function describeTopologyCheck(c: TopologyCheck): string {
  if (c.rule === "single-writer") return `zone ${c.zone} is writable by exactly ${c.writer} (declared topology)`;
  if (c.rule === "writer-subset") return `only ${c.roles.map((r) => `role:${r}`).join(", ")} may write zone ${c.zone} (declared topology)`;
  return `${c.principal} never writes zone ${c.zone} (declared topology)`;
}

const cite = (g: { cite?: string }) => (g.cite ? ` (${g.cite})` : "");

export function checkTopology(model: TopologyModel | undefined, c: TopologyCheck): Result {
  if (!model || !model.status.length) return { verdict: "unverifiable", reason: "no declared topology is registered (vibegraph-knowledge topology add) — NOT treated as satisfied", offenders: [] };
  const t = model.topology;
  if (!(t.zones ?? []).some((z) => z.id === c.zone)) return { verdict: "unverifiable", reason: `zone ${c.zone} is not in the declared topology — NOT treated as satisfied`, offenders: [] };
  const writers = whoMay(t, c.zone, "write");
  let r: Result;
  if (c.rule === "single-writer") {
    const want = new Set(grantees(t, c.writer));
    const got = new Set(writers.map((w) => w.principal));
    const extra = writers.filter((w) => !want.has(w.principal));
    const missing = [...want].filter((p) => !got.has(p));
    if (!want.size) r = { verdict: "unverifiable", reason: `${c.writer} reaches no declared principal — NOT treated as satisfied`, offenders: [] };
    else if (extra.length || missing.length) {
      r = { verdict: "violated", offenders: extra.map((w) => `${w.principal}${w.via !== "direct" ? ` via ${w.via}` : ""}${cite(w.grant)}`),
        reason: `zone ${c.zone} should be writable by exactly ${c.writer}: ${extra.length ? `also writable by ${extra.map((w) => `${w.principal}${w.via !== "direct" ? ` (via ${w.via})` : ""}${cite(w.grant)}`).join(", ")}` : ""}${extra.length && missing.length ? "; " : ""}${missing.length ? `no write grant for ${missing.join(", ")}` : ""}` };
    } else r = { verdict: "pass", reason: `zone ${c.zone} is writable by exactly ${c.writer} (${[...got].join(", ")})`, offenders: [] };
  } else if (c.rule === "writer-subset") {
    const roleOf = new Map((t.principals ?? []).map((p) => [p.id, new Set(p.roles ?? [])]));
    const bad = writers.filter((w) => !c.roles.some((role) => roleOf.get(w.principal)?.has(role)));
    r = bad.length
      ? { verdict: "violated", offenders: bad.map((w) => `${w.principal}${cite(w.grant)}`), reason: `only ${c.roles.map((x) => `role:${x}`).join(", ")} may write ${c.zone}: ${bad.map((w) => `${w.principal} holds ${[...(roleOf.get(w.principal) ?? [])].join(", ") || "no role"}${cite(w.grant)}`).join("; ")}` }
      : { verdict: "pass", reason: `every writer of ${c.zone} (${writers.map((w) => w.principal).join(", ") || "none declared"}) holds ${c.roles.join(" or ")}`, offenders: [] };
  } else {
    if (!(t.principals ?? []).some((p) => p.id === c.principal)) return { verdict: "unverifiable", reason: `${c.principal} is not a declared principal — NOT treated as satisfied`, offenders: [] };
    const hit = writers.filter((w) => w.principal === c.principal);
    r = hit.length
      ? { verdict: "violated", offenders: hit.map((w) => `${w.via}${cite(w.grant)}`), reason: `${c.principal} may write ${c.zone}: ${hit.map((w) => `${w.via === "direct" ? "granted directly" : `through ${w.via}`}${cite(w.grant)}`).join("; ")}` }
      : { verdict: "pass", reason: `no declared grant lets ${c.principal} write ${c.zone}`, offenders: [] };
  }
  const stale = model.status.filter((x) => x.state !== "fresh");
  if (stale.length) return { verdict: "unverifiable", reason: `the declared topology is not fresh (${stale.map((x) => `${x.source.id}: ${x.state}`).join(", ")}) — on it this would read ${r.verdict.toUpperCase()}: ${r.reason}. Re-run the generator (topology run).`, offenders: [] };
  if (model.conflicts.length) r.reason += ` (note: ${model.conflicts.length} merge conflict(s) between topology sources)`;
  return r;
}
