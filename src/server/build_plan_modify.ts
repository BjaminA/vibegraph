// M-GF3.4 — stage revision: parse the dialogue's ```vg-revise-stage block,
// validate it against the plan, and apply it immutably.
//
// The per-stage dialogue (StageDetailDialog → handleStageChat) lets the
// agent PROPOSE a revision; nothing lands until the human applies it, and
// an applied revision goes through the same validateBuildPlan boundary the
// original draft did (foundation-first needs stay structural, never
// advisory). Affordance-must-match: "Apply" genuinely rewrites the stage
// or honestly refuses — there is no silent partial apply.

import type { BuildPlan, BuildPlanItem } from "../shared/protocol";
// Runtime import carries the .ts extension: node --experimental-strip-types
// (the unit-test runner) resolves ESM literally (same as the draft modules).
import { validateBuildPlan } from "./build_plan.ts";

export interface StageRevision {
  capability?: string;
  needs?: string[];
}

// The fenced block the stage-dialogue prompt asks for. Take the LAST match:
// the agent may quote the protocol itself while explaining it.
const FENCE_RE = /```vg-revise-stage\s*\n([\s\S]*?)```/g;

export function parseReviseStageBlock(turnText: string): StageRevision | null {
  let match: RegExpExecArray | null = null;
  for (let m = FENCE_RE.exec(turnText); m; m = FENCE_RE.exec(turnText)) match = m;
  FENCE_RE.lastIndex = 0;
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  const rev: StageRevision = {};
  if (p.capability !== undefined) {
    if (typeof p.capability !== "string" || p.capability.trim().length === 0) return null;
    rev.capability = p.capability.trim();
  }
  if (p.needs !== undefined) {
    if (!Array.isArray(p.needs) || p.needs.some((n) => typeof n !== "string")) return null;
    rev.needs = [...new Set(p.needs as string[])];
  }
  if (rev.capability === undefined && rev.needs === undefined) return null;
  return rev;
}

export type ApplyResult =
  | { ok: true; plan: BuildPlan; item: BuildPlanItem }
  | { ok: false; error: string };

// Statuses a revision may touch. `built` code exists on disk — revising the
// label would lie about what was built; `drafting`/`gated` have an increment
// in flight drafted from the OLD text — reject/retry that first.
const REVISABLE = new Set(["pending", "failed", "skipped"]);

export function applyItemRevision(plan: BuildPlan, itemId: string, rev: StageRevision): ApplyResult {
  const idx = plan.items.findIndex((i) => i.id === itemId);
  if (idx === -1) return { ok: false, error: `no roadmap stage with id "${itemId}"` };
  const current = plan.items[idx];
  if (!REVISABLE.has(current.status)) {
    return {
      ok: false,
      error:
        current.status === "built"
          ? `stage "${itemId}" is already built — its code exists; revise a later stage instead`
          : `stage "${itemId}" is ${current.status} — resolve the in-flight increment (reject/retry) before revising`,
    };
  }
  const next: BuildPlan = structuredClone(plan);
  const item = next.items[idx];
  if (rev.capability !== undefined) item.capability = rev.capability;
  if (rev.needs !== undefined) item.needs = rev.needs;
  // groundedIn stays: the quote names the stage's ORIGIN in the description;
  // a user-directed refinement doesn't erase where it came from. A revised
  // failed/skipped stage re-queues (pending, verdict cleared): the failure
  // was against text that no longer exists, so Resume run must genuinely
  // pick the stage up again — the live gap: revise-then-Resume did nothing
  // because the stage stayed failed and nextBuildableItem only walks pending.
  if (item.status === "failed" || item.status === "skipped") {
    item.status = "pending";
    delete item.failReason;
  }
  const err = validateBuildPlan(next);
  if (err) return { ok: false, error: err };
  return { ok: true, plan: next, item };
}
