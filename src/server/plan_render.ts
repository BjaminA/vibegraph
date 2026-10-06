// THE PLAN, rendered (2026-09-30): `plan.md` (the page a person or an agent
// reads, objective first) and the compact form the prompt hook sends. Both
// say, before anything else, that this is a PLAN and not the code.

import type { Plan, PlanFinding, PlanReconcile, PlanSection } from "../shared/plan_types.ts";
import { planItemId, sectionItems } from "../shared/plan_types.ts";
import { assumptionState } from "./plan_assumptions.ts";

export const PLAN_BANNER = "HYPOTHETICAL — a plan, not the code. It will change; nothing in it is true of the project until the code says so.";

const live = <T extends { status?: string }>(xs: T[]) => xs.filter((x) => x.status !== "dropped");
const mark = (s: string) => (s === "agreed" ? "agreed" : s === "promoted" ? "promoted" : "PROPOSED");

function verdictOf(rec: PlanReconcile | null | undefined, section: PlanSection, id: string): PlanFinding | undefined {
  return rec?.findings.find((f) => f.section === section && f.id === id);
}

/** Where an item came from: a verified quote from the documents, or INFERRED. */
const src = (it: { groundedIn?: string | null }) =>
  it.groundedIn === undefined ? "" : it.groundedIn === null ? " _(inferred — not in the documents)_" : ` _(from the docs: “${it.groundedIn.length > 100 ? `${it.groundedIn.slice(0, 97)}…` : it.groundedIn}”)_`;
const v = (f?: PlanFinding) => (f ? ` — **${f.verdict}**${f.detail ? `: ${f.detail}` : ""}` : "");

