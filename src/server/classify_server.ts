// "Classify N unclassified tools" on the map (2026-10-12). The Tools lens asks
// for the estimate first, then the one model call — through the same functions
// as the CLI's `classify --apply` (stack_classify.ts), so screen and command
// cannot disagree. Every answer is stored AGENT-STATED (a `describe` stack
// policy): it shows as a model's wherever its role shows, reaches the inbox as
// a rule a person ratifies, and never loosens the run floor
// (floor_libraries.ts reads only table and person-stated roles).

import type { StackIndex } from "./stack.ts";
import { applyClassifications, buildClassifyPrompt, collectUnknownTools, parseClassifyResponse, type ToolDossier } from "./stack_classify.ts";

export interface ClassifyCtx {
  root: () => string | null;
  envelope: () => { files: Record<string, unknown>; threads: unknown[] } | null;
  stack: () => StackIndex;
  claudeAvailable: () => boolean;
  run: (prompt: string) => Promise<string | null>;
  modelLabel: () => string;
  changed: () => void;
}

function dossiersFor(ctx: ClassifyCtx): { root: string; dossiers: ToolDossier[]; prompt: string } | { error: string } {
  const root = ctx.root(), env = ctx.envelope();
  if (!root || !env) return { error: "classifying needs a project directory and a parsed project" };
  const dossiers = collectUnknownTools(env as never, ctx.stack(), { root });
  return { root, dossiers, prompt: buildClassifyPrompt(dossiers, { project: root.split(/[\\/]/).pop() }) };
}

/** What a run would ask about, and roughly what it costs. Spends nothing. */
export function classifyEstimate(ctx: ClassifyCtx): { ok: boolean; error?: string; tools?: number; names?: string[]; tokens?: number } {
  const d = dossiersFor(ctx);
  if ("error" in d) return { ok: false, error: d.error };
  return { ok: true, tools: d.dossiers.length, names: d.dossiers.slice(0, 12).map((x) => x.tool), tokens: Math.ceil(d.prompt.length / 4) };
}

/** The one model call; accepted answers stored agent-stated for a person. */
export async function classifyRun(ctx: ClassifyCtx): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const d = dossiersFor(ctx);
  if ("error" in d) return { ok: false, error: d.error };
  if (!d.dossiers.length) return { ok: false, error: "every tool already has a role" };
  if (!ctx.claudeAvailable()) return { ok: false, error: "the claude CLI is unavailable — `vibegraph-knowledge classify` with a saved reply works from the command line" };
  const text = await ctx.run(d.prompt);
  if (text === null) return { ok: false, error: "the model returned nothing" };
  const parsed = parseClassifyResponse(text, d.dossiers);
  if (parsed.error) return { ok: false, error: parsed.error };
  const applied = applyClassifications(d.root, parsed.accepted, d.dossiers, { model: ctx.modelLabel() });
  if (applied.added.length) ctx.changed();
  const unsure = parsed.unsure.length ? `; ${parsed.unsure.length} the model was unsure of (${parsed.unsure.slice(0, 4).map((u) => u.tool).join(", ")})` : "";
  return { ok: true, detail: `${applied.added.length} role${applied.added.length === 1 ? "" : "s"} proposed — a model's classification until a person ratifies it in the inbox${unsure}` };
}
