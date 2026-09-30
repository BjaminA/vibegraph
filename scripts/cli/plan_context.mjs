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
