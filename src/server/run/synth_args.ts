// M-RUN SM2.b — argument synthesis for "run to this node".
//
// When the entry function needs arguments, ask Claude (one-shot, headless)
// to synthesize PLAUSIBLE PURE-LITERAL values so the run can reach a node
// behind a parameter. Mirrors the _runIntentLlm shape (claude -p
// --output-format json) but lives in its own module so it is importable
// and unit-testable — automated tests drive a json-format stub via
// VG_CLAUDE_BIN (project convention, M10R.7), never the real `claude`.
//
// SAFETY: this only PROPOSES values. Every synthesized expression must
// still pass scripts/check_literals.py (the SM2.a chokepoint) before it is
// injected into executed source. And the SM3 floor (scan_effects.py) runs
// regardless — synthesized inputs never widen the statically-scanned set.

import { spawn } from "child_process";
import * as path from "path";
import {
  DEFAULT_TIERS, tierArgs, resolveTierRoute, routeLabel, serviceSuffix,
  type ModelTier, type TierSettings, type ProviderKind,
} from "../../shared/model_tiers.ts";

// ONE implementation, in the shared module, so the Models panel and the
// audit trail cannot drift. Re-exported because the server side already
// imports it from here — and imported above as well, since `export … from`
// alone creates no local binding for the label to use.
export { serviceSuffix };

/** M-PROVIDER — what a tier spawns. `cmd`/`args` are the PREFIX every
 * caller spreads before `-p`; `provider`/`label` are for audit trails;
 * `timeoutMs` is the worker-session budget (a local model is slower than
 * the CLI, and a 25-turn session on it must not be cut off at 5 min). */
export interface SpawnTarget {
  cmd: string;
  args: string[];
  provider: ProviderKind;
  label: string;
  timeoutMs: number;
  /** Route-specific environment for THIS spawn, merged over the parent's
   * by `spawnEnv`. A gateway route fills the CLI's endpoint/model slots
   * here rather than the whole server's environment. */
  env?: Record<string, string>;
  /** Names `spawnEnv` must DELETE — a wrong-service credential inherited
   * from the parent cannot be cleared by setting it to a string. */
  envUnset?: string[];
}

const CLAUDE_TIMEOUT_MS = 300_000;
const LOCAL_TIMEOUT_MS = 1_800_000;

/**
 * The environment a spawn actually runs with: the parent's, plus whatever
 * the route overrides, minus what the route must remove.
 *
 * Every claude spawn site used to write `{ ...process.env }` inline, which
 * is why a gateway could only be reached by exporting variables around the
 * WHOLE server. Routing is per TIER, so it has to be per SPAWN: this is the
 * one function that turns a resolved route into a child environment, and
 * the call sites now differ from each other in nothing.
 */
export function spawnEnv(target: SpawnTarget): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(target.env ?? {}) };
  for (const k of target.envUnset ?? []) delete env[k];
  return env;
}

/**
 * The CLI slots a gateway route fills, and the credential it must not mix.
 *
 * The variable names belong to the CLIENT, not to whoever issued the key —
 * the `claude` binary looks up ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN /
 * ANTHROPIC_MODEL and knows no others, which is why z.ai's own docs tell
 * you to set an ANTHROPIC_ variable for a GLM key.
 *
 * THE KEY IS NEVER IN models.json. That file is per-project, on disk and
 * committed in fixtures; a credential there would be a secret in the repo.
 * It comes from the environment (`VG_LLM_KEY`, or ANTHROPIC_AUTH_TOKEN set
 * directly) and the route supplies only the routing.
 */
function gatewayEnv(endpoint: string, model: string | null): { env: Record<string, string>; unset: string[] } {
  const env: Record<string, string> = { ANTHROPIC_BASE_URL: endpoint };
  if (model) env.ANTHROPIC_MODEL = model;
  const key = process.env.VG_LLM_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  if (key) env.ANTHROPIC_AUTH_TOKEN = key;
  // An ANTHROPIC_API_KEY from a normal Anthropic login would otherwise sit
  // beside the gateway's token and leave which credential is in play
  // ambiguous — and it is the wrong service's key for this spawn.
  return { env, unset: ["ANTHROPIC_API_KEY"] };
}

