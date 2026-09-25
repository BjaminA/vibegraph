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
 *
 * M-PROVIDER (2026-09-08) — a third axis, PROVIDER per tier. Each tier may
 * be served by the claude CLI (the tier's model above), by a LOCAL Ollama
 * server (an endpoint URL + model name — the app never loads weights
 * itself), or by a CUSTOM command that speaks the `claude -p` contract.
 * Work-run WORKERS get their own tier so the small local axe can be handed
 * to them without handing it to the brief and the review. The tier table's
 * own rule still applies and the UI says so: where a floor can reject the
 * output, a weak model means retries.
 */

export type ModelTier = "thinking" | "routine" | "worker";

export interface TierOption {
  /** `--model` value; null = don't pass the flag (CLI default). */
  id: string | null;
  label: string;
  hint: string;
}

/** What each tier governs — rendered under its picker so changing a tier
 * is an informed choice rather than a guess. */
export const TIER_GOVERNS: Record<ModelTier, string[]> = {
  thinking: ["Architecture", "Roadmap", "Builder increments", "Intent edits", "Compose", "Thread skills", "Explain", "Orchestrator brief", "Orchestrator review"],
  routine: ["READMEs", "Example data", "Run arguments"],
  worker: ["Work-run workers (packet edits through the chokepoint)"],
};

export const TIER_LABEL: Record<ModelTier, string> = {
  thinking: "Thinking & code",
  routine: "Routine work",
  worker: "Work-run workers",
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

/** M-PROVIDER — the worker tier's claude options. "match" = the thinking
 * model (the pre-M-PROVIDER behaviour: workers spawned on the thinking tier). */
export const WORKER_OPTIONS: TierOption[] = [
  { id: "match", label: "Match Thinking & code", hint: "Workers use the thinking model — the default" },
  { id: "claude-sonnet-5", label: "Sonnet 5", hint: "Cheaper workers; the reviewer still checks every diff" },
  { id: "claude-opus-5", label: "Opus 5", hint: "Strongest workers" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", hint: "Cheapest. Expect more rejections on real edits" },
];

// ── M-PROVIDER — providers, routes, the local endpoint ────────────────

export type ProviderKind = "claude" | "ollama" | "command";

/** A local model SERVER, not a file: Ollama's HTTP API at `endpoint`, serving `model`. */
export interface LocalEndpoint {
  endpoint: string;
  model: string;
}

/** Per-tier provider choice. "claude" = the tier's model above (the
 * default when absent). "ollama" = the local server (endpoint/model fall
 * back to `local`). "command" = a program that speaks the `claude -p`
 * contract, spawned WITHOUT a shell. */
export interface TierRoute {
  provider: ProviderKind;
  endpoint?: string;
  model?: string;
  command?: string;
}

export interface TierSettings {
  thinking: string | null;
  /** `"match"` = follow the thinking tier. */
  routine: string | null;
  /** M-PROVIDER — the worker tier's claude model; `"match"` = the thinking model. */
  worker?: string | null;
  /** M-PROVIDER — local defaults every "ollama" route falls back to; the chat's "Local" option uses these. */
  local?: LocalEndpoint;
  /** M-PROVIDER — per-tier provider; a missing tier means claude. */
  routes?: Partial<Record<ModelTier, TierRoute>>;
}

export const DEFAULT_LOCAL: LocalEndpoint = { endpoint: "http://localhost:11434", model: "qwen2.5-coder:7b" };

/**
 * Routine defaults to Sonnet, NOT Haiku: the per-spawn saving is already
 * most of the way there, and whether Haiku's output is good enough for the
 * remaining routine jobs is untested. Haiku is offered, not assumed.
 */
export const DEFAULT_TIERS: TierSettings = {
  thinking: null,
  routine: "claude-sonnet-5",
  worker: "match",
  local: DEFAULT_LOCAL,
  routes: {},
};

/** Effort for the routine tier. These spawns are one-shot with no cache to
 * protect, so trimming reasoning is free of the trade-off it would carry
 * mid-conversation. */
export const ROUTINE_EFFORT = "low";

export const TIERS: ModelTier[] = ["thinking", "routine", "worker"];

function isKnown(options: TierOption[], id: unknown): boolean {
  return options.some((o) => o.id === id);
}

/** An endpoint is an http(s) URL with a host, no credentials, no query, ≤ 200 chars. */
export function isSafeEndpoint(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > 200) return false;
  try {
    const u = new URL(v);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname && !u.username && !u.password && !u.search && !u.hash;
  } catch { return false; }
}

/** Ollama model names: `qwen2.5-coder:7b`, `library/name:tag`. */
export function isSafeModelName(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._\-\/:]{0,119}$/.test(v);
}

/** A custom command line: printable, single line, ≤ 300 chars. It is
 * spawned WITHOUT a shell (whitespace-split), so metacharacters are inert. */
export function isSafeCommand(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= 300 && !/[\r\n\0]/.test(v);
}

/** Normalise an endpoint for comparison/persistence (drop a trailing slash). */
export function normaliseEndpoint(e: string): string {
  return e.replace(/\/+$/, "");
}

function sanitiseLocal(raw: unknown): LocalEndpoint {
  const v = (raw ?? {}) as Partial<LocalEndpoint>;
  return {
    endpoint: isSafeEndpoint(v.endpoint) ? normaliseEndpoint(v.endpoint) : DEFAULT_LOCAL.endpoint,
    model: isSafeModelName(v.model) ? v.model : DEFAULT_LOCAL.model,
  };
}

function sanitiseRoute(raw: unknown): TierRoute | null {
  const v = (raw ?? {}) as Partial<TierRoute>;
  if (v.provider === "ollama") {
    return {
      provider: "ollama",
      ...(isSafeEndpoint(v.endpoint) ? { endpoint: normaliseEndpoint(v.endpoint) } : {}),
      ...(isSafeModelName(v.model) ? { model: v.model } : {}),
    };
  }
  if (v.provider === "command") {
    return isSafeCommand(v.command) ? { provider: "command", command: v.command.trim() } : null;
  }
  // A "claude" route that NAMES AN ENDPOINT is the CLI pointed at a gateway
  // speaking the Anthropic Message Protocol (z.ai serving GLM, say). It is
  // still the claude provider — same binary, same spawn, same MCP tool
  // channel, because `--mcp-config` is what carries tools and it is
  // independent of which service answers the inference request. Only the
  // SERVICE moved, so this is a field on the existing route rather than a
  // fourth ProviderKind.
  //
  // The endpoint and the model live here because they are ROUTING, not
  // secrets. The key never does: models.json is per-project and on disk, so
  // the credential stays in the environment (see `gatewayEnv`).
  if (v.provider === "claude" && isSafeEndpoint(v.endpoint)) {
    return {
      provider: "claude",
      endpoint: normaliseEndpoint(v.endpoint),
      ...(isSafeModelName(v.model) ? { model: v.model } : {}),
    };
  }
  // "claude" with no endpoint (or anything unknown) = the default; store
  // nothing, so removing the endpoint IS switching back to Anthropic.
  return null;
}

/**
 * Boundary validation — an arbitrary `--model` string from a WS client must
 * never reach the CLI. Anything unrecognised falls back to the default for
 * that tier rather than being passed through. M-PROVIDER: endpoints must be
 * http(s) URLs, model names a tight charset, commands single printable
 * lines; a route that fails validation is dropped (= claude), never kept
 * half-valid.
 */
export function sanitiseTiers(raw: unknown): TierSettings {
  const v = (raw ?? {}) as Partial<TierSettings>;
  const routes: Partial<Record<ModelTier, TierRoute>> = {};
  const rawRoutes = (v.routes ?? {}) as Record<string, unknown>;
  for (const tier of TIERS) {
    const r = sanitiseRoute(rawRoutes[tier]);
    if (r) routes[tier] = r;
  }
  return {
    thinking: isKnown(THINKING_OPTIONS, v.thinking) ? v.thinking! : DEFAULT_TIERS.thinking,
    routine: isKnown(ROUTINE_OPTIONS, v.routine) ? v.routine! : DEFAULT_TIERS.routine,
    worker: isKnown(WORKER_OPTIONS, v.worker) ? v.worker! : DEFAULT_TIERS.worker,
    local: sanitiseLocal(v.local),
    routes,
  };
}

/** The claude model id a tier resolves to (null = CLI default). */
export function tierClaudeModel(tier: ModelTier, settings: TierSettings): string | null {
  if (tier === "thinking") return settings.thinking;
  if (tier === "routine") return settings.routine === "match" ? settings.thinking : settings.routine;
  const w = settings.worker ?? "match";
  return w === "match" ? settings.thinking : w;
}

/**
 * The `--model` / `--effort` flags for a tier, as CLI prefix args.
 *
 * They must land BEFORE `-p`: gen spawns end with `-- <prompt>`, so a
 * trailing flag would be parsed as a positional (same constraint the
 * metering wrapper documents).
 */
export function tierArgs(tier: ModelTier, settings: TierSettings): string[] {
  const model = tierClaudeModel(tier, settings);
  const args = model ? ["--model", model] : [];
  // Only trim effort when we actually stepped down to a cheaper model —
  // "Match above" means the user asked for no split at all, and silently
  // lowering effort there would be a split they didn't ask for. Workers
  // write code: never trimmed.
  if (tier === "routine" && settings.routine !== "match") args.push("--effort", ROUTINE_EFFORT);
  return args;
}

/** M-PROVIDER — the fully resolved route for a tier: what will be spawned. */
export type ResolvedRoute =
  | { provider: "claude"; model: string | null; args: string[]; endpoint?: string }
  | { provider: "ollama"; endpoint: string; model: string }
  | { provider: "command"; command: string };

export function resolveTierRoute(tier: ModelTier, settings: TierSettings): ResolvedRoute {
  const r = settings.routes?.[tier];
  if (r?.provider === "ollama") {
    const local = settings.local ?? DEFAULT_LOCAL;
    return { provider: "ollama", endpoint: r.endpoint ?? local.endpoint, model: r.model ?? local.model };
  }
  if (r?.provider === "command" && r.command) return { provider: "command", command: r.command };
  if (r?.provider === "claude" && r.endpoint) {
    // A GATEWAY route ignores the tier's Claude model name, deliberately.
    // The tier ladder is Anthropic's catalog (claude-opus-5 / -sonnet-5),
    // and sending one of those names to a service that serves GLM asserts a
    // mapping this project has no business claiming on the gateway's
    // behalf. The route's OWN model is the only model named; with none, the
    // endpoint's default serves. `--effort` is dropped for the same reason
    // — it is a Claude flag, and a gateway need not understand it.
    const model = isSafeModelName(r.model) ? r.model : null;
    return {
      provider: "claude", endpoint: r.endpoint, model,
      args: model ? ["--model", model] : [],
    };
  }
  return { provider: "claude", model: tierClaudeModel(tier, settings), args: tierArgs(tier, settings) };
}

/**
 * The SERVICE half of a claude-provider label: `@host` when the CLI has
 * been pointed somewhere other than Anthropic, `""` when it has not.
 *
 * `ollama:<model>@<endpoint>` is the precedent: where the service is a
 * choice, the label names it. A run served by GLM must not record
 * `claude:default`, which is the lie M-BOUNDARY.5 already had to fix once
 * for a model pinned through VG_CLAUDE_BIN.
 *
 * THE HOST ONLY, never the URL. This string is written to
 * `.vibegraph/work-run.json` and quoted into reports, and a base URL can
 * carry a token in its path or query. The host identifies the service and
 * cannot leak a credential. A URL that does not parse is named `@custom`
 * for the same reason — it says "not Anthropic" without echoing a string
 * whose shape is unknown.
 *
 * Pure and webview-safe, so the Models panel and the audit trail say the
 * same thing through one function.
 */
export function serviceSuffix(baseUrl: string | null | undefined): string {
  const raw = baseUrl?.trim();
  if (!raw) return "";
  let host: string;
  try {
    host = new URL(raw).host;
  } catch {
    return "@custom";
  }
  if (!host) return "@custom";
  const bare = host.replace(/:\d+$/, "").toLowerCase();
  if (bare === "anthropic.com" || bare.endsWith(".anthropic.com")) return "";
  return `@${host}`;
}

/** A short, honest label for audit trails: who actually did the work. */
export function routeLabel(route: ResolvedRoute): string {
  if (route.provider === "claude") return `claude:${route.model ?? "default"}${serviceSuffix(route.endpoint)}`;
  if (route.provider === "ollama") return `ollama:${route.model}@${route.endpoint}`;
  return `command:${route.command.split(/\s+/)[0]}`;
}
