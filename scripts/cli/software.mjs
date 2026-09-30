// `software …` (2026-09-30): specs for the tools a project builds on, drafted
// from their own documents behind a citation gate and ratified by a person
// (src/server/software_{store,draft,apply}.ts).
//
// `add` is the one step here that SPENDS TOKENS (one model call) and the one
// that may touch the network: `--from https://…` fetches that page, and
// nothing else is ever fetched. `--dry-run` prints the prompt and spends
// nothing; `--reply <file>` uses a saved model reply instead of spawning.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { spawnClassifier } from "./classify.mjs";
import { loadEnvelope } from "../quality_check.mjs";
import { pipelineHere } from "./pipeline.mjs";
import { listSpecs, loadSpec, saveSpec, removeSpec, saveSource, isSafeTool } from "../../src/server/software_store.ts";
import { buildSpecPrompt, parseSpecReply, gateSpec, htmlToText } from "../../src/server/software_draft.ts";
import { ratifySpec, specIntoPlan } from "../../src/server/software_server.ts";
import { formatSpecMd, specUsage } from "../../src/server/software_apply.ts";
import { runSoftwareEdit, SOFTWARE_EDIT_HELP } from "./software_edit.mjs";
import { isAgentRun } from "./actor.mjs";

export const SOFTWARE_USAGE = `software add <tool> --from <url|file>… | list | show <tool> | edit <tool> | rule … | unknown … | ratify <tool> | plan <tool> | remove <tool>
                                  [--root <dir>] [--json]   a spec for a tool the project builds on, cited from its own docs
                                  (.vibegraph/software/); \`add\` SPENDS TOKENS and fetches the --from URLs (--dry-run: neither)`;

const HELP = `usage: vibegraph-knowledge ${SOFTWARE_USAGE}

  add <tool> --from <url|file> [--from …] [--hint "…"] [--model m] [--dry-run] [--reply <file>]
                     read the documents, ask a model for the spec (one call), keep only what quotes them;
                     saved as a DRAFT — nothing uses it until it is ratified
  list [--json]      every spec, draft or ratified
  show <tool> [--usage] [--json]   the spec with every quote; --usage adds where the code calls it
  ratify <tool>      re-check every quote against the saved sources, then mark it ratified (a person's step)
  plan <tool> [--param name=value …]   put the tool and its rules into the plan (all proposed); a rule's
                     {placeholders} are the project's own names, filled from --param; run again after a spec
                     edit and the planned rules that changed are updated (back to proposed)
${SOFTWARE_EDIT_HELP}
  remove <tool>`;

const MAX_BYTES = 5 * 1024 * 1024;

export async function readFrom(ref) {
  if (/^https?:\/\//i.test(ref)) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30_000);
    try {
      const res = await fetch(ref, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "vibegraph-knowledge (software spec)" } });
      if (!res.ok) return { error: `${ref}: HTTP ${res.status}` };
      const body = await res.text();
      if (body.length > MAX_BYTES) return { error: `${ref}: over ${MAX_BYTES / 1024 / 1024} MB` };
      const html = /html/i.test(res.headers.get("content-type") ?? "") || /^\s*<(!doctype|html)/i.test(body);
      return { text: html ? htmlToText(body) : body };
    } catch (e) { return { error: `${ref}: ${e.name === "AbortError" ? "timed out" : e.message}` }; }
    finally { clearTimeout(timer); }
  }
  const file = resolve(ref);
  if (!existsSync(file)) return { error: `${ref}: no such file` };
  const body = readFileSync(file, "utf-8");
  if (body.length > MAX_BYTES) return { error: `${ref}: over ${MAX_BYTES / 1024 / 1024} MB` };
  return { text: /\.html?$/i.test(file) ? htmlToText(body) : body };
}

