// The declared topology as the page an agent reads (2026-10-02): `topology.md`
// in the export, `vibegraph-knowledge topology show`. Says, before anything
// else, that it is DECLARED (read from the project's own data by its own
// generator) and how fresh each source is.

import type { TopologyModel } from "../shared/topology_types.ts";
import { whoMay, threadsTouching, threadsOfFunction, TOPOLOGY_QUERY_LIMITS } from "../shared/topology_query.ts";

interface ThreadLike { entryPointId: string | null; nodes: any[] }
const c = (x: { cite?: string }) => (x.cite ? ` _(${x.cite})_` : "");

export function formatTopologyMd(m: TopologyModel, threads: ThreadLike[] = [], files: Record<string, { nodes?: any[] }> = {}): string {
  const t = m.topology;
  const out: string[] = ["# Declared topology", "",
    "> DECLARED — read from the project's own declarations (catalogues, transition tables, decision trees, a principals file) by the generator(s) it registered. The resource names are computed at run time, so this is what the CODE cannot show statically; it is as true as the declarations are.", ""];
  out.push("Sources:", ...m.status.map((s) => `- **${s.source.id}** — ${s.state}: ${s.detail} (\`${s.source.generator}\` over ${s.source.inputs.join(", ")})`), "");
  if (m.conflicts.length) out.push("Conflicts between sources:", ...m.conflicts.map((x) => `- ${x}`), "");
  for (const st of t.stores ?? []) {
    out.push(`## Store ${st.id}${st.kind ? ` (${st.kind})` : ""}${c(st)}`, "");
    for (const z of (t.zones ?? []).filter((x) => x.store === st.id)) {
      const w = [...new Set(whoMay(t, z.id, "write").map((x) => x.principal))];
      const r = [...new Set(whoMay(t, z.id, "read").map((x) => x.principal))];
      const routers = (t.routers ?? []).filter((x) => x.zones?.includes(z.id));
      out.push(`- zone **${z.id}**${c(z)} — holds ${(z.holds ?? []).join(", ") || "(not said)"}; write: ${w.join(", ") || "NO ONE declared"}; read: ${r.join(", ") || "—"}${routers.length ? `; routed by ${routers.map((x) => x.function).join(", ")}` : ""}`);
    }
    out.push("");
  }
  const fams = t.families ?? [];
  if (fams.length) {
    out.push("## Document families", "");
    for (const f of fams) {
      const touch = threadsTouching(t, f.pattern ?? f.id, threads, files);
      out.push(`- **${f.id}**${f.pattern ? ` (\`${f.pattern}\`)` : ""}${f.zone ? ` in ${f.zone}` : ""}${c(f)}${touch.length ? ` — named by ${touch.slice(0, 4).map((x) => x.entryPointId).join(", ")}${touch.length > 4 ? ` +${touch.length - 4}` : ""}` : ""}`);
    }
    out.push("");
  }
  if ((t.principals ?? []).length) {
    out.push("## Principals and grants", "");
    for (const p of t.principals ?? []) out.push(`- **${p.id}**${p.kind ? ` (${p.kind})` : ""}${p.roles?.length ? ` — roles ${p.roles.join(", ")}` : ""}${c(p)}`);
    for (const g of t.grants ?? []) out.push(`  - ${g.who} ${g.access} ${g.zone}${c(g)}`);
    out.push("");
  }
  if ((t.routers ?? []).length) {
    out.push("## Routers (document → zone)", "");
    for (const r of t.routers ?? []) {
      const on = threadsOfFunction(r.function, threads);
      out.push(`- \`${r.function}\`${r.file ? ` in ${r.file}` : ""}${r.zones?.length ? ` → ${r.zones.join(", ")}` : ""}${c(r)}${on.length ? ` — on ${on.slice(0, 4).join(", ")}` : " — on no thread found"}`);
    }
    out.push("");
  }
  for (const sm of t.stateMachines ?? []) {
    out.push(`## State machine ${sm.id}${sm.family ? ` (family ${sm.family})` : ""}${c(sm)}`, "");
    for (const tr of sm.transitions) out.push(`- ${tr.from} → ${tr.to}${tr.roles?.length ? ` by ${tr.roles.join(", ")}` : ""}${tr.requires?.length ? `; requires ${tr.requires.join(", ")}` : ""}${c(tr)}`);
    out.push("");
  }
  for (const d of t.decisionTrees ?? []) {
    out.push(`## Decision tree ${d.id} (root ${d.root})${c(d)}`, "");
    for (const n of d.nodes) out.push(`- **${n.id}**${n.question ? ` ${n.question}` : ""}${n.outcome ? ` → outcome **${n.outcome}**` : ""}${n.yes ? `; yes → ${n.yes}` : ""}${n.no ? `; no → ${n.no}` : ""}${n.reads?.length ? `; reads ${n.reads.join(", ")}` : ""}${n.evaluatedBy ? `; evaluated by \`${n.evaluatedBy}\`` : ""}${c(n)}`);
    out.push("", `Follow a node's evidence: \`vibegraph-knowledge topology explain ${d.id}:<node>\`.`, "");
  }
  out.push("Limits:", ...TOPOLOGY_QUERY_LIMITS.map((l) => `- ${l}`), "");
  return out.join("\n");
}
