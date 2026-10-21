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

import type { Plan, PlanActor, PlanSection } from "../shared/plan_types.ts";
import { PLAN_CAPS, PLAN_SECTIONS } from "../shared/plan_types.ts";
import type { SoftwareSpec } from "../shared/software_types.ts";
import { normalizeForCite } from "./software_draft.ts";
import { compactPlan } from "./plan_render.ts";
import { specHeadlines } from "./software_apply.ts";
import { STACK_ROLES } from "../shared/stack_taxonomy.ts";
import { applyPlanOps, type PlanOp } from "./plan_ops.ts";
import { jsonInReply } from "./json_reply.ts";

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
  const r = jsonInReply(text, "array");
  return r.error ? { error: r.error === "the reply's JSON is not an array" ? "the reply is not a JSON array of operations" : r.error } : { ops: r.value };
}

/** Apply a gated draft item by item (2026-10-20, live run: one principle the
 *  plan's validator refused — `check: null`, then a two-sentence text —
 *  refused the WHOLE draft, "nothing written", and the session paid for four
 *  drafts to land one). An item the plan refuses is dropped with its reason;
 *  the rest land together in one revision. */
export function applyDraftOps(plan: Plan, ops: PlanOp[], by: PlanActor, now: Date = new Date()): { plan?: Plan; applied: PlanOp[]; refused: string[] } {
  const applied: PlanOp[] = [];
  const refused: string[] = [];
  let trial = plan;
  for (const op of ops) {
    const r = applyPlanOps(trial, [op], by, now);
    if (r.error || !r.plan) {
      // name the item by what it says ("add policies undefined: …" named nothing)
      const it = (op as { section?: string; item?: Record<string, unknown> });
      const said = String(it.item?.text ?? it.item?.id ?? it.item?.tool ?? "").slice(0, 70);
      refused.push(`${it.section ?? op.op}${said ? ` "${said}${said.length >= 70 ? "…" : ""}"` : ""}: ${(r.error ?? "refused").replace(/^\w+ \w+ [^:]*: /, "")}`);
      continue;
    }
    applied.push(op);
    trial = r.plan;
  }
  if (!applied.length) return { applied, refused };
  const all = applyPlanOps(plan, applied, by, now);
  return { plan: all.plan ?? trial, applied, refused };
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
    // `null` on an optional field means "none" (a model writes `"check": null`
    // for a principle nothing can check; the validator wants it absent)
    const { cite, status: _s, ...item } = Object.fromEntries(Object.entries(o.item as Record<string, unknown>).filter(([, v]) => v !== null)) as Record<string, unknown>;
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
