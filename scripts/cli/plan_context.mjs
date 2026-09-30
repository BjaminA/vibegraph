// The PLAN in a hooked session (2026-09-30). While `.vibegraph/plan.json`
// exists and is not closed, the prompt hook sends its compact form ONCE per
// session — the objective first, a line per section — and afterwards only
// when the plan's revision moves, as what changed. A compaction resets the
// record (resetDelivery), so it is sent again. Nothing is sent for a closed
// plan, and a plan never blocks anything: its rules are advice until promoted.
import { loadPlan } from "../../src/server/plan_store.ts";
import { compactPlan } from "../../src/server/plan_render.ts";

/** The block to add to this prompt, or null. Updates `state.planRev`. */
export function planForPrompt(absRoot, state) {
  let plan;
  try { plan = loadPlan(absRoot); } catch { return null; }
  if (!plan || plan.closed) return null;
  const sent = state.planRev;
  if (sent === plan.revision) return null;
  state.planRev = plan.revision;
  return compactPlan(plan, sent === undefined ? undefined : sent);
}
