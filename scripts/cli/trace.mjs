// `vibegraph-knowledge trace` (2026-10-08) — rung 4 of the run-time ladder:
// recorded runs, opted in once per project by a person. Zero tokens.
//
//   trace enable [<root>]          a person's step: writes .vibegraph/trace.json and the
//                                  recorder's config, and loads the recorder into Node
//                                  processes Claude Code starts here (NODE_OPTIONS in
//                                  .claude/settings.local.json, per user, never committed)
//   trace disable [<root>]         a person's step: off, and the NODE_OPTIONS entry removed
//   trace forbid [<root>]          a person's step: off for everyone (trace.json may be committed)
//   trace status [<root>]          on or off, and what the runs so far observed
//   trace run [<root>] -- <cmd>…   run a command with the recorder loaded (tracing must be on)
//
// What a run records: per operation the recorder sees, the process (its script),
// the verb and the ZONE — never a value, a key, a document id or the name.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { cliPath } from "./winpath.mjs";
import { loadEnvelope } from "../quality_check.mjs";
import { pipelineHere } from "./pipeline.mjs";
import { buildStackIndex } from "../../src/server/stack.ts";
import { buildCrossingIndex } from "../../src/server/crossings.ts";
import { archModelForEnvelope } from "../../src/server/arch_envelope.ts";
import { deriveDataArchitecture } from "../../src/server/data_arch.ts";
import { registeredAccess } from "../../src/server/registered_access.ts";
import { loadPlan } from "../../src/server/plan_store.ts";
import { buildTraceConfig } from "../../src/server/trace_config.ts";
import { observedOps, readRuns } from "../../src/server/trace_runs.ts";
import { ensurePrivateIgnore } from "../../src/server/local_guard.ts";
import { personName } from "../../src/server/person.ts";

export const TRACE_USAGE = `trace enable|disable|forbid|status [<root>]       recorded runs (a person opts in once): which zone each
                                  operation of a project process reaches, observed — never a value, key or name
      trace run [<root>] -- <command>…                 run a command with the recorder loaded`;

const here = dirname(fileURLToPath(import.meta.url));
/** The recorder file: beside the CLI in a checkout, under vendor/ in the package. */
export function tracerPath() {
  for (const p of [join(here, "..", "node_tracer.mjs"), join(here, "..", "vendor", "scripts", "node_tracer.mjs")]) if (existsSync(p)) return p;
  return null;
}
const importFlag = (root) => { const p = tracerPath(); return p ? `--import=${pathToFileURL(p).href}?root=${encodeURIComponent(root)}` : null; };
const TRACE_FILE = (root) => join(root, ".vibegraph", "trace.json");
const readSetting = (root) => { try { return JSON.parse(readFileSync(TRACE_FILE(root), "utf-8")); } catch { return {}; } };
const writeSetting = (root, s) => { mkdirSync(join(root, ".vibegraph"), { recursive: true }); writeFileSync(TRACE_FILE(root), JSON.stringify(s, null, 2) + "\n"); };

/** NODE_OPTIONS in .claude/settings.local.json: our --import added or removed, the rest kept. */
function settingsEnv(root, add) {
  const p = join(root, ".claude", "settings.local.json");
  let s = {};
  try { s = JSON.parse(readFileSync(p, "utf-8")); } catch { s = {}; }
  const parts = String(s.env?.NODE_OPTIONS ?? "").split(/\s+/).filter((x) => x && !x.includes("node_tracer.mjs"));
  if (add) parts.push(add);
  s.env = { ...(s.env ?? {}) };
  if (parts.length) s.env.NODE_OPTIONS = parts.join(" "); else delete s.env.NODE_OPTIONS;
  if (!Object.keys(s.env).length) delete s.env;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
  return p;
}

function writeConfig(root) {
  const { envelope } = loadEnvelope(root, null, pipelineHere(root), { cache: true });
  const stack = buildStackIndex(envelope, root);
  const da = deriveDataArchitecture(envelope.files, stack, envelope.threads, registeredAccess(root));
  const cfg = buildTraceConfig(envelope.files, da, loadPlan(root));
  mkdirSync(join(root, ".vibegraph", "trace"), { recursive: true });
  writeFileSync(join(root, ".vibegraph", "trace", "config.json"), JSON.stringify(cfg, null, 2) + "\n");
  ensurePrivateIgnore(root);
  return { cfg, envelope, stack };
}

