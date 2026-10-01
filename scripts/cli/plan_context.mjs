// The PLAN in a hooked session (2026-09-30). While `.vibegraph/plan.json`
// exists and is not closed, the prompt hook sends its compact form ONCE per
// session — the objective first, a line per section — and afterwards only
// when the plan's revision moves, as what changed. On every OTHER prompt it
// sends one line, the objective and where the plan stands (~60 tokens): deep
// in a long session the full plan has scrolled far back, and the objective is
// the one thing that must not. A compaction resets the record
// (resetDelivery), so the full plan is sent again. Nothing is sent for a
// closed plan, and a plan never blocks anything: its rules are advice until
// promoted.
import { loadPlan } from "../../src/server/plan_store.ts";
import { compactPlan } from "../../src/server/plan_render.ts";
import { matchThreadEntry, words } from "../../src/server/plan_thread_match.ts";
import { planAffected } from "../../src/server/plan_affected.ts";
import { headText } from "./head_text.mjs";

/** 2026-10-01 — GREENFIELD routing: a prompt that names a planned thread the
 *  code does not have yet gets THAT thread's plan — what it serves, where it
 *  will live, its primary steps with the boundaries they cross, the rules and
 *  open questions about it — instead of a keyword guess at existing code.
 *  Matched on the thread's id in the prompt, or two distinctive words shared
 *  with its id, `serves` and steps. Once per thread per session. Returns
 *  { block, ids } (block null when nothing matched). */
export function plannedThreadsForPrompt(absRoot, env, prompt, state) {
  let plan;
  try { plan = loadPlan(absRoot); } catch { return { block: null, ids: [] }; }
  if (!plan || plan.closed) return { block: null, ids: [] };
  const text = String(prompt).toLowerCase();
  const said = new Set(words(prompt));
  const unbuilt = plan.threads.filter((t) => t.status !== "dropped" && !matchThreadEntry(t, env.entryPoints).ep);
  const scored = unbuilt.map((t) => {
    const own = new Set([...words(t.id), ...words(t.serves ?? ""), ...t.primary.flatMap((s) => words(s.split(":").pop() ?? s))]);
    const shared = [...own].filter((w) => said.has(w));
    return { t, score: (text.includes(t.id.toLowerCase()) ? 10 : 0) + shared.length };
  }).filter((x) => x.score >= 2).sort((a, b) => b.score - a.score).slice(0, 2);
  const ids = scored.map((x) => x.t.id);
  const fresh = scored.filter((x) => !(state.plannedThreadsSent ?? []).includes(x.t.id));
  if (!fresh.length) return { block: null, ids };
  state.plannedThreadsSent = [...new Set([...(state.plannedThreadsSent ?? []), ...fresh.map((x) => x.t.id)])];
  const blocks = fresh.map(({ t }) => {
    const proc = t.process ? plan.processes.find((p) => p.id === t.process) : null;
    const step = (s) => {
      const b = plan.boundaries.find((x) => x.id === s.split(":")[0]);
      return b ? `${s} [${b.from} → ${b.to}${b.protocol ? ` over ${b.protocol}` : ""}${b.carries?.length ? `, carries ${b.carries.join(", ")}` : ""}]` : s;
    };
    const near = new Set([t.id, ...(t.process ? [t.process] : [])]);
    const rules = plan.policies.filter((p) => p.status !== "dropped" && p.about && near.has(p.about));
    const open = plan.open.filter((q) => q.about && near.has(q.about));
    return [
      `### Planned thread "${t.id}" — NOT BUILT YET (from .vibegraph/plan.json: a plan, not code)`,
      `serves: ${t.serves}`,
      `entry: ${t.entry}${proc ? `; process ${proc.label}${proc.at ? ` (code to live at ${proc.at})` : ""}` : ""}`,
      `primary steps: ${t.primary.map(step).join(" → ")}`,
      ...(rules.length ? [`planned rules about it: ${rules.map((p) => `${p.id} ${p.text} — why: ${p.why}`).join("; ")}`] : []),
      ...(open.length ? [`open questions it depends on: ${open.map((q) => `${q.id} ${q.text}`).join("; ")}`] : []),
      `When it is built, set its \`entryPoint\` (plan edit) so plan check follows it.`,
    ].join("\n");
  });
  return { block: blocks.join("\n\n"), ids };
}

/** The one line: the objective, and what is waiting on the person. */
export function objectiveReminder(plan) {
  const sections = ["processes", "boundaries", "stack", "threads", "policies"];
  const proposed = sections.reduce((n, s) => n + plan[s].filter((i) => i.status === "proposed").length, 0);
  const waiting = [
    proposed ? `${proposed} item${proposed === 1 ? "" : "s"} proposed` : "",
    plan.open.length ? `${plan.open.length} open question${plan.open.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(", ");
  return `Plan objective (rev ${plan.revision}${waiting ? `; ${waiting}` : ""}): ${plan.objective} — keep this work on it.`;
}

/** The block to add to this prompt, or null. Updates `state.planRev`. */
export function planForPrompt(absRoot, state) {
  let plan;
  try { plan = loadPlan(absRoot); } catch { return null; }
  if (!plan || plan.closed) return null;
  const sent = state.planRev;
  if (sent === plan.revision) return objectiveReminder(plan);
  state.planRev = plan.revision;
  return compactPlan(plan, sent === undefined ? undefined : sent);
}

/** 2026-10-01 — after an edit: a function the plan NAMES that this edit made
 *  disappear (defined in the edited file at HEAD, nowhere now) — said once per
 *  name per session, with the op that renames it in the plan. Null when the
 *  plan is closed, absent, or nothing it names is gone. */
export function planAffectedNote(absRoot, env, files, state) {
  let plan;
  try { plan = loadPlan(absRoot); } catch { return null; }
  if (!plan || plan.closed || !files?.length) return null;
  const { gone } = planAffected(plan, env.files, files, (f) => headText(absRoot, f));
  const sent = new Set(state.planGoneSent ?? []);
  const fresh = gone.filter((g) => !sent.has(`${g.name}@${g.where}`));
  if (!fresh.length) return null;
  state.planGoneSent = [...sent, ...fresh.map((g) => `${g.name}@${g.where}`)];
  return `The plan names ${fresh.map((g) => `\`${g.name}\` (${g.where})`).join(", ")}, which this edit removed from ${[...new Set(fresh.map((g) => g.file))].join(", ")} — nothing defines it now. If it was renamed, rename it in the plan too: vibegraph-knowledge plan edit '{"op":"rename-symbol","from":"${fresh[0].name}","to":"<new name>"}' (from Claude Code it is recorded as a proposal).`;
}
