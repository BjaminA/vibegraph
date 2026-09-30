// THE PLAN, rendered (2026-09-30): `plan.md` (the page a person or an agent
// reads, objective first) and the compact form the prompt hook sends. Both
// say, before anything else, that this is a PLAN and not the code.

import type { Plan, PlanFinding, PlanReconcile, PlanSection } from "../shared/plan_types.ts";
import { planItemId } from "../shared/plan_types.ts";

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
    for (const p of procs) out.push(`- **${p.id}** (${p.kind}, ${mark(p.status)})${p.label !== p.id ? ` — ${p.label}` : ""}${p.serves ? `; serves: ${p.serves}` : ""}${p.at ? `; code at \`${p.at}\`` : ""}${src(p)}${v(verdictOf(rec, "processes", p.id))}`);
    out.push("");
  }
  const tools = live(plan.stack);
  if (tools.length) {
    out.push("## Stack", "");
    for (const t of tools) out.push(`- **${t.tool}** as ${t.role} (${mark(t.status)})${t.why ? ` — ${t.why}` : ""}${src(t)}${v(verdictOf(rec, "stack", t.tool))}`);
    out.push("");
  }
  const bounds = live(plan.boundaries);
  if (bounds.length) {
    const known = new Set([...plan.processes.map((p) => p.id), ...plan.stack.map((t) => t.tool)]);
    out.push("## Data boundaries", "");
    for (const b of bounds) {
      const outside = [b.from, b.to].filter((x) => !known.has(x));
      out.push(`- **${b.id}** ${b.from} → ${b.to}${b.protocol ? ` over ${b.protocol}` : ""}${b.carries?.length ? `, carrying ${b.carries.map((k) => `\`${k}\``).join(", ")}` : ""} (${mark(b.status)})${outside.length ? ` — ${outside.join(", ")} not in the plan (existing code?)` : ""}${src(b)}${v(verdictOf(rec, "boundaries", b.id))}`);
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
    out.push("## Open questions", "");
    for (const q of plan.open) out.push(`- **${q.id}** ${q.text}`);
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
  const dropped = PLAN_ITEM_SECTIONS.flatMap((s) => (plan[s] as any[]).filter((i) => i.status === "dropped").map((i) => `${s} ${planItemId(s, i)}`));
  if (dropped.length) out.push(`Dropped (kept for the record): ${dropped.join(", ")}.`, "");
  if (plan.changelog.length) {
    out.push("## Recent changes", "");
    for (const c of plan.changelog.slice(-8).reverse()) out.push(`- rev ${c.rev} (${c.by}): ${c.change}`);
    out.push("");
  }
  return out.join("\n");
}

const PLAN_ITEM_SECTIONS: PlanSection[] = ["processes", "boundaries", "stack", "threads", "policies"];

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
  if (procs.length) lines.push(`Processes: ${procs.map((p) => `${p.id}${tag(p.status)} (${p.kind}${p.at ? ` at ${p.at}` : ""})`).join(", ")}`);
  const tools = live(plan.stack);
  if (tools.length) lines.push(`Stack: ${tools.map((t) => `${t.tool}${tag(t.status)} (${t.role})`).join(", ")}`);
  const bounds = live(plan.boundaries);
  if (bounds.length) lines.push(`Boundaries: ${bounds.map((b) => `${b.id}${tag(b.status)} ${b.from}→${b.to}${b.protocol ? ` ${b.protocol}` : ""}${b.carries?.length ? ` {${b.carries.join(",")}}` : ""}`).join("; ")}`);
  for (const t of live(plan.threads)) lines.push(`Thread ${t.id}${tag(t.status)}: ${t.primary.join(" → ")}`);
  const pols = live(plan.policies);
  if (pols.length) lines.push(`Planned rules (advice — they block nothing until promoted): ${pols.map((p) => `${p.id}${tag(p.status)} ${p.text} (why: ${p.why})`).join("; ")}`);
  if (plan.open.length) lines.push(`Open questions: ${plan.open.map((q) => `${q.id} ${q.text}`).join("; ")}`);
  lines.push("`?` = proposed, not yet agreed. Keep work on the objective; propose plan changes with the vibegraph_plan_edit tool or `vibegraph-knowledge plan edit` (a person agrees). Full page: `vibegraph-knowledge plan show`.");
  return lines.join("\n");
}
