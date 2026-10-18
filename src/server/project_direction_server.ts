// The project's own direction from the GUI (2026-10-16). The Direction panel
// is a person: it reads, runs the census (zero tokens) and agrees or drops.
// The model behind the census is the server's live one, so the panel and
// `vibegraph-knowledge direction project census` read the same facts.

import { loadDirection, saveDirection, census, mergeCensus, decideRule, type CensusInput } from "./project_direction.ts";
import { loadPlan } from "./plan_store.ts";
import type { ProjectDirectionPayload } from "../shared/project_direction_wire.ts";

export function handleProjectDirection(root: string, msg: { type: string; payload?: { id?: unknown; decision?: unknown } }, ctx: Omit<CensusInput, "plan">): ProjectDirectionPayload {
  if (msg.type === "project-direction-census") {
    const found = census({ ...ctx, plan: (() => { try { return loadPlan(root); } catch { return null; } })() });
    const m = mergeCensus(loadDirection(root), found);
    saveDirection(root, m.direction);
    return { direction: m.direction, note: `${found.length} rule(s) the code follows; ${m.added} new${m.changed ? `; ${m.changed} agreed rule(s) whose facts moved` : ""}` };
  }
  if (msg.type === "project-direction-decide") {
    const id = typeof msg.payload?.id === "string" ? msg.payload.id : "";
    const decision = msg.payload?.decision === "agree" ? "agree" : msg.payload?.decision === "drop" ? "drop" : null;
    const d = loadDirection(root);
    if (!decision) return { direction: d, error: "decide with agree or drop" };
    const err = decideRule(d, id, decision, "human");
    if (err) return { direction: d, error: err };
    saveDirection(root, d);
    return { direction: d };
  }
  return { direction: loadDirection(root) };
}
