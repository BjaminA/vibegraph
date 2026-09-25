#!/usr/bin/env node
// vibegraph-knowledge — PLAN-M-CRYSTAL. Crystallise what VibeGraph derives
// from a codebase and what its operators stated into files a plain Claude
// reads, and verify the stated rules against the code. Zero tokens: nothing
// export/check/init/constraints/seeds writes comes from a model. Three things
// spend tokens, each saying so in its usage line and labelling what it
// stores as a model's work until a person ratifies it: `classify` (M-CMD.3),
// `architecture --propose|--modify` (M-ARCH.4) and `skills draft`.
//
//   vibegraph-knowledge export [<root>] [--task "<text>"] [--out <dir>] [--envelope <project.json>]
//   vibegraph-knowledge --version | --help
//
// Dev:  node --experimental-strip-types --no-warnings scripts/cli/main.mjs export examples/fleet-telemetry
// Built: packages/knowledge/dist/cli.mjs (scripts/cli/build.mjs)
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PACKAGE_NAME, gitHead, locate, toolLabel } from "./paths.mjs";
import { resolvePython } from "./pyenv.mjs";
import { exportKnowledge } from "../export_knowledge.mjs";
import { formatCheckReport, runConstraintChecks } from "./check.mjs";
import { applyInit, POINTER } from "./init.mjs";
import { formatClassifyReport, runClassify } from "./classify.mjs";
import { runArchitecture } from "./architecture.mjs";
import { CONSTRAINTS_USAGE, runConstraints } from "./constraints.mjs";
import { SEEDS_USAGE, runSeeds } from "./seeds.mjs";
import { SKILLS_USAGE, runSkills } from "./skills.mjs";
import { VIEW_USAGE, runView } from "./view.mjs";

const USAGE = `${PACKAGE_NAME} — what VibeGraph derives from a codebase and what its operators stated, on disk for a plain Claude.

usage:
  ${PACKAGE_NAME} ${VIEW_USAGE}
  ${PACKAGE_NAME} export [<root>] [options]     write .vibegraph/knowledge/ under <root> (default: cwd)
      --task "<text>"      also write plan.md: the task mapped onto the threads that own it
                           (matching is lexical: name the files, symbols or node ids it touches)
      --with-ir            also write the raw forms: per-file IR, envelope, stack, crossings, quality
      --architecture       also write the system map as data (architecture.vibegraph.json: every lens,
                           the hierarchy, subsystems, thread graph) and as a picture (architecture.html);
                           architecture.md, the same map as prose, is always written
      --archify            also write architecture.archify.json (the model in Archify's schema)
      --out <dir>          write elsewhere (the directory must be empty or a previous export)
      --envelope <file>    use a committed project envelope instead of parsing <root>
  ${PACKAGE_NAME} check [<root>] [options]      verify every stated constraint's checkable half against the code
      --uncommitted        the working tree's changes against HEAD are the delta (what a hook has)
      --git <range>        a commit range's file changes are the delta (the project's own git)
                           co-changes needs one of these; without a delta it reads UNVERIFIABLE
      --json               the raw results instead of the report
      exit 0 every clause passed · 1 a clause is VIOLATED (offenders named as file:node)
           · 2 nothing violated but a clause is UNVERIFIABLE, which is not a pass
  ${PACKAGE_NAME} init [<root>] [--print]        point Claude at the folder: one marked block in CLAUDE.md
                                               (replaced on re-run, never duplicated) and the gitignore
                                               line for .vibegraph/knowledge/. --print shows the block only.
  ${PACKAGE_NAME} classify [<root>] [options]   SPENDS TOKENS: ask a model what the tools
                                               no table knows are, from how the code uses them; show the answers
      --apply              store each answer as an AGENT-STATED policy in .vibegraph/constraints.json
                           (labelled "NOT human-reviewed" everywhere the role shows; a human ratifies it
                           with: constraints ratify <id>; deleting it asks again next time)
      --dry-run            show the evidence and the prompt; spawn nothing, write nothing
      --model <id>         the model to ask (default: the claude CLI's own)
      --dossier-out <f>    write the evidence + prompt as JSON · --from-dossier <f> read it back (no parse step)
      --reply <f>          use a saved model reply instead of spawning · --show-prompt print the prompt
      exit 0 done · 3 the model could not be run or its reply was not JSON
  ${PACKAGE_NAME} architecture [<root>] [options]  write the system map into <root>/.vibegraph/architecture-map/:
                                               architecture.md (for an agent), architecture.vibegraph.json (every
                                               lens as data), architecture.html (for people), architecture.json
      --archify            also write architecture.archify.json (the model in Archify's schema)
      --out <dir>          write elsewhere
      --propose            SPENDS TOKENS: ask a model for deployment / trust groups, names and a primary path;
                           every item must cite a deployment-manifest line, a doc line or a node, and is stored
                           PENDING in .vibegraph/architecture.json, drawn ghosted until decided
      --modify "<text>"    SPENDS TOKENS: re-draft the pending proposal with your words (same grounding)
      --ratify | --reject  decide the pending proposal (running this is the human's decision)
      --reply <f>          use a saved model reply instead of spawning · --dry-run print the prompt, spawn nothing
      --model <id>         the model to ask (default: the claude CLI's own)
      exit 0 done · 1 nothing to decide · 3 the model could not be run or its reply was unusable

The files that shape what export writes — each has a command:
  ${PACKAGE_NAME} ${CONSTRAINTS_USAGE}
  ${PACKAGE_NAME} ${SEEDS_USAGE}
  ${PACKAGE_NAME} ${SKILLS_USAGE}
  (the root may come last in any of these; it defaults to the current directory)

  ${PACKAGE_NAME} --version
  ${PACKAGE_NAME} --help

Python 3 with libcst is required for the parse step; when libcst is missing it is installed
into a directory this tool owns (VIBEGRAPH_KNOWLEDGE_HOME, default ~/.cache/${PACKAGE_NAME}).
VG_PYTHON names the interpreter; VIBEGRAPH_PYDEPS names a directory that already holds libcst.
`;