export async function runSoftware(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: {
      root: { type: "string" }, json: { type: "boolean" }, from: { type: "string", multiple: true }, hint: { type: "string" },
      model: { type: "string" }, "dry-run": { type: "boolean" }, reply: { type: "string" }, usage: { type: "boolean" },
      param: { type: "string", multiple: true },
      id: { type: "string" }, text: { type: "string" }, why: { type: "string" }, check: { type: "string" },
      core: { type: "boolean" }, "not-core": { type: "boolean" }, cite: { type: "string" },
      question: { type: "string" }, matters: { type: "string" },
    } });
  } catch (e) { return { exitCode: 2, text: `${e.message}\n\n${HELP}\n` }; }
  const [sub, second, third] = parsed.positionals;
  const root = resolve(parsed.values.root ?? ".");
  const done = (text, exitCode = 0) => ({ exitCode, text: text.endsWith("\n") ? text : `${text}\n` });
  if (!sub || sub === "help") return done(HELP, sub ? 0 : 2);
  // `rule add <tool>` / `unknown remove <tool>`: the action comes before the tool.
  const tool = sub === "rule" || sub === "unknown" ? third : second;
  if (sub === "edit" || sub === "rule" || sub === "unknown") {
    const spec = isSafeTool(tool) ? loadSpec(root, tool) : null;
    if (!spec) return done(`no spec for ${tool ?? "(give the tool)"} (vibegraph-knowledge software list)`, 1);
    return runSoftwareEdit({ root, spec, action: sub, sub: second, values: parsed.values, done });
  }
  if (sub === "list") {
    const specs = listSpecs(root);
    if (parsed.values.json) return done(JSON.stringify(specs, null, 2));
    if (!specs.length) return done("no software specs (.vibegraph/software/) — draft one: vibegraph-knowledge software add <tool> --from <docs url or file>");
    return done(specs.map((s) => `${s.tool.padEnd(24)} ${s.status.padEnd(9)} ${s.role.padEnd(14)} ${s.operations.length} operations, ${s.rules.length} rules${s.gate?.inferred.length ? `, ${s.gate.inferred.length} inferred` : ""} — ${s.sources.map((x) => x.ref).join(", ")}`).join("\n"));
  }
  if (!isSafeTool(tool)) return done(`${sub} needs a tool name`, 2);

  if (sub === "add") {
    const refs = parsed.values.from ?? [];
    if (!refs.length) return done("add needs --from <url or file> (one or more): the documents the spec is drawn from", 2);
    const texts = [];
    for (const ref of refs) {
      const r = await readFrom(ref);
      if (r.error) return done(`could not read ${r.error}`, 1);
      if (!r.text.trim()) return done(`${ref} has no text`, 1);
      texts.push({ ref, text: r.text });
    }
    const prompt = buildSpecPrompt(tool, texts, parsed.values.hint);
    if (parsed.values["dry-run"]) return done(`(dry run — nothing spent, nothing saved)\n\n${prompt}`);
    let reply, by;
    if (parsed.values.reply) { reply = readFileSync(resolve(parsed.values.reply), "utf-8"); by = `saved reply ${parsed.values.reply}`; }
    else {
      const r = spawnClassifier({ prompt, model: parsed.values.model, cwd: root });
      if (!r.ok) return done(`the model could not be run: ${r.error}`, 3);
      reply = r.text; by = r.label + (parsed.values.model ? ` --model ${parsed.values.model}` : "");
    }
    const p = parseSpecReply(reply);
    if (p.error) return done(`refused: ${p.error}`, 1);
    const sources = texts.map((t) => saveSource(root, tool, t.ref, t.text));
    const g = gateSpec(p.value, tool, sources, texts.map((t) => t.text), by);
    if (g.error) return done(`refused: ${g.error}`, 1);
    const saved = saveSpec(root, g.spec);
    if (saved.error) return done(`refused: ${saved.error}`, 1);
    return done([
      `drafted .vibegraph/software/ ${tool}: ${g.spec.operations.length} operations, ${g.spec.states.length} states, ${g.spec.permissions.length} permissions, ${g.spec.rules.length} rules — a DRAFT, used nowhere until ratified`,
      `citation gate: ${g.dropped.length} dropped (quote not in the documents), ${g.inferred.length} inferred (no quote)`,
      ...g.dropped.map((d) => `  dropped: ${d}`), ...g.inferred.map((d) => `  inferred: ${d}`),
      `read it: vibegraph-knowledge software show ${tool}; then: vibegraph-knowledge software ratify ${tool}`,
    ].join("\n"));
  }
  const spec = loadSpec(root, tool);
  if (!spec) return done(`no spec for ${tool} (vibegraph-knowledge software list)`, 1);
  if (sub === "show") {
    if (parsed.values.json) return done(JSON.stringify(spec, null, 2));
    let usage;
    if (parsed.values.usage) usage = specUsage(spec, loadEnvelope(root, null, pipelineHere(root), { cache: true }).envelope.files);
    return done(formatSpecMd(spec, usage));
  }
  if (sub === "ratify") {
    const r = ratifySpec(root, tool);
    if (r.error) return done(`refused: ${r.error}`, 1);
    const inferred = spec.gate?.inferred.length ?? 0;
    return done(`${r.message}${inferred ? ` (with ${inferred} inferred item(s) — not in its docs, now accepted by you)` : ""}: the stack index, the plan and the hooks use it now`);
  }
  if (sub === "remove") return removeSpec(root, tool) ? done(`removed ${tool}`) : done(`no spec for ${tool}`, 1);
  if (sub === "plan") {
    const params = {};
    for (const kv of parsed.values.param ?? []) {
      const m = /^(\w+)=(.+)$/.exec(kv);
      if (!m) return done(`--param wants name=value (got ${kv})`, 2);
      params[m[1]] = m[2];
    }
    const r = specIntoPlan(root, tool, params, isAgentRun() ? "agent" : "human");
    return r.error ? done(`refused: ${r.error}`, 1) : done(`${r.message}; agree each in the Plan panel or with \`plan agree\``);
  }
  return done(`unknown software subcommand: ${sub}\n\n${HELP}`, 2);
}
