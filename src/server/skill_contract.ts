// Thread-skill body contract (2026-08-02) — the shape half of the
// draft-time gate. The grounding gate (citations.ts isGroundedSkill)
// already refuses confabulated citations; this refuses a body the
// product can't USE well: missing/misordered sections (the skill card
// renders them as markdown; the drafting prompt demands them), preamble
// noise, or a body too large to ever ride a prompt (the routing budget
// in thread_remit.ts — a persisted skill that can never inject would be
// a silent lie in the store).
//
// Pure and deterministic: no LLM in the loop, node:test-pinned. Applied
// to the LLM prose at draft time in runGenerateThreadSkill; the
// deterministic blind-spots block appended after the gate is IR fact and
// is covered only by the size ceiling (checked on the final body).
//
// NOT applied to hand-seeded fixture skills or the README (whose prompt
// is plain prose) — this is a gate on what GENERATION may persist, not
// retroactive policing of the store.

import { SKILL_INJECTION_BUDGET_CHARS } from "./thread_remit.ts";

/** Required sections, in order — mirrors _threadSkillPrompt exactly. */
export const SKILL_REQUIRED_SECTIONS = ["## Purpose", "## Architecture", "## Steps", "## Gotchas"] as const;

export interface SkillBodyCheck {
  ok: boolean;
  /** Human-worded refusal reasons; empty iff ok. */
  problems: string[];
}

/** Validate the drafted PROSE against the section contract. */
export function validateSkillBody(prose: string): SkillBodyCheck {
  const problems: string[] = [];
  const text = prose.trim();

  if (text.length === 0) {
    return { ok: false, problems: ["body is empty"] };
  }

  // No preamble: the prompt says "Output ONLY the markdown sections".
  if (!text.startsWith(SKILL_REQUIRED_SECTIONS[0])) {
    problems.push(`body must start with "${SKILL_REQUIRED_SECTIONS[0]}" (no preamble)`);
  }

  // Each required section exactly once, in order. Match headings at line
  // starts only, and exactly ## (### subsections inside are fine).
  let lastIndex = -1;
  for (const section of SKILL_REQUIRED_SECTIONS) {
    const re = new RegExp(`^${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gm");
    const hits = [...text.matchAll(re)];
    if (hits.length === 0) {
      problems.push(`missing section "${section}"`);
      continue;
    }
    if (hits.length > 1) {
      problems.push(`section "${section}" appears ${hits.length} times (must be exactly once)`);
    }
    const idx = hits[0].index ?? 0;
    if (idx < lastIndex) {
      problems.push(`section "${section}" is out of order (expected ${SKILL_REQUIRED_SECTIONS.join(" → ")})`);
    }
    lastIndex = Math.max(lastIndex, idx);
  }

  return { ok: problems.length === 0, problems };
}

/** Size ceiling for the FULL persisted body (prose + blind-spots block):
 *  the routing budget is the whole turn's allowance, so a body over it
 *  could never inject — persisting it would be a silent lie. */
export function skillBodyOverBudget(fullBody: string): boolean {
  return fullBody.length > SKILL_INJECTION_BUDGET_CHARS;
}
