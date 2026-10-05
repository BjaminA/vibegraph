// Has the map moved since its groups were ratified? (2026-10-05)
//
// Ratifying the groups is a person's decision about the map as it was. Rules
// (src/shared/arch_rules.ts) carry most growth into the right group with no
// model; what they cannot carry is a new KIND of thing: a cluster no rule
// matches, a new deployment unit, a new planned process, a group whose code
// is gone. This measures exactly those against the baseline stored at
// ratification, deterministically, on every re-derive:
//   substantial  a new deployment unit, a new planned process or module, a
//                group that now holds nothing, or new unplaced clusters past
//                one, or past a tenth of the map — the view asks for an
//                UPDATE pass (arch_propose.ts, mode "update");
//   minor        anything else that moved — counted, not asked about;
//   none.
// Zero tokens. The update itself is the person's choice.

import type { ArchDrift, ArchModelRecord } from "../shared/protocol.ts";
import type { Plan } from "../shared/plan_types.ts";
import type { InfraFact } from "./infra_manifests.ts";
import type { ArchBaseline, ArchStore } from "./arch_store.ts";
import { ratifiedAt } from "./arch_store.ts";

const DEPLOY_KINDS = new Set(["service", "pm2-app", "process", "k8s", "resource"]);

/** The deployment units the manifests declare, as stable keys. */
export function deployUnits(facts: readonly InfraFact[]): string[] {
  const out = new Set<string>();
  for (const f of facts) {
    if (DEPLOY_KINDS.has(f.kind)) out.add(`${f.kind}:${f.name}`);
    else if (f.kind === "base-image") out.add(`dockerfile:${f.file}`);
  }
  return [...out].sort();
}

const clustersOf = (m: Pick<ArchModelRecord, "nodes">) => m.nodes.filter((n) => n.kind === "cluster");
const plannedOf = (plan: Plan | null): string[] => !plan ? [] : [
  ...plan.processes.filter((p) => p.status !== "dropped").map((p) => `processes:${p.id}`),
  ...(plan.modules ?? []).filter((m) => m.status !== "dropped").map((m) => `modules:${m.id}`),
].sort();

/** What the map holds now — stored at ratification. `applied` is the map
 *  with the just-ratified groups on it (who is grouped is part of it). */
export function archBaseline(applied: Pick<ArchModelRecord, "nodes">, facts: readonly InfraFact[], plan: Plan | null, now = new Date()): ArchBaseline {
  const clusters = clustersOf(applied);
  return {
    at: now.toISOString(),
    clusters: clusters.map((n) => n.id).sort(),
    ungrouped: clusters.filter((n) => !n.group).map((n) => n.id).sort(),
    deploy: deployUnits(facts),
    ...(plan ? { planRevision: plan.revision, planned: plannedOf(plan) } : {}),
  };
}

/** The drift since ratification, or null when nothing is ratified. A store
 *  ratified before baselines existed is measured from an empty baseline of
 *  deployment units and plan items it cannot know: it says so. */
export function archDrift(applied: ArchModelRecord, store: ArchStore, facts: readonly InfraFact[], plan: Plan | null): ArchDrift | null {
  const r = ratifiedAt(store);
  if (!r) return null;
  const b = store.baseline;
  const clusters = clustersOf(applied);
  const now = new Set(clusters.map((n) => n.id));
  const was = new Set(b?.clusters ?? clusters.map((n) => n.id));
  const wasUngrouped = new Set(b?.ungrouped ?? []);
  const unplaced = clusters.filter((n) => !n.group && !wasUngrouped.has(n.id)).map((n) => n.id);
  const added = [...now].filter((id) => !was.has(id));
  const removed = [...was].filter((id) => !now.has(id));
  const deployAdded = b ? deployUnits(facts).filter((d) => !b.deploy.includes(d)) : [];
  const plannedAdded = b?.planned ? plannedOf(plan).filter((p) => !b.planned!.includes(p)) : [];
  const stated = new Set(store.groups.map((g) => g.id));
  const drawn = new Set(applied.groups.filter((g) => g.source === "stated").map((g) => g.id));
  const emptied = [...stated].filter((id) => !drawn.has(id) && !store.groups.find((g) => g.id === id)?.planned);
  const reasons: string[] = [];
  if (deployAdded.length) reasons.push(`${deployAdded.length} new deployment unit${deployAdded.length === 1 ? "" : "s"}: ${deployAdded.slice(0, 4).join(", ")}`);
  if (plannedAdded.length) reasons.push(`${plannedAdded.length} new planned item${plannedAdded.length === 1 ? "" : "s"}: ${plannedAdded.slice(0, 4).join(", ")}`);
  if (emptied.length) reasons.push(`${emptied.length} group${emptied.length === 1 ? " holds" : "s hold"} nothing now: ${emptied.slice(0, 4).join(", ")}`);
  const manyUnplaced = unplaced.length >= 2 || (clusters.length > 0 && unplaced.length / clusters.length > 0.1);
  if (unplaced.length) reasons.push(`${unplaced.length} cluster${unplaced.length === 1 ? "" : "s"} in no group: ${unplaced.slice(0, 4).join(", ")}`);
  const placedByRule = added.filter((id) => !unplaced.includes(id));
  if (placedByRule.length) reasons.push(`${placedByRule.length} new cluster${placedByRule.length === 1 ? "" : "s"} placed by the groups' rules: ${placedByRule.slice(0, 4).join(", ")}`);
  if (removed.length) reasons.push(`${removed.length} cluster${removed.length === 1 ? "" : "s"} gone`);
  if (!b) reasons.push("ratified before baselines were kept: deployment units and plan items are measured from now on");
  const substantial = deployAdded.length > 0 || plannedAdded.length > 0 || emptied.length > 0 || (unplaced.length > 0 && manyUnplaced);
  const moved = substantial || unplaced.length > 0 || added.length > 0 || removed.length > 0;
  return {
    level: substantial ? "substantial" : moved ? "minor" : "none",
    unplaced, added, removed, deployAdded, plannedAdded, emptied,
    reasons: moved ? reasons : [],
    since: b?.at ?? r.at,
  };
}