/** The page. `rec` (plan vs code) is optional: without it, no verdicts. */
export function formatPlanMd(plan: Plan, rec?: PlanReconcile | null): string {
  const out: string[] = [];
  out.push(`# Plan — revision ${plan.revision}${plan.closed ? " (closed)" : ""}`, "", `> ${PLAN_BANNER}`, "");
  out.push(`**Objective:** ${plan.objective}`, "");
  if (plan.description && plan.description !== plan.objective) out.push(`<details><summary>The description it came from</summary>\n\n${plan.description}\n\n</details>`, "");
  out.push("Every item is **PROPOSED** (drafted, not yet agreed), **agreed** (a person agreed) or **promoted** (a rule now in `constraints.json`). A planned rule is advice: it never blocks an edit until it is promoted.", "");

  const procs = live(plan.processes);
  if (procs.length) {
    out.push("## Processes", "");
    for (const p of procs) out.push(`- **${p.id}** (${p.kind}, ${mark(p.status)})${p.label !== p.id ? ` — ${p.label}` : ""}${p.serves ? `; serves: ${p.serves}` : ""}${p.at ? `; code at \`${p.at}\`` : ""}${p.entryPoints?.length ? `; starts from ${p.entryPoints.map((e) => `\`${e}\``).join(", ")}` : ""}${p.uses?.length ? `; uses ${p.uses.join(", ")}` : ""}${p.runsAs ? `; runs as ${p.runsAs}` : ""}${src(p)}${v(verdictOf(rec, "processes", p.id))}`);
    out.push("");
  }
  const mods = live(plan.modules ?? []);
  if (mods.length) {
    out.push("## Modules (code units, apart from the processes that run them)", "");
    for (const m of mods) {
      const users = plan.processes.filter((p) => p.status !== "dropped" && p.uses?.includes(m.id)).map((p) => p.id);
      out.push(`- **${m.id}** (${m.kind}, ${mark(m.status)})${m.label ? ` — ${m.label}` : ""}; code at \`${m.at}\`${users.length ? `; used by ${users.join(", ")}` : ""}${v(verdictOf(rec, "modules", m.id))}`);
    }
    out.push("");
  }
  const tools = live(plan.stack);
  if (tools.length) {
    out.push("## Stack", "");
    for (const t of tools) out.push(`- **${t.tool}** as ${t.role} (${mark(t.status)})${t.why ? ` — ${t.why}` : ""}${src(t)}${v(verdictOf(rec, "stack", t.tool))}`);
    out.push("");
  }
  const stores = live(plan.stores ?? []);
  if (stores.length) {
    out.push("## Stores (shared resources, not processes)", "");
    for (const st of stores) {
      out.push(`- **${st.id}** (${st.kind}, ${mark(st.status)})${st.label ? ` — ${st.label}` : ""}; reached through ${st.reachedThrough.map((n) => `\`${n}\``).join(", ")}${st.serves ? `; serves: ${st.serves}` : ""}${src(st)}${v(verdictOf(rec, "stores", st.id))}`);
      for (const z of st.zones ?? []) out.push(`  - zone **${z.id}** holds ${z.holds.join(", ")}${z.writers?.length ? `; writers: ${z.writers.join(", ")}` : ""}${z.readers?.length ? `; readers: ${z.readers.join(", ")}` : ""}${z.routedBy ? `; routed by ${z.routedBy}` : ""}${v(verdictOf(rec, "stores", `${st.id}/${z.id}`))}`);
    }
    out.push("");
  }
  const princ = live(plan.principals ?? []);
  if (princ.length) {
    out.push("## Principals (who the access rules are about)", "");
    for (const pr of princ) {
      const runners = plan.processes.filter((p) => p.status !== "dropped" && p.runsAs === pr.id).map((p) => p.id);
      out.push(`- **${pr.id}** (${pr.kind}, ${mark(pr.status)})${pr.label ? ` — ${pr.label}` : ""}${runners.length ? `; ${runners.join(", ")} run${runners.length === 1 ? "s" : ""} as it` : ""}${v(verdictOf(rec, "principals", pr.id))}`);
    }
    out.push("");
  }
  if (rec?.writeMatrix?.length) {
    const zones = [...new Set(rec.writeMatrix.map((c) => c.zone))];
    const who = [...new Set(rec.writeMatrix.map((c) => c.principal))];
    out.push("## Who writes where (plan vs code)", "", "`allowed` = the plan lets it write; `writes` = the code writes it there; **VIOLATION** = it writes where it may not.", "",
      `| | ${zones.join(" | ")} |`, `|---|${zones.map(() => "---").join("|")}|`);
    for (const w of who) {
      out.push(`| **${w}** | ${zones.map((z) => {
        const c = rec.writeMatrix!.find((x) => x.principal === w && x.zone === z);
        if (!c) return "";
        return c.writes.length ? (c.allowed ? `allowed, writes (${c.writes.length})` : `**VIOLATION** (${c.writes[0]})`) : "allowed";
      }).join(" | ")} |`);
    }
    out.push("");
    for (const st of live(plan.stores ?? [])) for (const z of st.zones ?? []) {
      const f = verdictOf(rec, "stores", `${st.id}/${z.id}:writers`);
      if (f) out.push(`- ${st.id}/${z.id} writers — **${f.verdict}**: ${f.detail}`);
    }
    out.push("");
  }
  const flows = live(plan.flows ?? []);
  if (flows.length || rec?.indirectHops?.length) {
    out.push("## Flows through the stores", "");
    for (const f of flows) {
      out.push(`- **${f.id}** (${mark(f.status)})${f.serves ? ` — serves: ${f.serves}` : ""}${v(verdictOf(rec, "flows", f.id))}`);
      out.push(`  ${f.steps.map((st) => `${st.process} ${st.op} ${st.zone}${st.family ? ` (${st.family})` : ""}`).join(" → ")}`);
    }
    if (rec?.indirectHops?.length) {
      out.push("", "Indirect hops the code has (a write in one process, a watch or read of the same family in another):", "");
      for (const h of rec.indirectHops) out.push(`- ${h.from} → ${h.to} via ${h.store}${h.zone ? `/${h.zone}` : ""}${h.family ? ` (${h.family})` : ""} — writes at ${h.write}; reads at ${h.read}`);
    }
    out.push("");
  }
  const bounds = live(plan.boundaries);
  if (bounds.length) {
    const known = new Set([...plan.processes.map((p) => p.id), ...plan.stack.map((t) => t.tool), ...(plan.stores ?? []).map((x) => x.id)]);
    out.push("## Data boundaries", "");
    for (const b of bounds) {
      const outside = [b.from, b.to].filter((x) => !known.has(x));
      out.push(`- **${b.id}** ${b.from} → ${b.to}${b.zone ? `/${b.zone}` : ""}${b.protocol ? ` over ${b.protocol}` : ""}${b.carries?.length ? `, carrying ${b.carries.map((k) => `\`${k}\``).join(", ")}` : ""} (${mark(b.status)})${outside.length ? ` — ${outside.join(", ")} not in the plan (existing code?)` : ""}${src(b)}${v(verdictOf(rec, "boundaries", b.id))}`);
    }
    out.push("");
  }
  const threads = live(plan.threads);
  if (threads.length) {
    out.push("## Threads (primary steps only)", "");
    for (const t of threads) {
      out.push(`- **${t.id}** — ${t.entry}${t.process ? ` in ${t.process}` : ""} (${mark(t.status)}); serves: ${t.serves}${src(t)}${v(verdictOf(rec, "threads", t.id))}`);
      out.push(`  ${t.primary.join(" → ")}`);
    }
    out.push("");
  }
  const pols = live(plan.policies);
  if (pols.length) {
    out.push("## Planned rules (advice until promoted)", "");
    for (const p of pols) out.push(`- **${p.id}** (${mark(p.status)}${p.constraintId ? ` as ${p.constraintId}` : ""}) ${p.text} — *why:* ${p.why}${p.source ? ` — from ${p.source}` : ""}${p.check ? ` — checked: \`${JSON.stringify(p.check)}\`` : ""}${src(p)}${v(verdictOf(rec, "policies", p.id))}`);
    out.push("");
  }
  if (plan.open.length) {
    out.push("## Open questions (and assumptions)", "");
    for (const q of plan.open) {
      out.push(`- **${q.id}** ${q.text}${v(verdictOf(rec, "open", q.id))}`);
      for (const e of q.evidence ?? []) out.push(`  - evidence ${e.at.slice(0, 10)}: \`${e.command}\` — expect: ${e.expect}${e.result ? ` → **${e.result.toUpperCase()}**` : " (not run yet)"}${e.note ? ` — ${e.note}` : ""}`);
    }
    out.push("");
  }
  // 2026-10-05 — closed and dropped questions stay on the record.
  if (plan.resolved?.length) {
    out.push("## Closed and dropped questions", "");
    for (const q of [...plan.resolved].reverse()) out.push(`- **${q.id}** ${q.state} at rev ${q.rev} by ${q.by} (${q.at.slice(0, 10)})${q.note ? ` — ${q.note}` : ""}: ${q.text.split("\n")[0].slice(0, 200)}`);
    out.push("");
  }
  // 2026-10-06 — the decisions ledger (plan_decisions.ts), newest first
  if (plan.decisions?.length) {
    out.push("## Decisions", "");
    for (const d of [...plan.decisions].reverse().slice(0, 30)) {
      out.push(`- **${d.id}** ${d.status} (${d.by}, ${(d.decidedAt ?? d.at).slice(0, 10)})${d.from ? ` from ${d.from}` : ""}: ${d.said}`);
      for (const e of d.effects.slice(0, 6)) out.push(`  - ${String(e.op)} ${[e.section, e.id ?? (e.item as any)?.id].filter(Boolean).join(" ")}${e.why ? ` — ${String(e.why).slice(0, 160)}` : ""}`);
    }
    if (plan.decisions.length > 30) out.push(`- … ${plan.decisions.length - 30} earlier`);
    out.push("");
  }
  if (rec?.offObjective?.length) {
    out.push("## Possibly off the objective (a word-match guess)", "",
      "These say they serve something that shares no word with the objective. Words are not meaning — check each one, and drop it or say how it serves the objective.", "",
      ...rec.offObjective.map((o) => `- ${o.section} **${o.id}** — serves: "${o.serves}"`), "");
  }
  if (rec) {
    const counts = Object.entries(rec.counts).map(([k, n]) => `${n} ${k}`).join(", ");
    out.push("## Plan vs code", "", counts ? `${counts}.` : "Nothing to compare yet.", "", ...rec.limits.map((l) => `- ${l}`), "");
  }
  const gone = PLAN_ITEM_SECTIONS.flatMap((s) => sectionItems(plan, s).filter((i) => i.status === "dropped").map((i) => ({ s, i: i as any })));
  const superseded = gone.filter((g) => g.i.supersededBy);
  if (superseded.length) {
    out.push("## Superseded (on no map; kept for the record)", "", ...superseded.map((g) => `- ${g.s} **${planItemId(g.s, g.i)}** by ${g.i.supersededBy} — ${g.i.supersededWhy ?? ""}`), "");
  }
  const dropped = gone.filter((g) => !g.i.supersededBy).map((g) => `${g.s} ${planItemId(g.s, g.i)}`);
  if (dropped.length) out.push(`Dropped (kept for the record): ${dropped.join(", ")}.`, "");
  if (plan.changelog.length) {
    out.push("## Recent changes", "");
    for (const c of plan.changelog.slice(-8).reverse()) out.push(`- rev ${c.rev} (${c.by}): ${c.change}`);
    out.push("");
  }
  return out.join("\n");
}

