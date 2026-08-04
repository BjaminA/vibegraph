/**
 * Model tiers — route each LLM spawn by WHAT IT DOES, not by a guess.
 *
 * VibeGraph's per-spawn floor is real money: a trivial prompt measured
 * ~$0.25 on Opus 5 and ~$0.04 on Haiku 4.5, almost all of it the CLI
 * establishing its system prompt and tools before any work happens. That
 * floor is per SPAWN, so it compounds on batch operations — a skill sweep
 * drafts one skill per thread, so 18 entry points is 18 of those.
 *
 * Two rules this design follows, both load-bearing:
 *
 * 1. ROUTE BY CALL SITE, NEVER BY JUDGEMENT. Asking a model "is this
 *    hard?" costs a spawn to decide, which defeats the saving on exactly
 *    the cheap tasks. The server already knows: system_draft is always
 *    architecture, synth_data is always a mechanical example file. The
 *    mapping below is that knowledge, written down.
 *
 * 2. THE CHAT IS NOT ROUTED HERE. Prompt caches are model-scoped, so
 *    switching models mid-conversation invalidates tools, system AND
 *    message cache — the persistent chat session is what took the
 *    greenfield showdown from $3.57 to $1.62, and a per-turn flip hands
 *    that back. The chat has its own explicit picker (chat_models.ts);
 *    these tiers cover the one-shot spawns, which have no cross-spawn
 *    cache to protect.
 *
 * Deliberately NOT cheapened: anything that writes code to disk, AND
 * anything checked against a machine-verified floor. Thread skills and
 * explain must cite real node ids or the grounding gate discards the
 * result ("generation not grounded — not persisted"), so a weaker model
 * there burns a spawn and produces nothing. Rehearsal-3 hit exactly that
 * after skills were first (wrongly) put on the routine tier.
 *
 * The same holds for code: OPUS-SHOWDOWN found Opus writing behavioural
 * checks stricter than its own code — 2 of 6 increments needed a Modify
 * round-trip. A weaker builder means more red floors, and every Modify is
 * another full-price spawn.
 *
 * The rule both cases share: IF A FLOOR CAN REJECT THE OUTPUT, THE CHEAP
 * TIER IS A FALSE ECONOMY. Only bounded text jobs with no floor — READMEs,
 * example data, run arguments — are on the routine tier.
 */

export type ModelTier = "thinking" | "routine";

export interface TierOption {
  /** `--model` value; null = don't pass the flag (CLI default). */
  id: string | null;
  label: string;
  hint: string;
}

/** What each tier governs — rendered under its picker so changing a tier
 * is an informed choice rather than a guess. */
export const TIER_GOVERNS: Record<ModelTier, string[]> = {
  thinking: ["Architecture", "Roadmap", "Builder increments", "Intent edits", "Compose", "Thread skills", "Explain"],
  routine: ["READMEs", "Example data", "Run arguments"],
};

export const TIER_LABEL: Record<ModelTier, string> = {
  thinking: "Thinking & code",
  routine: "Routine work",
};

export const THINKING_OPTIONS: TierOption[] = [
  { id: null, label: "Default", hint: "Whatever your claude CLI is set to" },
  { id: "claude-fable-5", label: "Fable 5", hint: "Hardest work. 2x Opus cost, slower turns" },
  { id: "claude-opus-5", label: "Opus 5", hint: "The workhorse for design and code" },
];

export const ROUTINE_OPTIONS: TierOption[] = [
  // "Match" is the pre-tier behaviour: one model for everything. Keeping it
  // selectable means the whole feature is opt-out in one click.
  { id: "match", label: "Match above", hint: "No split — same model as Thinking & code" },
  { id: "claude-sonnet-5", label: "Sonnet 5", hint: "Capable and much cheaper — the default" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", hint: "Cheapest. Draft quality unverified — try it" },
];

export interface TierSettings {
  thinking: string | null;
  /** `"match"` = follow the thinking tier. */
  routine: string | null;
}

/**
 * Routine defaults to Sonnet, NOT Haiku: the per-spawn saving is already
 * most of the way there, and whether Haiku's output is good enough for the
 * remaining routine jobs is untested. Haiku is offered, not assumed.
 */
export const DEFAULT_TIERS: TierSettings = {
  thinking: null,
  routine: "claude-sonnet-5",
};

/** Effort for the routine tier. These spawns are one-shot with no cache to
 * protect, so trimming reasoning is free of the trade-off it would carry
 * mid-conversation. */
export const ROUTINE_EFFORT = "low";

function isKnown(options: TierOption[], id: unknown): boolean {
  return options.some((o) => o.id === id);
}

/**
 * Boundary validation — an arbitrary `--model` string from a WS client must
 * never reach the CLI. Anything unrecognised falls back to the default for
 * that tier rather than being passed through.
 */
export function sanitiseTiers(raw: unknown): TierSettings {
  const v = (raw ?? {}) as Partial<TierSettings>;
  return {
    thinking: isKnown(THINKING_OPTIONS, v.thinking) ? v.thinking! : DEFAULT_TIERS.thinking,
    routine: isKnown(ROUTINE_OPTIONS, v.routine) ? v.routine! : DEFAULT_TIERS.routine,
  };
}

/**
 * The `--model` / `--effort` flags for a tier, as CLI prefix args.
 *
 * They must land BEFORE `-p`: gen spawns end with `-- <prompt>`, so a
 * trailing flag would be parsed as a positional (same constraint the
 * metering wrapper documents).
 */
export function tierArgs(tier: ModelTier, settings: TierSettings): string[] {
  if (tier === "thinking") {
    return settings.thinking ? ["--model", settings.thinking] : [];
  }
  const routine = settings.routine === "match" ? settings.thinking : settings.routine;
  const args = routine ? ["--model", routine] : [];
  // Only trim effort when we actually stepped down to a cheaper model —
  // "Match above" means the user asked for no split at all, and silently
  // lowering effort there would be a split they didn't ask for.
  if (settings.routine !== "match") args.push("--effort", ROUTINE_EFFORT);
  return args;
}
