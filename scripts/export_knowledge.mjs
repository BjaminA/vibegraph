#!/usr/bin/env node
// Head-to-head #3, arm D — EVERYTHING VibeGraph derives from a codebase
// without a model, written to disk for a reader that has no VibeGraph
// (plain `claude -p`): the IR per file, the project envelope, one thread
// contract per thread rendered exactly as a worker prompt renders it, the
// system spec, the stack index, the crossings, the derived quality
// artefacts, and (with --task) the deterministic dependency-ordered plan
// with each packet's closing bar. Zero tokens produce any of it.
//
// Why this exists: h2h2 said "the win is the captured constraint, not the
// orchestration — put the fact where the agent can see it and a strong
// model uses it", measured on constraints.json alone. This is the same
// question asked about every other derived product, so arm D can say how
// much of arm A's result is the FACTS and how much is the PROCESS.
//
//   node --experimental-strip-types --no-warnings scripts/export_knowledge.mjs <root>
//        [--out <dir>]        default <root>/.vibegraph/knowledge
//        [--task "<text>"]    also write plan.json / plan.md (plan_work + closing bars)
//        [--envelope <p>]     use a committed project envelope instead of building one
//        [--commit <sha>]     provenance stamp (default: this repo's HEAD)
//
// Every file names its KIND in README.md: derived (a script read it from
// the code), stated (a human wrote it), observed (a consented run saw it).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { loadEnvelope } from "./quality_check.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { formatContractBlock, summarizeContract } from "../src/server/thread_contract.ts";
import { loadConstraints, routeConstraints, formatConstraintsBlock } from "../src/server/constraint_store.ts";
import { formatSystemSpec } from "../src/server/stack_spec.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { repositoryFor, systemMapFor, writeArchArtifacts } from "./arch_artifacts.mjs";
import { renderSystemMapMd } from "../src/server/system_map_md.ts";
import { deriveThreadCalls } from "../src/webview/system/threadInteraction.ts";
import { planWork } from "../src/server/plan_work.ts";
import { getThreadSkill, injectableSkillText, threadSkillKey } from "../src/server/thread_skill_store.ts";
import { threadContexts } from "./thread_context.mjs";
import { tokenizeQuestion } from "../src/server/thread_remit.ts";
import { deriveStackProfile } from "../src/server/quality/profile.ts";
import { deriveQualityModel } from "../src/server/quality/model.ts";
import { computeAcceptance } from "../src/server/quality/acceptance.ts";
import { calibratedVerbs } from "../src/server/quality/standings.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const README_HEAD = "# What VibeGraph derived from this codebase";
const slug = (id) => id.replace(/[^A-Za-z0-9._-]/g, "_");
const json = (x) => JSON.stringify(x, null, 2) + "\n";
const tick = (s) => `\`${String(s).replace(/`/g, "")}\``;

