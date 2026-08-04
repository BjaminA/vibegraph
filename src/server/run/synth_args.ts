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
import {
  DEFAULT_TIERS, tierArgs, type ModelTier, type TierSettings,
} from "../../shared/model_tiers.ts";

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
export function resolveClaudeBin(tier?: ModelTier): { cmd: string; args: string[] } {
  const routing = tier ? tierArgs(tier, getModelTiers()) : [];
  const raw = process.env.VG_CLAUDE_BIN;
  if (raw && raw.trim().length > 0) {
    const parts = raw.trim().split(/\s+/);
    return { cmd: parts[0], args: [...parts.slice(1), ...routing] };
  }
  return { cmd: "claude", args: routing };
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
  const { cmd, args: pre } = resolveClaudeBin("routine");
  return new Promise((resolve) => {
    const child = spawn(
      cmd,
      [...pre, "-p", "--output-format", "json", "--strict-mcp-config",
        "--mcp-config", '{"mcpServers":{}}',
        "--dangerously-skip-permissions", "--", prompt],
      { cwd, env: { ...process.env } },
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