function fail(msg, code = 2) {
  process.stderr.write(`${msg}\n`);
  return code;
}

function projectRoot(positional) {
  const abs = resolve(positional ?? ".");
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`${abs} is not a directory`);
  return abs;
}

function pipelineFor(loc, absRoot) {
  const py = resolvePython(loc, { log: (m) => process.stderr.write(`  ${m}\n`) });
  return { scriptsDir: loc.scriptsDir, pythonBin: py.bin, pythonEnv: py.env, cwd: absRoot, python: py };
}

function cmdExport(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { task: { type: "string" }, out: { type: "string" }, envelope: { type: "string" }, "with-ir": { type: "boolean" }, architecture: { type: "boolean" }, archify: { type: "boolean" } },
      allowPositionals: true,
    });
  } catch (e) {
    return fail(`${e.message}\n\n${USAGE}`);
  }
  const loc = locate();
  let absRoot;
  try { absRoot = projectRoot(parsed.positionals[0]); } catch (e) { return fail(e.message); }
  let pipeline;
  try { pipeline = pipelineFor(loc, absRoot); } catch (e) { return fail(e.message, 3); }
  const projectCommit = gitHead(absRoot);
  const r = exportKnowledge({
    root: absRoot,
    out: parsed.values.out,
    task: parsed.values.task,
    envelope: parsed.values.envelope,
    commit: projectCommit ?? "no-git",
    tool: toolLabel(loc),
    projectCommit,
    pipeline,
    withIr: parsed.values["with-ir"] === true,
    architecture: parsed.values.architecture === true,
    archify: parsed.values.archify === true,
  });
  process.stdout.write(`wrote ${r.written.length} files to ${r.outDir}: ${r.files} source files parsed${r.withIr ? " (IR included)" : ""}, ${r.threads} thread contracts, ${r.skills.copied} skill${r.skills.copied === 1 ? "" : "s"}${r.skills.withheld ? ` (${r.skills.withheld} withheld, see README)` : ""}, ${r.constraints} stated constraints${r.packets !== null ? `, plan of ${r.packets} packets` : ""}${r.unmatchedTokens?.length ? ` (code-shaped tokens no thread owns: ${r.unmatchedTokens.join(", ")})` : ""}\n`);
  if (r.taskNamesNoCode) process.stderr.write("the task names no code (no file, symbol or node id), so plan.md is empty and says so — name what the task touches, or read threads/INDEX.md\n");
  if (Object.keys(r.parseErrors).length) process.stderr.write(`parse errors (those files carry no IR): ${Object.keys(r.parseErrors).join(", ")}\n`);
  return 0;
}

function cmdCheck(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { git: { type: "string" }, uncommitted: { type: "boolean" }, json: { type: "boolean" }, envelope: { type: "string" } },
      allowPositionals: true,
    });
  } catch (e) {
    return fail(`${e.message}\n\n${USAGE}`);
  }
  const loc = locate();
  let absRoot;
  try { absRoot = projectRoot(parsed.positionals[0]); } catch (e) { return fail(e.message); }
  let pipeline;
  try { pipeline = pipelineFor(loc, absRoot); } catch (e) { return fail(e.message, 3); }
  const r = runConstraintChecks({
    root: absRoot, envelope: parsed.values.envelope, pipeline, git: parsed.values.git,
    uncommitted: parsed.values.uncommitted === true,
    commit: gitHead(absRoot) ?? "no-git",
  });
  process.stdout.write(parsed.values.json ? JSON.stringify(r, null, 2) + "\n" : formatCheckReport(r));
  return r.exitCode;
}

