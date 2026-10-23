// "Propose rules from the architecture" in the Rules panel (2026-10-19,
// PLAN-M-RULES M2). The estimate spends nothing; the run is the one model
// call — through the same dossier, prompt and gate as `constraints draft`
// (rule_draft.ts, rule_draft_gate.ts), so screen and command cannot
// disagree. Survivors are stored agent-stated and wait in "Awaiting you".

import { statedRules, loadConstraints } from "./constraint_store.ts";
import { checkStatedRules } from "./constraint_report.ts";
import { buildRuleDossier, buildRuleDraftPrompt, MAX_DRAFT_RULES, pendingReview, pendingReviewRefusal } from "./rule_draft.ts";
import { applyRuleDraft, gateRuleDraft } from "./rule_draft_gate.ts";
import { claimFactsFromEnvelope } from "./rule_claims.ts";
import type { StackIndex } from "./stack.ts";
import { modelNothingText } from "./model_failure_state.ts";

export interface RuleDraftCtx {
  root: () => string | null;
  envelope: () => { files: Record<string, any>; entryPoints: any[]; threads: any[] } | null;
  stack: () => StackIndex;
  claudeAvailable: () => boolean;
  run: (prompt: string) => Promise<string | null>;
  modelLabel: () => string;
  changed: () => void;
}

export interface RuleDraftReply {
  ok: boolean;
  error?: string;
  facts?: number;
  tokens?: number;
  stored?: string[];
  /** checks proposed on stated rules, as `<rule>/<proposal>` */
  checkProposals?: string[];
  refused?: Array<{ text: string; reason: string }>;
  withoutEvidence?: string[];
}

function prepared(ctx: RuleDraftCtx) {
  const root = ctx.root(), env = ctx.envelope();
  if (!root || !env) return { error: "proposing rules needs a project directory and a parsed project" } as const;
  const stack = ctx.stack();
  const dossier = buildRuleDossier(root, env, stack);
  return { root, env, stack, dossier, prompt: buildRuleDraftPrompt(dossier) } as const;
}

/** What the model would be shown, and roughly what it costs. Spends nothing. */
export function ruleDraftEstimate(ctx: RuleDraftCtx): RuleDraftReply {
  const root = ctx.root();
  const waiting = root ? pendingReview(root) : 0;
  if (waiting >= MAX_DRAFT_RULES) return { ok: false, error: pendingReviewRefusal(waiting) };
  const p = prepared(ctx);
  if ("error" in p) return { ok: false, error: p.error };
  return { ok: true, facts: p.dossier.items.length, tokens: Math.ceil(p.prompt.length / 4) };
}

/** The one model call; survivors stored agent-stated for a person. */
export async function ruleDraftRun(ctx: RuleDraftCtx): Promise<RuleDraftReply> {
  const root = ctx.root();
  const waiting = root ? pendingReview(root) : 0;
  if (waiting >= MAX_DRAFT_RULES) return { ok: false, error: pendingReviewRefusal(waiting) };
  const p = prepared(ctx);
  if ("error" in p) return { ok: false, error: p.error };
  if (!p.dossier.items.length) return { ok: false, error: "there are no facts to propose rules from yet" };
  if (!ctx.claudeAvailable()) return { ok: false, error: "the claude CLI is unavailable — `vibegraph-knowledge constraints draft --reply <file>` works from the command line" };
  const text = await ctx.run(p.prompt);
  if (text === null) return { ok: false, error: modelNothingText() };
  const gated = gateRuleDraft(text, p.dossier, {
    existing: statedRules(loadConstraints(p.root)),
    files: new Set(Object.keys(p.env.files)),
    entryPoints: new Set(p.env.entryPoints.map((e) => e.id)),
    tools: new Set(p.stack.tools.map((t) => t.tool)),
    checkOne: (input) => checkStatedRules({ envelope: p.env as never, root: p.root, stack: p.stack, constraints: [{ ...input, id: "draft", source: "agent", createdAt: "" }] }).results
      .map((r) => ({ verdict: r.verdict, reason: r.reason, offenders: r.offenders })),
    claims: claimFactsFromEnvelope(p.env, p.stack),
    funnels: p.stack.tools.filter((t) => t.origin === "project"), stack: p.stack,
    model: ctx.modelLabel(),
  });
  if (gated.error) return { ok: false, error: gated.error };
  const all = applyRuleDraft(p.root, gated);
  if (all.length) ctx.changed();
  // new rules first, then checks proposed on stated rules (`c1/p1`): both wait in "Awaiting you"
  const stored = all.slice(0, gated.accepted.length);
  return { ok: true, facts: p.dossier.items.length, stored, checkProposals: all.slice(gated.accepted.length), refused: gated.refused, withoutEvidence: gated.withoutEvidence };
}
