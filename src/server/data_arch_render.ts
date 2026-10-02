// The derived data architecture as one page (export: data-architecture.md).

import type { DataArchitecture } from "../shared/data_arch_types.ts";

const list = (xs: string[] | undefined) => (xs?.length ? xs.join(", ") : "—");

export function formatDataArchMd(d: DataArchitecture): string {
  const t = d.topology;
  const out: string[] = [
    "# Data architecture (DERIVED from the code)",
    "",
    "What the IR alone says about the data this project declares, names and moves: literal tables, the names its functions build, what its SDK calls do, the capabilities injected into its logic, the stores and zones those imply, the hops between processes that share data, and the decision structures held as tables. Every item cites where it was read. Nothing here came from a model; a project's own topology generator (`topology.md`) outranks it wherever both speak.",
    "",
  ];
  if (d.tables.length) {
    out.push("## Literal tables", "", "| table | at | shape | rows | fields |", "| --- | --- | --- | --- | --- |");
    for (const x of d.tables) out.push(`| \`${x.name}\` | ${x.file}:${x.line} | ${x.shape} | ${x.rows} | ${list(x.fields.slice(0, 12))} |`);
    out.push("");
  }
  if (d.namePatterns.length) {
    out.push("## Names built by functions", "", ...d.namePatterns.map((p) => `- \`${p.pattern}\` — \`${p.fn}\` (${p.file}:${p.line})`), "");
  }
  if (d.sdkCalls.length) {
    out.push("## SDK calls and what they do", "", "The effect is read from the method's verb (a taxonomy per tool family); payload keys are named, never values.", "", "| call | at | tool | effect | name | how |", "| --- | --- | --- | --- | --- | --- |");
    for (const c of d.sdkCalls) out.push(`| \`${c.callee}\` | ${c.file}:${c.line} | ${c.tool} | ${c.effect} | ${c.name ? `\`${c.name}\`` : c.computedAt ? `computed at ${c.computedAt}` : "—"} | ${c.how} |`);
    out.push("");
  }
  if (d.injections.length) {
    out.push("## Injected capabilities", "", "A call through a parameter typed by an interface, linked to every object in the project that implements it (test fakes counted apart).", "");
    for (const j of d.injections) {
      const prod = j.implementations.filter((i) => !i.test);
      const fakes = j.implementations.length - prod.length;
      out.push(`- \`${j.iface}.${j.property}\` — called at ${j.calls.map((c) => `${c.file}:${c.line}`).join(", ")}; implemented by ${prod.length ? prod.map((i) => `\`${i.fn}\` (${i.file}:${i.line})`).join(", ") : "nothing in the project"}${fakes ? `; ${fakes} test fake(s)` : ""}`);
    }
    out.push("");
  }
  if (t.stores?.length || t.zones?.length || t.families?.length) {
    out.push("## Stores, zones and families", "");
    for (const s of t.stores ?? []) out.push(`- store **${s.id}**${s.kind ? ` (${s.kind})` : ""}${s.cite ? ` — ${s.cite}` : ""}`);
    for (const z of t.zones ?? []) out.push(`- zone \`${z.id}\` in ${z.store}${z.holds?.length ? ` — holds ${list(z.holds)}` : ""}${z.cite ? ` — ${z.cite}` : ""}`);
    for (const f of t.families ?? []) out.push(`- family \`${f.id}\`${f.pattern ? ` \`${f.pattern}\`` : ""}${f.zone ? ` → zone ${f.zone}` : ""}${f.cite ? ` — ${f.cite}` : ""}`);
    if (t.grants?.length) out.push("", "Grants:", ...t.grants.map((g) => `- ${g.who} may ${g.access} \`${g.zone}\`${g.cite ? ` — ${g.cite}` : ""}`));
    out.push("");
  }
  if (d.flows.length) {
    out.push("## Data-coupled hops", "", "A process writes a family another process watches or reads. No call joins them, and the ORDER is not proven by the code.", "");
    for (const h of d.flows) out.push(`- \`${h.family}\`: written at ${h.from.file}:${h.from.line} (${list(h.from.entries)}) → ${h.to.op} at ${h.to.file}:${h.to.line} (${list(h.to.entries)})`);
    out.push("");
  }
  for (const m of t.stateMachines ?? []) {
    out.push(`## State machine \`${m.id}\` (${m.cite ?? "?"})`, "", `States: ${list(m.states)}.${m.evaluatedBy ? ` Applied by: ${m.evaluatedBy}.` : ""}`, "", "| from | to | who | requires | label |", "| --- | --- | --- | --- | --- |");
    for (const tr of m.transitions) out.push(`| ${tr.from} | ${tr.to} | ${list(tr.roles)} | ${list(tr.requires)} | ${tr.label ?? ""} |`);
    out.push("");
  }
  for (const tree of t.decisionTrees ?? []) {
    out.push(`## Decision tree \`${tree.id}\` (${tree.cite ?? "?"})`, "", `Root: ${tree.root}.${tree.evaluatedByTable ? ` Nodes evaluated through ${tree.evaluatedByTable}.` : " No record maps its nodes to functions."}`, "", "| node | question | yes | no | evaluated by | reads |", "| --- | --- | --- | --- | --- | --- |");
    for (const n of tree.nodes.filter((x) => !x.outcome)) out.push(`| ${n.id} | ${(n.question ?? "").replace(/\|/g, "\\|")} | ${n.yes ?? ""} | ${n.no ?? ""} | ${n.evaluatedBy ?? "—"} | ${list(n.evidence)} |`);
    out.push("");
  }
  out.push("## What could not be reduced", "");
  out.push(...(d.computed.length ? d.computed.map((c) => `- ${c}`) : ["Nothing was found that the derivation tried and failed to reduce."]), "");
  return out.join("\n");
}

/** Whether there is anything worth a page. */
export const hasDataArch = (d: DataArchitecture) =>
  d.tables.length + d.namePatterns.length + d.sdkCalls.length + d.injections.length + d.flows.length
  + (d.topology.stateMachines?.length ?? 0) + (d.topology.decisionTrees?.length ?? 0) > 0;
