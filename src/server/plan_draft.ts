// DRAFTING a plan from documents (2026-09-30): the objective, the plan so far,
// every RATIFIED software spec, and the documents a person hands over go to a
// model once; it answers with plan operations, each item quoting what it came
// from. The same citation gate as a software spec: a quote not in the sources
// drops the item; no quote keeps it with `groundedIn: null` (INFERRED). Every
// item lands PROPOSED (applied as an agent). Pure: the CLI spends the tokens.
//
// 2026-10-06 (direction review M2) — a DIRECTION draft also may answer
// {"op":"objective","text","cite"} (it becomes the "Proposed objective: …"
// question a person adopts) and {"op":"name","id","label","cite"} (a name for
// an observed process). Both pass the same quote check.

import type { Plan, PlanSection } from "../shared/plan_types.ts";
import { PLAN_CAPS, PLAN_SECTIONS } from "../shared/plan_types.ts";
import type { SoftwareSpec } from "../shared/software_types.ts";
import { normalizeForCite } from "./software_draft.ts";
import { compactPlan } from "./plan_render.ts";
import { specHeadlines } from "./software_apply.ts";
import { STACK_ROLES } from "../shared/stack_taxonomy.ts";
import type { PlanOp } from "./plan_ops.ts";

const MAX_OPS = 40;
const BUDGET = 50_000;

export function buildPlanDraftPrompt(plan: Plan, specs: SoftwareSpec[], docs: Array<{ ref: string; text: string }>, hint?: string): string {
  let room = BUDGET;
  const body = docs.map((d, i) => {
    const t = d.text.length > room ? `${d.text.slice(0, Math.max(0, room))}\n[… cut for length]` : d.text;
    room -= t.length;
    return `=== DOCUMENT ${i + 1}: ${d.ref} ===\n${t}`;
  }).join("\n\n");
  return [
    "You are drafting a HYPOTHETICAL plan for a project that does not exist yet (or a feature not built yet). Keep it MINIMAL and on its objective.",
    `Objective: ${plan.objective}`,
    "",
    "The plan so far:", compactPlan(plan),
    ...(specs.length ? ["", "Ratified software specs — build WITH these tools, using their operations and keeping their rules:", ...specs.map((s) => specHeadlines(s))] : []),
    "",
    "Answer with ONE JSON array of operations, nothing else. Each is {\"op\":\"add\",\"section\":…,\"item\":{…,\"cite\":\"…\"}}.",
    `Sections and item fields: processes {id, kind: frontend|backend|db|cache|external_http|library, label, serves, at}; stack {tool, role: ${STACK_ROLES.filter((r) => r !== "unknown").join("|")}, why}; boundaries {from, to, protocol, carries: [key names]}; threads {id ("POST /x", a function name), entry (route|cli|script|page|tool|test), process, serves, primary: [≤ ${PLAN_CAPS.primarySteps} primary steps; "b1:insert" names the boundary a step crosses]}; policies {text, why, check (constraint grammar, or omit)}; open {text}.`,
    "Every item carries `cite`: an EXACT quote (12–300 characters) copied from a document or from a spec's quotes above. Use `cite: null` for an item you infer — it will be labelled INFERRED. A quote that is not in them gets the item dropped.",
    `Every process and thread says which part of the objective it \`serves\`. Caps: ${PLAN_CAPS.processes} processes, ${PLAN_CAPS.threads} threads, ${PLAN_CAPS.policies} rules — fewer is better. Do not repeat what the plan already has.`,
    ...(hint ? [`The person adds: ${hint}`] : []),
    "",
    body,
  ].join("\n");
}

export function parsePlanDraftReply(text: string): { ops?: unknown[]; error?: string } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const raw = fenced ?? text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  if (!raw.trim()) return { error: "the reply holds no JSON array" };
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? { ops: v } : { error: "the reply is not a JSON array of operations" };
  } catch (e: any) { return { error: `the reply's JSON does not parse: ${e.message}` }; }
}

/** The gate: verified quotes become `groundedIn`; fabricated ones drop the op. */
export function gatePlanDraft(rawOps: unknown[], sourceTexts: string[]): { ops: PlanOp[]; dropped: string[]; inferred: string[] } {
  const hay = normalizeForCite(sourceTexts.join("\n\n"));
  const ops: PlanOp[] = [];
  const dropped: string[] = [];
  const inferred: string[] = [];
  for (const raw of rawOps.slice(0, MAX_OPS)) {
    const o = raw as { op?: string; section?: string; item?: Record<string, unknown>; text?: unknown; id?: unknown; label?: unknown; cite?: unknown };
    if (o?.op === "objective" || o?.op === "name") {
      const text = String(o.op === "objective" ? o.text ?? "" : o.label ?? "").trim();
      const where = o.op === "objective" ? "the objective" : `a name for ${String(o.id)}`;
      if (!text || text.includes("\n") || text.length > (o.op === "objective" ? PLAN_CAPS.objective : 80) || (o.op === "name" && typeof o.id !== "string")) { dropped.push(`${where} — not one usable line`); continue; }
      let cited: string | null = null;
      if (typeof o.cite === "string" && o.cite.trim()) {
        const n = normalizeForCite(o.cite);
        if (n.length < 12 || !hay.includes(n)) { dropped.push(`${where} — its quote is not in the documents ("${o.cite.slice(0, 80)}")`); continue; }
        cited = o.cite.trim().slice(0, 200);
      } else inferred.push(where);
      if (o.op === "objective") ops.push({ op: "add", section: "open", item: { text: `Proposed objective: ${text}${cited ? ` (cited: "${cited}")` : " (INFERRED — no quote)"}`.slice(0, PLAN_CAPS.question) } });
      else ops.push({ op: "update", section: "processes", id: String(o.id), fields: { label: text, groundedIn: cited } });
      continue;
    }
    if (o?.op !== "add" || !PLAN_SECTIONS.includes(o.section as PlanSection) || !o.item || typeof o.item !== "object") { dropped.push(`not an add operation: ${JSON.stringify(raw).slice(0, 80)}`); continue; }
    const { cite, status: _s, ...item } = o.item as Record<string, unknown>;
    const name = String(item.id ?? item.tool ?? item.text ?? "?").slice(0, 60);
    const where = `${o.section} ${name}`;
    let groundedIn: string | null = null;
    if (typeof cite === "string" && cite.trim()) {
      const n = normalizeForCite(cite);
      if (n.length < 12 || !hay.includes(n)) { dropped.push(`${where} — its quote is not in the documents ("${cite.slice(0, 80)}")`); continue; }
      groundedIn = cite.trim().slice(0, 400);
    } else if (o.section !== "open") inferred.push(where); // a question claims nothing
    ops.push({ op: "add", section: o.section as PlanSection, item: o.section === "open" ? item : { ...item, groundedIn } });
  }
  return { ops, dropped, inferred };
}
