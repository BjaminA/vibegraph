// The architecture map's CONFIGURATION lens (2026-09-28): which process reads
// which environment variables. A GUI lens only — the model it draws is built
// here from the architecture's processes and the envelope's configuration
// surface (src/shared/env_surface.ts via `insight.env`), then laid out by the
// Tools lens's own pipeline, so routing and placement are not reinvented.
//
// Variables are grouped by prefix (`NEXT_PUBLIC_*`, `CH_*`, `AWS_*`): a real
// project reads hundreds (a private production codebase 266) and one box per variable is noise. A
// group keeps every member for the inspector and says how many are declared
// nowhere. A process reads a group when one of its threads reads a member.

import type { ArchModelRecord, ArchNodeRecord, ArchEdgeRecord, InsightRecord } from "../../shared/protocol";

type EnvInsight = NonNullable<InsightRecord["env"]>;

const SPLIT_ABOVE = 12;

/** Group names by first segment; a large group splits by its first two. */
export function envGroups(names: string[]): Map<string, string[]> {
  const first = new Map<string, string[]>();
  for (const n of names) {
    const seg = n.includes("_") ? n.split("_")[0] : n;
    (first.get(seg) ?? first.set(seg, []).get(seg)!).push(n);
  }
  const out = new Map<string, string[]>();
  for (const [seg, members] of first) {
    if (members.length <= SPLIT_ABOVE) { out.set(members.length === 1 ? members[0] : `${seg}_*`, members); continue; }
    for (const n of members) {
      const parts = n.split("_");
      const key = parts.length > 2 ? `${parts[0]}_${parts[1]}_*` : `${seg}_*`;
      (out.get(key) ?? out.set(key, []).get(key)!).push(n);
    }
  }
  return out;
}

export function configModel(arch: ArchModelRecord, env: EnvInsight | null | undefined): ArchModelRecord {
  const clusters = arch.nodes.filter((n) => n.kind === "cluster");
  if (!env) return { ...arch, nodes: clusters, edges: [], groups: [] };
  const byName = new Map(env.vars.map((v) => [v.name, v]));
  const undeclared = new Set(env.undeclared);
  const nodes: ArchNodeRecord[] = [...clusters];
  const edges: ArchEdgeRecord[] = [];
  for (const [key, members] of envGroups(env.vars.map((v) => v.name))) {
    const threads = [...new Set(members.flatMap((m) => byName.get(m)?.threads ?? []))];
    const nUndeclared = members.filter((m) => undeclared.has(m)).length;
    const id = `env:${key}`;
    nodes.push({
      id, kind: "tool", label: key,
      sublabel: `${members.length} variable${members.length === 1 ? "" : "s"}${nUndeclared ? ` · ${nUndeclared} declared nowhere` : env.hasDeclarations ? " · declared" : ""}`,
      category: "config", source: "derived", threads, refs: [],
      members: members.map((m) => `${m}${undeclared.has(m) ? "  (declared nowhere)" : ""}`),
    } as ArchNodeRecord);
    for (const c of clusters) {
      const shared = threads.filter((t) => c.threads.includes(t));
      if (!shared.length) continue;
      const read = members.filter((m) => (byName.get(m)?.threads ?? []).some((t) => c.threads.includes(t)));
      edges.push({
        id: `${c.id}->${id}:reads`, from: c.id, to: id, kind: "uses",
        protocol: "reads env", protocolBasis: "a thread of this process reads these variables by name (process.env / os.environ / getenv / a bash $X it never assigns)",
        details: read, count: read.length, threads: shared, confidence: "called", refs: [], source: "derived",
      } as ArchEdgeRecord);
    }
  }
  return { ...arch, nodes, edges, groups: [] };
}
