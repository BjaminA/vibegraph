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
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PACKAGE_NAME, gitHead, locate, toolLabel } from "./paths.mjs";
import { resolvePython } from "./pyenv.mjs";
import { exportKnowledge } from "../export_knowledge.mjs";
import { formatCheckReport, runConstraintChecks } from "./check.mjs";
import { hookInputFromWindows } from "./winpath.mjs";
import { applyHooks, applyInit, ALL_SKILLS, applySkills, hookCommand, windowsHookCommand, POINTER, skillsFromList } from "./init.mjs";
import { spawnSync } from "node:child_process";
import { HOOK_EVENTS, runHook } from "./hooks.mjs";
import { doctorReport, hookRunPayload, recordFired } from "./hook_tools.mjs";
import { LESSONS_USAGE, runLessons } from "./lessons.mjs";
import { DIRECTION_USAGE, runDirection } from "./direction.mjs";
import { DATAFLOW_USAGE, runDataflow } from "./dataflow.mjs";
import { PLAN_USAGE, runPlan } from "./plan.mjs";
import { runPlanDraft } from "./plan_draft.mjs";
import { isAgentRun, personOnlyStep, PERSONS_STEP } from "./actor.mjs";
import { pipelineFor, pipelineHere } from "./pipeline.mjs";
import { SOFTWARE_USAGE, runSoftware } from "./software.mjs";
import { BRIEF_USAGE, runBrief } from "./brief.mjs";
import { formatClassifyReport, runClassify } from "./classify.mjs";
import { runArchitecture } from "./architecture.mjs";
import { CONSTRAINTS_USAGE, runConstraints } from "./constraints.mjs";
import { SEEDS_USAGE, runSeeds } from "./seeds.mjs";
import { SKILLS_USAGE, runSkills } from "./skills.mjs";
import { VIEW_USAGE, runView } from "./view.mjs";
import { AFFECTED_USAGE, formatAffected, runAffected } from "./affected.mjs";
import { COVERAGE_USAGE, runCoverage } from "./coverage.mjs";
import { formatCoverage } from "../../src/server/coverage.ts";

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
  ${PACKAGE_NAME} ${AFFECTED_USAGE}
  ${PACKAGE_NAME} ${COVERAGE_USAGE}
  ${PACKAGE_NAME} ${LESSONS_USAGE}
  ${PACKAGE_NAME} ${BRIEF_USAGE}
  ${PACKAGE_NAME} ${DIRECTION_USAGE}
  ${PACKAGE_NAME} ${DATAFLOW_USAGE}
  ${PACKAGE_NAME} ${PLAN_USAGE}
  ${PACKAGE_NAME} ${SOFTWARE_USAGE}
  ${PACKAGE_NAME} init [<root>] [--print]        point Claude at the folder: one marked block in CLAUDE.md
                                               (replaced on re-run, never duplicated) and the gitignore
                                               line for .vibegraph/knowledge/. --print shows the block only.
      --hooks              also install four Claude Code hooks in .claude/settings.local.json (per user,
                           never committed): each session starts with an orientation (re-sent after a
                           compaction); each prompt gets its threads' contracts, rules and skills;
                           each edit and the end of each turn re-check every stated rule, and a NEW
                           violation blocks with the rule and the offending call. Zero tokens.
      --windows            with --hooks: write them as \`wsl.exe -d <distro> -e …\` commands, for a Claude Code
                           running on Windows against this WSL project (\\\\wsl.localhost\\…); they also run from
                           inside WSL. Run init from WSL with an installed CLI (not npx).
      --remove-hooks       take exactly those hooks out again
  ${PACKAGE_NAME} hook install [--target posix|wsl] [--remove] [<root>]   the same hooks without the CLAUDE.md
                                               block; --target wsl = the --windows form above
  ${PACKAGE_NAME} hook run <event> [<root>] [--file <path> | --command "<sh>"] [--prompt "<text>"] [--session <id>]
                                               fire a hook by hand: the stdin JSON is built for you, the
                                               exit codes are the hook's (0 · 2 blocked). Events: ${HOOK_EVENTS.join(", ")}
  ${PACKAGE_NAME} doctor [<root>]                are the hooks installed, runnable from this side, and have
                                               they fired since installed? exit 0 · 1 a warning
      --skill              also install the Claude Code skills into .claude/skills/: /vibegraph (set up and
                           use this) and the task skills /vibegraph-plan, -debug, -security, -review (which
                           knowledge file and command to open for that task; ~100 tokens each until used);
                           with --user into ~/.claude/skills/ instead (every project on this machine, and
                           nothing else is written)
      --skills <list>      only these task skills, e.g. --skills plan,security (/vibegraph always comes along)
      --remove-skill       take every one of these skills out again (--user for the machine-wide ones)
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
      --seed-plan          zero tokens: propose groups read off the plan (.vibegraph/plan.json) — one per realised
                           planned process, and trust zones between the project and the services it names;
                           PENDING like a model's draft, decided with --ratify / --reject
      --ratify | --reject  decide the pending proposal (running this is the human's decision)
      --force              with --propose / --seed-plan: draft again although the groups were already ratified
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

/** This package's version (for a hook that must re-run it through npx). */
function packageVersion(loc) {
  try { return JSON.parse(readFileSync(join(loc.packageRoot, "package.json"), "utf-8")).version ?? null; } catch { return null; }
}

function projectRoot(positional) {
  const abs = resolve(positional ?? ".");
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`${abs} is not a directory`);
  return abs;
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
      options: { git: { type: "string" }, uncommitted: { type: "boolean" }, json: { type: "boolean" }, envelope: { type: "string" }, "no-cache": { type: "boolean" } },
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
    cache: parsed.values["no-cache"] !== true,
  });
  process.stdout.write(parsed.values.json ? JSON.stringify(r, null, 2) + "\n" : formatCheckReport(r));
  return r.exitCode;
}

function cmdAffected(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, options: { uncommitted: { type: "boolean" }, json: { type: "boolean" }, envelope: { type: "string" }, "no-cache": { type: "boolean" } }, allowPositionals: true });
  } catch (e) {
    return fail(`${e.message}\n\n${USAGE}`);
  }
  // A leading directory is the root; everything else is a changed file.
  const pos = [...parsed.positionals];
  let absRoot;
  if (pos.length && existsSync(resolve(pos[0])) && statSync(resolve(pos[0])).isDirectory()) absRoot = resolve(pos.shift());
  else absRoot = resolve(".");
  if (!pos.length && !parsed.values.uncommitted) return fail(`name the changed files, or pass --uncommitted\n\n${USAGE}`);
  let pipeline;
  try { pipeline = pipelineFor(locate(), absRoot); } catch (e) { return fail(e.message, 3); }
  const r = runAffected({ root: absRoot, files: pos, uncommitted: parsed.values.uncommitted === true, envelope: parsed.values.envelope, pipeline, cache: parsed.values["no-cache"] !== true });
  process.stdout.write(parsed.values.json ? JSON.stringify(r, null, 2) + "\n" : formatAffected(r));
  return 0;
}

function cmdCoverage(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, options: { json: { type: "boolean" }, envelope: { type: "string" }, "no-cache": { type: "boolean" } }, allowPositionals: true });
  } catch (e) {
    return fail(`${e.message}\n\n${USAGE}`);
  }
  const pos = [...parsed.positionals];
  let absRoot = resolve(".");
  if (pos.length > 1 && existsSync(resolve(pos[0])) && statSync(resolve(pos[0])).isDirectory()) absRoot = resolve(pos.shift());
  if (!pos.length) return fail(`name the files to check\n\n${USAGE}`);
  let pipeline;
  try { pipeline = pipelineFor(locate(), absRoot); } catch (e) { return fail(e.message, 3); }
  const rows = runCoverage({ root: absRoot, files: pos, envelope: parsed.values.envelope, pipeline, cache: parsed.values["no-cache"] !== true });
  process.stdout.write(parsed.values.json ? JSON.stringify(rows, null, 2) + "\n" : formatCoverage(rows));
  return 0;
}

/** Install (or remove) the four hooks; shared by `init --hooks` and
 *  `hook install`. target "wsl" writes the wsl.exe form a Windows-side
 *  Claude Code can run against this WSL project. */
function installHooks(loc, absRoot, { remove = false, windows = false } = {}) {
  let h;
  try {
    let env = {};
    if (!remove) {
      // Pin the interpreter verified NOW, by absolute path.
      const py = resolvePython(loc, { log: (m) => process.stderr.write(`  ${m}\n`) });
      const exe = spawnSync(py.bin, ["-c", "import sys; print(sys.executable)"], { encoding: "utf-8" }).stdout.trim() || py.bin;
      // `how` is "as installed", "VIBEGRAPH_PYDEPS=<dir>" or the directory itself.
      const deps = py.how === "as installed" ? null
        : py.how.startsWith("VIBEGRAPH_PYDEPS=") ? py.how.slice("VIBEGRAPH_PYDEPS=".length) : py.how;
      env = { VG_PYTHON: exe, ...(deps ? { VIBEGRAPH_PYDEPS: deps } : {}) };
    }
    const version = packageVersion(loc);
    h = applyHooks({ root: absRoot, remove, command: (root, event) => windows
      ? windowsHookCommand(root, event, env)
      : hookCommand(root, event, env, process.argv, process.execPath, process.execArgv, version) });
  } catch (e) { return fail(e.message); }
  process.stdout.write(`${h.path}: hooks ${h.state}${h.state === "removed" ? "" : ` (prompt → routed contracts, rules and skills; post-edit and stop → every stated rule re-checked, a new violation blocks). Claude Code reads hooks when a session starts: they apply from the NEXT session (review them with /hooks; \`${PACKAGE_NAME} doctor\` says whether they have fired).${windows ? "" : " A Claude Code running on Windows against this WSL folder cannot run these: use \`hook install --target wsl\`."}`}\n`);
  return 0;
}

function cmdInit(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args, allowPositionals: true,
      options: {
        print: { type: "boolean" }, hooks: { type: "boolean" }, windows: { type: "boolean" }, "remove-hooks": { type: "boolean" },
        skill: { type: "boolean" }, skills: { type: "string" }, "remove-skill": { type: "boolean" }, user: { type: "boolean" },
      },
    });
  } catch (e) {
    return fail(`${e.message}\n\n${USAGE}`);
  }
  const loc = locate();
  // The Claude Code skills: into ~/.claude/skills with --user (and nothing
  // else — a user-level install touches no project), else the project's.
  // --skill installs the setup skill and all four task skills; --skills
  // plan,debug chooses; --remove-skill takes every one of ours out.
  if (parsed.values.skill || parsed.values.skills || parsed.values["remove-skill"]) {
    let results;
    const user = parsed.values.user === true;
    const remove = parsed.values["remove-skill"] === true;
    let skRoot = null;
    if (!user) { try { skRoot = projectRoot(parsed.positionals[0]); } catch (e) { return fail(e.message); } }
    try {
      const names = remove ? ALL_SKILLS : skillsFromList(parsed.values.skills);
      results = applySkills({ names, root: skRoot, loc, user, remove });
    } catch (e) { return fail(e.message); }
    for (const sk of results) {
      process.stdout.write(`${sk.path}: skill ${sk.state}${sk.state === "installed" || sk.state === "updated" ? ` (/${sk.name}; ${user ? "every project on this machine" : "this project"})` : ""}\n`);
    }
    if (user || remove) return 0;
  }
  let absRoot;
  try { absRoot = projectRoot(parsed.positionals[0]); } catch (e) { return fail(e.message); }
  if (parsed.values.hooks || parsed.values["remove-hooks"]) {
    const code = installHooks(loc, absRoot, { remove: parsed.values["remove-hooks"] === true, windows: parsed.values.windows === true });
    if (code !== 0 || parsed.values["remove-hooks"]) return code;
  }
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
        modify: { type: "string" }, archify: { type: "boolean" }, force: { type: "boolean" }, "seed-plan": { type: "boolean" },
      },
      allowPositionals: true,
    });
  } catch (e) {
    return fail(`${e.message}\n\n${USAGE}`);
  }
  const v = parsed.values;
  if ([v.propose, v.ratify, v.reject, v.modify !== undefined, v["seed-plan"]].filter(Boolean).length > 1) return fail("choose one of --propose, --modify, --seed-plan, --ratify, --reject");
  const loc = locate();
  let absRoot;
  try { absRoot = projectRoot(parsed.positionals[0]); } catch (e) { return fail(e.message); }
  let pipeline = {};
  if (!v.envelope) {
    try { pipeline = pipelineFor(loc, absRoot); } catch (e) { return fail(e.message, 3); }
  }
  const r = runArchitecture({
    root: absRoot, out: v.out, envelope: v.envelope, pipeline, commit: gitHead(absRoot) ?? "no-git", tool: toolLabel(loc),
    action: v.propose || v.modify !== undefined ? "propose" : v["seed-plan"] ? "seed-plan" : v.ratify ? "ratify" : v.reject ? "reject" : null,
    replyFile: v.reply, dryRun: v["dry-run"] === true, model: v.model, guidance: v.modify, archify: v.archify === true, force: v.force === true,
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
  const listJson = (argsIn[0] === "list" || argsIn[0] === "show") && argsIn.includes("--json");
  const args = listJson ? argsIn.filter((a) => a !== "--json") : argsIn;
  let parsed;
  try {
    parsed = parseArgs({
      args, allowPositionals: true,
      options: {
        kind: { type: "string" }, text: { type: "string" }, note: { type: "string" }, check: { type: "string" }, policy: { type: "string" },
        json: { type: "string" }, all: { type: "boolean" }, threads: { type: "string" }, files: { type: "string" }, tools: { type: "string" },
        checks: { type: "string" }, why: { type: "string" }, as: { type: "string" },
      },
    });
  } catch (e) { return fail(`${e.message}\n\n${USAGE}`); }
  const { sub, args: rest, root } = subAndRoot(parsed.positionals);
  const values = { ...parsed.values, ...(listJson ? { json: true } : {}), pid: rest[1] };
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
      options: { missing: { type: "boolean" }, "dry-run": { type: "boolean" }, "no-lessons": { type: "boolean" }, reply: { type: "string" }, model: { type: "string" }, envelope: { type: "string" } },
    });
  } catch (e) { return fail(`${e.message}\n\n${USAGE}`); }
  const { sub, args: rest, root } = subAndRoot(parsed.positionals);
  let pipeline = {};
  if (!parsed.values.envelope) {
    try { pipeline = pipelineFor(locate(), root); } catch (e) { return fail(e.message, 3); }
  }
  return report(await runSkills({ root, sub, targets: rest, values: parsed.values, envelope: parsed.values.envelope, pipeline }));
}

/** `hook <event>` — run by Claude Code (installed by `init --hooks`). Reads
 *  the hook payload on stdin. Exit 0 with JSON on stdout, or exit 2 with the
 *  reason on stderr (the form Claude Code shows to Claude).
 *  `hook install [--target posix|wsl] [<root>]` installs them;
 *  `hook run <event> [--file f | --command c | --prompt t] [<root>]` builds the
 *  payload itself and runs the same code, same exit codes — for testing a hook
 *  by hand without hand-rolling JSON. A manual run is not recorded as a fire. */
function cmdHook(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: {
      root: { type: "string" }, "vg-hook": { type: "boolean" }, target: { type: "string" }, remove: { type: "boolean" },
      file: { type: "string" }, prompt: { type: "string" }, tool: { type: "string" }, command: { type: "string" }, session: { type: "string" },
    } });
  } catch (e) { return fail(`${e.message}\n\n${USAGE}`); }
  const sub = parsed.positionals[0];
  if (sub === "install") {
    const target = parsed.values.target ?? "posix";
    if (!["posix", "wsl"].includes(target)) return fail("--target must be posix (Claude Code runs where this project is) or wsl (Claude Code runs on Windows against this WSL project)");
    let absRoot;
    try { absRoot = projectRoot(parsed.positionals[1]); } catch (e) { return fail(e.message); }
    return installHooks(locate(), absRoot, { windows: target === "wsl", remove: parsed.values.remove === true });
  }
  const manual = sub === "run";
  const event = manual ? parsed.positionals[1] : sub;
  if (!HOOK_EVENTS.includes(event)) return fail(`hook event must be one of: ${HOOK_EVENTS.join(", ")} (or: hook install | hook run <event>)`);
  let input = {};
  if (manual) {
    let r;
    try { r = projectRoot(parsed.values.root ?? parsed.positionals[2]); } catch (e) { return fail(e.message); }
    if (event === "post-edit" && !parsed.values.file && !parsed.values.command) return fail("hook run post-edit needs --file <path> (an Edit/Write) or --command \"<shell>\" (a Bash edit)");
    if (event === "prompt" && parsed.values.prompt === undefined) return fail("hook run prompt needs --prompt \"<text>\"");
    const file = parsed.values.file ? resolve(r, parsed.values.file) : undefined;
    input = hookRunPayload(event, { absRoot: r, file, prompt: parsed.values.prompt, tool: parsed.values.tool, command: parsed.values.command, session: parsed.values.session });
    parsed.values.root = r;
  } else {
    // A UTF-8 byte-order mark (PowerShell adds one when it pipes text) is not JSON.
    try { input = JSON.parse(readFileSync(0, "utf-8").replace(/^\uFEFF/, "") || "{}"); } catch { input = {}; }
    // A Windows-side Claude Code (init --hooks --windows) sends Windows paths,
    // and its hook command spells our own paths `//x` to get them past Git Bash.
    input = hookInputFromWindows(input);
    for (const k of ["VG_PYTHON", "VIBEGRAPH_PYDEPS"]) if (process.env[k]?.startsWith("//")) process.env[k] = process.env[k].slice(1);
    if (parsed.values.root?.startsWith("//")) parsed.values.root = parsed.values.root.slice(1);
  }
  const silent = (msg) => { process.stdout.write(JSON.stringify({ systemMessage: msg })); return 0; };
  let absRoot;
  try { absRoot = projectRoot(parsed.values.root ?? process.env.CLAUDE_PROJECT_DIR ?? input.cwd); }
  catch (e) { return silent(`VibeGraph ${event} hook: ${e.message}`); }
  if (!manual) recordFired(absRoot, event, input.session_id);
  let pipeline;
  try { pipeline = pipelineFor(locate(), absRoot); } catch (e) { return silent(`VibeGraph ${event} hook could not start the parser: ${e.message}`); }
  const t0 = Date.now();
  const r = runHook(event, input, { absRoot, pipeline });
  // VG_HOOK_LOG: one JSON line per run (event, ms, blocked) — what a drill
  // reports as the hooks' cost. Never the payload, never the prompt.
  if (process.env.VG_HOOK_LOG) {
    try {
      appendFileSync(process.env.VG_HOOK_LOG, JSON.stringify({
        at: new Date().toISOString(), event, ms: Date.now() - t0, blocked: !!r?.block,
        file: event === "post-edit" ? input.tool_input?.file_path ?? null : undefined,
        block: r?.block ? r.block.slice(0, 600) : undefined,
      }) + "\n");
    } catch { /* a log that cannot be written must not break the hook */ }
  }
  if (r?.block) { process.stderr.write(`${r.block}\n`); return 2; }
  if (r?.json) process.stdout.write(JSON.stringify(r.json));
  return 0;
}

