// BOXES THE PLAN SPLITS (2026-10-12, field review: "the partner exchange and
// the admin tools still sit in the shared scripts box" though the agreed plan
// names each as its own process). The derived map clusters entry points by
// framework family under a package; a person who AGREED a plan process with
// `entryPoints` has said which of them run as one process.
// Where a derived box holds entry points of more than one agreed process (or
// of one and of none), or one agreed process's entries sit in several boxes,
// that process's entries move to a box of their own, `cluster:plan:<id>`,
// labelled as the plan names it. A box the plan does not divide keeps its id,
// so stored names and groups still find it.
//
// Only an entry point the plan LISTS moves. A process placed by its `at`
// alone is LOCATED, not anchored (arch_plan.ts `locatedOnly`): `at` says
// where code lives, not which process runs it — so it moves nothing, nor
// does `plan check`'s guess from a directory's name, nor a proposed process.

import type { Plan } from "../shared/plan_types.ts";
import { entryFiles } from "./plan_modules.ts";

export interface PlanOwner { id: string; label: string }

/** entry point id → the agreed plan process it runs as, by what the plan states. */
export function planOwnerOf(plan: Plan | null | undefined, files: string[], entryPoints: Array<{ id: string; file: string }>): Map<string, PlanOwner> {
  const out = new Map<string, PlanOwner>();
  // 2026-10-12 (field review: a pending agent edit dropped the box until a
  // person re-agreed) — a process with a change pending is drawn as it was
  // last AGREED (`agreedAs`); the proposal reshapes nothing until agreed
  const agreed = (plan?.processes ?? []).flatMap((p) => {
    if (p.status === "agreed") return [p];
    const was = p.status === "proposed" ? (p as { agreedAs?: Record<string, unknown> }).agreedAs : undefined;
    return was ? [{ ...p, ...(was as Partial<typeof p>), id: p.id, status: "agreed" as const }] : [];
  });
  if (!agreed.length) return out;
  for (const e of entryPoints) {
    // a process at bin/ listing bin/provision.sh: the probes beside it are not its own
    const p = agreed.find((x) => (x.entryPoints ?? []).some((r) => r === e.id || r === e.file || entryFiles([r], files).includes(e.file)));
    if (p) out.set(e.id, { id: p.id, label: p.label });
  }
  return out;
}

/** entry point id → its plan box, for the entries of derived boxes the plan divides. */
export function planSplit(entryIds: string[], boxOf: (ep: string) => string | undefined, owner: Map<string, PlanOwner>): Map<string, { id: string; label: string; process: string }> {
  const owners = new Map<string, Set<string>>();
  for (const ep of entryIds) {
    const box = boxOf(ep);
    if (!box) continue;
    (owners.get(box) ?? owners.set(box, new Set()).get(box)!).add(owner.get(ep)?.id ?? "");
  }
  // and a process the derived boxes split (a spawned script beside its siblings)
  const boxesOf = new Map<string, Set<string>>();
  for (const ep of entryIds) { const box = boxOf(ep), o = owner.get(ep); if (box && o) (boxesOf.get(o.id) ?? boxesOf.set(o.id, new Set()).get(o.id)!).add(box); }
  const out = new Map<string, { id: string; label: string; process: string }>();
  for (const ep of entryIds) {
    const box = boxOf(ep), o = owner.get(ep);
    if (!box || !o || ((owners.get(box)?.size ?? 0) < 2 && (boxesOf.get(o.id)?.size ?? 0) < 2)) continue;
    out.set(ep, { id: `cluster:plan:${o.id}`, label: o.label, process: o.id });
  }
  return out;
}