const PLAN_ITEM_SECTIONS: PlanSection[] = ["processes", "boundaries", "stack", "threads", "policies", "stores", "principals", "flows", "modules"];

/** What a hooked session receives while a plan is open: the objective first,
 *  then the live items in a line each. Small by construction (the caps keep
 *  it under ~2 KB); the full page is `vibegraph-knowledge plan show`. */
export function compactPlan(plan: Plan, sinceRevision?: number): string {
  const lines: string[] = [];
  const head = sinceRevision !== undefined
    ? `## The plan changed (rev ${sinceRevision} → ${plan.revision}) — ${PLAN_BANNER}`
    : `## Plan in progress (rev ${plan.revision}) — ${PLAN_BANNER}`;
  lines.push(head, `Objective: ${plan.objective}`);
  if (sinceRevision !== undefined) {
    const recent = plan.changelog.filter((c) => c.rev > sinceRevision).map((c) => `${c.change} (${c.by})`);
    if (recent.length) lines.push(`Changed: ${recent.slice(-8).join("; ")}`);
  }
  const tag = (s: string) => (s === "agreed" || s === "promoted" ? "" : "?");
  const procs = live(plan.processes);
  if (procs.length) lines.push(`Processes: ${procs.map((p) => `${p.id}${tag(p.status)} (${p.kind}${p.at ? ` at ${p.at}` : ""}${p.runsAs ? `, runs as ${p.runsAs}` : ""}${p.uses?.length ? `, uses ${p.uses.join("+")}` : ""})`).join(", ")}`);
  const mods = live(plan.modules ?? []);
  if (mods.length) lines.push(`Modules: ${mods.map((m) => `${m.id}${tag(m.status)} (${m.kind} at ${m.at})`).join(", ")}`);
  const princ = live(plan.principals ?? []);
  if (princ.length) lines.push(`Principals: ${princ.map((p) => `${p.id}${tag(p.status)} (${p.kind})`).join(", ")}`);
  const tools = live(plan.stack);
  if (tools.length) lines.push(`Stack: ${tools.map((t) => `${t.tool}${tag(t.status)} (${t.role})`).join(", ")}`);
  const stores = live(plan.stores ?? []);
  if (stores.length) lines.push(`Stores (shared resources, not processes): ${stores.map((x) => `${x.id}${tag(x.status)} (${x.kind} via ${x.reachedThrough.join(", ")}${x.zones?.length ? `; zones ${x.zones.map((z) => `${z.id}[${z.holds.join(",")}]${z.writers?.length ? ` w:${z.writers.join(",")}` : ""}`).join(" ")}` : ""})`).join("; ")}`);
  const bounds = live(plan.boundaries);
  if (bounds.length) lines.push(`Boundaries: ${bounds.map((b) => `${b.id}${tag(b.status)} ${b.from}→${b.to}${b.zone ? `/${b.zone}` : ""}${b.protocol ? ` ${b.protocol}` : ""}${b.carries?.length ? ` {${b.carries.join(",")}}` : ""}`).join("; ")}`);
  for (const t of live(plan.threads)) lines.push(`Thread ${t.id}${tag(t.status)}: ${t.primary.join(" → ")}`);
  for (const f of live(plan.flows ?? [])) lines.push(`Flow ${f.id}${tag(f.status)} (through the store): ${f.steps.map((st) => `${st.process} ${st.op} ${st.zone}${st.family ? `(${st.family})` : ""}`).join(" → ")}`);
  const pols = live(plan.policies);
  if (pols.length) lines.push(`Planned rules (advice — they block nothing until promoted): ${pols.map((p) => `${p.id}${tag(p.status)} ${p.text} (why: ${p.why})`).join("; ")}`);
  if (plan.open.length) lines.push(`Open questions: ${plan.open.map((q) => `${q.id} ${q.text}${q.evidence?.some((e) => e.result) ? ` [${assumptionState(q).toUpperCase()}]` : ""}`).join("; ")}`);
  const assumed = [...new Set(([] as Array<{ assumes?: string[] }>).concat(plan.processes, plan.boundaries, plan.stack, plan.threads, plan.policies, plan.stores ?? [], plan.flows ?? [], plan.modules ?? []).flatMap((x) => x.assumes ?? []))];
  const refuted = assumed.filter((q) => assumptionState(plan.open.find((x) => x.id === q)) === "refuted");
  const pending = (plan.decisions ?? []).filter((d) => d.status === "proposed");
  if (pending.length) lines.push(`Decisions waiting for a person: ${pending.map((d) => `${d.id} ${d.said}`).join("; ")}`);
  const superseded = PLAN_ITEM_SECTIONS.flatMap((s) => sectionItems(plan, s).filter((i: any) => i.supersededBy).map((i: any) => `${planItemId(s, i)}`));
  if (superseded.length) lines.push(`Superseded — do not build: ${superseded.join(", ")}`);
  if (refuted.length) lines.push(`REFUTED assumptions (items resting on them are built on something false): ${refuted.join(", ")}`);
  lines.push("`?` = proposed, not yet agreed. Keep work on the objective; propose plan changes with the vibegraph_plan_edit tool or `vibegraph-knowledge plan edit` (a person agrees). Full page: `vibegraph-knowledge plan show`.");
  return lines.join("\n");
}