/** `doctor [<root>]` — are the hooks installed, runnable from here, and have
 *  they fired since they were installed? Exit 0 fine · 1 a warning. */
function cmdDoctor(args) {
  let absRoot;
  try { absRoot = projectRoot(args.find((a) => !a.startsWith("-"))); } catch (e) { return fail(e.message); }
  const r = doctorReport(absRoot);
  for (const [level, text] of r.lines) process.stdout.write(`${level === "ok" ? "ok  " : level === "info" ? "--  " : "!!  "}${text}\n`);
  return r.ok ? 0 : 1;
}

function cmdBrief(args) {
  let parsed;
  try { parsed = parseArgs({ args, allowPositionals: true, options: { max: { type: "string" } } }); }
  catch (e) { return fail(`${e.message}\n\n${USAGE}`); }
  const [entryPointId, rootArg] = parsed.positionals;
  if (!entryPointId) return fail(`brief needs an entry id (see \`skills list\` or the export's threads/INDEX.md)\n\n${USAGE}`);
  const maxChars = parsed.values.max ? Number(parsed.values.max) : undefined;
  if (maxChars !== undefined && !(maxChars >= 2000)) return fail("--max must be a number of characters, at least 2000");
  let absRoot;
  try { absRoot = projectRoot(rootArg); } catch (e) { return fail(e.message); }
  let pipeline;
  try { pipeline = pipelineFor(locate(), absRoot); } catch (e) { return fail(e.message, 3); }
  const r = runBrief({ root: absRoot, entryPointId, maxChars, pipeline });
  process.stdout.write(r.text);
  return r.exitCode;
}

