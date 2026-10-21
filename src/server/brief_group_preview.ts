// The Brief's pending groups, ON the map (2026-10-21, Ben: "when proposing
// groups show the new proposed groups automatically to allow the person to
// ratify while seeing the change"). The Brief's groups-first step stores its
// group changes with the Brief, and the map drew none of them: the card said
// "3 group change(s)" and a person ratified groups they could not see.
//
// TRANSPORT ONLY, like `vocabulary` (operation_vocab.ts): the copy of the
// model the app is sent shows the groups as they WOULD be once ratified,
// through the same applyBriefGroups the ratification runs, and every group
// that changes is drawn as `proposed` (dashed). Never on an export, never in
// the Brief's own facts. A pending architecture proposal of its own is
// already drawn, and the two are not mixed.

import type { ArchModelRecord } from "../shared/protocol.ts";
import { applyArchStore, loadArchStore } from "./arch_store.ts";
import { applyBriefGroups, loadBrief, sectionSummary } from "./brief_store.ts";

export function withBriefGroupPreview(model: ArchModelRecord, derived: ArchModelRecord | null, root: string | null): ArchModelRecord {
  if (!root || !derived || model.proposal) return model;
  let p;
  try { p = loadBrief(root).proposed; } catch { return model; }
  if (!p || !sectionSummary(p, "groups")) return model;
  let preview: ArchModelRecord;
  try { preview = applyArchStore(derived, applyBriefGroups(loadArchStore(root), p.groups, p.names, p.model)); } catch { return model; }
  const now = new Map(model.groups.map((g) => [g.id, g]));
  const named = new Set(p.groups.filter((g) => g.op !== "keep").map((g) => g.id));
  const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
  const groups = preview.groups.map((g) => {
    const was = now.get(g.id);
    const changed = named.has(g.id) || !was || !same(was.wraps, g.wraps) || was.label !== g.label;
    return changed ? { ...g, source: "proposed" as const } : was;
  });
  const changes = groups.filter((g) => g.source === "proposed").length;
  return { ...model, groups, briefGroups: { changes, names: Object.keys(p.names).length, model: p.model } };
}
