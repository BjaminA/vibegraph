// GROUPS FIRST (2026-10-09, from a field brief that described a remote,
// policy-gated command platform as "a local shell-out"). A brief's sentences
// say what a codebase is FOR; the groups — which boxes deploy together and
// which trust zone they share — are where that intention shows first. So a
// full draft asks for the groups ALONE when none is settled, and waits for a
// person to decide them; once they are settled (ratified, or written in
// architecture.json) the brief is drafted with them as citable statements and
// without a groups section of its own. `--skip-groups` keeps the one-call draft.

import type { ArchModelRecord } from "../shared/protocol.ts";
import type { BriefRecord } from "../shared/brief_types.ts";
import { loadArchStore, ratifiedAt } from "./arch_store.ts";
import { sectionSummary } from "./brief_store.ts";

export type GroupsStep =
  | { step: "groups"; why: string }
  | { step: "wait"; why: string }
  | { step: "brief"; skipGroups: boolean };

/** What a draft does about groups. `only` / `stale` drafts are unchanged. */
export function groupsStep(root: string, rec: BriefRecord, model: ArchModelRecord, opts: { only?: string; stale?: boolean; skip?: boolean } = {}): GroupsStep {
  if (opts.only || opts.stale || opts.skip) return { step: "brief", skipGroups: false };
  const store = loadArchStore(root);
  const pendingBrief = !!(rec.proposed && sectionSummary(rec.proposed, "groups"));
  if (pendingBrief || store.proposal) {
    return { step: "wait", why: `${pendingBrief ? "the brief's proposed groups" : "a proposed architecture"} wait for a person — ratify or reject ${pendingBrief ? "them (`brief codebase ratify|reject groups`, the card or the inbox)" : "it on the map (or `architecture --ratify|--reject`)"}, then draft the brief; or draft now with --skip-groups` };
  }
  const settled = !!ratifiedAt(store) || (model.groups ?? []).some((g) => g.source === "stated");
  if (settled) return { step: "brief", skipGroups: true };
  return { step: "groups", why: "no groups are settled yet: the groups are proposed first (which boxes deploy together, which trust zone they share), because the brief reads the codebase through them — decide them, then draft the brief" };
}
