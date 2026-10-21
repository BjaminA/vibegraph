// PROJECT DIRECTION (2026-10-16) — the project's own "how we do things here",
// read from its facts rather than shipped. Webview-safe shapes; the store and
// the census are src/server/project_direction.ts.
//
// A rule is PROPOSED by the census (zero tokens) or carried from an agreed
// plan principle, and only a person AGREES to it. An agreed rule reaches a
// hooked session as a headline with the threads it is about, and one with a
// check is checked after every edit AS ADVICE — direction never blocks; a rule
// that must block is a stated rule (constraints.json).

import type { Delivery, SkillsConfig } from "./generic_skills_wire.ts";
import { legacyDelivery } from "./generic_skills_wire.ts";

export type DirectionStatus = "proposed" | "agreed" | "dropped";

export interface ProjectRule {
  id: string;
  /** the rule, one line */
  text: string;
  /** why, from the facts it was read from (counts and sites), or the plan's own */
  why: string;
  /** what it was read from: funnel:<tool>, guard:<zone>, plan:policies:<id> */
  basis: string;
  /** file or file:line it rests on */
  evidence: string[];
  /** a grammar check (constraint_grammar.ts) — run after edits as advice */
  check?: Record<string, unknown>;
  /** the files it is about: a thread walking one of them gets it (none = every thread) */
  files?: string[];
  status: DirectionStatus;
  /** a hash of the facts it was read from */
  stamp: string;
  /** the facts moved since a person agreed — re-read before relying on it */
  changed?: boolean;
  /** the census no longer finds it in the code */
  missing?: boolean;
  decided?: { by: string; at: string };
  /** 2026-10-20 — what Claude is told about it once agreed (absent: the legacy
   *  page-wide mode's meaning, which by default is both). */
  delivery?: Delivery;
}

export interface ProjectDirection { version: "1"; rules: ProjectRule[]; censusAt?: string }

/** The `project-direction` message to the webview. `defaultDelivery`: the
 *  switches an agreed rule with none of its own has. */
export interface ProjectDirectionPayload { direction: ProjectDirection; error?: string; note?: string; defaultDelivery?: Delivery }

/** An agreed rule's switches; a rule nothing checks can only be told up front. */
export function ruleDelivery(r: ProjectRule, legacyMode: SkillsConfig["hooks"]): Delivery {
  if (r.status !== "agreed") return { upfront: false, onCheck: false };
  const d = r.delivery ?? legacyDelivery(legacyMode);
  return { upfront: d.upfront, onCheck: d.onCheck && !!r.check };
}
