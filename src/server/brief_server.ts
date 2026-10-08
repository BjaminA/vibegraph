// The Brief on the live server (2026-10-08): the map's Brief card asks for the
// state, the estimate, a draft (the one token-spending step) and a person's
// decision. The same functions the CLI uses (brief_inputs / _prompt /
// _validate / _store); server.ts only routes the WS messages here.

import type { ArchModelRecord } from "../shared/protocol.ts";
import { BRIEF_SECTIONS, type BriefBody, type BriefSection } from "../shared/brief_types.ts";
import { reviewBrief } from "./brief_review.ts";
import { briefInputs, briefEstimate } from "./brief_inputs.ts";
import { buildBriefPrompt, type BriefOnly } from "./brief_prompt.ts";
import { parseBrief } from "./brief_validate.ts";
import { loadBrief, saveBrief, proposeBrief, decideBrief, sectionSummary, briefWithStaleness, allLines } from "./brief_store.ts";

export interface BriefCtx {
  root: () => string | null;
  model: () => ArchModelRecord | null;
  claudeAvailable: () => boolean;
  run: (prompt: string) => Promise<string | null>;
  modelLabel: () => string;
  who: () => string;
  changed: () => void;
}

/** What the card draws: the ratified spec (stale lines marked, with what
 *  changed), the pending sections, and the review sheet of each (B13). */
export function briefState(ctx: BriefCtx): Record<string, unknown> {
  const root = ctx.root(), model = ctx.model();
  if (!root) return { available: false, reason: "the Brief needs a project directory" };
  const rec = loadBrief(root);
  const p = rec.proposed;
  const inp = model ? briefInputs(root, model, { notes: p?.notes }) : null;
  const ratified = inp && rec.ratified?.spec ? briefWithStaleness(rec, inp.facts) : rec.ratified;
  const review = (spec: BriefBody["spec"] | undefined, omitted?: string[]) => (inp && spec && allLines(spec).length ? reviewBrief(spec, inp.facts, { omitted, absolutes: inp.absolutes }) : null);
  return {
    available: true, claude: ctx.claudeAvailable(),
    ratified: ratified ?? null,
    ratifiedReview: review(ratified?.spec),
    proposed: p ? {
      model: p.model, at: p.at, spec: p.spec, refused: p.refused.length, refusedList: p.refused.slice(0, 30), omitted: p.omitted, notes: p.notes ?? [],
      sections: BRIEF_SECTIONS.map((s) => ({ section: s, summary: sectionSummary(p, s) })).filter((x) => x.summary),
      review: review(p.spec, p.omitted),
    } : null,
  };
}

export function briefEstimateFor(ctx: BriefCtx): { ok: boolean; calls?: number; tokens?: number; silent?: number; error?: string } {
  const root = ctx.root(), model = ctx.model();
  if (!root || !model) return { ok: false, error: "the map is not built yet" };
  return { ok: true, ...briefEstimate(root, model) };
}

/** One call: a draft (or `only` a section, or `stale` lines), stored PROPOSED. */
export async function briefDraft(ctx: BriefCtx, opts: { only?: BriefOnly; stale?: boolean; guidance?: string; notes?: string[] } = {}): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const root = ctx.root(), model = ctx.model();
  if (!root || !model) return { ok: false, error: "the map is not built yet" };
  if (!ctx.claudeAvailable()) return { ok: false, error: "the claude CLI is unavailable — the Brief needs one model call" };
  const rec = loadBrief(root);
  const only: BriefOnly | undefined = opts.stale ? "spec" : opts.only;
  const notes = (opts.notes ?? []).filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim().slice(0, 400)).slice(0, 12);
  const inp = briefInputs(root, model, { only, pending: rec.proposed, notes });
  let restate: string[] | undefined;
  if (opts.stale) {
    const r = briefWithStaleness(rec, inp.facts);
    restate = r?.spec ? allLines(r.spec).filter((l) => l.stale?.length).map((l) => l.text) : [];
    if (!restate.length) return { ok: false, error: "no ratified line of the Brief is stale" };
  }
  if (only === "scopes" && !inp.facts.silent.length) return { ok: false, error: "every silent box is scoped already" };
  const current = rec.proposed && allLines(rec.proposed.spec).length ? rec.proposed.spec : rec.ratified?.spec ?? null;
  const text = await ctx.run(buildBriefPrompt(inp.facts, inp.vocab, inp.opVocab, { only, guidance: opts.guidance?.slice(0, 400), restate, current, absolutes: inp.absolutes }));
  if (text === null) return { ok: false, error: "the model returned nothing" };
  const parsed = parseBrief(text, inp.facts, inp.vocab, inp.opVocab, { model: ctx.modelLabel(), only, absolutes: inp.absolutes });
  if (!parsed.brief) return { ok: false, error: parsed.error };
  if (restate) parsed.brief.restates = restate;
  const next = proposeBrief(rec, parsed.brief, only);
  if (restate && next.proposed) next.proposed.restates = restate;
  saveBrief(root, next);
  ctx.changed();
  return { ok: true, detail: `${allLines(parsed.brief.spec).length} spec line(s), ${parsed.brief.refused.length} refused` };
}

export function briefDecide(ctx: BriefCtx, section: string, decision: "ratify" | "reject"): { ok: boolean; error?: string; detail?: string } {
  const root = ctx.root();
  if (!root) return { ok: false, error: "the Brief needs a project directory" };
  if (section !== "all" && !BRIEF_SECTIONS.includes(section as BriefSection)) return { ok: false, error: `no section ${section}` };
  const r = decideBrief(root, section as BriefSection | "all", decision, ctx.who());
  if (r.ok) ctx.changed();
  return r.ok ? { ok: true, detail: r.detail } : { ok: false, error: r.detail };
}