function summary(root, envelope, stack) {
  const model = archModelForEnvelope(envelope, stack, buildCrossingIndex(envelope), root);
  const obs = observedOps(root, model);
  const label = new Map(model.nodes.map((n) => [n.id, n.label]));
  const runs = new Set(readRuns(root).map((e) => e.run));
  return [`${runs.size} recorded run(s); operations observed:`, ...(obs.length ? obs.map((o) => `  ${label.get(o.box) ?? o.box} ${o.op} ${o.zone.replace(/^zone:/, "")} — in ${o.runs.length} run(s)`) : ["  none yet"])];
}

export function runTrace(args) {
  const dash = args.indexOf("--");
  const head = dash >= 0 ? args.slice(0, dash) : args;
  const command = dash >= 0 ? args.slice(dash + 1) : [];
  const [sub, rootArg] = head;
  const root = resolve(cliPath(rootArg ?? "."));
  const done = (text, exitCode = 0) => ({ exitCode, text: text.endsWith("\n") ? text : `${text}\n` });
  const s = readSetting(root);
  if (sub === "enable") {
    if (s.forbidden) return done("tracing is forbidden for this project (.vibegraph/trace.json) — a person lifts that by editing the file", 1);
    const flag = importFlag(root);
    if (!flag) return done("the recorder file was not found next to this CLI — reinstall vibegraph-knowledge", 3);
    const { cfg } = writeConfig(root);
    writeSetting(root, { ...s, enabled: true, at: new Date().toISOString(), by: personName(root) });
    const settings = settingsEnv(root, flag);
    return done([
      "tracing ENABLED for this project.",
      `  the recorder wraps ${cfg.targets.length} method(s) the code names resources through and maps names to ${cfg.families.length} pattern(s); it writes, per operation, only the process, the verb and the zone — never a value, a key or a name — to .vibegraph/traces/ (git-ignored)`,
      `  Node processes Claude Code starts here load it: NODE_OPTIONS in ${settings} (per user, not committed); outside Claude Code: \`vibegraph-knowledge trace run -- <command>\``,
      "  limit: an operation through a plain exported function, or an object no wrapped method hands out, is not seen",
      "  off again: `vibegraph-knowledge trace disable`; for everyone: `trace forbid`",
    ].join("\n"));
  }
  if (sub === "disable" || sub === "forbid") {
    writeSetting(root, { ...s, enabled: false, ...(sub === "forbid" ? { forbidden: true } : {}), at: new Date().toISOString(), by: personName(root) });
    settingsEnv(root, null);
    return done(`tracing ${sub === "forbid" ? "FORBIDDEN for this project" : "disabled"}; the recorder is no longer loaded`);
  }
  if (sub === "status") {
    const { envelope } = loadEnvelope(root, null, pipelineHere(root), { cache: true });
    return done([`tracing is ${s.forbidden ? "FORBIDDEN" : s.enabled ? "ON" : "off"}${s.by ? ` (${s.by}, ${String(s.at ?? "").slice(0, 10)})` : ""}`, ...summary(root, envelope, buildStackIndex(envelope, root))].join("\n"));
  }
  if (sub === "run") {
    if (!s.enabled || s.forbidden) return done("tracing is off for this project — a person turns it on with `vibegraph-knowledge trace enable`", 1);
    if (!command.length) return done("trace run needs a command after --", 2);
    const flag = importFlag(root);
    const { envelope, stack } = writeConfig(root);
    const started = Date.now();
    const r = spawnSync(command[0], command.slice(1), { cwd: root, stdio: "inherit", env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, flag].filter(Boolean).join(" ") } });
    let fresh = 0;
    try { fresh = readdirSync(join(root, ".vibegraph", "traces")).filter((f) => f.startsWith("run-") && statSync(join(root, ".vibegraph", "traces", f)).mtimeMs >= started).length; } catch { fresh = 0; }
    return done([`the command exited ${r.status ?? r.signal}; ${fresh} process run(s) recorded`, ...summary(root, envelope, stack)].join("\n"), r.status ?? 1);
  }
  return done(`usage: vibegraph-knowledge ${TRACE_USAGE}`, 2);
}
