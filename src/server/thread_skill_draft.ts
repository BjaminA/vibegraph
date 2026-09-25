// Drafting a THREAD SKILL, as a module (2026-09-25). The prompt and its two
// gates lived inside server.ts, closed over the server's live state, so a
// skill could only be drafted from the GUI or MCP — and the CLI that hands
// VibeGraph's knowledge to a plain Claude could copy a ratified skill but
// never make one. Everything here is a function of its inputs; the caller
// supplies the model (`runLlm`), the known node ids and the effect lookup.
//
// The gates are unchanged from server.ts:
//   * grounding — at least one real IR node id cited and ZERO invented ones
//     (one retry, naming the invalid ids; the retry is kept only if better);
//   * shape — the four sections, once each, in order (skill_contract.ts);
//   * budget — the full body (prose + the deterministic honesty block) must
//     fit the injection budget, or it could never ride a prompt.
// A draft is always a DRAFT: ratification stays a separate, human act.

import type { Thread } from "../webview/threads/types.ts";
import { projectThreadForAgent } from "../webview/threads/collapse.ts";
import { computeThreadBlindSpots, formatBlindSpotsBlock } from "../webview/threads/blindSpots.ts";
import { validateCitations } from "./citations.ts";
import { validateSkillBody, skillBodyOverBudget } from "./skill_contract.ts";
import { SKILL_INJECTION_BUDGET_CHARS } from "./thread_remit.ts";

/** The drafting prompt. `rulesBlock` is skillRulesBlock(routed) — the rules
 *  routed to this thread, which the skill must carry with their reasons. */
export function threadSkillPrompt(entryPointId: string, ir: any, rulesBlock: string): string {
  const projected = projectThreadForAgent(ir as Thread);
  const steps = projected.nodes
    .filter((n) => ["seed", "step", "external"].includes(n.kind))
    .slice(0, 40)
    .map((n) => {
      const mark =
        (n.nestedCollapsed ? ` [+${n.nestedCollapsed} nested, drillable]` : "") +
        (n.uncaptured ? " [hides calls not in IR]" : "");
      return `- ${n.kind}: ${n.label}${n.irNodeId ? ` \`${n.irNodeId}\`` : ""}${n.file ? ` (${n.file})` : ""}${mark}`;
    })
    .join("\n");
  return [
    "Write a THREAD SKILL: durable, grounded guidance for a coding agent working on this code thread.",
    "Use these markdown sections, in order:",
    "## Purpose — what this thread does and why (1-2 sentences).",
    "## Architecture — the key functions/files and how control flows across them.",
    "## Steps — the execution path; for each named step cite its IR node id in `backticks` (use the ids below).",
    "## Gotchas — edit hazards, ordering constraints, cross-file coupling.",
    "## Rules and why — M-WHY: for each STATED RULE below, give the rule AND the reason behind it,",
    "  and cite the IR node id(s) it governs where the step list names them. The reason is the load-bearing",
    "  half: a rule without it gets worked around by the next agent that meets a case the rule did not",
    "  foresee. Write nothing in this section if no rules are listed. Never invent a rule.",
    "Be concrete and specific. Cite ONLY node ids that appear below; never invent ids. Do NOT describe the",
    "thread's unknown/dynamic/uncaptured parts — those are appended separately as verified IR fact.",
    "Output ONLY the markdown sections, no preamble. These four sections, once each, in that order, are a",
    "hard contract — a draft missing them is refused. Keep the whole skill under 8000 characters: it is",
    "injected into working prompts, so dense beats long.",
    "",
    `Thread entry point: ${entryPointId}`,
    `Files reached: ${(ir.filesReached ?? []).join(", ")}`,
    "Steps in execution order:",
    steps,
    rulesBlock,
  ].join("\n");
}

export interface DraftInput {
  entryPointId: string;
  ir: any;
  rulesBlock: string;
  /** every IR node id in the project: what a citation may name. */
  knownIds: Set<string>;
  /** one model call; null when it returned nothing. */
  runLlm: (prompt: string) => Promise<string | null>;
  /** the effectKind of a node, for the honesty block. */
  effectKindFor: (file: string | null, irNodeId: string | null) => string | null;
  /** appended to "returned nothing" (why the last spawn failed, when known). */
  failureSuffix?: () => string;
}

/** Draft, gate and assemble a skill body. Writes nothing. */
export async function draftThreadSkill(input: DraftInput): Promise<{ ok: boolean; body?: string; error?: string }> {
  const { entryPointId, ir, rulesBlock, knownIds, runLlm } = input;
  const prompt = threadSkillPrompt(entryPointId, ir, rulesBlock);
  // The grounding gate tolerates ZERO ungrounded citations, so a single
  // invented id discards an otherwise good skill. Retry ONCE, naming the
  // invalid ids; the gate itself is unchanged.
  let prose = await runLlm(prompt);
  if (prose) {
    const first = validateCitations(prose, knownIds);
    if (first.ungrounded.length > 0 || first.grounded.length === 0) {
      const complaint = first.ungrounded.length
        ? `These node ids do NOT exist and must not be cited: ${first.ungrounded.slice(0, 12).join(", ")}. `
          + "Re-write citing ONLY ids from the step list, or drop the citation."
        : "The draft cited no node ids. Every named step must cite its IR node id in backticks, taken verbatim from the step list.";
      const retry = await runLlm(`${prompt}\n\nYour previous attempt was REJECTED. ${complaint}`);
      if (retry) {
        const second = validateCitations(retry, knownIds);
        if (second.grounded.length >= 1 && second.ungrounded.length === 0) prose = retry;
      }
    }
  }
  if (!prose) return { ok: false, error: `thread-skill generation returned nothing${input.failureSuffix?.() ?? ""}` };

  const check = validateCitations(prose, knownIds);
  if (!(check.grounded.length >= 1 && check.ungrounded.length === 0)) {
    const why = check.cited.length === 0
      ? "the draft cited no node ids at all"
      : `${check.grounded.length} of ${check.cited.length} citations were real; these do not exist: ${check.ungrounded.slice(0, 8).join(", ")}`;
    return { ok: false, error: `generation not grounded — ${why}; not persisted` };
  }
  const shape = validateSkillBody(prose);
  if (!shape.ok) {
    return { ok: false, error: `generation violates the skill body contract — ${shape.problems.join("; ")}; not persisted` };
  }
  // Deterministic honesty block — the thread's blind spots, appended as IR fact.
  const rollup = computeThreadBlindSpots(ir as Thread, input.effectKindFor);
  const body = `${prose.trim()}\n\n${formatBlindSpotsBlock(rollup)}`;
  if (skillBodyOverBudget(body)) {
    return { ok: false, error: `generated body is ${body.length} chars — over the ${SKILL_INJECTION_BUDGET_CHARS}-char injection budget, so it could never ride a prompt; not persisted` };
  }
  return { ok: true, body };
}