function cmdInit(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, options: { print: { type: "boolean" } }, allowPositionals: true });
  } catch (e) {
    return fail(`${e.message}\n\n${USAGE}`);
  }
  let absRoot;
  try { absRoot = projectRoot(parsed.positionals[0]); } catch (e) { return fail(e.message); }
  const r = applyInit({ root: absRoot, print: parsed.values.print === true });
  if (r.claudeMd === "printed") { process.stdout.write(POINTER + "\n"); return 0; }
  process.stdout.write(`${r.paths.claudeMd}: ${r.claudeMd} (the block between ${"<!-- vibegraph-knowledge:begin/end -->"} is replaced on re-run)\n`);
  process.stdout.write(`${r.paths.gitignore}: ${r.gitignore} (.vibegraph/knowledge/ is generated; never commit it)\n`);
  if (r.claudeMd !== "unchanged") process.stdout.write(`next: ${PACKAGE_NAME} export${existsSync(join(absRoot, ".vibegraph", "knowledge")) ? " (the folder exists; re-run to refresh it)" : ""}\n`);
  return 0;
}

function cmdClassify(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        apply: { type: "boolean" }, "dry-run": { type: "boolean" }, model: { type: "string" },
        "dossier-out": { type: "string" }, "from-dossier": { type: "string" }, reply: { type: "string" },
        "show-prompt": { type: "boolean" }, json: { type: "boolean" }, envelope: { type: "string" },
      },
      allowPositionals: true,
    });
  } catch (e) {
    return fail(`${e.message}\n\n${USAGE}`);
  }
  let absRoot;
  try { absRoot = projectRoot(parsed.positionals[0]); } catch (e) { return fail(e.message); }
  let pipeline = {};
  if (!parsed.values["from-dossier"] && !parsed.values.envelope) {
    try { pipeline = pipelineFor(locate(), absRoot); } catch (e) { return fail(e.message, 3); }
  }
  const r = runClassify({
    root: absRoot, envelope: parsed.values.envelope, pipeline,
    dryRun: parsed.values["dry-run"] === true, apply: parsed.values.apply === true, model: parsed.values.model,
    fromDossier: parsed.values["from-dossier"], dossierOut: parsed.values["dossier-out"], replyFile: parsed.values.reply,
    log: (m) => process.stderr.write(`  ${m}\n`),
  });
  if (parsed.values.json) process.stdout.write(JSON.stringify({ dossiers: r.dossiers, parsed: r.parsed ?? null, applied: r.applied ?? null, messages: r.messages }, null, 2) + "\n");
  else process.stdout.write(formatClassifyReport(r, { showPrompt: parsed.values["show-prompt"] === true }));
  for (const m of r.messages) process.stderr.write(`${m}\n`);
  return r.exitCode;
}

function cmdArchitecture(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        out: { type: "string" }, envelope: { type: "string" }, propose: { type: "boolean" }, ratify: { type: "boolean" },
        reject: { type: "boolean" }, reply: { type: "string" }, "dry-run": { type: "boolean" }, model: { type: "string" },
        modify: { type: "string" }, archify: { type: "boolean" },
      },
      allowPositionals: true,
    });
  } catch (e) {
    return fail(`${e.message}\n\n${USAGE}`);
  }
  const v = parsed.values;
  if ([v.propose, v.ratify, v.reject, v.modify !== undefined].filter(Boolean).length > 1) return fail("choose one of --propose, --modify, --ratify, --reject");
  const loc = locate();
  let absRoot;
  try { absRoot = projectRoot(parsed.positionals[0]); } catch (e) { return fail(e.message); }
  let pipeline = {};
  if (!v.envelope) {
    try { pipeline = pipelineFor(loc, absRoot); } catch (e) { return fail(e.message, 3); }
  }
  const r = runArchitecture({
    root: absRoot, out: v.out, envelope: v.envelope, pipeline, commit: gitHead(absRoot) ?? "no-git", tool: toolLabel(loc),
    action: v.propose || v.modify !== undefined ? "propose" : v.ratify ? "ratify" : v.reject ? "reject" : null,
    replyFile: v.reply, dryRun: v["dry-run"] === true, model: v.model, guidance: v.modify, archify: v.archify === true,
  });
  for (const line of r.lines) process.stdout.write(`${line}\n`);
  for (const m of r.messages) process.stderr.write(`${m}\n`);
  return r.exitCode;
}

