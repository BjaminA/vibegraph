// `setup` (2026-10-20) — the project's setup, one step at a time, in one fixed
// order (src/server/setup_state.ts): software specs → architecture groups →
// the Brief → rules → (direction) → hooks; then, not counted, a plan for what
// is built next (2026-10-21).
// Zero tokens and read-only: it says where the project stands and the exact
// commands for the next step — who may run each (you / Claude / either) and
// which spend tokens. The /vibegraph-setup skill walks a Claude Code session
// through it; a person takes every decision.
//
//   setup [<root>] [--json]
//   setup skip software <name> --why "…"     a package that needs no spec
//   setup skip direction --why "…"
//   setup unskip software <name> | unskip direction
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { outdatedSkills } from "./init.mjs";
import { locate } from "./paths.mjs";
import { loadEnvelope } from "../quality_check.mjs";
import { pipelineHere } from "./pipeline.mjs";
import { cliPath } from "./winpath.mjs";
import { buildStackIndex } from "../../src/server/stack.ts";
import { setupState, loadSkips, saveSkips, SKIPPABLE_STEPS } from "../../src/server/setup_state.ts";
import { loadDirection } from "../../src/server/project_direction.ts";
import { censusNow } from "./project_direction_context.mjs";

export const SETUP_USAGE = `setup [<root>] [--json]                 the project's setup, in order: software specs, architecture groups, the Brief,
                                  rules, the hooks, then a plan for what you build next — where it stands and the
                                  exact next commands (who may run each, which spend tokens); zero tokens
  setup skip software <name> --why "…" | skip direction --why "…" | unskip software <name> | unskip direction`;

const LABEL = { done: "done", waiting: "waiting for you", todo: "to do", optional: "optional", skipped: "set aside" };
const WHO = { you: "you:", claude: "Claude may:", either: "either:" };

/** A command as it can be pasted: run as the command that ran `setup`
 *  (2026-10-20, live run: a session handed a person "replace
 *  `vibegraph-knowledge` with the full node command, same as I ran above"). */
export const asRun = (run, cli) => (cli && cli !== "vibegraph-knowledge" ? run.replace(/^vibegraph-knowledge(?= |$)/, cli) : run);

/** The checklist as text; `cli` = how this CLI was invoked; `stale` = the
 *  installed skills an older version wrote. */
export function setupText(state, root, cli = null, stale = []) {
  const head = state.next ? ` Next: ${state.next.title}.` : ` Every step is done.${state.after ? ` After the setup: ${state.after.title}.` : ""}`;
  const lines = [`VibeGraph setup for ${root}: ${state.done} of ${state.of} steps done.${head}`, ""];
  if (stale.length) {
    const user = stale.some((s) => s.user), here = stale.some((s) => !s.user);
    lines.push(`note: ${stale.map((s) => s.name).join(", ")} ${stale.length === 1 ? "was" : "were"} installed by an older VibeGraph and say${stale.length === 1 ? "s" : ""} things this one does not — refresh before following ${stale.length === 1 ? "it" : "them"}: ${[here ? asRun("vibegraph-knowledge init --skill", cli) : "", user ? asRun("vibegraph-knowledge init --skill --user", cli) : ""].filter(Boolean).join(" ; ")}`, "");
  }
  state.steps.forEach((s, i) => {
    if (s.after && !state.steps[i - 1]?.after) lines.push("After the setup, not counted in it:");
    const mark = state.next && s.id === state.next.id ? "next" : state.after?.id === s.id ? "then" : LABEL[s.status];
    lines.push(`[${mark}] ${i + 1}. ${s.title}${s.status !== "done" && (mark === "next" || mark === "then") ? ` (${LABEL[s.status]})` : ""}`);
    for (const f of s.facts) lines.push(`      ${f}`);
    // the commands for the step that is next (or offered after) in full; others only when they wait for a person
    if (s.status !== "done" && (state.next?.id === s.id || state.after?.id === s.id || s.status === "waiting")) {
      for (const c of s.commands) lines.push(`      ${WHO[c.who].padEnd(11)} ${asRun(c.run, cli)}${c.spends ? "   (spends tokens)" : ""}\n                  ${c.why}`);
    }
    if (s.status === "done" && s.commands.length && s.id === "hooks") for (const c of s.commands) lines.push(`      ${WHO[c.who].padEnd(11)} ${asRun(c.run, cli)}`);
  });
  lines.push("", "\"you:\" is a person's step — Claude Code is refused it. \"Claude may:\" steps that spend tokens wait for a person's yes.");
  return lines.join("\n") + "\n";
}

export function runSetup(args, { cli = null, home = homedir() } = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: { json: { type: "boolean" }, why: { type: "string" }, root: { type: "string" } } });
  } catch (e) { return { exitCode: 2, text: `${e.message}\n\nusage: vibegraph-knowledge ${SETUP_USAGE}\n` }; }
  const [sub, a, b] = parsed.positionals;
  if (sub === "skip" || sub === "unskip") {
    const isSoftware = a === "software";
    const name = isSoftware ? b : a;
    const root = resolve(cliPath(parsed.values.root ?? (isSoftware ? parsed.positionals[3] : b) ?? "."));
    if (!name) return { exitCode: 2, text: `usage: vibegraph-knowledge ${SETUP_USAGE}\n` };
    if (!isSoftware && !SKIPPABLE_STEPS.includes(name)) return { exitCode: 2, text: `only these steps can be set aside: ${SKIPPABLE_STEPS.join(", ")} (and a software candidate: setup skip software <name>) — the others say "done" when there is nothing to do\n` };
    const skips = loadSkips(root);
    const bucket = isSoftware ? skips.software : skips.steps;
    if (sub === "skip") {
      if (!parsed.values.why?.trim()) return { exitCode: 2, text: "say why: --why \"…\" (it is kept, and shown where the step is)\n" };
      bucket[name] = { why: parsed.values.why.trim(), at: new Date().toISOString() };
    } else if (!bucket[name]) return { exitCode: 1, text: `${name} was not set aside\n` };
    else delete bucket[name];
    saveSkips(root, skips);
    return { exitCode: 0, text: `${sub === "skip" ? "set aside" : "back in"}: ${isSoftware ? `software ${name}` : name}\n` };
  }
  const root = resolve(cliPath(parsed.values.root ?? sub ?? "."));
  const { envelope } = loadEnvelope(root, null, pipelineHere(root), { cache: true });
  const stack = buildStackIndex(envelope, root);
  const state = setupState(root, { stack, census: loadDirection(root).rules.some((r) => r.status === "proposed") ? censusNow(root, { envelope, stack }) : null });
  const head = `${Object.keys(envelope.files ?? {}).length} parsed source files, ${envelope.threads?.length ?? 0} threads`;
  let stale = [];
  try { stale = outdatedSkills({ root, loc: locate(), home }); } catch { stale = []; }
  if (parsed.values.json) return { exitCode: 0, text: JSON.stringify({ parsed: head, ...(cli ? { cli } : {}), ...(stale.length ? { skillsOutdated: stale } : {}), ...state, software: state.software }, null, 2) + "\n" };
  return { exitCode: 0, text: `${setupText(state, root, cli, stale)}`.replace("\n\n", `\n(${head})\n\n`) };
}