/** Refuse to empty a directory this script did not fill (look before deleting). */
function prepareOutDir(outDir) {
  if (existsSync(outDir)) {
    const entries = readdirSync(outDir);
    const ours = entries.includes("README.md") && readFileSync(join(outDir, "README.md"), "utf-8").startsWith(README_HEAD);
    if (entries.length && !ours) throw new Error(`refusing to overwrite ${outDir}: it is not empty and was not written by export_knowledge.mjs`);
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(outDir, { recursive: true });
}

/**
 * @param commit stamped into the derived quality artefacts (the server
 *   stamps the ANALYSED project's commit there; this script's own CLI
 *   stamps VibeGraph's HEAD, as h2h3 arm D did).
 * @param tool M-CRYSTAL.1 — who wrote the folder, for the README's
 *   provenance line (`vibegraph-knowledge 0.1.0`); defaults to the
 *   VibeGraph commit wording arm D used.
 * @param projectCommit the analysed project's HEAD, or null when it is not
 *   a git repository — said either way, never guessed.
 * @param pipeline where the parsers live (scriptsDir / pythonBin /
 *   pythonEnv / cwd) for a caller that is not this checkout.
 * @param withIr M-CRYSTAL.2 — also write the raw derived forms (per-file
 *   IR, envelope, stack, crossings, quality). Off by default: h2h3 arm D
 *   opened six prose files of the 1.5 MB and none of the JSON, and a
 *   reader that trusts a stale IR after its own edit is worse off than
 *   one that reads the source. The prose is the product; the JSON is a
 *   reference on request.
 */
export function exportKnowledge({ root, out, task, envelope: envelopePath, commit, tool, projectCommit, pipeline, withIr = false, architecture: withArch = false, archify = false }) {
  const { absRoot, envelope: env, parseErrors, skippedDirs, unresolvedSeeds } = loadEnvelope(root, envelopePath, pipeline ?? {});
  const outDir = resolve(out ?? join(absRoot, ".vibegraph", "knowledge"));
  prepareOutDir(outDir);
  const written = [];
  const write = (rel, text) => {
    const p = join(outDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
    written.push(rel);
  };

  const stack = buildStackIndex(env, absRoot);
  const constraints = existsSync(join(absRoot, ".vibegraph", "constraints.json")) ? loadConstraints(absRoot) : [];
  const crossings = buildCrossingIndex(env);
  const graph = deriveThreadCalls(env.threads, env.entryPoints, crossings);
  // Contract, routed rules and skill stamp per thread: the ONE computation the
  // CLI's `skills` command shares (scripts/thread_context.mjs).
  const ctx = threadContexts(env, absRoot, constraints, { stack, crossings, graph });
  const epKind = new Map(env.entryPoints.map((e) => [e.id, e.kind]));
  const epFw = new Map(env.entryPoints.map((e) => [e.id, e.framework ?? null]));

  // 1. The raw forms, on request: the IR one file per source file, and the
  //    envelope without it.
  if (withIr) {
    for (const [rel, ir] of Object.entries(env.files)) write(join("ir", `${rel}.ir.json`), json(ir));
    const { files: _files, ...envelopeRest } = env;
    write("envelope.json", json({ ...envelopeRest, stack, crossings, threadCalls: graph }));
    write("stack.json", json(stack));
    write("crossings.json", json(crossings));
  }

  // 2. One contract per thread, the three blocks a worker prompt carries, in
  //    the worker's order: what the code does, what it is built on, what it
  //    must keep. And the thread's SKILL, when one exists and the injection
  //    gate lets it through: a stored skill is read with the same stamp the
  //    server writes (thread_skill_stamp.ts), so fresh means fresh here too.
  //    Skills are gitignored in the analysed project — this folder is the
  //    only way a ratified one travels.
  const threads = [];
  const skills = { copied: [], withheld: [] };
  const stamps = {};
  const contracts = new Map(); // M-ARCH.1 — reused by the architecture model
  for (const t of env.threads) {
    const ep = t.entryPointId;
    if (!ep) continue;
    const { contract, routed, stamp } = ctx.byEntry.get(ep);
    contracts.set(ep, contract);
    const blocks = [
      formatContractBlock(contract),
      formatSystemSpec(stack, constraints, { entryPointId: ep }),
      formatConstraintsBlock(routed, Number.MAX_SAFE_INTEGER) ?? "## Constraints for this thread (STATED)\nNone of the stated constraints route to this thread.",
    ].filter(Boolean);
    const file = join("threads", `${slug(ep)}.md`);
    write(file, `# ${contract.qualifiedName}\n\nEntry point: \`${ep}\` (${epKind.get(ep) ?? "thread"})\n\n${blocks.join("\n\n")}\n`);

    stamps[ep] = stamp;
    const skill = getThreadSkill(absRoot, ep, stamp);
    let skillFile = null;
    let skillNote = null;
    if (skill.exists) {
      const text = injectableSkillText(skill);
      if (text) {
        skillFile = join("skills", `${slug(ep)}.md`);
        const by = skill.ratifiedBy?.kind === "model" ? `a model (${skill.ratifiedBy.model}) under ruling ${skill.ratifiedBy.delegatedBy.id}` : "a human";
        const freshness = skill.stale ? "STALE — the thread or its rules changed since ratification; kept by the human's auto-reaffirm opt-in, caveat below" : "fresh";
        write(skillFile, `# Thread skill — ${contract.qualifiedName}\n\nEntry point: \`${ep}\` · ratified by ${by} · generated ${skill.generatedAt} · ${freshness}\n\nMODEL-DRAFTED, then ratified; provenance above. A stated constraint still overrides it.\n\n${text}\n`);
        skills.copied.push({ entryPointId: ep, file: skillFile, stale: skill.stale, ratifiedBy: skill.ratifiedBy?.kind ?? "human" });
      } else {
        skillNote = skill.status !== "ratified"
          ? "withheld: a draft no one has ratified"
          : "withheld: stale — the thread's steps or the rules routed to it changed since ratification, and auto-reaffirm is off";
        skills.withheld.push({ entryPointId: ep, reason: skillNote });
      }
    }
    threads.push({
      entryPointId: ep, file, qualifiedName: contract.qualifiedName, summary: summarizeContract(contract),
      filesReached: contract.filesReached, routed: routed.map((c) => c.id), skill, skillFile, skillNote,
    });
  }
  write("threads/INDEX.md", [
    "# Threads (derived — one per discovered entry point)",
    "",
    "| entry point | kind | files reached | effects | round trips | boundaries unattributed | crosses into | stated rules routed | contract | skill |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...threads.map((t) => {
      const s = t.summary;
      const effects = Object.entries(s.effects).filter(([, n]) => n > 0).map(([k, n]) => `${k}×${n}`).join(" ") || "none";
      return `| \`${t.entryPointId}\` | ${epKind.get(t.entryPointId) ?? ""}${epFw.get(t.entryPointId) ? `/${epFw.get(t.entryPointId)}` : ""} | ${t.filesReached.join(", ")} | ${effects} | ${s.roundTrips} | ${s.unattributed} | ${s.crossesInto.join(", ") || "—"} | ${t.routed.join(", ") || "—"} | ${t.file} | ${t.skillFile ?? t.skillNote ?? "—"} |`;
    }),
    "",
    "`effects` counts effectful external calls by kind; `unattributed` counts boundaries no attribution rule could join to a tool (a named limit, never a guess). `skill` is the ratified per-thread guidance when one exists and is current; a withheld one says why.",
    "",
  ].join("\n"));

  // 2b. M-FLOW.4 — the FLOWS: every hop that leaves a thread's language or
  //     process, rendered terminal to terminal (the page → the literal it
  //     hands the platform → the script → what the script leaves through),
  //     and the same hops indexed from the target's side, which is the
  //     reverse trace: what runs each script.
  const epLabel = new Map(env.entryPoints.map((e) => [e.id, `${e.label}${e.framework ? ` (${e.framework})` : ""}`]));
  const boundariesOf = (ep) => {
    const t = env.threads.find((x) => x.entryPointId === ep);
    const ext = [...new Set((t?.nodes ?? []).filter((n) => n.kind === "external").map((n) => n.label))];
    return ext.length ? ext.slice(0, 8).join(", ") + (ext.length > 8 ? ", …" : "") : "no external boundary the IR sees";
  };
  const hops = crossings.all ?? [];
  const flowLines = [
    "# Flows (derived — every hop that leaves a thread's language or process)",
    "",
    "A hop is a weighed claim over parsed data on both sides: the caller names its target by a literal (a URL shape, a script path, a tool name) and the callee declares it (a route, a parsed file, a registration). `path` = one target; `ambiguous` = several named, none claimed; `unmatched` = the literal names nothing this project parses. Read top-down from what the user sees to the script that ingests; the reverse index below reads the other way. A hop never widens a thread: each thread's own files stay one language.",
    "",
  ];
  if (!hops.length) flowLines.push("No crossing found: no thread names a route, script or tool outside its own files.", "");
  const byKind = {};
  for (const h of hops) (byKind[h.kind ?? "http"] ??= []).push(h);
  for (const [kind, title] of [["command", "## Commands — a thread runs a script"], ["tool", "## Tools — a thread calls an MCP tool"], ["http", "## HTTP — a thread calls a route"]]) {
    const list = byKind[kind] ?? [];
    if (!list.length) continue;
    flowLines.push(title, "");
    for (const h of list) {
      const from = `\`${h.entryPointId}\`${epLabel.has(h.entryPointId) ? ` — ${epLabel.get(h.entryPointId)}` : ""}`;
      const via = `${h.callee} \`${h.path}\` (${h.file})`;
      if (!h.targets.length) { flowLines.push(`- ${from} → ${via} → **unmatched**: ${h.note}`); continue; }
      for (const t of h.targets) {
        flowLines.push(`- ${from} → ${via} → \`${t.entryPointId}\`${epLabel.has(t.entryPointId) ? ` — ${epLabel.get(t.entryPointId)}` : ""} [${h.confidence}]`);
        flowLines.push(`  - the target leaves through: ${boundariesOf(t.entryPointId)}`);
      }
    }
    flowLines.push("");
  }
  const reverse = new Map();
  for (const h of hops) for (const t of h.targets) {
    if (!reverse.has(t.entryPointId)) reverse.set(t.entryPointId, []);
    reverse.get(t.entryPointId).push(h);
  }
  if (reverse.size) {
    flowLines.push("## Reverse index — what runs each target", "");
    for (const [to, list] of [...reverse.entries()].sort()) {
      const froms = [...new Set(list.map((h) => `\`${h.entryPointId}\` (${h.kind ?? "http"}: ${h.path})`))];
      flowLines.push(`- \`${to}\`${epLabel.has(to) ? ` — ${epLabel.get(to)}` : ""} ← ${froms.join("; ")}`);
    }
    flowLines.push("");
  }
  write("flows.md", flowLines.join("\n"));

  // 2c. M-ARCH.1 — the derived architecture model, from the contracts just
  //     computed. The JSON rides with the raw forms; M-ARCH.5 adds the prose
  //     and the self-contained picture.
  const architecture = archModelForEnvelope(env, stack, crossings, absRoot, (ep) => contracts.get(ep) ?? null);
  if (withIr) write("architecture.json", json(architecture));
  // 2026-09-25 — the SYSTEM MAP as prose is part of the default bundle: it is
  // the one page that says how the whole system fits together, and a plain
  // Claude reads prose. The data twin, the picture (and Archify's file, only
  // on --archify) are opt-in, the M-CRYSTAL rule for anything that is not prose.
  const archArgs = { title: basename(absRoot), commit, tool, envelope: env, threadGraph: graph };
  if (withArch || archify) {
    writeArchArtifacts(architecture, { write, ...archArgs, repository: repositoryFor(absRoot), skipJson: withIr, archify });
  } else {
    write("architecture.md", renderSystemMapMd(systemMapFor(architecture, archArgs)));
  }

  // 3. Project-level renderings: the system spec and every stated constraint.
  // M-CMD.1 — a FILE, not a prompt: the default budget is sized for a
  // prompt block and truncated this document to its first alphabetical
  // page on a real project. A file reader can scroll, and the pointer
  // names something they actually have.
  write("system_spec.md", (formatSystemSpec(stack, constraints, {
    budget: Number.MAX_SAFE_INTEGER,
    truncationHint: withIr ? "the whole index is in stack.json" : "re-run with --with-ir for the whole index as stack.json",
  }) ?? "## Stack\nNo third-party or project-funnel tools found in the project's imports.") + "\n");
  write("constraints.md", (formatConstraintsBlock(constraints, Number.MAX_SAFE_INTEGER)
    ?? "## Constraints (STATED)\nNo stated constraints in .vibegraph/constraints.json (state one with `vibegraph-knowledge constraints add`).")
    .replace("## Constraints for this thread", "## Every stated constraint in this project")
    + "\n\nEach constraint's scope (which files/threads/tools it routes to) and its checkable half (`check`/`checks`, a rule the IR verifies) are in `../constraints.json`; the per-thread files under `threads/` show which rules route to which thread.\n");

  // 3b. What consented runs saw, verbatim: an overlay beside the IR, never in
  //     it (PLAN-M-RUNTIME). Staleness is judged against the current files by
  //     whoever reads it, and is never persisted — so the copy says that.
  const observationsPath = join(absRoot, ".vibegraph", "observations.json");
  const observations = existsSync(observationsPath);
  if (observations) write("observations.json", readFileSync(observationsPath, "utf-8"));

  // 4. The derived quality artefacts (computed regardless — the plan's
  //    closing bars need them — and written with the other raw forms).
  const { profile, notes: profileNotes } = deriveStackProfile(env, stack, { project: root, commit });
  const { model, notes: modelNotes } = deriveQualityModel(profile, constraints, { commit });
  if (withIr) {
    write("quality/stack_profile.json", json(profile));
    write("quality/quality_model.json", json(model));
    write("quality/NOTES.md", `# Derivation notes\n\n${[...profileNotes.map((n) => `- profile: ${n}`), ...modelNotes.map((n) => `- model: ${n}`)].join("\n") || "- none"}\n`);
  }

  // 5. With a task: the deterministic plan and each packet's closing bar —
  //    the same functions the server calls at the objective gate, minus the
  //    brief (a model spawn, so not knowledge the codebase yields for free).
  let plan = null;
  let taskNamesNoCode = false;
  if (task) {
    const byEp = new Map(threads.map((t) => [t.entryPointId, t]));
    const tokens = tokenizeQuestion(task);
    taskNamesNoCode = tokens.nodeIds.size + tokens.files.size + tokens.symbols.size === 0;
    const raw = planWork({
      task, threads: env.threads, entryPoints: env.entryPoints,
      skillFor: (id) => byEp.get(id)?.skill ?? { exists: false, key: threadSkillKey(id), entryPointId: id },
      contractFor: (id) => { const t = byEp.get(id); return t ? { ...t.summary, constraints: t.routed.length } : null; },
    });
    const calibrated = calibratedVerbs();
    const packets = raw.packets.map((p) => {
      const t = byEp.get(p.entryPointId);
      const routed = routeConstraints(constraints, { entryPointId: p.entryPointId, filesReached: p.filesReached, stack: stack.byThread[p.entryPointId] ?? [] });
      const acceptance = computeAcceptance({
        packetId: `p${p.order}`, entryPointId: p.entryPointId,
        scope: { files: p.filesReached, declaredBy: "thread" },
        routedConstraints: routed, profile, model, calibrated,
        task: {
          constraintsRouted: routed.length > 0,
          effectfulBoundaries: Object.values(t?.summary.effects ?? {}).some((n) => n > 0),
          systemPacket: false, crossLanguage: (t?.summary.crossesInto.length ?? 0) > 0, retry: false,
        },
        commit,
      });
      return { id: `p${p.order}`, ...p, routedConstraints: routed.map((c) => c.id), contractFile: t?.file ?? null, acceptance };
    });
    plan = { ...raw, packets, note: "Deterministic: plan_work over the remit index + computeAcceptance per packet. The brief a live run writes (packet tasks, edit scopes, system packets) is a model's work and is NOT here." };
    write("plan.json", json(plan));
    // The plan note from plan_work names the MCP tools a driving Claude has;
    // this reader has none, so the note is kept only where it explains a
    // refusal (no packets) and the packet section speaks for itself.
    const lines = [
      "# Plan for the task (derived — dependencies first; the same decomposition a live run starts from)",
      "",
      `Task: ${task}`,
      "",
      // plan_work's own note names the MCP tools a driving Claude has; this
      // reader has none (the drill's dry run printed them into plan.md).
      packets.length ? null : "> No thread's remit matched this task (matching is lexical over the IR — exact code-shaped tokens only, never a semantic guess).",
      // Three honest states, not two: a task naming NO code used to print
      // "every code-shaped token matched" (vacuously true, and it contradicted
      // the refusal above it). M-CRYSTAL.2.
      taskNamesNoCode
        ? "**The task names no code** — no file, symbol or structural node id the matcher could use, so no thread was matched and this plan is empty. Name the files, symbols or node ids the task touches; matching is lexical over the IR, never a semantic guess. `threads/INDEX.md` lists every thread with the files it reaches, which is the other way in."
        : raw.unmatchedTokens.length
          ? `**Code-shaped tokens in the task that matched NO thread:** ${raw.unmatchedTokens.map(tick).join(", ")} — the plan does not cover them; look before editing there.`
          : "Every code-shaped token in the task matched a thread.",
      raw.cycles.length ? `**Dependency cycles** (order inside one is score-ranked, not topological): ${raw.cycles.map((c) => c.join(" → ")).join("; ")}` : null,
      "",
      "Build order is dependencies-first: a packet's `depends on` packets are built BEFORE it. `outside this plan` names threads the packet touches that no packet owns — a change needed there is outside the task as decomposed, so say so rather than guessing. The decomposition is lexical over the IR (which threads own the code the task names), never a semantic guess; what each packet should DO is yours to decide.",
      "",
      ...packets.flatMap((p) => {
        const deps = p.boundaries.dependsOn.map((d) => packets.find((q) => q.entryPointId === d)?.id ?? d);
        const s = p.contract;
        return [
          `## ${p.id} · ${p.qualifiedName}`,
          "",
          `- entry point: \`${p.entryPointId}\` (${p.kind ?? "thread"}); matched on ${p.matchedOn.map(tick).join(", ")}`,
          `- files reached (this packet's edit scope): ${p.filesReached.join(", ")}`,
          `- depends on: ${deps.join(", ") || "nothing in this plan"}`,
          `- outside this plan: reaches ${p.boundaries.outsidePlan.reaches.join(", ") || "—"}; reached by ${p.boundaries.outsidePlan.reachedBy.join(", ") || "—"}`,
          `- boundaries: ${p.boundaries.staticallyComplete ? "statically complete" : "NOT statically complete"} — ${p.boundaries.resolutionGaps} resolution gap(s), ${p.boundaries.runtimeDispatch} runtime dispatch, ${p.boundaries.uncaptured} uncaptured`,
          s ? `- contract: ${s.params} param(s), returns ${s.returns ?? "no declared type"}, effects ${Object.entries(s.effects).filter(([, n]) => n > 0).map(([k, n]) => `${k}×${n}`).join(" ") || "none"}, ${s.roundTrips} round trip(s) in loops, ${s.constraints} stated rule(s) routed${p.routedConstraints.length ? ` (${p.routedConstraints.join(", ")})` : ""}` : null,
          `- thread contract: ${p.contractFile ?? "(none)"}`,
          `- closing bar (what a review of this packet checks): ${p.acceptance.closingBar}`,
          "",
        ];
      }),
    ];
    write("plan.md", lines.filter((l) => l !== null).join("\n") + "\n");
  }

  // 6. The index, written for the reader that has none of the tools.
  const langs = [...new Set(Object.values(env.files).map((f) => f.language))].sort();
  // M-CMD.1 — files whose IR the parser could not finish (the stamp rides
  // the IR itself now, so this is read, not recomputed).
  const degradedFiles = Object.entries(env.files)
    .filter(([, ir]) => ir?.degraded)
    .map(([file, ir]) => ({ file, dropped: ir.degraded.dropped }));
  const skillLine = skills.copied.length || skills.withheld.length
    ? `**\`skills/<entry point>.md\`** (MODEL-DRAFTED, then RATIFIED — provenance in each file) — the per-thread guidance a person or a delegated model signed off, with the rules and their reasons. ${skills.copied.length} copied${skills.copied.some((s) => s.stale) ? ` (${skills.copied.filter((s) => s.stale).length} stale, kept by auto-reaffirm with a caveat)` : ""}${skills.withheld.length ? `; ${skills.withheld.length} withheld: ${skills.withheld.map((w) => `\`${w.entryPointId}\` ${w.reason}`).join("; ")}` : ""}.`
    : null;
  write("README.md", [
    README_HEAD,
    "",
    `Generated ${new Date().toISOString()} by ${tool ?? `VibeGraph commit ${commit} (\`scripts/export_knowledge.mjs\`)`}; the project was ${projectCommit === undefined ? `at VibeGraph commit ${commit}` : projectCommit ? `at commit ${projectCommit}` : "not a git repository, so no commit is recorded"}. Nothing here was written by a model: every file is DERIVED (a script read it from the code), STATED (a person wrote it, with provenance on each line) or OBSERVED (a consented run saw it). Where the derivation could not follow something it says so (\`dynamic\` = genuine runtime dispatch, \`unresolved\` = a resolution gap, \`unattributed\` = a boundary no rule could join to a tool); none of those is an error in the code.`,
    "",
    `Project: ${Object.keys(env.files).length} files across ${langs.join(", ")}; ${env.entryPoints.length} entry points; ${threads.length} threads; ${constraints.length} stated constraints.${Object.keys(parseErrors).length ? ` Parse errors in: ${Object.keys(parseErrors).join(", ")}.` : ""}`,
    // M-CMD.1 — never skip in silence. A project that keeps real source in a
    // directory named `build` must be able to see that it was passed over,
    // and a partially-read file must be nameable before anything trusts it.
    ...(Object.keys(skippedDirs ?? {}).length
      ? ["", `**Not read:** ${Object.entries(skippedDirs).map(([d, n]) => `\`${d}/\` (${n} file(s))`).join(", ")} — skipped as compiled output. If any of that is real source, it is missing from everything below.`]
      : []),
    ...(degradedFiles.length
      ? ["", `**Partially read:** ${degradedFiles.map((d) => `\`${d.file}\` (${d.dropped} construct(s) dropped)`).join(", ")} — the parser could not read part of these files. Their IR is INCOMPLETE: something absent from it may still exist in the source, so read those files directly before concluding anything about them.`]
      : []),
    ...((unresolvedSeeds ?? []).length
      ? ["", `**Named but not found:** ${unresolvedSeeds.map((s) => `\`${s.seed}\` (${s.reason})`).join("; ")} — someone named these entry points in \`.vibegraph/manual_seeds.json\` and they did not resolve, so no thread was built for them.`]
      : []),
    "",
    "## Read in this order",
    "",
    `1. **\`constraints.md\`** (STATED) — the operators' rules with their reasons. They are not in the code; they are the part of the task you cannot infer. The raw form with scopes and checkable halves is \`../constraints.json\`.`,
    ...(plan ? [`2. **\`plan.md\`** (DERIVED) — the task decomposed onto the threads that own it, dependencies first, with each packet's files, its escalation surface and its closing bar (what a review would check). \`plan.json\` is the raw form.`] : ["2. (no task was given, so there is no plan)"]),
    `3. **\`threads/INDEX.md\`** then **\`threads/<entry point>.md\`** (DERIVED) — one contract per thread: what enters and leaves, every external call with its literal call text and the tool it leaves through, round trips inside loops, the thread's stack, the hops that cross into another language or process, and the stated rules routed to that thread. This is exactly what a VibeGraph worker is handed before it edits. **\`flows.md\`** (DERIVED) renders every such hop terminal to terminal — the page, the literal it hands the platform, the script it runs, what that script leaves through — with a reverse index of what runs each script.`,
    ...(skillLine ? [`4. ${skillLine}`] : []),
    `${skillLine ? 5 : 4}. **\`architecture.md\`** (DERIVED + STATED) — the whole system on one page: the start-here story, the system in a dozen arrows, where each process runs, what each one calls and hops to (with the protocol and the fact it was read from), what crosses each edge, the deployment boundaries, the subsystems, which threads drive which, and what the map leaves out. Read it before a task that crosses processes. **\`system_spec.md\`** (DERIVED + STATED) — the tools the project is built on, with roles and evidence, project funnels (a module wrapping a tool, imported by two or more files — edit inside the funnel, not around it), and the policies stated about them.`,
    ...(observations ? [`${skillLine ? 6 : 5}. **\`observations.json\`** (OBSERVED) — what consented runs saw at each call site: the receiver a \`dynamic\` call actually dispatched to. Per site, per run; two runs that disagree both survive. Judge staleness against the current files yourself — it is never recorded.`] : []),
    ...(withIr ? [
      `${(skillLine ? 5 : 4) + (observations ? 2 : 1)}. **\`envelope.json\`**, **\`stack.json\`**, **\`crossings.json\`** (DERIVED) — the project map: entry points, threads with their steps, the system tier, the stack index (tools per file and per thread, import and local bindings), the cross-language crossings, the thread call graph.`,
      `${(skillLine ? 5 : 4) + (observations ? 3 : 2)}. **\`ir/<file>.ir.json\`** (DERIVED) — the IR per source file: \`{nodes, edges, symbolIndex}\`, node ids are structural paths (\`module/Class.class/method.fn/call@3\`), edges include cross-file \`reference\` edges the linker resolved. Read a file's IR when you need to know what calls what without reading the source.`,
      `${(skillLine ? 5 : 4) + (observations ? 4 : 3)}. **\`quality/\`** (DERIVED) — the stack profile (facts with confidence and regimes) and the quality model (dimensions and the checks they bind, all advisory until calibrated).`,
    ] : [
      `${(skillLine ? 5 : 4) + (observations ? 2 : 1)}. The raw derived forms (per-file IR, the envelope, the stack index, the crossings, the quality profile) are not written by default — the source is the better reference once you start editing. \`--with-ir\` adds them.`,
    ]),
    ...(withArch ? [
      "",
      `**The system map as data:** \`architecture.vibegraph.json\` (format \`vibegraph.system-map\`) holds every box, edge and group with its provenance, each lens of the map (Bird's-eye, Overview, Tools, Flows, Payloads, Trust) as the ids it selects, the hierarchy, the start-here story, the subsystems and the thread graph — query it when \`architecture.md\` caps a list. **For a person:** \`architecture.html\` is the same map, self-contained, with every lens as a toggle — open it in a browser.${archify ? " \`architecture.archify.json\` is the model in Archify's schema, for that tool." : ""} Everything in them is derived from the code or stated by a person; a model's proposal appears only marked *proposed*.`,
    ] : []),
    "",
    "## What is NOT here",
    "",
    ...(skillLine ? [] : ["- Thread skills: none exist for this project (draft one with `vibegraph-knowledge skills draft <entry id>`, review it, then `skills ratify` — or in VibeGraph itself)."]),
    ...(observations ? [] : ["- Runtime observations: none — nothing here was run."]),
    "- A brief: the packet tasks, edit scopes and system packets a live VibeGraph run writes come from a model and are not knowledge the codebase yields for free.",
    "- Any judgement. A contract says what the code does; a constraint says what a person requires; neither says whether the code is good.",
    "",
    "## Files",
    "",
    ...[...written, "README.md"].sort().map((f) => `- \`${f}\`${f === "README.md" ? " (this index)" : ""}`),
    "",
  ].join("\n"));

  return {
    outDir, written, threads: threads.length, files: Object.keys(env.files).length, constraints: constraints.length,
    packets: plan?.packets.length ?? null, unmatchedTokens: plan?.unmatchedTokens ?? null, taskNamesNoCode, parseErrors,
    withIr, observations, architecture: withArch, archify,
    skills: { copied: skills.copied.length, withheld: skills.withheld.length, files: skills.copied.map((s) => s.file) },
    /** entryPointId → the stamp a stored skill must carry to read as fresh here (what the server writes). */
    stamps,
  };
}

