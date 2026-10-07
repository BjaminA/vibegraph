// THE PROPOSAL BACKLOG (2026-10-01). Agents propose; a person agrees — and
// proposals pile up: a dozen items nobody has looked at, each one a line in a
// panel. `plan review` is one page: every pending proposal grouped by section,
// with WHAT it would change (a new item in full; a change to an agreed item as
// a field-by-field diff against the version a person agreed to), the EVIDENCE
// for it (the plan-vs-code finding, the quote it came from, its evidence
// runs), and the one command that decides it. The rule changes agents
// propose to stated constraints are listed beside them.

import type { Plan, PlanReconcile, PlanSection } from "../shared/plan_types.ts";
import { planItemId, sectionItems } from "../shared/plan_types.ts";

const SECTIONS: PlanSection[] = ["processes", "modules", "stores", "principals", "stack", "boundaries", "threads", "flows", "policies"];

export interface PendingProposal {
  section: PlanSection;
  id: string;
  kind: "new" | "change";
  /** a change: the fields that differ from the agreed version */
  diff: Array<{ field: string; from: unknown; to: unknown }>;
  /** a new item: the item as proposed */
  item?: Record<string, unknown>;
  /** what plan check says about it, the quote it came from, its evidence */
  evidence: string[];
}

export interface Backlog {
  proposals: PendingProposal[];
  /** open questions an agent raised as a new objective */
  objective: Array<{ id: string; text: string }>;
  /** constraint changes agents proposed (constraints.json) */
  constraintProposals: Array<{ constraint: string; id: string; why: string; by: string }>;
}

const SKIP = new Set(["status", "agreedAs"]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function planBacklog(plan: Plan, rec?: PlanReconcile | null, constraints: Array<{ id: string; proposals?: Array<{ id: string; why: string; by?: string; status?: string }> }> = []): Backlog {
  const proposals: PendingProposal[] = [];
  for (const section of SECTIONS) {
    for (const it of sectionItems(plan, section)) {
      if (it.status !== "proposed") continue;
      const id = planItemId(section, it);
      const f = rec?.findings.find((x) => x.section === section && x.id === id);
      const evidence = [
        ...(f ? [`plan check: ${f.verdict} — ${f.detail}`] : []),
        ...(typeof it.groundedIn === "string" ? [`from the documents: “${it.groundedIn}”`] : it.groundedIn === null ? ["inferred — not in the documents"] : []),
        ...((it.evidence ?? []) as Array<{ command: string; expect: string; at: string; result?: string }>).map((e) => `evidence ${e.at.slice(0, 10)}: \`${e.command}\` expect ${e.expect}${e.result ? ` → ${e.result}` : " (not run)"}`),
        ...plan.changelog.filter((c) => c.change.includes(` ${id}`) && c.by === "agent").slice(-2).map((c) => `rev ${c.rev} (agent): ${c.change}`),
      ];
      if (it.agreedAs) {
        const keys = new Set([...Object.keys(it), ...Object.keys(it.agreedAs)].filter((k) => !SKIP.has(k)));
        const diff = [...keys].filter((k) => !same(it[k], it.agreedAs[k])).map((k) => ({ field: k, from: it.agreedAs[k], to: it[k] }));
        proposals.push({ section, id, kind: "change", diff, evidence });
      } else {
        const { status: _s, ...item } = it;
        proposals.push({ section, id, kind: "new", diff: [], item, evidence });
      }
    }
  }
  const objective = plan.open.filter((q) => q.text.startsWith("Proposed objective:")).map((q) => ({ id: q.id, text: q.text }));
  const constraintProposals = constraints.flatMap((c) => (c.proposals ?? []).filter((p) => !p.status || p.status === "open").map((p) => ({ constraint: c.id, id: p.id, why: p.why, by: p.by ?? "agent" })));
  return { proposals, objective, constraintProposals };
}

export function backlogCount(b: Backlog): number {
  return b.proposals.length + b.objective.length + b.constraintProposals.length;
}

const show = (v: unknown) => (v === undefined ? "(absent)" : JSON.stringify(v));

export function formatBacklog(b: Backlog): string {
  const n = backlogCount(b);
  if (!n) return "Nothing awaits review: no proposed plan item, no proposed objective, no proposed rule change.";
  const out: string[] = [`# Review — ${n} proposal${n === 1 ? "" : "s"} await a person`, "",
    "Decide each with one command, or several at once: `vibegraph-knowledge plan review --agree <section:id,…> --reject <section:id,…>`.",
    "Rejecting a CHANGE to an agreed item restores the agreed version; rejecting a NEW item drops it.", ""];
  let section = "";
  for (const p of b.proposals) {
    if (p.section !== section) { section = p.section; out.push(`## ${section}`, ""); }
    out.push(`### ${p.section}:${p.id} — ${p.kind === "new" ? "NEW" : "CHANGE to an agreed item"}`);
    if (p.kind === "change") for (const d of p.diff) out.push(`- \`${d.field}\`: ${show(d.from)} → ${show(d.to)}`);
    else out.push(`- ${show(p.item)}`);
    for (const e of p.evidence) out.push(`- ${e}`);
    out.push(`- decide: \`plan agree ${p.section} ${p.id}\` · \`plan edit '{"op":"reject","section":"${p.section}","id":"${p.id}"}'\``, "");
  }
  if (b.objective.length) {
    out.push("## Proposed objective", "");
    for (const q of b.objective) out.push(`- ${q.id}: ${q.text.slice("Proposed objective:".length).trim()} — adopt: \`plan edit '{"op":"set-objective","text":"…"}'\`, then drop ${q.id}`);
    out.push("");
  }
  if (b.constraintProposals.length) {
    out.push("## Proposed changes to stated rules (constraints.json)", "");
    for (const c of b.constraintProposals) out.push(`- ${c.constraint} ${c.id} (by ${c.by}): ${c.why} — \`constraint show ${c.constraint}\`, then \`constraint accept|reject ${c.constraint} ${c.id}\``);
    out.push("");
  }
  return out.join("\n");
}

/** `--agree a:b,c:d --reject e:f` → plan ops, refusing what is not pending. */
export function reviewOps(b: Backlog, agree: string[], reject: string[]): { ops: Array<{ op: "agree" | "reject"; section: PlanSection; id: string }>; error?: string } {
  const pending = new Map(b.proposals.map((p) => [`${p.section}:${p.id}`, p]));
  const ops: Array<{ op: "agree" | "reject"; section: PlanSection; id: string }> = [];
  // 2026-10-07 — `all` and `<section>:*` stand for every pending proposal (in
  // that section); what the OTHER list names explicitly is left to it
  const named = new Set([...agree, ...reject].filter((k) => k !== "all" && !k.endsWith(":*")));
  const expand = (keys: string[]) => keys.flatMap((k) =>
    k === "all" ? [...pending.keys()].filter((x) => !named.has(x))
      : k.endsWith(":*") ? [...pending.keys()].filter((x) => x.startsWith(k.slice(0, -1)) && !named.has(x))
        : [k]);
  if (agree.includes("all") && reject.includes("all")) return { ops: [], error: "agree all and reject all at once" };
  for (const [op, keys] of [["agree", expand(agree)], ["reject", expand(reject)]] as const) {
    for (const k of keys) {
      const p = pending.get(k);
      if (!p) return { ops: [], error: `${k} is not a pending proposal (see \`plan review\`)` };
      ops.push({ op, section: p.section, id: p.id });
    }
  }
  return { ops };
}