function cmdLessons(args) {
  let parsed;
  try { parsed = parseArgs({ args, allowPositionals: true, options: { json: { type: "boolean" } } }); }
  catch (e) { return fail(`${e.message}\n\n${USAGE}`); }
  const sub = parsed.positionals[0];
  if (sub !== "list") return fail(`lessons: the one subcommand is \`list\`\n\n${USAGE}`);
  let absRoot;
  try { absRoot = projectRoot(parsed.positionals[1]); } catch (e) { return fail(e.message); }
  const r = runLessons({ root: absRoot, json: parsed.values.json === true });
  process.stdout.write(r.text);
  return r.exitCode;
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
  // 2026-09-30 — the steps that are a person's, refused when Claude Code runs them (actor.mjs).
  const personsStep = isAgentRun() ? personOnlyStep(command, rest) : null;
  if (personsStep) return fail(`refused: \`${personsStep}\` — ${PERSONS_STEP}.`, 1);
  if (command === "view") return cmdView(rest);
  if (command === "export") return cmdExport(rest);
  if (command === "check") return cmdCheck(rest);
  if (command === "init") return cmdInit(rest);
  if (command === "classify") return cmdClassify(rest);
  if (command === "architecture") return cmdArchitecture(rest);
  if (command === "constraints" || command === "constraint") return cmdConstraints(rest);
  if (command === "seeds" || command === "seed") return cmdSeeds(rest);
  if (command === "skills") return cmdSkills(rest);
  if (command === "affected") return cmdAffected(rest);
  if (command === "coverage") return cmdCoverage(rest);
  if (command === "hook") return cmdHook(rest);
  if (command === "doctor") return cmdDoctor(rest);
  if (command === "lessons") return cmdLessons(rest);
  if (command === "brief") return cmdBrief(rest);
  if (command === "dataflow") { const r = runDataflow(rest); process.stdout.write(r.text); return r.exitCode; }
  if (command === "plan" && rest[0] === "draft") return runPlanDraft(rest.slice(1)).then((r) => { (r.exitCode === 0 ? process.stdout : process.stderr).write(r.text); return r.exitCode; });
  if (command === "plan") { const r = runPlan(rest); (r.exitCode === 0 ? process.stdout : process.stderr).write(r.text); return r.exitCode; }
  if (command === "direction") { const r = runDirection(rest); process.stdout.write(r.text); return r.exitCode; }
  if (command === "software") return runSoftware(rest).then((r) => { (r.exitCode === 0 ? process.stdout : process.stderr).write(r.text); return r.exitCode; });
  return fail(`unknown command: ${command}\n\n${USAGE}`);
}

const code = main(process.argv.slice(2));
if (code && typeof code.then === "function") code.then((c) => { process.exitCode = c; });
else process.exitCode = code;