// Main guard by file name, not by import.meta.url === argv[1]: inside the
// M-CRYSTAL bundle both are the bundle, and this block would run at import.
if (process.argv[1] && basename(process.argv[1]) === "export_knowledge.mjs") {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const root = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
  if (!root) { console.error("usage: export_knowledge.mjs <root> [--out dir] [--task text] [--envelope p] [--commit sha] [--with-ir]"); process.exit(2); }
  const commit = flag("--commit") ?? execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf-8" }).trim();
  const r = exportKnowledge({ root, out: flag("--out"), task: flag("--task"), envelope: flag("--envelope"), commit, withIr: args.includes("--with-ir"), architecture: args.includes("--architecture"), archify: args.includes("--archify") });
  console.log(`wrote ${r.written.length} files to ${r.outDir}: ${r.files} source files${r.withIr ? " with IR" : ""}, ${r.threads} thread contracts, ${r.skills.copied} skills, ${r.constraints} stated constraints${r.packets !== null ? `, plan of ${r.packets} packets` : ""}${r.unmatchedTokens?.length ? ` (unmatched tokens: ${r.unmatchedTokens.join(", ")})` : ""}`);
  if (r.taskNamesNoCode) console.error("the task names no code (no file, symbol or node id), so the plan is empty — name what it touches");
  if (Object.keys(r.parseErrors).length) console.error(`parse errors: ${Object.keys(r.parseErrors).join(", ")}`);
}