// VG_CLAUDE_BIN (whitespace-split; first token = command, rest = prefix
// args) overrides the spawned binary. Same contract as the chat backend's
// resolveBin so one stub mechanism covers every headless Claude path.
//
// `tier` (model_tiers.ts) routes the spawn by what it does: every one-shot
// spawn in the codebase resolves its binary here, so this is the single
// place model routing has to be applied. Returned flags are PREFIX args —
// callers spread them before `-p`, which is required because gen spawns
// end with `-- <prompt>` and a trailing flag becomes a positional.
//
// Omitting `tier` keeps the pre-routing behaviour (no --model), so an
// unrouted caller is unchanged rather than silently cheapened.
//
// M-PROVIDER — a tier routed to a LOCAL Ollama server spawns the shim
// (scripts/vg_ollama_shim.mjs) with its endpoint/model as prefix args; the
// shim speaks the same `claude -p` contract the callers already use, so
// no call site changes. A "command" route spawns the user's program as
// given (no shell). VG_CLAUDE_BIN overrides only the claude provider — the
// user chose the others explicitly.

export function resolveClaudeBin(tier?: ModelTier): SpawnTarget {
  const settings = getModelTiers();
  const route = tier ? resolveTierRoute(tier, settings) : null;
  if (route && route.provider === "ollama") {
    return {
      cmd: process.execPath,
      args: [shimPath, "--ollama-endpoint", route.endpoint, "--ollama-model", route.model],
      provider: "ollama", label: routeLabel(route), timeoutMs: LOCAL_TIMEOUT_MS,
    };
  }
  if (route && route.provider === "command") {
    const parts = route.command.split(/\s+/);
    return { cmd: parts[0], args: parts.slice(1), provider: "command", label: routeLabel(route), timeoutMs: LOCAL_TIMEOUT_MS };
  }
  // `resolveTierRoute` already decided the claude args — the tier ladder for
  // Anthropic, and for a GATEWAY route just its own model with no `--effort`
  // (a Claude model name sent to a service serving GLM asserts a mapping
  // that is the gateway's to claim, not ours). With no tier there is no
  // route and no routing, exactly as before.
  const routing = route && route.provider === "claude" ? route.args : [];
  const gwEndpoint = route && route.provider === "claude" ? route.endpoint ?? null : null;
  const raw = process.env.VG_CLAUDE_BIN;
  // The audit label must say what actually ran: a model pinned through
  // VG_CLAUDE_BIN (the drills run `claude --model claude-opus-5`) is the
  // model when the tier itself pins none — "claude:default" would be a lie.
  const binModel = raw?.match(/--model\s+(\S+)/)?.[1];
  const tierModel = route && route.provider === "claude" ? route.model : null;
  // ...and the same rule one level out: ANTHROPIC_MODEL is the CLI's own
  // default-model env var, so where nothing else pins one it names what
  // will serve. A redirected endpoint usually sets it (the model a gateway
  // serves is not one of ours), which is why it sits ahead of "default".
  const envModel = process.env.ANTHROPIC_MODEL?.trim() || null;
  // A ROUTE'S endpoint outranks the environment's: the route is this tier's
  // stated choice, the env is the whole process's. Either way the label
  // names the service that served, so an arm's report can say which model
  // produced it.
  const baseUrl = gwEndpoint ?? process.env.ANTHROPIC_BASE_URL ?? null;
  const label = `claude:${tierModel ?? binModel ?? envModel ?? "default"}${serviceSuffix(baseUrl)}`;
  const gw = gwEndpoint ? gatewayEnv(gwEndpoint, tierModel) : null;
  const extra = gw ? { env: gw.env, envUnset: gw.unset } : {};
  if (raw && raw.trim().length > 0) {
    const parts = raw.trim().split(/\s+/);
    return { cmd: parts[0], args: [...parts.slice(1), ...routing], provider: "claude", label, timeoutMs: CLAUDE_TIMEOUT_MS, ...extra };
  }
  return { cmd: "claude", args: routing, provider: "claude", label, timeoutMs: CLAUDE_TIMEOUT_MS, ...extra };
}

/** Live tier settings. Held here (not passed through every call site)
 * because the drafts are deep in call chains that have no business
 * threading a UI preference; the setter is the WS boundary in server.ts. */
let modelTiers: TierSettings = DEFAULT_TIERS;
export function getModelTiers(): TierSettings {
  return modelTiers;
}
export function setModelTiers(next: TierSettings): void {
  modelTiers = next;
}

/** M-PROVIDER — where the Ollama shim lives. server.ts sets it from the
 * project root at boot (the bundle's __dirname is dist/); the default
 * serves unbundled runs and tests started from the repo root. */
let shimPath = path.resolve(process.cwd(), "scripts", "vg_ollama_shim.mjs");
export function setShimPath(p: string): void {
  shimPath = p;
}
export function getShimPath(): string {
  return shimPath;
}

// Strip a leading/trailing ```json … ``` (or bare ```) fence if the model
// wrapped its JSON in one despite being asked not to.
function stripFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return (m ? m[1] : t).trim();
}

// M-RUN2.1 — a METHOD run needs an example instance too: the prompt gains
// the class source and asks for constructor args alongside the method args.
export interface InstanceContext {
  className: string;
  classSource: string;
}