/** `<sub> [args...] [<root>]`: the root is the LAST positional when it is a
 *  directory (an entry id or a file path inside the project is not). */
function subAndRoot(positionals) {
  const [sub, ...rest] = positionals;
  const last = rest[rest.length - 1];
  if (last && existsSync(resolve(last)) && statSync(resolve(last)).isDirectory()) return { sub, args: rest.slice(0, -1), root: resolve(last) };
  return { sub, args: rest, root: resolve(".") };
}

function report(r) {
  for (const m of r.messages) process.stderr.write(`${m}\n`);
  if (r.lines.length) process.stdout.write(r.lines.join("\n") + "\n");
  return r.exitCode;
}

function cmdConstraints(argsIn) {
  // `list --json` is a flag; `add --json '<object>'` takes a value. Read the
  // flag off before parsing, so one option name means one thing to parseArgs.
  const listJson = argsIn[0] === "list" && argsIn.includes("--json");
  const args = listJson ? argsIn.filter((a) => a !== "--json") : argsIn;
  let parsed;
  try {
    parsed = parseArgs({
      args, allowPositionals: true,
      options: {
        kind: { type: "string" }, text: { type: "string" }, note: { type: "string" }, check: { type: "string" }, policy: { type: "string" },
        json: { type: "string" }, all: { type: "boolean" }, threads: { type: "string" }, files: { type: "string" }, tools: { type: "string" },
      },
    });
  } catch (e) { return fail(`${e.message}\n\n${USAGE}`); }
  const { sub, args: rest, root } = subAndRoot(parsed.positionals);
  const values = { ...parsed.values, ...(listJson ? { json: true } : {}) };
  return report(runConstraints({ root, sub, id: rest[0], values }));
}

function cmdSeeds(args) {
  let parsed;
  try { parsed = parseArgs({ args, allowPositionals: true, options: { note: { type: "string" }, envelope: { type: "string" } } }); }
  catch (e) { return fail(`${e.message}\n\n${USAGE}`); }
  const { sub, args: rest, root } = subAndRoot(parsed.positionals);
  let pipeline = {};
  if (!parsed.values.envelope) {
    try { pipeline = pipelineFor(locate(), root); } catch (e) { return fail(e.message, 3); }
  }
  return report(runSeeds({ root, sub, spec: rest[0], values: parsed.values, envelope: parsed.values.envelope, pipeline }));
}

async function cmdSkills(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args, allowPositionals: true,
      options: { missing: { type: "boolean" }, "dry-run": { type: "boolean" }, reply: { type: "string" }, model: { type: "string" }, envelope: { type: "string" } },
    });
  } catch (e) { return fail(`${e.message}\n\n${USAGE}`); }
  const { sub, args: rest, root } = subAndRoot(parsed.positionals);
  let pipeline = {};
  if (!parsed.values.envelope) {
    try { pipeline = pipelineFor(locate(), root); } catch (e) { return fail(e.message, 3); }
  }
  return report(await runSkills({ root, sub, targets: rest, values: parsed.values, envelope: parsed.values.envelope, pipeline }));
}

function cmdView(args) {
  let parsed;
  try { parsed = parseArgs({ args, allowPositionals: true, options: { port: { type: "string" }, open: { type: "boolean" } } }); }
  catch (e) { return fail(`${e.message}\n\n${USAGE}`); }
  if (parsed.values.port && !/^\d{2,5}$/.test(parsed.values.port)) return fail("--port must be a number");
  return runView({ loc: locate(), target: parsed.positionals[0], port: parsed.values.port, open: parsed.values.open === true });
}

export function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") { process.stdout.write(USAGE); return 0; }
  if (command === "--version" || command === "-v" || command === "version") { process.stdout.write(`${toolLabel(locate())}\n`); return 0; }
  if (command === "view") return cmdView(rest);
  if (command === "export") return cmdExport(rest);
  if (command === "check") return cmdCheck(rest);
  if (command === "init") return cmdInit(rest);
  if (command === "classify") return cmdClassify(rest);
  if (command === "architecture") return cmdArchitecture(rest);
  if (command === "constraints") return cmdConstraints(rest);
  if (command === "seeds") return cmdSeeds(rest);
  if (command === "skills") return cmdSkills(rest);
  return fail(`unknown command: ${command}\n\n${USAGE}`);
}

const code = main(process.argv.slice(2));
if (code && typeof code.then === "function") code.then((c) => { process.exitCode = c; });
else process.exitCode = code;
