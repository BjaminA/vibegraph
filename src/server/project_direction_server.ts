// The project's own direction from the GUI (2026-10-16). The Direction panel
// is a person: it reads, runs the census (zero tokens), agrees or drops, and
// (2026-10-20) sets what Claude is told about each agreed rule. The model
// behind the census is the server's live one, so the panel and
// `vibegraph-knowledge direction project census` read the same facts.

import { loadDirection, saveDirection, censusAt, mergeCensus, decideRule, setRuleDelivery, type CensusInput } from "./project_direction.ts";
import { readSkillsConfig } from "./generic_skills.ts";
import { legacyDelivery } from "../shared/generic_skills_wire.ts";
import type { ProjectDirectionPayload } from "../shared/project_direction_wire.ts";

type Msg = { type: string; payload?: { id?: unknown; decision?: unknown; upfront?: unknown; onCheck?: unknown } };

export function handleProjectDirection(root: string, msg: Msg, ctx: Omit<CensusInput, "plan" | "stated">): ProjectDirectionPayload {
  // the switches an agreed rule has before a person sets its own
  const defaultDelivery = (() => { try { return legacyDelivery(readSkillsConfig(root).config.hooks); } catch { return legacyDelivery(undefined); } })();
  const reply = (p: Omit<ProjectDirectionPayload, "defaultDelivery">): ProjectDirectionPayload => ({ ...p, defaultDelivery });
  if (msg.type === "project-direction-census") {
    const found = censusAt(root, ctx);
    const m = mergeCensus(loadDirection(root), found);
    saveDirection(root, m.direction);
    return reply({ direction: m.direction, note: `${found.length} rule(s) the code follows; ${m.added} new${m.changed ? `; ${m.changed} agreed rule(s) whose facts moved` : ""}` });
  }
  if (msg.type === "project-direction-decide") {
    const id = typeof msg.payload?.id === "string" ? msg.payload.id : "";
    const decision = msg.payload?.decision === "agree" ? "agree" : msg.payload?.decision === "drop" ? "drop" : null;
    const d = loadDirection(root);
    if (!decision) return reply({ direction: d, error: "decide with agree or drop" });
    // agreeing reads the code as it is now (a stale census proposal is refused)
    const found = decision === "agree" ? censusAt(root, ctx) : undefined;
    const err = decideRule(d, id, decision, "human", new Date(), found);
    if (err) return reply({ direction: d, error: err });
    saveDirection(root, d);
    return reply({ direction: d });
  }
  if (msg.type === "project-direction-deliver") {
    const id = typeof msg.payload?.id === "string" ? msg.payload.id : "";
    const d = loadDirection(root);
    const err = setRuleDelivery(d, id, { upfront: msg.payload?.upfront, onCheck: msg.payload?.onCheck }, defaultDelivery);
    if (err) return reply({ direction: d, error: err });
    saveDirection(root, d);
    return reply({ direction: d });
  }
  return reply({ direction: loadDirection(root) });
}