function buildPrompt(entryFn: string, fnSource: string, instance?: InstanceContext): string {
  return [
    "You are synthesizing PLAUSIBLE TEST INPUTS so a Python function can be run.",
    instance
      ? `Return ONLY a JSON object of the form {"args": {"<paramName>": "<python literal expression>"}, "instance_args": {"<ctorParam>": "<python literal expression>"}} — instance_args are constructor arguments for ${instance.className} (the method runs on an example instance).`
      : 'Return ONLY a JSON object of the form {"args": {"<paramName>": "<python literal expression>"}}.',
    "Rules for every value expression:",
    "- It MUST be a pure Python literal: a number, string, True/False/None, or a",
    "  list/tuple/set/dict whose elements are themselves literals.",
    "- Do NOT use function calls, variable names, attribute access, f-strings,",
    "  comprehensions, or operators. Only literals. (Non-literal values are rejected.)",
    "- Provide a value for every REQUIRED parameter; OMIT parameters that already",
    "  have a default, and omit self / *args / **kwargs.",
    "- Choose values that are representative of normal use, not edge cases.",
    "No explanation and no code fence — output just the JSON object.",
    "",
    `Function (entry point: ${entryFn}):`,
    "```python",
    fnSource,
    "```",
    ...(instance
      ? ["", `Class (${instance.className} — for instance_args):`, "```python", instance.classSource, "```"]
      : []),
  ].join("\n");
}

export interface SynthResult {
  args: Record<string, string> | null; // param -> literal expression source
  instanceArgs?: Record<string, string>; // M-RUN2.1 — ctor args for a method run
  error?: string;                       // diagnostic when args is null
}

// Synthesize arguments for `entryFn`. Resolves { args } on success, or
// { args: null, error } on any failure (never throws — the caller decides
// how to surface the honest decline). `cwd` is the analyzed project root.
export function synthesizeArgs(entryFn: string, fnSource: string, cwd: string, instance?: InstanceContext): Promise<SynthResult> {
  const prompt = buildPrompt(entryFn, fnSource, instance);
  // Model tier: routine — mechanical literal args.
  const spawnTarget = resolveClaudeBin("routine");
  const { cmd, args: pre } = spawnTarget;
  return new Promise((resolve) => {
    const child = spawn(
      cmd,
      [...pre, "-p", "--output-format", "json", "--strict-mcp-config",
        "--mcp-config", '{"mcpServers":{}}',
        "--dangerously-skip-permissions", "--", prompt],
      { cwd, env: spawnEnv(spawnTarget) },
    );
    child.stdin?.end(); // 6d pre-flight: no open pipe — claude -p otherwise waits 3s for stdin per draft
    let out = "";
    let err = "";
    child.stdout.on("data", (b: Buffer) => { out += b.toString(); });
    child.stderr.on("data", (b: Buffer) => { err += b.toString(); });
    child.on("close", (code) => {
      if (code !== 0) {
        const first = err.split("\n").find((l) => l.trim()) ?? `exit ${code}`;
        resolve({ args: null, error: `claude -p exited ${code}: ${first}` });
        return;
      }
      // claude -p --output-format json wraps the model's reply text in
      // `.result`; the model's own JSON is therefore a STRING inside it.
      let text = "";
      try {
        const parsed = JSON.parse(out);
        text = typeof parsed.result === "string" ? parsed.result : "";
      } catch {
        resolve({ args: null, error: `could not parse claude -p envelope: ${out.slice(0, 200)}` });
        return;
      }
      let obj: any;
      try {
        obj = JSON.parse(stripFence(text));
      } catch {
        resolve({ args: null, error: `model reply was not JSON: ${text.slice(0, 200)}` });
        return;
      }
      if (!obj || typeof obj.args !== "object" || obj.args === null || Array.isArray(obj.args)) {
        resolve({ args: null, error: "model reply had no args object" });
        return;
      }
      // Coerce values to strings (the model may emit a JSON number/bool for a
      // value); check_literals.py validates them structurally next.
      const coerce = (o: Record<string, unknown>): Record<string, string> => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(o)) out[k] = typeof v === "string" ? v : JSON.stringify(v);
        return out;
      };
      const args = coerce(obj.args);
      // M-RUN2.1 — instance_args ride along for a method run; a missing map
      // means "all defaults" (ClassName()), validated downstream either way.
      const instanceArgs = instance
        ? coerce(typeof obj.instance_args === "object" && obj.instance_args !== null && !Array.isArray(obj.instance_args) ? obj.instance_args : {})
        : undefined;
      resolve(instance ? { args, instanceArgs } : { args });
    });
    child.on("error", (e) => {
      resolve({ args: null, error: `claude -p spawn error: ${e.message}` });
    });
  });
}
