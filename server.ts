import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFile, spawn } from "child_process";
import { WebSocketServer, WebSocket } from "ws";
import { createMcpHttpHandler } from "./src/mcp/server";
import type { VibegraphMcpContext } from "./src/mcp/context";
import { selectBackend, type ChatSession } from "./src/server/chat/backend";
import { ClaudeStdioBackend } from "./src/server/chat/claude_stdio_backend";
import { forwardChatEvent } from "./src/server/chat/forward";
import { buildChatPrompt, buildStagePrompt, buildTurnPreamble, renderRoutedBlock, type ChatNodeContext, type ChatThreadContext, type ChatTurnContext } from "./src/server/chat/prompt";
import { buildRemitIndex, matchQuestion, matchNode, mergeMatches, applyRoutingBudget, SKILL_INJECTION_BUDGET_CHARS, type ThreadRemit, type RoutedThreadContext, type RoutingCandidate } from "./src/server/thread_remit";
import { planWork } from "./src/server/plan_work";
import { buildArtifactIndex, detectMissingArtifacts, missingArtifactFor, isArtifactPath, type ArtifactRecord } from "./src/server/artifact_index";
import { planSweep, runSweep } from "./src/server/skill_sweep";
import { parseReviseStageBlock, applyItemRevision } from "./src/server/build_plan_modify";
import { makeRunSandbox } from "./src/server/run/sandbox";
import { getReadme as readReadmeFromStore, writeReadme, sourceHashOf } from "./src/server/readme_store";
import {
  getThreadSkill as readThreadSkillFromStore,
  writeThreadSkill,
  ratifyThreadSkill,
  reaffirmThreadSkill,
  setThreadSkillAutoReaffirm,
  makeThreadSnapshot,
  threadSkillDiff,
  injectableSkillText,
  isAuthoritative as threadSkillAuthoritative,
  type ThreadSkillResult,
} from "./src/server/thread_skill_store";
import { extractFunctionSource } from "./src/server/intent_extract";
import { synthesizeArgs, resolveClaudeBin } from "./src/server/run/synth_args";
import { arraylikeParams, arraylikeDeclineReason } from "./src/server/run/arg_shape";
import { draftInsertion } from "./src/server/compose_draft";
import { validateSystemPlan, loadSystemPlan, persistSystemPlan } from "./src/server/system_plan";
import { draftSystemPlan } from "./src/server/system_draft";
import { validateChangeset, changesetConsentScope, CHECK_MODULE, CHECK_FN_ID } from "./src/server/changeset";
import { draftChangeset } from "./src/server/changeset_draft";
import { validateBuildPlan, persistBuildPlan, loadBuildPlan, setItemStatus, nextBuildableItem } from "./src/server/build_plan";
import { draftBuildPlan, type RoadmapRevision } from "./src/server/build_plan_draft";
import type { Changeset, ChangesetFile, ChangesetFloor, BuildPlan } from "./src/shared/protocol";
import {
  mintEffectConsent, verifyEffectConsent, mintDataConsent, verifyDataConsent,
  gatedOffenses, grantUnverifiedTrust, mintUnverifiedTrust, isTrustableOffense,
} from "./src/server/run/effect_consent";
import { detectMissingDataFiles, missingPathFromStderr, safeRelPath, type MissingDataFile } from "./src/server/run/missing_data";
import { synthesizeDataFile, collectSiblingSamples, collectHelperSources } from "./src/server/run/synth_data";
import type { EffectOffense, ThreadRunResult as WireThreadRunResult } from "./src/shared/protocol";
// M-NEST L3 — agent-facing thread projection (compact + two honest markers).
import { projectThreadForAgent, deriveNests } from "./src/webview/threads/collapse";
import type { Thread } from "./src/webview/threads/types";
import { computeThreadBlindSpots, formatBlindSpotsBlock } from "./src/webview/threads/blindSpots";
import { computeThreadAssertions } from "./src/webview/threads/threadAssertions";
import { validateCitations as validateCitationsCore, isGroundedSkill } from "./src/server/citations";
import { validateSkillBody, skillBodyOverBudget } from "./src/server/skill_contract";
import { computeBlastRadius, type BlastFile, type BlastThread } from "./src/server/blast_radius";
import { diffIR, type IrDelta } from "./src/server/ir_delta";
import { explainPrompt, EXPLAIN_ATTRIBUTION, type NodeExplanation } from "./src/server/explain";
import { OBSERVE_NOTE, type DynamicObservation } from "./src/server/observe";
import { buildThreadAgentPrompt, isEscalation, renderAgentProjection, type ThreadAgentResult } from "./src/server/thread_agent";
import { deriveThreadCalls } from "./src/webview/system/threadInteraction";
import { isKnownChatModel } from "./src/shared/chat_models";
import { sanitiseTiers, type ModelTier } from "./src/shared/model_tiers";
import { setModelTiers } from "./src/server/run/synth_args";

// When bundled, __dirname = dist/, so go up one level for project root
const PROJECT_ROOT = path.join(__dirname, "..");
const SCRIPT_PATH = path.join(PROJECT_ROOT, "scripts", "parse_cst.py");
const LINKER_SCRIPT = path.join(PROJECT_ROOT, "scripts", "cross_file_link.py");
const RUN_BLOCK_SCRIPT = path.join(PROJECT_ROOT, "scripts", "run_block.py");
const RUN_TO_NODE_SCRIPT = path.join(PROJECT_ROOT, "scripts", "run_to_node.py");
const SCAN_EFFECTS_SCRIPT = path.join(PROJECT_ROOT, "scripts", "scan_effects.py");
const CHECK_LITERALS_SCRIPT = path.join(PROJECT_ROOT, "scripts", "check_literals.py");
const REWRITE_SCRIPT = path.join(PROJECT_ROOT, "scripts", "cst_rewrite.py");
const EXTRACT_THREAD_SCRIPT = path.join(PROJECT_ROOT, "scripts", "extract_thread.py");
const DISCOVER_ENTRY_POINTS_SCRIPT = path.join(PROJECT_ROOT, "scripts", "discover_entry_points.py");
const BUILD_SYSTEM_TIER_SCRIPT = path.join(PROJECT_ROOT, "scripts", "build_system_tier.py");
const CHECK_PROJECT_DEPS_SCRIPT = path.join(PROJECT_ROOT, "scripts", "check_project_deps.py");
const RESOLVE_EXTERNAL_SCRIPT = path.join(PROJECT_ROOT, "scripts", "resolve_external_callable.py");
const PLACE_INTENT_SCRIPT = path.join(PROJECT_ROOT, "scripts", "place_intent.py");
const PYDEPS_DIR = path.join(PROJECT_ROOT, ".pydeps");
const DIST_DIR = __dirname;

// Inject .pydeps into PYTHONPATH so libcst (parser) and black (rewriter
// formatter) are available without a system-wide Python install. runVis.sh
// bootstraps these on first launch.
function pythonEnv(): NodeJS.ProcessEnv {
  const existing = process.env.PYTHONPATH ?? "";
  return {
    ...process.env,
    PYTHONPATH: existing ? `${PYDEPS_DIR}:${existing}` : PYDEPS_DIR,
  };
}

// Cached parse result for quick node lookups
let lastParse: { nodes: any[]; edges: any[]; symbolIndex: any[] } | null = null;

// Multi-file (directory) mode
let projectParse: Record<string, { nodes: any[]; edges: any[]; symbolIndex: any[] }> = {};

// M8.2.4 — discovered entry points for the loaded project (PLAN-v2.md
// §1.2). Refreshed by runDiscoverEntryPoints() after every project
// parse / cross-file link. Empty in single-file mode and when discovery
// errors out — the diagram view stays usable either way.
let latestEntryPoints: any[] = [];

// M8.3.1 — threads extracted at parse time (PLAN-v2.md §1.1, §1.3).
// One per entry point, keyed back via entryPointId; ships in the
// envelope so the thread index can render without round-tripping for
// each row. Empty in single-file mode. Cache invalidation: full
// re-extract on any project parse — sufficient until the parse
// pipeline learns to do per-file dirty-tracking.
let latestThreads: any[] = [];

// M-SKILL.2 — remit index memo. buildRemitIndex is pure; latestThreads is
// REASSIGNED (never mutated in place) on boot parse and every M26
// refreshDerived, so array identity is the exact staleness signal.
let remitCache: { ref: unknown; index: ThreadRemit[] } | null = null;
function remitIndex(): ThreadRemit[] {
  if (!remitCache || remitCache.ref !== latestThreads) {
    remitCache = { ref: latestThreads, index: buildRemitIndex(latestThreads) };
  }
  return remitCache.index;
}

// M19.1 — the system tier (PLAN-v5 §1), rolled up from latestThreads +
// per-file effectKind + latestEntryPoints after every project parse.
// Pure derivation; ships in the v2.1 envelope so the system view (M19.2)
// renders without round-tripping. Empty in single-file mode.
let latestSystem: { subsystems: any[]; edges: any[] } = { subsystems: [], edges: [] };

// NEXT-ACTIONS §2 (project-env awareness) — third-party import roots the
// analyzed project declares that are NOT importable from the runtime's
// PYTHONPATH (.pydeps). Refreshed with every full/incremental derived
// pass; ships as a `project-warnings` WS message so the webview can
// surface the gap (external-call resolution silently degrades without
// the dep) instead of leaving it to hand-diagnosis.
let latestMissingDeps: { module: string; files: string[] }[] = [];

// PLAN-v7 Stage 3 — the ratified architecture PLAN, when one exists. A
// LABELLED PLAN (never honest IR): rides the envelope as a SIBLING of
// `system`, composed with it only at render. Loaded from
// <projectRoot>/.vibegraph/system-plan.json, mtime-cached so an
// externally-written (or deleted) plan is picked up on the next envelope
// build instead of being frozen at boot; set directly by
// system-plan-accept.
let systemPlan: import("./src/shared/protocol").SystemPlan | null = null;
let systemPlanMtime = -1;

// PLAN-v7 Stage 5 — the BUILD PLAN (roadmap) + the orchestrator run flags.
// The plan artifact is the durable run state (per-item status persisted on
// every transition); these flags are just the live-session dial: active =
// the run auto-advances on accept, runItemId = the item currently
// drafting/gated. Not persisted — after a restart the run is PAUSED and the
// human resumes (never auto-resumes into drafting unattended).
let buildPlan: BuildPlan | null = null;
let buildPlanMtime = -1;
let buildRunActive = false;
let runItemId: string | null = null;

// ── M7 wave 1 — MCP cross-cutting state ───────────────────────────────────────
// The MCP server (src/mcp/server.ts) reads webview selection through the
// VibegraphMcpContext built lower in this file. Selection updates flow both
// ways: MCP set_selection -> broadcast `set-selection` WS message to webviews;
// webview `selection-changed` WS message -> update currentSelection + fan
// out to MCP subscribers via the resource-updated channel.
let currentSelection: { nodeId: string | null; filePath: string | null } = {
  nodeId: null,
  filePath: null,
};
const selectionListeners = new Set<(sel: { nodeId: string; filePath?: string }) => void>();
const projectUpdateListeners = new Set<() => void>();
function notifySelectionChanged(sel: { nodeId: string; filePath?: string }): void {
  for (const cb of selectionListeners) {
    try { cb(sel); } catch (e: any) { console.warn(`  [MCP] selection listener: ${e.message}`); }
  }
}
function notifyProjectUpdated(): void {
  for (const cb of projectUpdateListeners) {
    try { cb(); } catch (e: any) { console.warn(`  [MCP] project-update listener: ${e.message}`); }
  }
}

const pyFile = process.argv[2];
if (!pyFile) {
  console.error("Usage: node server.js <path-to-python-file-or-dir>");
  process.exit(1);
}

const inputPath = path.resolve(pyFile);
if (!fs.existsSync(inputPath)) {
  console.error(`Path not found: ${inputPath}`);
  process.exit(1);
}

const isDirectory = fs.statSync(inputPath).isDirectory();
// resolvedPyFile: the .py file (single-file mode) or project root dir (directory mode — only used for watching)
const resolvedPyFile = inputPath;

// ── Claude CLI detection ─────────────────────────────────────────────────────
// M7 wave 2 — LLM-backed features route through the user's Claude Code
// CLI subscription (spawns `claude -p`) instead of calling
// @anthropic-ai/sdk directly, so no separate ANTHROPIC_API_KEY is
// needed. Consumers: the chat panel (M25 revival), Analyze, the
// editor's Intent tier-2 fallback, and README generation.
let claudeCliAvailable = false;
if (process.env.VG_CLAUDE_BIN) {
  // M-SKILL.4 — the stub contract (M10R.7) covers every headless path: when
  // tests override the binary, "available" means the override, not PATH.
  claudeCliAvailable = true;
  console.log("  Claude: VG_CLAUDE_BIN override in effect — headless Claude paths use the stub");
} else {
  try {
    const { execSync } = require("child_process");
    execSync("command -v claude", { stdio: "ignore" });
    claudeCliAvailable = true;
    console.log("  Claude: claude CLI detected — Chat / Analyze / Intent / READMEs route through Claude Code");
  } catch {
    console.warn("  Claude: claude CLI not on PATH — Chat / Analyze / Intent / README generation will surface errors. Install Claude Code.");
  }
}


// ── Python parsing ────────────────────────────────────────────────────────────

function parseOneFile(filePath: string, modulePath?: string): Promise<any> {
  const argv = [SCRIPT_PATH, filePath];
  if (modulePath) argv.push("--module-path", modulePath);
  return new Promise((resolve, reject) => {
    const opts = { timeout: 10000, env: pythonEnv() };
    execFile("python3", argv, opts, (err, stdout, stderr) => {
      if (err) {
        execFile("python", argv, opts, (err2, stdout2, stderr2) => {
          if (err2) {
            reject(new Error(stderr || stderr2 || "Parser failed (libcst missing? run runVis.sh to bootstrap)"));
            return;
          }
          try { resolve(JSON.parse(stdout2)); } catch { reject(new Error(`Parse failed: ${filePath}`)); }
        });
        return;
      }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`Parse failed: ${filePath}`)); }
    });
  });
}

function parseFile(): Promise<any> {
  return parseOneFile(resolvedPyFile);
}

// M4a — convert an absolute file path under inputPath to a dotted module
// name. Matches cross_file_link.py:file_to_module_path. Stripping
// __init__.py treats the package as the importable name.
function fileToModulePath(filePath: string): string {
  const rel = path.relative(inputPath, filePath);
  const parts = rel.split(path.sep);
  if (parts[parts.length - 1] === "__init__.py") {
    parts.pop();
  } else if (parts[parts.length - 1].endsWith(".py")) {
    parts[parts.length - 1] = parts[parts.length - 1].slice(0, -3);
  }
  return parts.filter(Boolean).join(".");
}

// M4a — run the cross-file linker on the per-file IRs and return the
// enriched map. Falls through to the input on any error (the diagram
// view still renders, just without cross-file edges).
function runCrossFileLink(files: typeof projectParse): Promise<typeof projectParse> {
  return new Promise((resolve) => {
    const child = spawn("python3", [LINKER_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      env: pythonEnv(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed.files ?? files);
      } catch {
        if (stderr) console.warn(`  [Project] cross-file linker failed — ${stderr.split("\n")[0]}`);
        resolve(files);
      }
    });
    child.stdin.write(JSON.stringify({ files }));
    child.stdin.end();
  });
}

// M8.2.4 — pipe the linked project IR through discover_entry_points.py.
// Returns [] on any error (parser missing, JSON parse fail, etc.); the
// diagram view stays usable either way. Manual seeds: looks for
// `<project root>/.vibegraph/manual_seeds.json` and passes the path
// through if it exists.
function runDiscoverEntryPoints(files: typeof projectParse): Promise<any[]> {
  return new Promise((resolve) => {
    const args = [DISCOVER_ENTRY_POINTS_SCRIPT];
    const seedsPath = path.join(inputPath, ".vibegraph", "manual_seeds.json");
    if (fs.existsSync(seedsPath)) {
      args.push("--manual-seeds", seedsPath);
    }
    const child = spawn("python3", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: pythonEnv(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed.entryPoints ?? []);
      } catch {
        if (stderr) console.warn(`  [Project] entry-point discovery failed — ${stderr.split("\n")[0]}`);
        resolve([]);
      }
    });
    child.stdin.write(JSON.stringify({ files }));
    child.stdin.end();
  });
}

// NEXT-ACTIONS §2 — probe the analyzed project's third-party import
// roots for importability from .pydeps (find_spec only; no module code
// runs). Returns [] on any error — the warning channel must never make
// the parse pipeline less reliable than it was without it.
function runCheckProjectDeps(files: typeof projectParse): Promise<{ module: string; files: string[] }[]> {
  return new Promise((resolve) => {
    const child = spawn("python3", [CHECK_PROJECT_DEPS_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      env: pythonEnv(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", () => {
      try {
        resolve(JSON.parse(stdout).missing ?? []);
      } catch {
        if (stderr) console.warn(`  [Project] dep check failed — ${stderr.split("\n")[0]}`);
        resolve([]);
      }
    });
    child.stdin.write(JSON.stringify({ files }));
    child.stdin.end();
  });
}

// M8.3.1 — batch-extract one thread per entry point. Single subprocess
// invocation pays libcst-free Python startup once per project parse
// (vs. once per entry point). On any extraction failure, that thread
// is silently dropped — the others still ship; the index just shows
// fewer rows.
function runExtractAllThreads(
  files: typeof projectParse,
  entryPoints: any[],
): Promise<any[]> {
  if (entryPoints.length === 0) return Promise.resolve([]);
  return new Promise((resolve) => {
    const child = spawn("python3", [EXTRACT_THREAD_SCRIPT, "--batch-seeds"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: pythonEnv(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", () => {
      try {
        resolve(JSON.parse(stdout).threads ?? []);
      } catch {
        if (stderr) console.warn(`  [Project] thread batch-extract failed — ${stderr.split("\n")[0]}`);
        resolve([]);
      }
    });
    const seeds = entryPoints.map((e) => ({
      seedFile: e.file,
      seedId: e.irNodeId,
      entryPointId: e.id,
    }));
    child.stdin.write(JSON.stringify({ files, seeds }));
    child.stdin.end();
  });
}

// M19.1 — roll threads + per-file effectKind + entryPoints up into the
// system tier (PLAN-v5 §1.3). Pure derivation; the script also text-scans
// the frontend (inputPath) for route-string literals — the one
// language-shallow crossing (LIGHT path). On any failure the system tier
// is empty and the rest of the envelope still ships.
function runBuildSystemTier(
  files: typeof projectParse,
  entryPoints: any[],
  threads: any[],
): Promise<{ subsystems: any[]; edges: any[] }> {
  const empty = { subsystems: [], edges: [] };
  return new Promise((resolve) => {
    const child = spawn("python3", [BUILD_SYSTEM_TIER_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      env: pythonEnv(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", () => {
      try {
        resolve(JSON.parse(stdout).system ?? empty);
      } catch {
        if (stderr) console.warn(`  [Project] system-tier build failed — ${stderr.split("\n")[0]}`);
        resolve(empty);
      }
    });
    child.stdin.write(JSON.stringify({
      files,
      entryPoints,
      threads,
      projectRoot: isDirectory ? inputPath : null,
    }));
    child.stdin.end();
  });
}

// ── Directory helpers ─────────────────────────────────────────────────────────

function findPyFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "__pycache__" && entry.name !== "node_modules") {
      results.push(...findPyFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".py")) {
      results.push(full);
    }
  }
  return results;
}

// M6 wave 3b -- batch every file through one python3 process so libcst's
// cold-import cost is paid once per project parse, not once per file.
// Falls back to per-file parses if the batch run produces no usable
// output (parser old enough not to know --batch, or a startup error).
function parseAllFilesBatch(files: string[]): Promise<typeof projectParse> {
  return new Promise((resolve) => {
    const child = spawn("python3", [SCRIPT_PATH, "--batch"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: pythonEnv(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout);
        for (const [f, msg] of Object.entries(parsed.errors ?? {})) {
          console.warn(`  [Project] parse error: ${f} — ${msg}`);
        }
        resolve(parsed.files ?? {});
      } catch {
        if (stderr) console.warn(`  [Project] batch parser failed — ${stderr.split("\n")[0]}`);
        resolve({});
      }
    });
    for (const f of files) {
      child.stdin.write(`${f}\t${fileToModulePath(f)}\n`);
    }
    child.stdin.end();
  });
}

async function parseAllFiles(): Promise<void> {
  if (!isDirectory) return;
  const startedAt = Date.now();
  const files = findPyFiles(inputPath);
  let next = await parseAllFilesBatch(files);
  // Per-file fallback covers the case where the batch run failed
  // entirely (empty result) -- preserves the previous behaviour rather
  // than handing the client an empty project.
  if (Object.keys(next).length === 0 && files.length > 0) {
    console.warn("  [Project] batch parse returned nothing; falling back to per-file parses");
    const perFile: typeof projectParse = {};
    await Promise.all(
      files.map(async (f) => {
        try {
          perFile[f] = await parseOneFile(f, fileToModulePath(f));
        } catch (e: any) {
          console.warn(`  [Project] parse error: ${f} — ${e.message}`);
        }
      })
    );
    next = perFile;
  }
  // M26.1 follow-up — a full pass races the edit chokepoint: the batch
  // read each file from disk at some unknown time ≥ startedAt, so an
  // in-memory patch that landed since then may be NEWER than what the
  // batch saw — merging `next` verbatim would clobber the edit out of
  // the graph (on disk but invisible until the next external event).
  // Prefer the chokepoint-patched IR for those files; when the batch
  // DID see the post-edit bytes the two are equivalent.
  for (const f of Object.keys(next)) {
    const stamp = selfEditStamps.get(path.basename(f));
    if (stamp !== undefined && stamp >= startedAt && projectParse[f]) {
      next[f] = projectParse[f];
    }
  }
  // M4a: run the cross-file linker before broadcasting so the renderer
  // gets cross-file `reference` edges in the same project-update payload.
  projectParse = await runCrossFileLink(next);
  // M8.2.4 / M8.3.1: discovery + extraction both run over the relative-
  // keyed view so their outputs (entryPoints[].file, threads[].seed.file
  // and threads[].filesReached[]) ship relative paths, matching the
  // envelope's wire format.
  const relFiles = relativeProjectFiles();
  broadcastGraphRefresh("started");
  try {
    latestEntryPoints = await runDiscoverEntryPoints(relFiles);
    latestThreads = await runExtractAllThreads(relFiles, latestEntryPoints);
    latestSystem = await runBuildSystemTier(relFiles, latestEntryPoints, latestThreads);
    latestMissingDeps = await runCheckProjectDeps(relFiles);
    broadcastProjectUpdate();
    broadcastProjectWarnings();
  } finally {
    broadcastGraphRefresh("done");
  }
}

// ── M26.1 — incremental derived refresh ──────────────────────────────────────
// The cheap half of parseAllFiles: cross-file link + discovery + thread
// extraction + system tier over the CURRENT in-memory projectParse (the
// edit chokepoint has already re-parsed the one changed file). Without
// this, an internal edit's thread/system data waited on the watcher's
// FULL pipeline — the "generated but no new node rendered" report.
// link() is idempotent (cross_file_link.py M26.1) so the already-linked
// map can be fed back through.
//
// Trailing 250ms debounce: a multi-tool chat turn coalesces into one
// refresh per quiet period instead of one pipeline per edit. A refresh
// already in flight queues exactly one follow-up.
let derivedTimer: ReturnType<typeof setTimeout> | undefined;
let derivedRunning = false;
let derivedQueued = false;

async function refreshDerived(): Promise<void> {
  if (!isDirectory) return;
  if (derivedRunning) { derivedQueued = true; return; }
  derivedRunning = true;
  broadcastGraphRefresh("started");
  try {
    projectParse = await runCrossFileLink(projectParse);
    const relFiles = relativeProjectFiles();
    latestEntryPoints = await runDiscoverEntryPoints(relFiles);
    latestThreads = await runExtractAllThreads(relFiles, latestEntryPoints);
    latestSystem = await runBuildSystemTier(relFiles, latestEntryPoints, latestThreads);
    latestMissingDeps = await runCheckProjectDeps(relFiles);
    broadcastProjectUpdate();
    broadcastProjectWarnings();
  } finally {
    broadcastGraphRefresh("done");
    derivedRunning = false;
    if (derivedQueued) {
      derivedQueued = false;
      scheduleDerivedRefresh();
    }
  }
}

function scheduleDerivedRefresh(): void {
  if (!isDirectory) return;
  if (derivedTimer) clearTimeout(derivedTimer);
  derivedTimer = setTimeout(() => {
    refreshDerived().catch((e: any) =>
      console.warn(`  [Derived] refresh failed: ${e?.message ?? e}`));
  }, 250);
}

// M26.1 — the fs watcher can't tell our own writes from external ones.
// The edit chokepoint records its writes here; the watcher skips files
// we touched within the last 2s (the incremental refresh covers them),
// keeping the full parseAllFiles pass as the EXTERNAL-edit safety net
// only. Keyed by basename because fs.watch filenames are relative.
const selfEditStamps = new Map<string, number>();
function noteSelfEdit(filePath: string): void {
  selfEditStamps.set(path.basename(filePath), Date.now());
}
function isRecentSelfEdit(filename: string): boolean {
  const t = selfEditStamps.get(path.basename(filename));
  return t !== undefined && Date.now() - t < 2000;
}

// M8.1 — wrap projectParse into the v2.1 envelope (PLAN-v2.md §1.1, PLAN-v5 §1.1).
// M8.2.4 fills entryPoints; M8.3.1 fills threads. M8.3.3: file map +
// downstream entryPoints[].file + threads[].seed.file all use paths
// relative to inputPath — relativize at this single boundary.
function buildProjectEnvelope(): {
  version: "2.1";
  files: typeof projectParse;
  symbolIndex: any[];
  entryPoints: any[];
  threads: any[];
  system: { subsystems: any[]; edges: any[] };
  systemPlan?: import("./src/shared/protocol").SystemPlan;
  buildPlan?: BuildPlan;
} {
  const files = relativeProjectFiles();
  const symbolIndex: any[] = [];
  for (const ir of Object.values(files)) {
    if (ir.symbolIndex) symbolIndex.push(...ir.symbolIndex);
  }
  // PLAN-v7 Stage 3 — the ratified plan rides as an OPTIONAL sibling: the
  // field is present only when a plan exists, so plan-less envelopes are
  // byte-identical to pre-Stage-3 ones.
  const plan = getSystemPlan();
  const roadmap = getBuildPlan();
  return {
    version: "2.1",
    files,
    symbolIndex,
    entryPoints: latestEntryPoints,
    threads: latestThreads,
    system: latestSystem,
    ...(plan ? { systemPlan: plan } : {}),
    ...(roadmap ? { buildPlan: roadmap } : {}),
  };
}

// M8.3.3 — wire-format file paths are relative to inputPath. The
// internal projectParse keeps absolute paths because every fs.readFile
// in this server expects absolute, but the envelope, MCP tools, and
// all incoming WS messages talk in paths relative to the project root.
// Single source of truth at the boundary.
function relativize(absolute: string): string {
  if (!isDirectory) return absolute;
  return path.relative(inputPath, absolute);
}
function resolveProjectPath(maybeRelative: string): string {
  if (!isDirectory) return maybeRelative;
  if (path.isAbsolute(maybeRelative)) return maybeRelative;
  return path.resolve(inputPath, maybeRelative);
}
function relativeProjectFiles(): typeof projectParse {
  if (!isDirectory) return projectParse;
  const out: typeof projectParse = {};
  for (const [k, v] of Object.entries(projectParse)) {
    // U2 / M8.3.3 follow-on: also relativise edge.targetFile values
    // inside each IR. cross_file_link.py emits targetFile from the
    // (absolute-keyed) input map; if we hand the extractor / discovery
    // scripts a relative-keyed top-level map but leave targetFile
    // absolute, downstream `e.targetFile in files` checks miss every
    // cross-file edge — manifesting as cross-file calls being marked
    // as external terminals in the live thread payload.
    const relIr = {
      ...v,
      edges: v.edges.map((e: any) => {
        if (!e.targetFile) return e;
        return { ...e, targetFile: relativize(e.targetFile) };
      }),
    };
    out[relativize(k)] = relIr;
  }
  return out;
}

function broadcastProjectUpdate(ws?: WebSocket) {
  const msg = JSON.stringify({ type: "project-update", payload: buildProjectEnvelope() });
  if (ws) {
    ws.send(msg);
  } else {
    for (const c of clients) c.send(msg);
  }
  // M7 wave 1 — fan out to MCP subscribers via vibegraph://project/ir
  // resource-updated notifications.
  notifyProjectUpdated();
}

// M26.4 — bounded refresh feedback: the webview shows a subtle
// "re-linking…" pulse between started and done (state-driven; never an
// infinite spinner). Wraps both the incremental derived refresh and the
// watcher's full parseAllFiles pass.
function broadcastGraphRefresh(state: "started" | "done"): void {
  const msg = JSON.stringify({ type: "graph-refresh", payload: { state } });
  for (const c of clients) c.send(msg);
}

// NEXT-ACTIONS §2 — soft project warnings (currently: missing third-party
// deps). A separate message from project-update so the envelope shape is
// untouched; sent after every derived pass and to each new client.
function broadcastProjectWarnings(ws?: WebSocket): void {
  const msg = JSON.stringify({
    type: "project-warnings",
    payload: { missingDeps: latestMissingDeps },
  });
  if (ws) {
    ws.send(msg);
  } else {
    for (const c of clients) c.send(msg);
  }
}

// ── Node lookup ───────────────────────────────────────────────────────────────

function findNode(nodeId: string, filePath?: string): any | null {
  if (isDirectory) {
    if (filePath) {
      // M8.3.3: webview / MCP clients pass relative paths; resolve to
      // the absolute key projectParse uses internally. resolveProjectPath
      // is a no-op on already-absolute input so legacy callers still work.
      const abs = resolveProjectPath(filePath);
      return projectParse[abs]?.nodes.find((n: any) => n.id === nodeId) || null;
    }
    // search all files
    for (const data of Object.values(projectParse)) {
      const n = data.nodes.find((n: any) => n.id === nodeId);
      if (n) return n;
    }
    return null;
  }
  if (!lastParse) return null;
  return lastParse.nodes.find((n: any) => n.id === nodeId) || null;
}

function findNodeFile(nodeId: string): string | null {
  if (!isDirectory) return resolvedPyFile;
  for (const [filePath, data] of Object.entries(projectParse)) {
    if (data.nodes.find((n: any) => n.id === nodeId)) return filePath;
  }
  return null;
}

function getSourceSnippet(lineno: number, endLineno: number, filePath?: string): string {
  // U1.1 — in directory mode, fall through to `resolvedPyFile` blew up
  // because it's the project root *directory*, not a .py file (boot at
  // server.ts:88). Caller must pass a real file path in directory mode;
  // path may be relative (the wire format the webview / MCP see after
  // M8.3.3) — resolve to absolute before the fs read.
  if (isDirectory && !filePath) {
    throw new Error("getSourceSnippet: filePath required in directory mode");
  }
  const src = filePath ? resolveProjectPath(filePath) : resolvedPyFile;
  const content = fs.readFileSync(src, "utf-8");
  const lines = content.split("\n");
  return lines.slice(lineno - 1, endLineno).join("\n");
}

function fileLineCount(filePath: string): number {
  return fs.readFileSync(filePath, "utf-8").split("\n").length;
}

// ── Rewrite helpers ───────────────────────────────────────────────────────────

// cst_rewrite.py emits a structured `errorKind` on every CST op (see
// scripts/cst_rewrite.py:_VALID_ERROR_KINDS / PLAN-v3 §5.3). Surface it to
// callers so the editor panel can branch on it in its inline error row.
function spawnRewrite(args: string[], stdin?: string):
  Promise<{ success: boolean; error?: string; errorKind?: string }> {
  return new Promise((resolve) => {
    const child = spawn("python3", [REWRITE_SCRIPT, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: pythonEnv(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    if (stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
    child.on("close", () => {
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve({ success: false, error: stderr || "Rewrite script error" });
      }
    });
    child.on("error", (err: any) => resolve({ success: false, error: err.message }));
  });
}

// Rewrite + validate: apply the rewrite, re-parse, rollback on parse failure.
async function rewriteAndValidate(
  args: string[],
  stdin?: string,
  targetFile?: string  // multi-file: which file is being rewritten
): Promise<{ success: boolean; message?: string; errorKind?: string; delta?: IrDelta }> {
  const file = targetFile ?? (isDirectory ? null : resolvedPyFile);
  if (!file) return { success: false, message: "No target file" };

  const backup = fs.readFileSync(file, "utf-8");
  // B3 — snapshot the pre-edit IR before it is overwritten, so the edit can
  // report the structural delta (self-verification).
  const beforeIR = isDirectory ? projectParse[file] : lastParse;
  const result = await spawnRewrite(args, stdin);
  if (!result.success) return { success: false, message: result.error, errorKind: result.errorKind };

  try {
    // modulePath MUST ride the solo re-parse: link() indexes a file's
    // symbols under its modulePath and skips files without one, so a
    // patch that drops it makes every cross-file edge INTO this file
    // unresolvable on the next re-link — public_api entries (and their
    // threads) silently vanish. Found via the M26.1 freshness test.
    const parsed = await parseOneFile(file, isDirectory ? fileToModulePath(file) : undefined);
    noteSelfEdit(file);
    let afterIR = parsed;
    if (isDirectory) {
      projectParse[file] = parsed;
      // M-FS5 (full-scope review P2) — re-link BEFORE diffing. The solo
      // parse carries no cross-file reference edges, so diffing it
      // against the pre-edit LINKED IR reported every edge out of the
      // edited file as "removed" and its resolved calls as external —
      // a transient lie the in-app agent spent a chat turn
      // investigating. link() is idempotent and cheap next to the full
      // derived pipeline, which stays debounced below.
      try {
        projectParse = await runCrossFileLink(projectParse);
        afterIR = projectParse[file] ?? parsed;
      } catch (e: any) {
        console.warn(`  [Edit] post-edit re-link failed (delta may over-report): ${e?.message ?? e}`);
      }
      // Immediate broadcast: fresh linked file IR so the diagram updates
      // per edit. Threads/entryPoints/system in this envelope are still
      // pre-edit; the scheduled incremental refresh (M26.1) follows
      // with the fresh derived data, coalescing multi-edit bursts.
      broadcastProjectUpdate();
      scheduleDerivedRefresh();
    } else {
      lastParse = parsed;
      const msg = JSON.stringify({ type: "ast-update", payload: { filePath: file, ...parsed } });
      for (const c of clients) c.send(msg);
    }
    const delta = beforeIR ? diffIR(beforeIR, afterIR) : undefined;
    return { success: true, delta };
  } catch (err: any) {
    fs.writeFileSync(file, backup, "utf-8");
    return { success: false, message: `Reverted: ${err.message}` };
  }
}

// ── Compose-insert handler (Stage 4) ─────────────────────────────────────────

// M7 wave 1 — extracted body so both the WS handler and the MCP
// `vibegraph_compose_insert` tool can drive the same pipeline.
async function composeInsertCore(
  mode: "replace" | "insert_before" | "insert_after" | "append_end",
  anchorNodeId: string | null,
  source: string,
  filePath: string | undefined,
): Promise<{ success: boolean; message?: string }> {
  // Same relative-path contract as executeToolCall above.
  const targetFile = filePath ? resolveProjectPath(filePath) : (isDirectory ? null : resolvedPyFile);
  if (!targetFile) return { success: false, message: "No target file" };

  if (mode === "append_end") {
    return rewriteAndValidate([targetFile, "append_end"], source, targetFile);
  }
  if (!anchorNodeId) {
    return rewriteAndValidate([targetFile, "append_end"], source, targetFile);
  }
  const node = findNode(anchorNodeId, targetFile);
  if (!node) return { success: false, message: `Node not found: ${anchorNodeId}` };

  const opArg = mode === "replace" ? "replace_node"
    : mode === "insert_before" ? "insert_before"
    : "insert_after";
  return rewriteAndValidate([targetFile, opArg, anchorNodeId], source, targetFile);
}

async function handleComposeInsert(
  mode: "replace" | "insert_before" | "insert_after" | "append_end",
  anchorNodeId: string | null,
  source: string,
  filePath: string | undefined,
  ws: WebSocket
): Promise<void> {
  const result = await composeInsertCore(mode, anchorNodeId, source, filePath);
  ws.send(JSON.stringify({ type: "compose-done", payload: result }));
}

// ── PLAN-v7 Stage 1: compose-propose (preview-before-write) ──────────────────
//
// The insert path is now propose-first. This dry-runs the SAME op the wet
// compose-insert would run (via _dryRunRewrite → cst_rewrite --dry-run, which
// runs the full format-and-diff pipeline and writes nothing — see the G1
// done-gate proving dry ≡ wet byte-for-byte), then temp-parses the result to
// derive the NEW structural nodes the edit would create. Those become ghost
// descriptors the webview renders as a proposal; NOTHING here mutates
// projectParse / lastParse / the envelope. The honest IR stays honest until
// the human accepts, at which point the webview fires the wet compose-insert.
//
// Reconciliation caveat (A1 pre/post-link lesson): the temp parse is ISOLATED
// (pre-link, no cross-file resolution). We surface only structural id / kind /
// label — never resolution state, which the post-link re-parse owns. Ghost ids
// are proposals; the real re-parse is the truth they reconcile against.
type ComposeProposal = {
  ok: boolean;
  ghostNodes: Array<{ id: string; type: string; label: string }>;
  mode: "replace" | "insert_before" | "insert_after" | "append_end";
  anchorNodeId: string | null;
  filePath: string | undefined;
  source: string;
  // PLAN-v7 Stage 1b — the source was DRAFTED by `claude -p`, not user-typed
  // or canned. Honesty flag: the ghost badge reads "CLAUDE DRAFT" so the human
  // knows they are ratifying a model proposal. Loop is otherwise identical.
  drafted?: boolean;
  error?: string;
};

async function composeProposeCore(
  mode: "replace" | "insert_before" | "insert_after" | "append_end",
  anchorNodeId: string | null,
  source: string,
  filePath: string | undefined,
): Promise<ComposeProposal> {
  const base: ComposeProposal = { ok: false, ghostNodes: [], mode, anchorNodeId, filePath, source };
  const targetFile = filePath ? resolveProjectPath(filePath) : (isDirectory ? null : resolvedPyFile);
  if (!targetFile) return { ...base, error: "No target file" };

  // Mirror composeInsertCore's op selection exactly — same op, so the dry-run
  // matches what accept will write.
  let argv: string[];
  if (mode === "append_end" || !anchorNodeId) {
    argv = [targetFile, "append_end"];
  } else {
    const node = findNode(anchorNodeId, targetFile);
    if (!node) return { ...base, error: `Node not found: ${anchorNodeId}` };
    const opArg = mode === "replace" ? "replace_node"
      : mode === "insert_before" ? "insert_before"
      : "insert_after";
    argv = [targetFile, opArg, anchorNodeId];
  }

  const dry = await _dryRunRewrite(argv, source);
  if (dry.error || !dry.source) return { ...base, error: dry.error ?? "dry-run produced no source" };

  // Temp-parse the (unwritten) result to find the new structural nodes. Parse
  // under the target's modulePath so structural ids match what the real
  // re-parse will produce (and thus reconcile cleanly on accept).
  const currentNodes: Array<{ id: string }> =
    (isDirectory ? projectParse[targetFile]?.nodes : lastParse?.nodes) ?? [];
  const currentIds = new Set(currentNodes.map((n) => n.id));
  const tmp = path.join(os.tmpdir(), `vg-propose-${process.pid}-${Date.now()}.py`);
  try {
    fs.writeFileSync(tmp, dry.source, "utf-8");
    const parsed = await parseOneFile(tmp, isDirectory ? fileToModulePath(targetFile) : undefined);
    const newNodes = (parsed.nodes as any[]).filter((n) => !currentIds.has(n.id));
    const newIds = new Set(newNodes.map((n) => n.id));
    // roots of the inserted subtree (a function + its body → one ghost, the fn)
    const roots = newNodes.filter((n) => !newIds.has(n.parentId));
    const ghostNodes = roots.map((n) => ({
      id: n.id as string,
      type: n.type as string,
      label: (n.name ?? n.funcName ?? n.target ?? n.type) as string,
    }));
    return { ...base, ok: true, ghostNodes };
  } catch (err: any) {
    return { ...base, error: `propose parse failed: ${err.message}` };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

async function handleComposePropose(
  mode: "replace" | "insert_before" | "insert_after" | "append_end",
  anchorNodeId: string | null,
  source: string,
  filePath: string | undefined,
  ws: WebSocket
): Promise<void> {
  const result = await composeProposeCore(mode, anchorNodeId, source, filePath);
  ws.send(JSON.stringify({ type: "compose-proposal", payload: result }));
}

// ── PLAN-v7 Stage 1b: compose-propose-intent (LIVE `claude -p` draft) ────────
//
// The 1b entry: a plain-language intent instead of a canned insert spec. Draft
// the function via `claude -p`, then hand the draft to the EXACT 1a path
// (composeProposeCore → dry-run → ghost → accept re-runs wet). The only 1b
// addition is `drafted: true` on the proposal so the ghost badge is honest that
// this is Claude's proposal, not a fact. If the draft fails (CLI unavailable /
// bad reply), reply with an honest !ok proposal carrying the diagnostic — no
// ghost, no write.
async function handleComposeProposeIntent(
  intent: string,
  mode: "replace" | "insert_before" | "insert_after" | "append_end",
  anchorNodeId: string | null,
  filePath: string | undefined,
  ws: WebSocket
): Promise<void> {
  const send = (p: ComposeProposal) =>
    ws.send(JSON.stringify({ type: "compose-proposal", payload: { ...p, drafted: true } }));
  const base: ComposeProposal = { ok: false, ghostNodes: [], mode, anchorNodeId, filePath, source: "", drafted: true };

  if (!claudeCliAvailable) {
    send({ ...base, error: "The claude CLI is unavailable — can't draft an insertion." });
    return;
  }
  // Label the anchor for the prompt so the draft fits its neighbourhood.
  let anchorLabel: string | null = null;
  if (anchorNodeId) {
    const tf = filePath ? resolveProjectPath(filePath) : (isDirectory ? null : resolvedPyFile);
    const node = tf ? findNode(anchorNodeId, tf) : null;
    if (node) anchorLabel = `${(node as any).type} ${(node as any).name ?? (node as any).funcName ?? anchorNodeId}`;
  }
  const draft = await draftInsertion(intent, anchorLabel, analyzedRoot());
  if (!draft.source) {
    send({ ...base, error: draft.error ?? "The draft did not produce a usable function." });
    return;
  }
  // Same op as 1a from here: dry-run the drafted source, derive ghost nodes.
  const result = await composeProposeCore(mode, anchorNodeId, draft.source, filePath);
  send(result);
}

// ── PLAN-v7 Stage 3: system plan (proposed architecture) ─────────────────────
//
// The system-tier analogue of Stage 1's loop, with one inversion: ACCEPT
// cannot write code (there is none yet), so accept RATIFIES — it persists the
// plan artifact (.vibegraph/system-plan.json under the analyzed root) and the
// envelope carries it as a SIBLING `systemPlan` field. Planned subsystems
// ghost-render in the system view until real built code re-parses into
// matching subsystems (Stage 4+); the honest `system` tier is NEVER mutated.

function getSystemPlan(): import("./src/shared/protocol").SystemPlan | null {
  // mtime-keyed reload: a plan written after boot (or by another process,
  // or deleted) must not be frozen out by a boot-time cache. -1 = never
  // seen; 0 = file absent.
  let mtime = 0;
  try {
    mtime = fs.statSync(path.join(analyzedRoot(), ".vibegraph", "system-plan.json")).mtimeMs;
  } catch { /* absent */ }
  if (mtime !== systemPlanMtime) {
    systemPlanMtime = mtime;
    systemPlan = mtime === 0 ? null : loadSystemPlan(analyzedRoot());
    if (systemPlan) {
      console.log(`  [SystemPlan] loaded ratified plan (${systemPlan.subsystems.length} planned subsystems)`);
    }
  }
  return systemPlan;
}

// Validate an untrusted proposal at the boundary and echo it back as a
// pending (webview-held) proposal. Nothing is persisted; nothing touches the
// honest tier. Reject = the webview drops its overlay — no server round-trip.
function handleSystemPropose(plan: unknown, ws: WebSocket): void {
  const invalid = validateSystemPlan(plan);
  if (invalid) {
    ws.send(JSON.stringify({ type: "system-proposal", payload: { ok: false, error: invalid } }));
    return;
  }
  ws.send(JSON.stringify({ type: "system-proposal", payload: { ok: true, plan } }));
}

// PLAN-v7 Stage 3b — LIVE architecture drafting: describe → `claude -p`
// drafts a SystemPlan (grounding-enforced: fabricated quotes are demoted to
// INFERRED) → the SAME system-proposal reply as the canned 3a path. The gate
// and everything downstream are reused unchanged.
async function handleSystemProposeIntent(description: string, ws: WebSocket): Promise<void> {
  const fail = (error: string) =>
    ws.send(JSON.stringify({ type: "system-proposal", payload: { ok: false, error } }));
  if (!claudeCliAvailable) {
    fail("The claude CLI is unavailable — can't draft an architecture.");
    return;
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    fail("A project description is required.");
    return;
  }
  const opts = genSpawnOptions();
  if (!opts) {
    fail("analyzed project root unreachable");
    return;
  }
  const draft = await draftSystemPlan(description.trim(), opts.cwd);
  if (!draft.plan) {
    fail(draft.error ?? "The draft did not produce a usable architecture.");
    return;
  }
  ws.send(JSON.stringify({ type: "system-proposal", payload: { ok: true, plan: draft.plan } }));
}

// ── PLAN-v7 Stage 4: changeset (build increment) propose / accept ────────────
//
// One thread-capability's worth of code as a single reviewable unit — 4a
// shipped CREATE-only; 6c adds MIXED create+edit (op per file: create_file /
// append_end / replace_node, every one through the SAME chokepoint with its
// format-and-diff confinement). Propose computes the verification FLOOR
// without touching the project:
//   1. shape + root-containment + per-op existence guards (create → must
//      NOT exist; edits → MUST exist);
//   2. per file: the op run --dry-run (the emitted source IS the full file
//      accept will produce — dry ≡ wet, proven at the op level) + a
//      temp-parse for the IR summary;
//   3. behavioural check in a SANDBOX COPY: parse+link the sandbox, run
//      scan_effects seeded on __vg_check__ — run the check ONLY when the
//      path is confidently pure or the human explicitly consented (6b).
// Accept re-runs every op WET through the chokepoint, re-parses, and lets
// the derived refresh reconcile — ghost subsystems solidify only because
// parsed reality now matches the plan.

// Map a changeset file to its chokepoint CLI args (op whitelist enforced at
// validateChangeset; this is the single argv seam shared by dry + wet).
function changesetOpArgs(f: ChangesetFile, abs: string): string[] {
  const op = f.op ?? "create_file";
  if (op === "replace_node") return [abs, "replace_node", f.nodeId!];
  return [abs, op]; // create_file | append_end
}

// 6c — the builder's REPLACE targets must be grounded in real structure:
// each existing file's replaceable top-level node ids from the live parse.
function changesetExistingSymbols(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!isDirectory) return out;
  for (const [abs, ir] of Object.entries(projectParse)) {
    const syms = ((ir as any)?.nodes ?? [])
      .filter((n: any) => !n.parentId && (n.type === "function_def" || n.type === "class_def"))
      .map((n: any) => n.id);
    if (syms.length) out[relativize(abs)] = syms;
  }
  return out;
}

// Resolve + root-contain a changeset file path. Returns the absolute path
// or null when it escapes the analyzed root (the server-side half of the
// create_file guard set — the script can't know the root).
function resolveChangesetPath(rel: string): string | null {
  const root = analyzedRoot();
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

async function changesetProposeCore(raw: unknown, effectConsentToken?: string, trustUnverified?: string): Promise<{ ok: boolean; changeset?: Changeset; floor?: ChangesetFloor; error?: string }> {
  const invalid = validateChangeset(raw);
  if (invalid) return { ok: false, error: invalid };
  const changeset = raw as Changeset;

  const floor: ChangesetFloor = {
    files: [],
    check: { ok: false, ran: false, pure: null, output: "" },
    ok: false,
  };

  // ── per-file: containment + per-op existence guard + dry-run the op ──
  let filesOk = true;
  for (const f of changeset.files) {
    const abs = resolveChangesetPath(f.path);
    if (!abs) {
      floor.files.push({ path: f.path, ok: false, error: "path escapes the project root" });
      filesOk = false;
      continue;
    }
    const op = f.op ?? "create_file";
    if (op === "create_file" && fs.existsSync(abs)) {
      floor.files.push({ path: f.path, ok: false, error: "file already exists (create_file targets must be new)" });
      filesOk = false;
      continue;
    }
    if (op !== "create_file" && !fs.existsSync(abs)) {
      floor.files.push({ path: f.path, ok: false, error: `file does not exist (${op} targets an existing file)` });
      filesOk = false;
      continue;
    }
    const dry = await _dryRunRewrite(changesetOpArgs(f, abs), f.content);
    if (dry.error || !dry.source) {
      floor.files.push({ path: f.path, ok: false, error: dry.error ?? "dry-run produced no source" });
      filesOk = false;
      continue;
    }
    // IR summary from a temp-parse of the formatted content.
    let newNodes: number | undefined;
    try {
      const tmp = path.join(os.tmpdir(), `vg-chg-${process.pid}-${Date.now()}-${path.basename(f.path)}`);
      fs.writeFileSync(tmp, dry.source, "utf-8");
      try {
        const parsed = await parseOneFile(tmp);
        newNodes = Array.isArray(parsed?.nodes) ? parsed.nodes.length : undefined;
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      }
    } catch { /* summary only — dry-run already proved it parses */ }
    floor.files.push({ path: f.path, ok: true, formatted: dry.source, newNodes });
  }

  if (!filesOk) {
    floor.check.error = "not run — file floor failed";
    return { ok: true, changeset, floor };
  }

  // ── behavioural check in a sandbox copy ──
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "vg-changeset-"));
  try {
    // Copy the analyzed project (greenfield: little or nothing) then lay
    // down the FORMATTED changeset files + the check module.
    fs.cpSync(analyzedRoot(), sandbox, {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}.git`),
    });
    for (const [i, f] of changeset.files.entries()) {
      const dst = path.join(sandbox, f.path);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, floor.files[i].formatted!, "utf-8");
    }
    fs.writeFileSync(path.join(sandbox, CHECK_MODULE), changeset.check.module, "utf-8");

    // Parse + link the sandbox (module paths relative to the SANDBOX root).
    const sandboxFiles = findPyFiles(sandbox);
    const sandboxMap: Record<string, any> = {};
    for (const sf of sandboxFiles) {
      const relModule = path.relative(sandbox, sf).replace(/\.py$/, "").split(path.sep).join(".");
      try {
        sandboxMap[sf] = await parseOneFile(sf, relModule);
      } catch (e: any) {
        floor.check.error = `sandbox parse failed for ${path.relative(sandbox, sf)}: ${e.message}`;
        return { ok: true, changeset, floor };
      }
    }
    const linked = await runCrossFileLink(sandboxMap);
    // Relativize edge.targetFile along with the keys — an absolute targetFile
    // in a relative-keyed map makes scan_effects treat every cross-file call
    // as outside the project, and the check path's effects escape the floor.
    const relIR: Record<string, unknown> = {};
    for (const [fp, ir] of Object.entries(linked) as [string, any][]) {
      relIR[path.relative(sandbox, fp)] = {
        ...ir,
        edges: (ir.edges ?? []).map((e: any) =>
          e.targetFile && path.isAbsolute(e.targetFile)
            ? { ...e, targetFile: path.relative(sandbox, e.targetFile) }
            : e),
      };
    }

    // The check must define __vg_check__() — verified STRUCTURALLY.
    const checkIR: any = relIR[CHECK_MODULE];
    if (!checkIR?.nodes?.some((n: any) => n.id === CHECK_FN_ID)) {
      floor.check.error = "check module does not define __vg_check__()";
      return { ok: true, changeset, floor };
    }

    // Effect floor: scan the check path; run ONLY when confidently pure.
    const scan = await new Promise<{ pure: boolean; offenses: any[]; reason: string }>((resolve) => {
      const child = spawn("python3", [SCAN_EFFECTS_SCRIPT, "--seed-file", CHECK_MODULE, "--seed-id", CHECK_FN_ID, "--list-effects"],
        { stdio: ["pipe", "pipe", "pipe"], env: pythonEnv() });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (b) => { stdout += b.toString(); });
      child.stderr.on("data", (b) => { stderr += b.toString(); });
      child.on("close", (code) => {
        if (code !== 0) {
          resolve({ pure: false, offenses: [], reason: `effect scan failed (exit ${code}): ${stderr.split("\n")[0] ?? ""}` });
          return;
        }
        try {
          const v = JSON.parse(stdout);
          resolve({ pure: !!v.pure, offenses: Array.isArray(v.offenses) ? v.offenses : [], reason: v.reason ?? "" });
        } catch {
          resolve({ pure: false, offenses: [], reason: "could not parse effect-scan output" });
        }
      });
      child.stdin.write(JSON.stringify({ files: relIR }));
      child.stdin.end();
    });

    floor.check.pure = scan.pure;
    floor.check.offenses = scan.offenses;
    if (!scan.pure) {
      // PLAN-v7 6b — an effectful (or unprovable) check NEVER runs silently,
      // but the human can consent: the token is scoped to (this changeset's
      // content + this exact offense set) via changesetConsentScope and
      // re-validated here against the FRESH scan, so an edited changeset or
      // a drifted offense set invalidates it (the SM3 consent-integrity
      // model, applied to the changeset floor).
      const scope = changesetConsentScope(changeset);
      // Sitting-2 — a trust echo grants the session category-trust ("stop
      // asking about unverifiable calls"); gating then applies only to what
      // remains. floor.check.offenses stays the FULL scan output (honesty).
      if (trustUnverified) grantUnverifiedTrust(scope, gatedOffenses(scan.offenses as EffectOffense[]), trustUnverified);
      const gated = gatedOffenses(scan.offenses as EffectOffense[]);
      if (gated.length === 0 || verifyEffectConsent(scope, gated, effectConsentToken)) {
        floor.check.consented = true; // fall through: run it, labelled honestly
      } else {
        // Honest reason: prefer the scan's own words; else summarise the
        // offenses (seed-mode --list-effects may return offenses w/o reason).
        const why = scan.reason?.trim()
          || scan.offenses.map((o: any) => o.effectKind ? `${o.effectKind}: ${o.target}` : `${o.kind}: ${o.target}`).join("; ")
          || "effect scan refused";
        floor.check.consentToken = mintEffectConsent(scope, gated);
        if (gated.some(isTrustableOffense)) {
          floor.check.trustToken = mintUnverifiedTrust(scope, gated);
        }
        floor.check.error = effectConsentToken
          ? `check not run — consent token stale (the changeset or its effect set changed; re-consent) (${why})`
          : `check not run — path not confidently pure (${why})`;
        return { ok: true, changeset, floor };
      }
    }

    // Run it. Sandbox cwd + PYTHONPATH so imports resolve to the sandbox.
    const run = await new Promise<{ code: number | null; output: string }>((resolve) => {
      const env = pythonEnv();
      env.PYTHONPATH = `${sandbox}:${env.PYTHONPATH ?? ""}`;
      const child = spawn("python3", ["-c", "from __vg_check__ import __vg_check__; __vg_check__()"],
        { cwd: sandbox, env, timeout: 15000 });
      let out = "";
      child.stdout.on("data", (b) => { out += b.toString(); });
      child.stderr.on("data", (b) => { out += b.toString(); });
      child.on("close", (code) => resolve({ code, output: out.slice(-2000) }));
      child.on("error", (e) => resolve({ code: -1, output: e.message }));
    });
    floor.check.ran = true;
    floor.check.output = run.output;
    floor.check.ok = run.code === 0;
    if (run.code !== 0) floor.check.error = `check failed (exit ${run.code})`;
  } finally {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  floor.ok = floor.files.every((f) => f.ok) && floor.check.ok;
  return { ok: true, changeset, floor };
}

async function handleChangesetPropose(raw: unknown, ws: WebSocket, effectConsentToken?: string, claimedRunItemId?: string, trustUnverified?: string): Promise<void> {
  const result = await changesetProposeCore(
    raw,
    typeof effectConsentToken === "string" ? effectConsentToken : undefined,
    typeof trustUnverified === "string" ? trustUnverified : undefined,
  );
  // PLAN-v7 6b — a consented RE-propose during an orchestrator run must keep
  // its gate↔item association. The echo is correlation only (accept advances
  // off the server's own runItemId state), and only the item actually at the
  // gate can be claimed — a stray/forged id is dropped.
  const echo = claimedRunItemId && claimedRunItemId === runItemId ? { runItemId } : {};
  ws.send(JSON.stringify({ type: "changeset-proposal", payload: { ...result, ...echo } }));
}

// PLAN-v7 Stage 4b — LIVE building: one capability described in plain
// language → the builder agent drafts the increment (bounded to the RATIFIED
// plan; declines rather than invents) → the ENTIRE 4a floor re-runs on the
// draft → the same gate. A ratified plan is the input contract: without one
// there is nothing human-approved to build toward.
async function handleChangesetProposeIntent(intent: string, ws: WebSocket): Promise<void> {
  const fail = (error: string) =>
    ws.send(JSON.stringify({ type: "changeset-proposal", payload: { ok: false, error } }));
  if (!claudeCliAvailable) {
    fail("The claude CLI is unavailable — can't draft a build increment.");
    return;
  }
  if (typeof intent !== "string" || intent.trim().length === 0) {
    fail("A capability description is required.");
    return;
  }
  const plan = getSystemPlan();
  if (!plan) {
    fail("No ratified architecture plan — describe + ratify one first (the plan is what the builder builds toward).");
    return;
  }
  const opts = genSpawnOptions();
  if (!opts) {
    fail("analyzed project root unreachable");
    return;
  }
  const existing = isDirectory
    ? findPyFiles(inputPath).map((f) => relativize(f))
    : [];
  const draft = await draftChangeset(intent.trim(), plan, existing, opts.cwd, changesetExistingSymbols(), builderSession());
  if (!draft.changeset) {
    fail(draft.error ?? "The builder did not produce a usable increment.");
    return;
  }
  // Same floor as the canned path — no shortcut for drafted increments.
  const result = await changesetProposeCore(draft.changeset);
  ws.send(JSON.stringify({ type: "changeset-proposal", payload: result }));
}

// M-GF3.5 — Modify at the gate: re-draft the CURRENT increment with the
// human's instruction folded into the builder's intent, then the SAME floor
// and the SAME gate (a red floor still renders honestly; nothing skips the
// chokepoint). The base intent is the run item's capability when the gate
// belongs to a run (runItemId), else the changeset's label — the gate stays
// tagged with the run item so accept still advances the run.
async function handleChangesetModify(instruction: unknown, runItemId: unknown, label: unknown, ws: WebSocket): Promise<void> {
  const fail = (error: string) =>
    ws.send(JSON.stringify({ type: "changeset-proposal", payload: { ok: false, error } }));
  if (!claudeCliAvailable) { fail("The claude CLI is unavailable — can't re-draft the increment."); return; }
  if (typeof instruction !== "string" || instruction.trim().length === 0) {
    fail("A modification instruction is required.");
    return;
  }
  const plan = getSystemPlan();
  if (!plan) { fail("No ratified architecture plan."); return; }
  const opts = genSpawnOptions();
  if (!opts) { fail("analyzed project root unreachable"); return; }

  let base: string | null = null;
  let itemId: string | undefined;
  if (typeof runItemId === "string" && runItemId) {
    const item = getBuildPlan()?.items.find((i) => i.id === runItemId);
    if (!item) { fail(`no roadmap stage with id "${runItemId}"`); return; }
    base = item.capability;
    itemId = runItemId;
  } else if (typeof label === "string" && label.trim()) {
    base = label.trim();
  }
  if (!base) { fail("Nothing to modify — no run item or changeset label."); return; }

  const intent = `${base}\n\nREVISION GUIDANCE (the previous draft of this increment was declined by the human; follow this): ${instruction.trim()}`;
  const existing = isDirectory ? findPyFiles(inputPath).map((f) => relativize(f)) : [];
  const draft = await draftChangeset(intent, plan, existing, opts.cwd, changesetExistingSymbols(), builderSession());
  if (!draft.changeset) {
    fail(draft.error ?? "The builder did not produce a revised increment.");
    return;
  }
  const result = await changesetProposeCore(draft.changeset);
  ws.send(JSON.stringify({
    type: "changeset-proposal",
    payload: itemId ? { ...result, runItemId: itemId } : result,
  }));
}

// Accept — the same guards cross the boundary again ("same op twice"), then
// every file's op runs WET through the chokepoint. A mid-way failure reverts
// everything this accept touched — creations unlinked, edits restored from
// their pre-edit snapshots (all-or-nothing increment).
async function handleChangesetAccept(raw: unknown, ws: WebSocket): Promise<void> {
  const fail = (error: string) =>
    ws.send(JSON.stringify({ type: "changeset-done", payload: { ok: false, error } }));
  const invalid = validateChangeset(raw);
  if (invalid) { fail(invalid); return; }
  const changeset = raw as Changeset;

  const targets: Array<{ abs: string; file: ChangesetFile }> = [];
  for (const f of changeset.files) {
    const abs = resolveChangesetPath(f.path);
    if (!abs) { fail(`path escapes the project root: ${f.path}`); return; }
    const op = f.op ?? "create_file";
    if (op === "create_file" && fs.existsSync(abs)) { fail(`file already exists: ${f.path}`); return; }
    if (op !== "create_file" && !fs.existsSync(abs)) { fail(`file does not exist (${op}): ${f.path}`); return; }
    targets.push({ abs, file: f });
  }

  // All-or-nothing increment: creations are unlinked, edits restored from
  // their pre-edit snapshot, in reverse order.
  const undo: Array<() => void> = [];
  const revert = () => { for (const u of undo.reverse()) { try { u(); } catch { /* ignore */ } } };
  for (const t of targets) {
    const op = t.file.op ?? "create_file";
    const before = op === "create_file" ? null : fs.readFileSync(t.abs, "utf-8");
    const result = await spawnRewrite(changesetOpArgs(t.file, t.abs), t.file.content);
    if (!result.success) {
      revert();
      fail(`${op} failed for ${path.relative(analyzedRoot(), t.abs)}: ${result.error ?? "unknown"} (increment reverted)`);
      // PLAN-v7 Stage 5 — a build error during a run is a judgment point:
      // the item fails and the run pauses for triage on the roadmap.
      if (runItemId) {
        updateItem(runItemId, "failed", `build error: ${result.error ?? "unknown"}`);
        buildRunActive = false;
        runItemId = null;
        broadcastRunState("run paused: build error");
      }
      return;
    }
    undo.push(before === null
      ? () => fs.unlinkSync(t.abs)
      : () => fs.writeFileSync(t.abs, before, "utf-8"));
  }

  // Re-parse each touched file into the live map (modulePath MUST ride —
  // the M26.1 lesson), then broadcast + schedule the derived refresh: link /
  // discovery / threads / system. THAT refresh is what solidifies ghost
  // subsystems — parsed reality catching up with the ratified plan.
  try {
    for (const t of targets) {
      noteSelfEdit(t.abs);
      const parsed = await parseOneFile(t.abs, isDirectory ? fileToModulePath(t.abs) : undefined);
      if (isDirectory) projectParse[t.abs] = parsed;
      else lastParse = parsed;
    }
  } catch (err: any) {
    fail(`built but re-parse failed: ${err.message}`);
    return;
  }
  ws.send(JSON.stringify({ type: "changeset-done", payload: { ok: true } }));
  if (isDirectory) {
    broadcastProjectUpdate();
    scheduleDerivedRefresh();
  }
  // PLAN-v7 Stage 5 — accept ADVANCES the run: the increment is built, the
  // roadmap records it (persisted), and the next buildable item starts
  // drafting. The human's accept click was the "continue" signal — one
  // judgment per increment, automation only between gates.
  if (runItemId) {
    const builtId = runItemId;
    runItemId = null;
    updateItem(builtId, "built");
    if (buildRunActive) {
      broadcastRunState(`${builtId} built — advancing`);
      void advanceBuildRun();
    }
  }
}

// ── PLAN-v7 Stage 5: the ORCHESTRATOR (build plan + run driver) ──────────────
//
// The milestone-runner, encoded: an ordered, dependency-aware capability list
// (the ROADMAP — itself drafted → human-ratified → persisted) drives the
// proven Stage-4 increment loop item by item. The human gate stays at EVERY
// increment; the orchestrator automates BETWEEN gates, never through them:
// your accept at increment N's gate is the "continue" signal that starts
// drafting N+1. Reject or any failure PAUSES the run at a judgment point
// (retry with an edited capability / skip flagging dependents / stop).

function getBuildPlan(): BuildPlan | null {
  let mtime = 0;
  try {
    mtime = fs.statSync(path.join(analyzedRoot(), ".vibegraph", "build-plan.json")).mtimeMs;
  } catch { /* absent */ }
  if (mtime !== buildPlanMtime) {
    buildPlanMtime = mtime;
    buildPlan = mtime === 0 ? null : loadBuildPlan(analyzedRoot());
    if (buildPlan) {
      console.log(`  [BuildPlan] loaded roadmap (${buildPlan.items.length} items)`);
    }
  }
  return buildPlan;
}

function broadcastToAll(msg: unknown): void {
  const s = JSON.stringify(msg);
  for (const c of clients) c.send(s);
}

// Run-state signal for the roadmap panel: active (auto-advancing) vs paused,
// with an honest note about why the state changed.
function broadcastRunState(note?: string): void {
  broadcastToAll({ type: "build-run-state", payload: { active: buildRunActive, runItemId, note } });
}

function updateItem(itemId: string, status: import("./src/shared/protocol").BuildItemStatus, failReason?: string, failOutput?: string): boolean {
  const plan = getBuildPlan();
  if (!plan) return false;
  const r = setItemStatus(analyzedRoot(), plan, itemId, status, failReason, failOutput);
  if (r.error || !r.plan) {
    console.warn(`  [BuildRun] status update failed: ${r.error}`);
    return false;
  }
  buildPlan = r.plan;
  try { buildPlanMtime = fs.statSync(path.join(analyzedRoot(), ".vibegraph", "build-plan.json")).mtimeMs; } catch { /* re-read next */ }
  broadcastProjectUpdate(); // the roadmap renders from the envelope's buildPlan
  return true;
}

// Boundary + echo for a proposed roadmap (5a canned path; 5b's draft feeds
// the same reply). All items must be pending at ratification — a proposal
// carrying run state is not a proposal.
function handleBuildPlanPropose(plan: unknown, ws: WebSocket): void {
  const invalid = validateBuildPlan(plan);
  if (invalid) {
    ws.send(JSON.stringify({ type: "build-plan-proposal", payload: { ok: false, error: invalid } }));
    return;
  }
  const p = plan as BuildPlan;
  if (p.items.some((it) => it.status !== "pending")) {
    ws.send(JSON.stringify({ type: "build-plan-proposal", payload: { ok: false, error: "a proposed roadmap must have all items pending" } }));
    return;
  }
  ws.send(JSON.stringify({ type: "build-plan-proposal", payload: { ok: true, plan: p } }));
}

// 5b — draft the roadmap from the RATIFIED system plan (the input contract).
// M-GF3.5 — an optional revision (guidance + the previous pending draft)
// turns the draft into a revise: the human steers instead of rejecting.
async function handleBuildPlanProposeIntent(ws: WebSocket, guidance?: unknown, previous?: unknown): Promise<void> {
  const fail = (error: string) =>
    ws.send(JSON.stringify({ type: "build-plan-proposal", payload: { ok: false, error } }));
  if (!claudeCliAvailable) { fail("The claude CLI is unavailable — can't draft a roadmap."); return; }
  const plan = getSystemPlan();
  if (!plan) { fail("No ratified architecture plan — describe + ratify one first."); return; }
  const opts = genSpawnOptions();
  if (!opts) { fail("analyzed project root unreachable"); return; }
  let revision: RoadmapRevision | undefined;
  if (typeof guidance === "string" && guidance.trim().length > 0) {
    // The previous draft is prompt fodder only — but still boundary-checked
    // so malformed client state can't ride into the prompt.
    const prev = previous != null && validateBuildPlan(previous) === null ? (previous as BuildPlan) : null;
    revision = { guidance: guidance.trim(), previous: prev };
  }
  const draft = await draftBuildPlan(plan, opts.cwd, revision);
  if (!draft.plan) { fail(draft.error ?? "The draft did not produce a usable roadmap."); return; }
  ws.send(JSON.stringify({ type: "build-plan-proposal", payload: { ok: true, plan: draft.plan } }));
}

function handleBuildPlanAccept(plan: unknown, ws: WebSocket): void {
  const fail = (error: string) =>
    ws.send(JSON.stringify({ type: "build-plan-saved", payload: { ok: false, error } }));
  const root = analyzedRoot();
  if (!fs.existsSync(root)) { fail("analyzed project root unreachable"); return; }
  const invalid = validateBuildPlan(plan);
  if (invalid) { fail(invalid); return; }
  if ((plan as BuildPlan).items.some((it) => it.status !== "pending")) {
    fail("a roadmap must be ratified with all items pending");
    return;
  }
  const result = persistBuildPlan(root, plan);
  if (result.error || !result.plan) { fail(result.error ?? "persist failed"); return; }
  buildPlan = result.plan;
  try { buildPlanMtime = fs.statSync(result.path!).mtimeMs; } catch { /* re-read next */ }
  ws.send(JSON.stringify({ type: "build-plan-saved", payload: { ok: true, path: result.path } }));
  broadcastProjectUpdate();
}

// The drive step: draft + floor the next buildable item, then wait at the
// gate. A green floor opens the gate (proposal broadcast, tagged with the
// item); a red floor / decline FAILS the item and pauses the run — failures
// are judgment points, triaged on the roadmap, not auto-retried.
// OPUS-SHOWDOWN follow-up (2026-08-02) — persistent builder session, opt-in
// via VG_BUILD_SESSION=1. Routes every changeset draft through ONE
// long-lived stream-json claude child (the M27 stdio backend) instead of a
// fresh `claude -p` per increment: the metered comparison priced per-spawn
// context re-establishment at ~20-33k cache-write tokens per increment —
// the dominant cost of the greenfield pipeline (~3x vs a one-shot). The
// zero-MCP config keeps the drafting child's tool surface identical to the
// spawn path it replaces; prompts are identical; replies cross the same
// parse → validate boundary. A modify redraft additionally happens in a
// session that REMEMBERS the draft it is fixing. DEFAULT ON since
// 2026-08-02 (the builder stubs speak both protocols via
// stream_json_stub.mjs); VG_BUILD_SESSION=0 opts out to the classic
// spawn-per-increment transport for debugging.
// Lifecycle: lazy per run, kept across pause/resume (memory helps a
// resumed run), disposed on completion and stop; the backend's idle
// reaper + --resume recovery handle everything between.
// The GUI chat may not write files directly: every edit must go through
// the CST chokepoint so it is structurally verified and re-parsed into the
// graph. Facing a rejected edit, the chat's Claude used to finish the task
// with its own `Edit` tool instead — the change landed with none of that
// verification, and the user was never told the safe path had been
// abandoned (reviews/modify-showdown-2026-08/). Denying the write tools is
// only fair now that a refusal is recoverable: the rewriter retries
// unformatted before refusing, so formatting noise no longer produces dead
// ends (PLAN-M-DIRTY.md).
//
// Bash stays available deliberately — the chat uses it to VERIFY its edits
// (running the code, checking behaviour), which is worth more than the
// hermetic seal that removing it would buy. A raw write via Bash is
// therefore still possible, but it is now a deliberate detour rather than
// the path of least resistance.
const CHAT_DENIED_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

const buildSessionEnabled = process.env.VG_BUILD_SESSION !== "0";
let buildSession: ChatSession | null = null;

function builderSession(): ChatSession | undefined {
  if (!buildSessionEnabled) return undefined;
  if (!buildSession) {
    buildSession = new ClaudeStdioBackend().openSession({
      mcpServerUrl: `http://localhost:${port}/mcp`,
      cwd: analyzedRoot(),
      mcpConfigJson: '{"mcpServers":{}}',
    });
    console.log("[build] persistent builder session opened (VG_BUILD_SESSION=1)");
  }
  return buildSession;
}

function disposeBuildSession(): void {
  if (buildSession) {
    buildSession.dispose();
    buildSession = null;
    console.log("[build] persistent builder session disposed");
  }
}

async function advanceBuildRun(): Promise<void> {
  if (!buildRunActive) return;
  const plan = getBuildPlan();
  if (!plan?.ratifiedAt) {
    buildRunActive = false;
    broadcastRunState("no ratified roadmap");
    return;
  }
  const sysPlan = getSystemPlan();
  if (!sysPlan) {
    buildRunActive = false;
    broadcastRunState("no ratified architecture plan");
    return;
  }
  const { item, blocked } = nextBuildableItem(plan);
  if (!item) {
    buildRunActive = false;
    runItemId = null;
    disposeBuildSession(); // run over (complete or blocked) — no child outlives it
    const done = plan.items.every((it) => it.status === "built");
    broadcastRunState(done
      ? "roadmap complete — every increment built"
      : blocked.length
        ? `run stopped: ${blocked.map((b) => `${b.id} needs ${b.missing.join(", ")}`).join("; ")}`
        : "nothing buildable");
    return;
  }
  runItemId = item.id;
  updateItem(item.id, "drafting");
  broadcastRunState(`drafting ${item.id}`);

  const opts = genSpawnOptions();
  if (!opts) {
    updateItem(item.id, "failed", "analyzed project root unreachable");
    buildRunActive = false;
    runItemId = null;
    broadcastRunState("run paused: project root unreachable");
    return;
  }
  const existing = isDirectory ? findPyFiles(inputPath).map((f) => relativize(f)) : [];
  const draft = await draftChangeset(item.capability, sysPlan, existing, opts.cwd, changesetExistingSymbols(), builderSession());
  if (!draft.changeset) {
    updateItem(item.id, "failed", draft.error ?? "builder produced no increment");
    buildRunActive = false;
    runItemId = null;
    broadcastRunState(`run paused: ${item.id} failed`);
    return;
  }
  const result = await changesetProposeCore(draft.changeset);
  if (!result.ok || !result.floor || !result.changeset) {
    updateItem(item.id, "failed", result.error ?? "changeset floor could not run");
    buildRunActive = false;
    runItemId = null;
    broadcastRunState(`run paused: ${item.id} failed`);
    return;
  }
  if (!result.floor.ok) {
    // PLAN-v7 6b — when the ONLY blocker is an unconsented effectful check
    // (files all green, consent token minted), that is a QUESTION for the
    // human, not a floor verdict: gate it. Consent at the gate re-proposes
    // with the token; reject returns the item to pending as usual.
    const filesOk = result.floor.files.length > 0 && result.floor.files.every((f) => f.ok);
    if (filesOk && result.floor.check.consentToken) {
      updateItem(item.id, "gated");
      broadcastRunState(`${item.id} at the gate — effectful check awaits consent`);
      broadcastToAll({ type: "changeset-proposal", payload: { ...result, runItemId: item.id } });
      return;
    }
    const reason = result.floor.files.find((f) => !f.ok)?.error
      ?? result.floor.check.error
      ?? "verification floor red";
    // Keep the check's own output. "check failed (exit 1)" names the exit
    // code and nothing else; the assertion message that says WHY lives in
    // result.floor.check.output and was previously dropped on the floor.
    updateItem(item.id, "failed", reason, result.floor.check.output || undefined);
    buildRunActive = false;
    runItemId = null;
    broadcastRunState(`run paused: ${item.id} failed its floor`);
    return;
  }
  // Green floor → the gate. Broadcast (the gate is app state, not a
  // per-client reply) tagged with the run item.
  updateItem(item.id, "gated");
  broadcastRunState(`${item.id} at the gate`);
  broadcastToAll({ type: "changeset-proposal", payload: { ...result, runItemId: item.id } });
}

// Run controls. Start/resume kick the drive loop; pause stops BETWEEN
// increments (an open gate stays open — closing it is the human's call);
// reject-at-gate returns the item to pending and pauses; retry (optionally
// with an edited capability) re-queues a failed item and resumes; skip marks
// it skipped (dependents become blocked — honest hole, surfaced); stop
// pauses and returns any in-flight item to pending.
function handleBuildRunControl(msg: any): void {
  const type: string = msg.type;
  if (type === "build-run-start") {
    if (buildRunActive) return;
    buildRunActive = true;
    broadcastRunState("run started");
    void advanceBuildRun();
    return;
  }
  if (type === "build-run-pause") {
    buildRunActive = false;
    broadcastRunState("run paused");
    return;
  }
  if (type === "build-run-reject") {
    // The human rejected the gated increment — judgment says no. Item back
    // to pending (the draft is discarded, not recorded as failure), run
    // pauses for triage/redirection.
    const id = typeof msg.payload?.itemId === "string" ? msg.payload.itemId : runItemId;
    if (id) updateItem(id, "pending");
    runItemId = null;
    buildRunActive = false;
    broadcastRunState(id ? `run paused: ${id} rejected at the gate` : "run paused");
    return;
  }
  if (type === "build-run-retry") {
    const id = msg.payload?.itemId;
    const plan = getBuildPlan();
    if (typeof id !== "string" || !plan?.items.some((it) => it.id === id)) return;
    // Optionally re-aim the item: an edited capability is a NEW instruction
    // to the builder, recorded on the artifact before the retry.
    const capability = msg.payload?.capability;
    if (typeof capability === "string" && capability.trim().length > 0) {
      const next: BuildPlan = {
        ...plan,
        items: plan.items.map((it) => it.id === id ? { ...it, capability: capability.trim() } : it),
      };
      const persisted = persistBuildPlan(analyzedRoot(), next);
      if (persisted.plan) {
        buildPlan = persisted.plan;
        try { buildPlanMtime = fs.statSync(path.join(analyzedRoot(), ".vibegraph", "build-plan.json")).mtimeMs; } catch { /* ignore */ }
      }
    }
    updateItem(id, "pending");
    buildRunActive = true;
    broadcastRunState(`retrying ${id}`);
    void advanceBuildRun();
    return;
  }
  if (type === "build-run-skip") {
    const id = msg.payload?.itemId;
    if (typeof id !== "string") return;
    updateItem(id, "skipped", "skipped by the human — dependents are blocked");
    if (runItemId === id) runItemId = null;
    // Skipping is a decision; continuing past it is another. Keep the run
    // active and advance — nextBuildableItem blocks dependents honestly.
    if (buildRunActive) void advanceBuildRun();
    else broadcastRunState(`${id} skipped`);
    return;
  }
  if (type === "build-run-stop") {
    if (runItemId) updateItem(runItemId, "pending");
    runItemId = null;
    buildRunActive = false;
    disposeBuildSession();
    broadcastRunState("run stopped");
  }
}

// Human acceptance: re-validate (the accept payload is a fresh boundary
// crossing — same "same op twice" discipline as Stage 1), persist with a
// ratifiedAt stamp, then rebroadcast the envelope so every client's ghost
// tier now comes from the durable plan.
function handleSystemPlanAccept(plan: unknown, ws: WebSocket): void {
  const root = analyzedRoot();
  if (!fs.existsSync(root)) {
    ws.send(JSON.stringify({ type: "system-plan-saved", payload: { ok: false, error: "analyzed project root unreachable" } }));
    return;
  }
  const result = persistSystemPlan(root, plan);
  if (result.error || !result.plan) {
    ws.send(JSON.stringify({ type: "system-plan-saved", payload: { ok: false, error: result.error ?? "persist failed" } }));
    return;
  }
  systemPlan = result.plan;
  try { systemPlanMtime = fs.statSync(result.path!).mtimeMs; } catch { /* next getSystemPlan re-reads */ }
  ws.send(JSON.stringify({ type: "system-plan-saved", payload: { ok: true, path: result.path } }));
  broadcastProjectUpdate();
}

// ── M13.2 External-callable resolver ─────────────────────────────────────────
//
// PLAN-v4 §1: the tooltip's "External library call — source not available"
// dead-end becomes a real signature + docstring lookup via inspect /
// importlib. Process-local LRU cache keyed by qualified name keeps the
// python3 spawn cost off the hot path for repeat hovers.

const EXTERNAL_RESOLVE_CACHE_MAX = 200;
const externalResolveCache = new Map<string, unknown>();

function spawnExternalResolve(qualifiedName: string): Promise<unknown> {
  return new Promise((resolve) => {
    const child = spawn("python3", [RESOLVE_EXTERNAL_SCRIPT, qualifiedName], {
      stdio: ["ignore", "pipe", "pipe"],
      env: pythonEnv(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", () => {
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        // The resolver never raises by contract; if we get unparseable
        // output that's an environment issue (missing python, broken
        // pydeps). Surface as kind=unresolved with the stderr text.
        resolve({
          qualifiedName,
          kind: "unresolved",
          signature: null,
          signatureSource: null,
          docstring: null,
          module: null,
          sourceFile: null,
          isBuiltin: false,
          error: stderr || "resolver subprocess produced no output",
        });
      }
    });
    child.on("error", (err: any) => resolve({
      qualifiedName, kind: "unresolved",
      signature: null, signatureSource: null, docstring: null,
      module: null, sourceFile: null, isBuiltin: false,
      error: `resolver spawn failed: ${err?.message ?? err}`,
    }));
  });
}

async function handleResolveExternalCall(
  payload: { nodeId: string; qualifiedName: string },
  ws: WebSocket,
): Promise<void> {
  const { nodeId, qualifiedName } = payload;
  if (!qualifiedName || typeof qualifiedName !== "string") {
    ws.send(JSON.stringify({
      type: "external-call-resolved",
      payload: {
        nodeId, qualifiedName: qualifiedName ?? "",
        kind: "unresolved",
        signature: null, signatureSource: null, docstring: null,
        module: null, sourceFile: null, isBuiltin: false,
        error: "missing qualifiedName",
      },
    }));
    return;
  }

  let result = externalResolveCache.get(qualifiedName);
  if (result === undefined) {
    result = await spawnExternalResolve(qualifiedName);
    // Naive LRU: drop the oldest entry when over cap. JS Maps iterate
    // in insertion order, so the first key IS the oldest.
    if (externalResolveCache.size >= EXTERNAL_RESOLVE_CACHE_MAX) {
      const oldest = externalResolveCache.keys().next().value;
      if (oldest !== undefined) externalResolveCache.delete(oldest);
    }
    externalResolveCache.set(qualifiedName, result);
  } else {
    // Refresh recency by re-inserting.
    externalResolveCache.delete(qualifiedName);
    externalResolveCache.set(qualifiedName, result);
  }

  ws.send(JSON.stringify({
    type: "external-call-resolved",
    payload: { nodeId, ...(result as object) },
  }));
}

// ── Edit handlers (Stage 2) ───────────────────────────────────────────────────

function handleEditOpen(nodeId: string, ws: WebSocket, filePath?: string): void {
  const node = findNode(nodeId, filePath);
  if (!node) {
    ws.send(JSON.stringify({ type: "edit-node-source", payload: { nodeId, source: "", error: "Node not found" } }));
    return;
  }
  const line = node.line ?? node.lineno;
  const endLine = node.endLine ?? node.endLineno;
  // U1.1 — in directory mode the caller must supply a filePath; if it's
  // missing, fall back to findNodeFile so the pencil-edit path (which
  // historically passed nodeId only) keeps working.
  const targetFile = filePath ?? (isDirectory ? (findNodeFile(nodeId) ?? undefined) : undefined);
  try {
    const source = getSourceSnippet(line, endLine, targetFile);
    ws.send(JSON.stringify({ type: "edit-node-source", payload: { nodeId, source } }));
  } catch (e: any) {
    ws.send(JSON.stringify({
      type: "edit-node-source",
      payload: { nodeId, source: "", error: `Read failed: ${e.message}` },
    }));
  }
}

async function handleEditSave(nodeId: string, newSource: string, ws: WebSocket, filePath?: string): Promise<void> {
  const targetFile = filePath ?? (isDirectory ? null : resolvedPyFile);
  if (!targetFile) {
    ws.send(JSON.stringify({ type: "edit-node-saved", payload: { nodeId, success: false, error: "No target file" } }));
    return;
  }
  const node = findNode(nodeId, filePath);
  if (!node) {
    ws.send(JSON.stringify({ type: "edit-node-saved", payload: { nodeId, success: false, error: "Node not found" } }));
    return;
  }
  const result = await rewriteAndValidate(
    [targetFile, "replace_node", nodeId],
    newSource,
    targetFile
  );
  ws.send(JSON.stringify({
    type: "edit-node-saved",
    payload: { nodeId, success: result.success, error: result.message },
  }));
}

// M18.3 — Mode A commit from <NodeEditorPanel>. The panel sends the whole
// function (or module) buffer; we route it through the M18.2 whole-scope
// ops. On success in directory mode we re-run discovery + extraction
// (rewriteAndValidate only re-parses the one file + rebroadcasts cached
// threads) so the open thread/graph reflects the edit — the "graph
// animates" half of the §F done clause.
async function handleReplaceBodySave(
  payload: {
    nodeId: string | null;
    newSource: string;
    filePath: string;
    isModule: boolean;
    allowSignatureChange: boolean;
  },
  ws: WebSocket,
): Promise<void> {
  const { nodeId, newSource, filePath, isModule, allowSignatureChange } = payload;
  if (!filePath) {
    ws.send(JSON.stringify({
      type: "replace-body-saved",
      payload: { nodeId, success: false, error: "No target file" },
    }));
    return;
  }
  const targetFile = resolveProjectPath(filePath);
  const args = isModule
    ? [targetFile, "replace_module_body"]
    : [
        targetFile,
        "replace_function_body",
        nodeId ?? "",
        ...(allowSignatureChange ? ["--allow-signature-change"] : []),
      ];
  const result = await rewriteAndValidate(args, newSource, targetFile);
  // M26.1 — derived data (threads/entryPoints/system) now refreshes via
  // the chokepoint's scheduled incremental refresh; the full parseAllFiles
  // this handler used to run per save is gone.
  ws.send(JSON.stringify({
    type: "replace-body-saved",
    payload: {
      nodeId,
      success: result.success,
      error: result.message,
      errorKind: result.errorKind,
    },
  }));
}

// ── M18.5: Mode B — intent → proposal ─────────────────────────────────
//
// Tier 1 runs the deterministic placer (place_intent.py); Tier 2 falls
// back to a scoped `claude -p` call (§B.2). Both converge on "the new
// enclosing-function source", which the panel previews in Monaco and
// commits via the Mode A path (replace_function_body) — the human-
// approval gate (§A.4 Guard 3). No proposal is ever auto-applied.

function _spawnJson(script: string, stdin: string): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn("python3", [script], { stdio: ["pipe", "pipe", "pipe"], env: pythonEnv() });
    let out = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stdin.write(stdin);
    child.stdin.end();
    child.on("close", () => { try { resolve(JSON.parse(out.trim())); } catch { resolve(null); } });
    child.on("error", () => resolve(null));
  });
}

function _enclosingFunctionNode(node: any, fileNodes: any[]): any | null {
  const byId = new Map(fileNodes.map((n: any) => [n.id, n]));
  let cur: any = byId.get(node.id) ?? node;
  let guard = 0;
  while (cur && guard++ < 10_000) {
    if (cur.type === "function_def") return cur;
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return null;
}

// Map a placer proposal to cst_rewrite CLI args + stdin (mirrors main()).
function _proposalToCstArgs(
  file: string,
  proposal: { op: string; target_id: string | null; source: string },
): { argv: string[]; stdin?: string } | null {
  const { op, target_id, source } = proposal;
  if (!target_id) return null;
  switch (op) {
    case "append_keyword_arg": {
      const eq = source.indexOf("=");
      if (eq < 0) return null;
      return { argv: [file, op, target_id, source.slice(0, eq).trim()], stdin: source.slice(eq + 1).trim() };
    }
    case "append_positional_arg":
      return { argv: [file, op, target_id], stdin: source };
    case "add_function_parameter":
      return { argv: [file, op, target_id, source.trim()] };
    case "insert_before":
    case "insert_after":
    case "insert_as_first_child":
    case "insert_as_last_child":
    case "replace_node":
      return { argv: [file, op, target_id], stdin: source };
    default:
      return null;
  }
}

// Run cst_rewrite --dry-run; resolve the modified file source (raw) or an
// error. --dry-run prints raw source on success, JSON {success:false} on
// failure (Python modules don't start with `{`, so the discriminator is safe).
function _dryRunRewrite(argv: string[], stdin?: string): Promise<{ source?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("python3", [REWRITE_SCRIPT, ...argv, "--dry-run"], {
      stdio: ["pipe", "pipe", "pipe"], env: pythonEnv(),
    });
    let out = "", err = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    if (stdin !== undefined) child.stdin.write(stdin);
    child.stdin.end();
    child.on("close", () => {
      const t = out.trim();
      if (t.startsWith("{")) {
        try {
          const j = JSON.parse(t);
          if (j && j.success === false) { resolve({ error: j.error || "op rejected" }); return; }
        } catch { /* not JSON → it's source */ }
      }
      if (!t) { resolve({ error: err || "empty dry-run output" }); return; }
      resolve({ source: out });
    });
    child.on("error", (e: any) => resolve({ error: e.message }));
  });
}

// Slice an enclosing function's NEW source out of a (dry-run) modified
// file — write to a temp file, re-parse for the shifted span, slice.
async function _sliceFunctionFromSource(source: string, fnId: string): Promise<string | null> {
  const tmp = path.join(os.tmpdir(), `vg-intent-${process.pid}-${Date.now()}.py`);
  try {
    fs.writeFileSync(tmp, source, "utf-8");
    const parsed = await parseOneFile(tmp);
    const n = parsed.nodes.find((x: any) => x.id === fnId);
    if (!n) return null;
    const lines = source.split("\n");
    return lines.slice((n.line ?? n.lineno) - 1, (n.endLine ?? n.endLineno)).join("\n");
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

async function _buildPreviewFromProposal(
  targetFile: string,
  proposal: { op: string; target_id: string | null; source: string },
  fn: any | null,
): Promise<{ previewSource?: string; commitTargetId?: string | null; isModule?: boolean; error?: string }> {
  // replace_function_body proposals already carry the full function.
  if (proposal.op === "replace_function_body" && fn) {
    return { previewSource: proposal.source, commitTargetId: fn.id, isModule: false };
  }
  const args = _proposalToCstArgs(targetFile, proposal);
  if (!args) return { error: `Unsupported proposal op: ${proposal.op}` };
  const dry = await _dryRunRewrite(args.argv, args.stdin);
  if (dry.error || !dry.source) return { error: dry.error ?? "dry-run produced no source" };
  const inFn = fn && (proposal.target_id === fn.id || (proposal.target_id ?? "").startsWith(`${fn.id}/`));
  if (!inFn) {
    // module-scope change (e.g. add import) → preview + commit the module.
    return { previewSource: dry.source, commitTargetId: null, isModule: true };
  }
  const sliced = await _sliceFunctionFromSource(dry.source, fn.id);
  if (!sliced) return { error: "could not locate the function in the dry-run result" };
  return { previewSource: sliced, commitTargetId: fn.id, isModule: false };
}

// §B.2 scoped LLM call — system + target + neighbourhood + intent, single
// round-trip, JSON out. The IR is the analysis; Claude only writes source.
function _runIntentLlm(intent: string, node: any, fileNodes: any[], fnSource: string): Promise<string | null> {
  const siblings = fileNodes
    .filter((n: any) => n.parentId === node.parentId)
    .slice(0, 12)
    .map((n: any) => `${n.type} ${n.name ?? n.funcName ?? n.id.split("/").pop()}`)
    .join(", ");
  // Fence-first: ask for the function in a single ```python block, NOT a
  // JSON string. A multi-line function inside a JSON string has raw
  // newlines (invalid JSON) — the cause of the historical "no usable
  // function" failures. extractFunctionSource still accepts the JSON form
  // for back-compat.
  const prompt = [
    "You edit a single Python function. Apply the requested change and return ONLY the complete",
    "modified function inside a single ```python code block. No explanation before or after.",
    "Preserve the signature unless the change requires altering it.",
    "",
    `Intent: ${intent}`,
    `Selected node: ${node.type} ${node.name ?? node.funcName ?? node.id}`,
    `Siblings: ${siblings}`,
    "",
    "Current function:",
    "```python",
    fnSource,
    "```",
  ].join("\n");
  return new Promise((resolve) => {
    // gen-cwd-fix: run in the analyzed project, fail honestly if it's gone.
    const opts = genSpawnOptions();
    if (!opts) {
      console.warn("  [Intent] analyzed project root unreachable — skipping LLM");
      resolve(null);
      return;
    }
    // CLI-drift note: --mcp-config requires an mcpServers record (a bare
    // {} is rejected) AND is variadic, so the positional prompt must sit
    // behind `--` or it's consumed as a second config path.
    // Model tier: thinking — Intent drafts code that lands on disk through
    // the CST chokepoint. Also switches off the hardcoded "claude": this
    // spawn bypassed VG_CLAUDE_BIN, so tests could not stub it and the
    // showdown metering never saw it.
    const { cmd, args: pre } = resolveClaudeBin("thinking");
    const child = spawn(
      cmd,
      [...pre, "-p", "--output-format", "json", "--strict-mcp-config",
        "--mcp-config", '{"mcpServers":{}}',
        "--dangerously-skip-permissions", "--", prompt],
      opts,
    );
    child.stdin?.end(); // 6d pre-flight: no open pipe — claude -p otherwise waits 3s for stdin per draft
    let out = "";
    let err = "";
    child.stdout.on("data", (b: Buffer) => { out += b.toString(); });
    child.stderr.on("data", (b: Buffer) => { err += b.toString(); });
    child.on("close", (code) => {
      // Diagnostics: silent failure here used to be undebuggable. Mirror
      // the Analyze handler — log exit code / stderr / a raw-output preview.
      if (code !== 0) {
        const first = err.split("\n").find((l) => l.trim()) ?? `exit ${code}`;
        console.warn(`  [Intent] claude -p exited ${code}: ${first}`);
        resolve(null);
        return;
      }
      let result = "";
      try {
        const parsed = JSON.parse(out);
        result = typeof parsed.result === "string" ? parsed.result : "";
      } catch {
        console.warn(`  [Intent] could not parse claude -p JSON: ${out.slice(0, 200)}`);
        resolve(null);
        return;
      }
      const fn = extractFunctionSource(result);
      if (!fn) console.warn(`  [Intent] no function extracted from LLM reply: ${result.slice(0, 200)}`);
      resolve(fn);
    });
    child.on("error", (e) => {
      console.warn(`  [Intent] claude -p spawn error: ${e.message}`);
      resolve(null);
    });
  });
}

async function handlePlaceIntent(
  payload: { intent: string; targetIrNodeId: string; filePath: string },
  ws: WebSocket,
): Promise<void> {
  const reply = (p: any) => ws.send(JSON.stringify({ type: "intent-proposal", payload: p }));
  const none = (error: string, tier = "none", reason = "") =>
    reply({ previewSource: null, commitTargetId: null, isModule: false, tier, reason, error });

  const { intent, targetIrNodeId, filePath } = payload;
  const targetFile = resolveProjectPath(filePath);
  const fileData = isDirectory ? projectParse[targetFile] : lastParse;
  const fileNodes: any[] = fileData?.nodes ?? [];
  const node = fileNodes.find((n: any) => n.id === targetIrNodeId);
  if (!node) { none("Selected node not found in the current file."); return; }

  const fn = _enclosingFunctionNode(node, fileNodes);
  let fnSource: string | null = null;
  if (fn) {
    try { fnSource = getSourceSnippet(fn.line ?? fn.lineno, fn.endLine ?? fn.endLineno, filePath); } catch { /* ignore */ }
  }

  // ── Tier 1: heuristic placer ──
  const placer = await _spawnJson(PLACE_INTENT_SCRIPT, JSON.stringify({
    intent,
    target: { id: node.id, type: node.type, name: node.name ?? node.funcName, parentId: node.parentId ?? null },
    ctx: {
      nodes: fileNodes.map((n: any) => ({
        id: n.id, type: n.type, parentId: n.parentId ?? null, name: n.name, funcName: n.funcName,
      })),
      filePath,
      enclosingFunctionSource: fnSource,
    },
  }));
  const proposal = placer?.proposal;
  if (proposal?.rejected) { none(proposal.reason, "heuristic", proposal.reason); return; }
  if (proposal) {
    const built = await _buildPreviewFromProposal(targetFile, proposal, fn);
    if (built.error) { none(built.error, "heuristic", proposal.reason); return; }
    reply({
      previewSource: built.previewSource,
      commitTargetId: built.commitTargetId,
      isModule: built.isModule,
      tier: "heuristic",
      reason: proposal.reason,
    });
    return;
  }

  // ── Tier 2: scoped LLM (claude -p) ──
  if (!claudeCliAvailable || !fn || !fnSource) {
    none(claudeCliAvailable
      ? "No heuristic matched, and there's no enclosing function for the LLM to rewrite."
      : "No heuristic matched; the claude CLI is unavailable for the LLM fallback.");
    return;
  }
  const llm = await _runIntentLlm(intent, node, fileNodes, fnSource);
  if (!llm) { none("The LLM did not return a usable function. See the server log for the claude output."); return; }
  reply({
    previewSource: llm, commitTargetId: fn.id, isModule: false,
    tier: "llm", reason: "LLM-proposed rewrite of the enclosing function",
  });
}

// ── Edit-tool execution (Stage 3) ─────────────────────────────────────────────
// Born as the chat panel's tool dispatcher; the live consumer is now the
// MCP context's rewriteNode adapter below, which funnels MCP edit tools
// through the same rewriteAndValidate chokepoint.

async function executeToolCall(
  name: string,
  input: Record<string, unknown>,
  ws: WebSocket,
  chatFile?: string
): Promise<{ success: boolean; message?: string; errorKind?: string; delta?: IrDelta }> {
  // MCP clients pass project-relative paths (the keys list_files returns);
  // resolve before any fs access — findNode already resolves internally,
  // so an unresolved path here would read IR fine but ENOENT on rewrite.
  const tFile = chatFile ? resolveProjectPath(chatFile) : (isDirectory ? null : resolvedPyFile);
  if (!tFile) return { success: false, message: "No target file for tool call" };

  switch (name) {
    case "replace_node": {
      const node = findNode(input.nodeId as string, tFile);
      if (!node) return { success: false, message: `Node not found: ${input.nodeId}` };
      return rewriteAndValidate(
        [tFile, "replace_node", input.nodeId as string],
        input.newSource as string, tFile,
      );
    }
    case "insert_statement_before": {
      const node = findNode(input.nodeId as string, tFile);
      if (!node) return { success: false, message: `Node not found: ${input.nodeId}` };
      return rewriteAndValidate(
        [tFile, "insert_before", input.nodeId as string],
        input.source as string, tFile,
      );
    }
    case "insert_statement_after": {
      const node = findNode(input.nodeId as string, tFile);
      if (!node) return { success: false, message: `Node not found: ${input.nodeId}` };
      return rewriteAndValidate(
        [tFile, "insert_after", input.nodeId as string],
        input.source as string, tFile,
      );
    }
    case "delete_node": {
      const node = findNode(input.nodeId as string, tFile);
      if (!node) return { success: false, message: `Node not found: ${input.nodeId}` };
      return rewriteAndValidate(
        [tFile, "delete_node", input.nodeId as string],
        undefined, tFile,
      );
    }
    case "rename_symbol": {
      // Scope-aware rename: takes a node_id (the def site) + new name.
      // Replaces the legacy whole-file regex behaviour.
      const node = findNode(input.nodeId as string, tFile);
      if (!node) return { success: false, message: `Node not found: ${input.nodeId}` };
      return rewriteAndValidate(
        [tFile, "rename_in_scope", input.nodeId as string, input.newName as string],
        undefined, tFile,
      );
    }
    default:
      return { success: false, message: `Unknown tool: ${name}` };
  }
}

// ── Chat handler (M7 wave 2 → M10.1–.3 ChatBackend; M25 revival) ─────────────
// handleChat builds the prompt + context, picks a ChatBackend via
// selectBackend(), and forwards each emitted ChatEvent to the webview
// using the WS shapes the ChatPanel knows. Unmounted in M10-chat-removal,
// revived in M25: the in-GUI chat is the product's agent surface — it
// behaves like a terminal Claude Code session because it IS one (claude -p
// with an inline MCP config pointing back at this server's /mcp).

// forwardChatEvent lives in src/server/chat/forward.ts (M-CHAT-POLISH.1):
// it now carries toolUseId on both tool payloads so the webview can pair
// a result to its card, and no longer masks tool results as "(mcp)".

// M27.1 — one persistent ChatSession per connected client. The stdio
// backend keeps a long-running `claude -p` child behind it, so the
// conversation has real memory between sends; dispose on WS close (and
// on clearHistory) so children never outlive their client. M27.2 also
// keeps the previous turn's context snapshot for delta framing.
interface ChatClientState {
  session: ChatSession;
  prevCtx: ChatTurnContext | null;
  // M-SKILL.2 — (entryPointId → sourceHash) of routed skills already injected
  // into THIS session, so an identical skill re-routes as a one-line reference
  // instead of a re-paste. Only meaningful for the stdio backend (the SDK
  // backend has no cross-turn memory, so it must re-inject every turn).
  injectedSkills: Map<string, string>;
}
// M-GF3.4 — sessions are keyed per SCOPE within a client: "main" is the
// chat panel's conversation; "stage:<itemId>" is a stage-dialogue in the
// StageDetailDialog. Scopes are independent conversations (isolation beats
// shared memory here) but share the lifecycle: all dispose on WS close.
const chatSessions = new Map<WebSocket, Map<string, ChatClientState>>();

function chatScopeState(ws: WebSocket, scope: string): ChatClientState | undefined {
  return chatSessions.get(ws)?.get(scope);
}
function setChatScopeState(ws: WebSocket, scope: string, state: ChatClientState): void {
  let scopes = chatSessions.get(ws);
  if (!scopes) {
    scopes = new Map();
    chatSessions.set(ws, scopes);
  }
  scopes.set(scope, state);
}
function disposeChatScope(ws: WebSocket, scope: string): void {
  const scopes = chatSessions.get(ws);
  const state = scopes?.get(scope);
  if (state) {
    state.session.dispose();
    scopes!.delete(scope);
  }
}

// Terminal parity (PLAN-M27): the chat runs in the ANALYZED project —
// its CLAUDE.md loads, and `--resume` looks sessions up per-cwd — not
// in VibeGraph's own repo. Byte-identical to analyzedRoot() (gen-cwd-fix
// deduped them to one source of truth so cwd can't drift between the chat
// and gen paths); kept as a named alias for the M27 call sites.
function chatCwd(): string {
  return analyzedRoot();
}

async function handleChat(
  userText: string,
  contextNodeId: string | null,
  clearHistory: boolean,
  ws: WebSocket,
  chatFilePath?: string,
  threadEntryPointId?: string | null,
  model?: string | null
): Promise<void> {
  if (!claudeCliAvailable) {
    ws.send(JSON.stringify({
      type: "chat-error",
      payload: { message: "claude CLI not found on PATH. Install Claude Code to use the in-webview chat." },
    }));
    return;
  }

  // M27.4 — a null activeFile is fine in directory mode (it can only be
  // null there: single-file mode always has resolvedPyFile). The old
  // "No active file" rejection predates the M26.3 framing — the prompt
  // now carries the project map + IR targeting rules, so the chat works
  // from the thread index without a selection, like a terminal session
  // would. The prompt simply omits the "currently viewing" line.
  const activeFile = chatFilePath ?? (isDirectory ? null : resolvedPyFile);

  // M26.3 — resolve all impure context here, then delegate the framing
  // to the pure buildChatPrompt (unit-tested without a server boot).
  let nodeCtx: ChatNodeContext | null = null;
  if (contextNodeId) {
    // True node file: the payload's filePath first, findNodeFile as the
    // fallback — the selected node is NOT always in the viewed file
    // (thread view selections cross files). Never silently drop the
    // context block; an unresolved id ships as file:null so the prompt
    // states the gap.
    let node = findNode(contextNodeId, activeFile ?? undefined);
    let nodeFile: string | null = node ? activeFile : null;
    if (!node) {
      const abs = findNodeFile(contextNodeId);
      if (abs) {
        nodeFile = isDirectory ? relativize(abs) : abs;
        node = findNode(contextNodeId, nodeFile ?? undefined);
      }
    }
    nodeCtx = {
      nodeId: contextNodeId,
      file: nodeFile,
      type: node?.type,
      line: node?.line ?? node?.lineno,
      endLine: node?.endLine ?? node?.endLineno,
      source: node && nodeFile
        ? getSourceSnippet(node.line ?? node.lineno, node.endLine ?? node.endLineno, nodeFile)
        : null,
    };
  }

  let threadCtx: ChatThreadContext | null = null;
  if (threadEntryPointId) {
    const t = latestThreads.find((t: any) => t.entryPointId === threadEntryPointId);
    if (t) {
      // C1 — inject the thread-skill ONLY through the labeled gate: ratified
      // + fresh, or ratified + human-opted auto-reaffirm (caveat appended —
      // M-SKILL.7). Drafts and unopted stale skills never inject.
      const skill = readThreadSkill(threadEntryPointId);
      // M-TRAINED.4 — artifact awareness: if this thread consumes an
      // artifact that is missing or stale, say so (with its producer) so
      // the agent's natural next move is to offer running training —
      // through the consent-gated run tool, never silently.
      const artifactNotes = computeArtifactIndex()
        .filter((a) => a.consumers.some((c) => c.entryPointId === threadEntryPointId) && (!a.exists || a.stale))
        .map((a) => {
          const prod = a.producers.filter((p) => p.entryPointId);
          const by = prod.length
            ? `produced by ${prod.map((p) => `thread ${p.qualifiedName} (${p.call} at ${p.file}:${p.line})`).join(", ")}`
            : "no producer found in this project";
          return a.exists
            ? `${a.path} is STALE (${a.staleReason}) — ${by}. Retraining may be wanted; ask before running (real file writes).`
            : `${a.path} is MISSING — ${by}. Offer to run the producer (vibegraph_run_thread_to_node on its save site, consent-gated); never fabricate this file.`;
        });
      threadCtx = {
        qualifiedName: t.seed.qualifiedName,
        seedFile: t.seed.file,
        nodes: t.nodes.map((n: any) => ({ id: n.id, kind: n.kind, label: n.label, file: n.file })),
        skill: injectableSkillText(skill),
        ...(artifactNotes.length ? { artifacts: artifactNotes } : {}),
      };
    }
  }

  // Backend picks itself per M10.3: Agent SDK when ANTHROPIC_API_KEY is
  // set, else the zero-friction stdio spawn (M27.1). Both backends
  // reach back into this same process's /mcp endpoint via the URL we
  // pass in, so the agent can drive the very webview the user is
  // sitting in front of.
  const backend = selectBackend();

  // M27.1 — New chat: drop the old session (and its child) before
  // opening a fresh one. The flag was accepted-and-ignored since M7.
  let state = chatScopeState(ws, "main");
  if (clearHistory && state) {
    disposeChatScope(ws, "main");
    state = undefined;
  }
  // M27.3 — honesty signal: true when this turn continues a session
  // that predates it (the panel may have been closed and reopened, so
  // its transcript no longer shows everything the agent remembers).
  const resumedExisting = !!state;
  if (!state) {
    state = {
      session: backend.openSession({
        mcpServerUrl: `http://localhost:${port}/mcp`,
        cwd: chatCwd(),
        disallowedTools: CHAT_DENIED_TOOLS,
        model: model ?? undefined,
      }),
      prevCtx: null,
      injectedSkills: new Map(),
    };
    setChatScopeState(ws, "main", state);
  } else {
    // Switching model keeps the conversation: the backend retires the
    // child and the next turn respawns it with --model and --resume.
    state.session.setModel?.(model ?? undefined);
  }

  // M-SKILL.2 — remit routing. Match the question's code-shaped tokens
  // against every OTHER thread's remit (deterministic, thread_remit.ts);
  // matched threads ride the prompt with their authoritative skill under
  // the routing budget. Zero matches → routed stays empty → the prompt is
  // byte-identical to the pre-routing shape.
  // M-SKILL.6 — node-click dispatch: a question asked FROM a node also
  // routes to the threads that own/walk that node — no text matching
  // needed, the id is unambiguous (file-disambiguated via the node's TRUE
  // file already resolved into nodeCtx). Both signals merge under one limit.
  let routed: RoutedThreadContext[] = [];
  {
    const exclude = threadEntryPointId ? [threadEntryPointId] : [];
    const matches = mergeMatches(
      contextNodeId ? matchNode(contextNodeId, nodeCtx?.file ?? null, remitIndex(), { exclude }) : [],
      matchQuestion(userText, remitIndex(), { exclude }),
    );
    // Silence is ambiguous: "matched nothing" and "matched the thread you
    // are already reading" produced the same empty result, so a question
    // about the open thread looked like routing had failed. Re-run WITHOUT
    // the exclusion purely to detect that case and say so.
    if (threadEntryPointId && matches.length === 0) {
      const unfiltered = mergeMatches(
        contextNodeId ? matchNode(contextNodeId, nodeCtx?.file ?? null, remitIndex()) : [],
        matchQuestion(userText, remitIndex()),
      );
      const self = unfiltered.find((m) => m.entryPointId === threadEntryPointId);
      if (self) {
        ws.send(JSON.stringify({
          type: "chat-routed",
          payload: {
            matches: [],
            // Not a routed thread — the active thread's FULL context (nodes,
            // skill, artifacts) is already in the prompt, so re-routing it
            // would duplicate it. Report it, don't inject it twice.
            // matchedOn is RemitMatchToken[] ({kind, token}) straight from
            // the matcher — flatten to the tokens the human actually typed.
            selfMatch: { qualifiedName: self.qualifiedName, matchedOn: self.matchedOn.map((t) => t.token) },
          },
        }));
      }
    }
    if (matches.length > 0) {
      const candidates: RoutingCandidate[] = matches.map((m) => {
        const res = readThreadSkill(m.entryPointId);
        // M-SKILL.7 — the labeled gate: fresh-ratified, or auto-reaffirmed
        // stale WITH its caveat baked into the text (dedup keys on the hash,
        // so a re-affirm re-injects the re-stamped skill).
        const text = injectableSkillText(res);
        return {
          ...m,
          skillBody: text,
          sourceHash: text !== null && res.exists ? res.sourceHash : null,
          // M-SKILL.7 honesty: a stale un-reaffirmed ratified skill is
          // WITHHELD — never reported downstream as "no skill exists".
          staleRatified: res.exists && res.status === "ratified" && res.stale && text === null,
          // Sitting-2 honesty: routed with NO ratified skill at all — say
          // why the shared-skill line is absent instead of implying one.
          ...(!res.exists ? { skillState: "absent" as const }
            : res.status !== "ratified" ? { skillState: "draft" as const } : {}),
        };
      });
      // The SDK backend forgets between turns — dedup only makes sense for
      // the persistent stdio session.
      const dedup = backend.id === "claude-stdio" ? state.injectedSkills : new Map<string, string>();
      const applied = applyRoutingBudget(candidates, dedup);
      routed = applied.routed;
      if (backend.id === "claude-stdio") {
        for (const [id, hash] of applied.injected) state.injectedSkills.set(id, hash);
      }
    }
  }

  // M27.2 — full framing on the FIRST turn of a persistent session;
  // later turns carry only a delta of what the user is looking at.
  // Non-stdio backends have NO cross-turn memory (SDK = per-turn
  // query), so they get the full framing every time.
  const turnCtx: ChatTurnContext = {
    activeFile,
    projectFiles: isDirectory ? Object.keys(relativeProjectFiles()) : [],
    node: nodeCtx,
    thread: threadCtx,
  };
  let prompt: string;
  if (backend.id !== "claude-stdio" || !state.prevCtx) {
    prompt = buildChatPrompt({ userText, ...turnCtx, routed });
  } else {
    // Routing is per-question, not a context delta: the routed block rides
    // every follow-up turn that has matches.
    const preamble = buildTurnPreamble(state.prevCtx, turnCtx);
    const routedText = renderRoutedBlock(routed);
    prompt = [preamble, routedText, userText].filter(Boolean).join("\n\n");
  }
  state.prevCtx = turnCtx;

  // M-SKILL.2 — provenance to the human: name every routed thread and why
  // it matched, before the reply streams.
  if (routed.length > 0) {
    ws.send(JSON.stringify({
      type: "chat-routed",
      payload: {
        matches: routed.map((r) => ({
          entryPointId: r.entryPointId,
          qualifiedName: r.qualifiedName,
          matchedOn: r.matchedOn,
          skillInjected: r.skill != null,
          ...(r.skillOmitted === "stale" ? { skillStale: true } : {}),
          ...(r.skillMissing ? { skillMissing: r.skillMissing } : {}),
          // Sitting-2 — the remaining withhold reasons were SILENT in the
          // chip (a ratified skill over budget read as "no skill"): name them.
          ...(r.skillOmitted === "over-budget" ? { skillOverBudget: true } : {}),
          ...(r.skillOmitted === "already-in-session" ? { skillAlreadyShared: true } : {}),
        })),
      },
    }));
  }

  ws.send(JSON.stringify({
    type: "chat-backend-info",
    payload: { backend: backend.id, sessionId: state.session.sessionId(), resumed: resumedExisting },
  }));

  try {
    for await (const ev of state.session.sendTurn(prompt)) {
      forwardChatEvent(ev, ws);
    }
  } catch (err: any) {
    ws.send(JSON.stringify({
      type: "chat-error",
      payload: { message: `Chat backend (${backend.id}) failed: ${err?.message ?? err}` },
    }));
    ws.send(JSON.stringify({ type: "chat-done", payload: {} }));
  }
}

// ── M-GF3.4 — per-stage dialogue (StageDetailDialog) ─────────────────────────
// A SCOPED conversation about one roadmap stage, on the same persistent
// ChatBackend machinery as the main panel but under its own session key
// ("stage:<itemId>") — isolated memory, shared lifecycle. The client sends
// its CURRENT plan snapshot (the pending proposal or the ratified roadmap —
// the server only holds the latter), validated at the boundary. When the
// agent's turn ends with a ```vg-revise-stage block, it is parsed +
// dry-run-validated here and proposed back as build-plan-item-revision;
// nothing changes until the human applies it.

async function handleStageChat(
  planSnapshot: unknown,
  itemId: string,
  userText: string,
  ws: WebSocket,
): Promise<void> {
  const scope = `stage:${itemId}`;
  const fail = (message: string) => {
    ws.send(JSON.stringify({ type: "chat-error", payload: { message, scope } }));
    ws.send(JSON.stringify({ type: "chat-done", payload: { scope } }));
  };
  if (!claudeCliAvailable) {
    fail("claude CLI not found on PATH. Install Claude Code to use the stage dialogue.");
    return;
  }
  const invalid = validateBuildPlan(planSnapshot);
  if (invalid) { fail(`invalid roadmap snapshot: ${invalid}`); return; }
  const plan = planSnapshot as BuildPlan;
  if (!plan.items.some((i) => i.id === itemId)) { fail(`no roadmap stage with id "${itemId}"`); return; }

  const backend = selectBackend();
  let state = chatScopeState(ws, scope);
  if (!state) {
    state = {
      session: backend.openSession({
        mcpServerUrl: `http://localhost:${port}/mcp`,
        cwd: chatCwd(),
        disallowedTools: CHAT_DENIED_TOOLS,
      }),
      prevCtx: null,
      injectedSkills: new Map(),
    };
    setChatScopeState(ws, scope, state);
  }

  // Full stage framing on the first turn of the persistent session; bare
  // text after (the session remembers). Non-stdio backends have no
  // cross-turn memory, so they get the framing every time (M27.2 rule).
  const firstTurn = backend.id !== "claude-stdio" || !state.prevCtx;
  const prompt = firstTurn
    ? buildStagePrompt({
        userText,
        itemId,
        description: plan.description,
        items: plan.items.map((i) => ({
          id: i.id, capability: i.capability, needs: i.needs, status: i.status, groundedIn: i.groundedIn,
        })),
      })
    : userText;
  state.prevCtx = { activeFile: null, projectFiles: [], node: null, thread: null };

  let assistantText = "";
  try {
    for await (const ev of state.session.sendTurn(prompt)) {
      if (ev.type === "token") assistantText += ev.delta;
      forwardChatEvent(ev, ws, scope);
    }
  } catch (err: any) {
    fail(`Stage dialogue backend (${backend.id}) failed: ${err?.message ?? err}`);
    return;
  }

  const rev = parseReviseStageBlock(assistantText);
  if (rev) {
    const dryRun = applyItemRevision(plan, itemId, rev);
    ws.send(JSON.stringify({
      type: "build-plan-item-revision",
      payload: dryRun.ok
        ? { itemId, ok: true, revised: { capability: dryRun.item.capability, needs: dryRun.item.needs } }
        : { itemId, ok: false, error: dryRun.error },
    }));
  }
}

// Dialog closed → drop the scoped session (and its child) immediately.
function handleStageChatClose(itemId: string, ws: WebSocket): void {
  disposeChatScope(ws, `stage:${itemId}`);
}

// Apply a revision to the RATIFIED roadmap (the server-persisted artifact).
// A pending (unratified) proposal lives client-side only — the webview
// applies those locally and never calls this.
function handleBuildPlanItemModify(itemId: string, revision: unknown, ws: WebSocket): void {
  const fail = (error: string) =>
    ws.send(JSON.stringify({ type: "build-plan-item-modified", payload: { ok: false, itemId, error } }));
  const rev = revision as { capability?: unknown; needs?: unknown };
  if (
    typeof revision !== "object" || revision === null
    || (rev.capability !== undefined && typeof rev.capability !== "string")
    || (rev.needs !== undefined && (!Array.isArray(rev.needs) || rev.needs.some((n) => typeof n !== "string")))
  ) { fail("malformed revision"); return; }
  const plan = getBuildPlan();
  if (!plan) { fail("no ratified roadmap to modify"); return; }
  const res = applyItemRevision(plan, itemId, rev as { capability?: string; needs?: string[] });
  if (!res.ok) { fail(res.error); return; }
  const persisted = persistBuildPlan(analyzedRoot(), res.plan);
  if (persisted.error || !persisted.plan) { fail(persisted.error ?? "persist failed"); return; }
  buildPlan = persisted.plan;
  try { buildPlanMtime = fs.statSync(persisted.path!).mtimeMs; } catch { /* re-read next */ }
  ws.send(JSON.stringify({ type: "build-plan-item-modified", payload: { ok: true, itemId } }));
  broadcastProjectUpdate(); // the roadmap rows re-render from the envelope
}

// ── Analyze handler (M7 wave 2) ──────────────────────────────────────────────
// Spawns `claude -p` against the user's Claude Code subscription with a
// tight system prompt.

async function handleAnalyzeFile(filePath: string | undefined, ws: WebSocket): Promise<void> {
  if (!claudeCliAvailable) {
    ws.send(JSON.stringify({
      type: "analyze-error",
      payload: { message: "claude CLI not found on PATH. Install Claude Code to use Analyze." },
    }));
    return;
  }
  const target = filePath ?? (isDirectory ? null : resolvedPyFile);
  if (!target) {
    ws.send(JSON.stringify({ type: "analyze-error", payload: { message: "No file to analyze. Open a file first." } }));
    return;
  }
  let fileContent: string;
  try {
    fileContent = fs.readFileSync(target, "utf-8");
  } catch (err: any) {
    ws.send(JSON.stringify({ type: "analyze-error", payload: { message: `Cannot read file: ${err.message}` } }));
    return;
  }

  const prompt = [
    "Describe this Python script in 2 to 4 short sentences of plain prose.",
    "Cover: (1) overall purpose, (2) the main thing it does, (3) any notable patterns or libraries used.",
    "End with one sentence on the script's 'vibe' (e.g. 'feels like a quick prototype', 'production-grade', 'classic OOP', 'data pipeline', 'CLI tool', 'experimental').",
    "No bullet points, no headers, no code blocks. Just prose.",
    "",
    `File: ${target}`,
    "",
    "Source:",
    "```python",
    fileContent,
    "```",
  ].join("\n");

  // gen-cwd-fix: run in the analyzed project, fail honestly if it's gone.
  const opts = genSpawnOptions();
  if (!opts) {
    ws.send(JSON.stringify({ type: "analyze-error", payload: { message: "Analyzed project root is unreachable." } }));
    return;
  }
  // No MCP tools needed for Analyze -- it's pure text generation.
  // (CLI-drift note: see _runIntentLlm — mcpServers record + `--`.)
  // Model tier: routine — a prose summary of one file. Also the last
  // hardcoded "claude" in the codebase; VG_CLAUDE_BIN now covers every
  // headless path without exception.
  const { cmd, args: pre } = resolveClaudeBin("routine");
  const child = spawn(
    cmd,
    [
      ...pre,
      "-p",
      "--output-format", "json",
      "--strict-mcp-config",
      "--mcp-config", '{"mcpServers":{}}',
      "--dangerously-skip-permissions",
      "--",
      prompt,
    ],
    opts,
  );

  let stdoutBuf = "";
  let stderrBuf = "";
  child.stdout.on("data", (b) => { stdoutBuf += b.toString(); });
  child.stderr.on("data", (b) => { stderrBuf += b.toString(); });
  child.on("close", (code) => {
    if (code !== 0) {
      const firstLine = stderrBuf.split("\n").find((l) => l.trim()) ?? `exit ${code}`;
      ws.send(JSON.stringify({
        type: "analyze-error",
        payload: { message: `claude exited ${code}: ${firstLine}` },
      }));
      return;
    }
    try {
      const parsed = JSON.parse(stdoutBuf);
      const summary = typeof parsed.result === "string" ? parsed.result.trim() : "(empty response)";
      ws.send(JSON.stringify({
        type: "analyze-result",
        payload: { filePath: target, summary: summary || "(empty response)" },
      }));
    } catch (e: any) {
      ws.send(JSON.stringify({ type: "analyze-error", payload: { message: `Could not parse claude output: ${e.message}` } }));
    }
  });
  child.on("error", (err: any) => {
    ws.send(JSON.stringify({
      type: "analyze-error",
      payload: { message: `Could not spawn claude: ${err.message}. Is Claude Code installed?` },
    }));
  });
}

// ── Run handler ───────────────────────────────────────────────────────────────

function findParentForLoop(nodeId: string): any | null {
  if (!lastParse) return null;
  const edge = lastParse.edges.find((e: any) => e.target === nodeId && e.type === "contains");
  if (edge) return lastParse.nodes.find((n: any) => n.id === edge.source) || null;
  return null;
}

// M7 wave 1 — extracted body so the MCP `vibegraph_run_block` tool
// can invoke run_block.py without going through the WebSocket.
function runBlockCore(
  nodeId: string,
  filePath?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    let node = findNode(nodeId, filePath);
    if (!node) {
      resolve({ stdout: "", stderr: "Node not found", exitCode: 1 });
      return;
    }
    if (node.type === "print_call") {
      const parent = findParentForLoop(nodeId);
      if (parent) node = parent;
    }
    const runFile = findNodeFile(node.id) ?? filePath ?? resolvedPyFile;
    const runStart = node.line ?? node.lineno;
    const runEnd = node.endLine ?? node.endLineno;
    execFile(
      "python3",
      [RUN_BLOCK_SCRIPT, runFile, String(runStart), String(runEnd)],
      { timeout: 15000 },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          resolve({ stdout: "", stderr: stderr || err.message, exitCode: 1 });
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          resolve({ stdout: parsed.stdout ?? "", stderr: parsed.stderr ?? "", exitCode: parsed.exitCode ?? 0 });
        } catch {
          resolve({ stdout: stdout || "", stderr: "Failed to parse run output", exitCode: 1 });
        }
      }
    );
  });
}

function handleRun(nodeId: string, ws: WebSocket, filePath?: string): void {
  // M6 wave 1 — accept filePath so project-mode runs land on the right
  // file. findNode falls back to the whole-project search when filePath
  // is undefined, so legacy single-file callers still work.
  runBlockCore(nodeId, filePath).then((result) => {
    ws.send(JSON.stringify({ type: "run-output", payload: { nodeId, ...result } }));
  });
}

// ── M-RUN SM1: thread test-run ("run to this node") ──────────────────────────
//
// Execute the real path through node N's enclosing function up to and including
// N, capture N's value, return it with provenance. EPHEMERAL by construction:
// the probe is injected via two diff-confined CST ops run with --dry-run (the
// real file is NEVER written), the patched source goes to a temp file, we run
// THAT, and unlink it. Clean-tree holds by construction. Claude is not in this
// loop — the client computes exprN/entryFn (judgment-lite) and the pre-gate.
//
// The analyzed-project environment is the real risk, not args: we run with
// cwd + PYTHONPATH set to the analyzed project root so the file's own module +
// siblings resolve; a missing third-party dep fails honestly (import-error),
// never a silent "no output". v1.0 = no-arg, confidently-pure paths only.

const _VG_IDENT = /^[A-Za-z_][A-Za-z0-9_.]*$/; // exprN / entryFn must be a plain name

interface ThreadRunResult {
  outcome: string;          // ok | probe-not-reached | import-error | runtime-error
                            // | timeout | stop-not-enforced | value-opaque | value-ambiguous
                            // | unsupported-target | requires-confirmation | harness-error
  value: string | null;     // repr() of the value at N
  valueOpaque: boolean;     // repr was non-deterministic (memory address)
  provenance: "real-input" | "synthesized-input";
  synthArgs?: string | null;        // SM2 — the synthesized call string, when synth
  effects?: EffectOffense[];        // SM3 — detected effects on a requires-confirmation
  effectConsentToken?: string | null; // SM3 — scope-bound token to confirm the run
  stdout: string;
  stderr: string;
  error?: string;           // assembly/harness error detail (not user stderr)
}

// The analyzed project's root — what executed code should see as cwd/PYTHONPATH.
function analyzedRoot(): string {
  return isDirectory ? inputPath : path.dirname(resolvedPyFile);
}

// gen-cwd-fix Steps 1+2 — ONE source of truth for the `claude -p` generation
// spawns (README / thread-skill / explain / thread-agent / intent / analyze).
// They must run in the ANALYZED project root so the gen agent grounds in the
// USER's files, not VibeGraph's own repo (the bug Plan-v6 verification found:
// cwd: PROJECT_ROOT pointed every gen path at VibeGraph). Returns null if the
// root is unreachable (project moved/deleted mid-session) so callers FAIL
// LOUDLY without spawning or persisting — never a silent fallback to
// VibeGraph's root. The run-to-node core (analyzedRoot() + PYTHONPATH) is the
// precedent this generalises.
function genSpawnOptions(): { cwd: string; env: NodeJS.ProcessEnv } | null {
  const cwd = analyzedRoot();
  if (!fs.existsSync(cwd)) return null;
  return { cwd, env: { ...process.env } };
}

// The live IR's full node-id universe — every id the parser emitted across the
// analyzed project (directory) or the single file. Shared by A3 citation
// validation and the gen-cwd-fix grounding gate.
function allKnownNodeIds(): Set<string> {
  const known = new Set<string>();
  if (isDirectory) {
    for (const data of Object.values(projectParse)) {
      for (const n of (data as any).nodes ?? []) known.add(n.id);
    }
  } else if (lastParse) {
    for (const n of lastParse.nodes) known.add(n.id);
  }
  return known;
}

// M-RUN SM3 floor — the AUTHORITATIVE side-effect verdict. Re-derives
// effects from the server's own projectParse (never the client's purity
// claim), interprocedurally, via scripts/scan_effects.py. Returns null if
// the path from N's enclosing function up to N is confidently pure, or an
// honest refusal reason otherwise. The client's planRunToNode purity check
// (runToNode.ts) is advisory UX only; THIS is the gate that decides.
function scanEffectsToNode(
  nodeId: string,
  filePath: string | undefined,
): Promise<{ pure: boolean; offenses: EffectOffense[]; reason: string }> {
  return new Promise((resolve) => {
    // Same relative-keyed project IR view the thread extractor consumes
    // (extractThreadCore) — one keyspace, resolved via relativize().
    // MUST be relativeProjectFiles(), not a bare key remap: edge.targetFile
    // is absolute in projectParse, and an unmatched targetFile makes the
    // scanner treat the whole cross-file leg as external — no gate.
    const projectIR: Record<string, unknown> = {};
    let stopFile = filePath ?? resolvedPyFile;
    if (isDirectory) {
      Object.assign(projectIR, relativeProjectFiles());
      if (path.isAbsolute(stopFile)) stopFile = relativize(stopFile);
    } else if (lastParse) {
      projectIR[resolvedPyFile] = lastParse;
      stopFile = resolvedPyFile;
    }
    const fail = (reason: string) => resolve({ pure: false, offenses: [], reason });
    if (!projectIR[stopFile]) {
      // Fail SAFE: if we can't even locate the IR, refuse rather than run.
      fail(`cannot scan effects: ${stopFile} not in project IR`);
      return;
    }
    // --list-effects: the FULL offense set (for informed consent), not just
    // the first. A scan failure stays fail-safe (refuse, empty list).
    const child = spawn("python3", [SCAN_EFFECTS_SCRIPT, "--stop-file", stopFile, "--stop-id", nodeId, "--list-effects"],
      { stdio: ["pipe", "pipe", "pipe"], env: pythonEnv() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", (code) => {
      if (code !== 0) {
        const first = stderr.split("\n").find((l) => l.trim().length > 0) ?? "unknown error";
        fail(`effect scan failed (exit ${code}): ${first}`);
        return;
      }
      try {
        const v = JSON.parse(stdout);
        const offenses: EffectOffense[] = Array.isArray(v.offenses) ? v.offenses : [];
        const reason = offenses.length === 0 ? "confidently pure path"
          : offenses.map((o) => o.kind === "effect" ? `${o.effectKind} effect: ${o.target} (${o.file}:${o.line})`
              : `${o.kind} call: ${o.target} (${o.file}:${o.line})`).join("; ");
        resolve({ pure: !!v.pure, offenses, reason });
      } catch {
        fail("could not parse effect-scan output");
      }
    });
    child.stdin.write(JSON.stringify({ files: projectIR }));
    child.stdin.end();
  });
}

// M-RUN2.1 — the CONSTRUCTOR side of the floor. A synthesized-instance run
// executes `ClassName(...)` before the method, so `__init__`'s whole path
// must be scanned too (seed-mode, unbounded, interprocedural — a ctor that
// opens a socket gates like any other effect). No `__init__` in the file's
// IR = no constructor code to scan (object.__init__ is a no-op).
function scanConstructorEffects(
  className: string,
  filePath: string | undefined,
): Promise<{ pure: boolean; offenses: EffectOffense[]; reason: string }> {
  return new Promise((resolve) => {
    const projectIR: Record<string, any> = {};
    let seedFile = filePath ?? resolvedPyFile;
    if (isDirectory) {
      // relativeProjectFiles() so edge.targetFile relativizes with the keys
      // (same floor-bypass trap as scanEffectsToNode).
      Object.assign(projectIR, relativeProjectFiles());
      if (path.isAbsolute(seedFile)) seedFile = relativize(seedFile);
    } else if (lastParse) {
      projectIR[resolvedPyFile] = lastParse;
      seedFile = resolvedPyFile;
    }
    const fail = (reason: string) => resolve({ pure: false, offenses: [], reason });
    const ir = projectIR[seedFile];
    if (!ir) { fail(`cannot scan constructor: ${seedFile} not in project IR`); return; }
    const nodes: any[] = ir.nodes ?? [];
    const cls = nodes.find((n) => n.type === "class_def" && n.name === className);
    if (!cls) { fail(`cannot scan constructor: class ${className} not in ${seedFile}`); return; }
    const init = nodes.find((n) => n.type === "function_def" && n.name === "__init__" && n.parentId === cls.id);
    if (!init) { resolve({ pure: true, offenses: [], reason: "no __init__ — default constructor" }); return; }

    const child = spawn("python3", [SCAN_EFFECTS_SCRIPT, "--seed-file", seedFile, "--seed-id", init.id, "--list-effects"],
      { stdio: ["pipe", "pipe", "pipe"], env: pythonEnv() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", (code) => {
      if (code !== 0) {
        const first = stderr.split("\n").find((l) => l.trim().length > 0) ?? "unknown error";
        fail(`constructor effect scan failed (exit ${code}): ${first}`);
        return;
      }
      try {
        const v = JSON.parse(stdout);
        const offenses: EffectOffense[] = Array.isArray(v.offenses) ? v.offenses : [];
        const reason = offenses.length === 0 ? "confidently pure constructor"
          : offenses.map((o) => o.kind === "effect" ? `${o.effectKind} effect: ${o.target} (${o.file}:${o.line})`
              : `${o.kind} call: ${o.target} (${o.file}:${o.line})`).join("; ");
        resolve({ pure: !!v.pure, offenses, reason });
      } catch {
        fail("could not parse constructor effect-scan output");
      }
    });
    child.stdin.write(JSON.stringify({ files: projectIR }));
    child.stdin.end();
  });
}

// M-RUN2.1 — the run's whole floor: the method path up to N plus (for a
// synthesized-instance run) the constructor path. Offenses merge into ONE
// canonical set so a consent token binds to everything the run would
// execute — mint and verify both use this, so scopes can't drift.
async function scanEffectsForRun(
  nodeId: string,
  filePath: string | undefined,
  className?: string,
): Promise<{ pure: boolean; offenses: EffectOffense[]; reason: string }> {
  const main = await scanEffectsToNode(nodeId, filePath);
  if (!className) return main;
  const ctor = await scanConstructorEffects(className, filePath);
  const seen = new Set<string>();
  const offenses = [...main.offenses, ...ctor.offenses].filter((o) => {
    const k = `${o.kind}|${o.effectKind ?? ""}|${o.target}|${o.file}|${o.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Fail-safe composition: a scan failure on EITHER side (pure:false with
  // no offenses) keeps the run refused with the honest reason.
  const pure = main.pure && ctor.pure;
  const reason = pure ? "confidently pure path"
    : [main.pure ? null : main.reason, ctor.pure ? null : `constructor: ${ctor.reason}`]
        .filter(Boolean).join("; ");
  return { pure, offenses, reason };
}

// M-RUN2.1 — instance-construction validation at the injection boundary
// (check_literals --mode instance): exactly `ClassName(<literal kwargs>)`.
function _validateInstance(className: string, args: Record<string, string>): Promise<{ ok: boolean; call: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("python3", [CHECK_LITERALS_SCRIPT, "--mode", "instance"],
      { stdio: ["pipe", "pipe", "pipe"], env: pythonEnv() });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => { out += b.toString(); });
    child.stderr.on("data", (b) => { err += b.toString(); });
    child.on("close", (code) => {
      if (code !== 0) { resolve({ ok: false, call: "", error: `check_literals exit ${code}: ${err.slice(0, 200)}` }); return; }
      try {
        const r = JSON.parse(out);
        const reasons = (r.rejected ?? []).map((x: any) => `${x.param ?? "class"}: ${x.reason}`).join("; ");
        resolve({ ok: !!r.ok, call: r.call ?? "", error: r.ok ? undefined : `rejected instance: ${reasons}` });
      } catch {
        resolve({ ok: false, call: "", error: "could not parse check_literals output" });
      }
    });
    child.stdin.write(JSON.stringify({ class: className, args }));
    child.stdin.end();
  });
}

// M-RUN2.3 — read one source line (1-indexed) of a project-relative file,
// for the missing-data detector. Read-only; never trusts the path outward.
function _readSourceLine(file: string, line: number): string | null {
  try {
    const rel = safeRelPath(analyzedRoot(), file);
    if (!rel) return null;
    const src = fs.readFileSync(path.join(analyzedRoot(), rel), "utf-8");
    return src.split("\n")[line - 1] ?? null;
  } catch {
    return null;
  }
}

// M-TRAINED.1 — the artifact index over the live envelope (trained-ness as
// artifact state). Recomputed on demand: it is a cheap lexical pass over the
// in-memory IR plus a handful of stats, and staleness must reflect the disk
// NOW, not a cached parse.
function _statProjectFile(rel: string): { exists: boolean; mtimeMs: number | null } {
  try {
    const s = fs.statSync(path.join(analyzedRoot(), rel));
    return { exists: true, mtimeMs: s.mtimeMs };
  } catch {
    return { exists: false, mtimeMs: null };
  }
}

// Artifact paths seen by the most recent index, so the watcher can recognise
// a write to one WITHOUT recomputing on every unrelated file event. Populated
// on each compute (boot, thread open, re-parse) — and an artifact is listed
// whether or not it exists yet, since the paths come from the code that
// writes them, not from disk.
const knownArtifactPaths = new Set<string>();

function computeArtifactIndex(): ArtifactRecord[] {
  const files = isDirectory
    ? (relativeProjectFiles() as Record<string, { nodes?: unknown[] }>)
    : lastParse
      ? { [path.basename(resolvedPyFile ?? "")]: lastParse as { nodes?: unknown[] } }
      : {};
  const records = buildArtifactIndex({
    threads: latestThreads as never[],
    files,
    statFile: _statProjectFile,
  });
  knownArtifactPaths.clear();
  for (const r of records) knownArtifactPaths.add(r.path);
  return records;
}

/** Does this watcher filename name an artifact we track? Compared on the
 *  normalised relative path (fs.watch reports paths relative to the watch
 *  root, with platform separators). */
function isKnownArtifactPath(filename: string): boolean {
  const rel = filename.split(path.sep).join("/");
  if (knownArtifactPaths.has(rel)) return true;
  // A record path may be written relative to a subdirectory ("model.pt" for
  // a producer that runs with cwd inside the project).
  for (const p of knownArtifactPaths) {
    if (rel === p || rel.endsWith(`/${p}`)) return true;
  }
  return false;
}

// M-TRAINED.2 follow-up (2026-07-30). The artifact chip exists to report the
// trained/untrained seam — and the event that FLIPS that seam, the artifact
// being written, is not a `.py` change. The watcher dropped it, and the
// client only re-asks for the index when the entry-point set changes (i.e.
// after a re-parse), so a chip could sit on a verdict computed BEFORE the
// training run: `model.pt` genuinely stale at 14:58 when train.py was edited,
// rewritten at 15:00, and still painted "stale" afterwards because nothing
// re-checked. Re-index and push on an artifact write. No re-parse — the IR
// did not change, only the file on disk did.
let artifactIndexTimer: NodeJS.Timeout | null = null;
function refreshArtifactIndex(): void {
  if (artifactIndexTimer) clearTimeout(artifactIndexTimer);
  // Debounced: a producer may write in bursts, and mid-write stats are
  // worthless. The IR is untouched, so this is a stat sweep, not a parse.
  artifactIndexTimer = setTimeout(() => {
    artifactIndexTimer = null;
    if (clients.size === 0) return;
    const msg = JSON.stringify({
      type: "artifact-index", payload: { artifacts: computeArtifactIndex() },
    });
    for (const c of clients) c.send(msg);
  }, 250);
}

// SM2.a chokepoint at the INJECTION BOUNDARY. Synthesized args become
// executed source, so whatever reaches the scaffold — no matter which path
// supplied it — is re-validated here through scripts/check_literals.py
// (libcst literal-only allowlist). Returns the assembled keyword-arg call
// string, or an error. Defense-in-depth: the phase-1 proposal already
// validated, but the server never injects an unvalidated string.
function _validateLiterals(args: Record<string, string>): Promise<{ ok: boolean; call: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("python3", [CHECK_LITERALS_SCRIPT],
      { stdio: ["pipe", "pipe", "pipe"], env: pythonEnv() });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => { out += b.toString(); });
    child.stderr.on("data", (b) => { err += b.toString(); });
    child.on("close", (code) => {
      if (code !== 0) { resolve({ ok: false, call: "", error: `check_literals exit ${code}: ${err.slice(0, 200)}` }); return; }
      try {
        const r = JSON.parse(out);
        const reasons = (r.rejected ?? []).map((x: any) => `${x.param}: ${x.reason}`).join("; ");
        resolve({ ok: !!r.ok, call: r.call ?? "", error: r.ok ? undefined : `rejected args: ${reasons}` });
      } catch {
        resolve({ ok: false, call: "", error: "could not parse check_literals output" });
      }
    });
    child.stdin.write(JSON.stringify({ args }));
    child.stdin.end();
  });
}

function runThreadToNodeCore(
  nodeId: string,
  filePath: string | undefined,
  entryFn: string,
  exprN: string,
  synthArgs?: Record<string, string>,
  effectConsent?: string,
  // B2 — optional ephemeral upstream override: re-bind `${assignment}` (a
  // pre-validated `<lhs> = <literal>`) right after override.nodeId.
  override?: { nodeId: string; assignment: string },
  // M-RUN2.1 — synthesized example instance for a METHOD run: the entry
  // becomes `_vg_obj = ClassName(<args>); _vg_obj.<entryFn>(<callArgs>)`.
  synthInstance?: { className: string; args: Record<string, string> },
  // M-RUN2.3 — a consented example data file, written into the run SANDBOX
  // only. `consent` is the content-hash-bound token from the data proposal.
  synthData?: { path: string; content: string; consent?: string },
  // Sitting-2 — echo of a gate's trustUnverifiedToken: grants the session-wide
  // "stop asking about unverifiable calls" before this run's gating is applied.
  trustUnverified?: string,
): Promise<ThreadRunResult> {
  const synth = synthArgs !== undefined;
  // An override run is a made-up premise too — never labelled real-input.
  const overridden = override !== undefined;
  const provenance: "real-input" | "synthesized-input" =
    (synth || overridden || synthInstance || synthData) ? "synthesized-input" : "real-input";
  const fail = (outcome: string, error: string, extra?: Partial<ThreadRunResult>): ThreadRunResult => ({
    outcome, value: null, valueOpaque: false, provenance,
    stdout: "", stderr: "", error, ...extra,
  });
  return (async () => {
    // Light server-side validation — exprN/entryFn are code we inject, so they
    // must be plain names (the client derives them from the IR).
    if (!_VG_IDENT.test(entryFn)) return fail("harness-error", `unsafe entryFn: ${entryFn}`);
    if (!_VG_IDENT.test(exprN)) return fail("value-ambiguous", `non-trivial value expr: ${exprN}`);
    const node = findNode(nodeId, filePath);
    if (!node) return fail("harness-error", `Node not found: ${nodeId}`);
    const file = findNodeFile(nodeId) ?? filePath ?? resolvedPyFile;

    // SM3 FLOOR — authoritative server-side side-effect scan. Re-derives
    // purity interprocedurally from the server's own IR; does NOT trust the
    // client's pre-gate. Runs for BOTH real-input and synthesized-input runs:
    // synthesized inputs change the runtime path but never the statically-
    // scanned set, so the floor stays sound and is NOT relaxed for SM2.
    // M-RUN2.1 — an instance run's floor covers the constructor path too.
    const verdict = await scanEffectsForRun(nodeId, filePath, synthInstance?.className);
    if (!verdict.pure) {
      // Sitting-2 — a trust echo grants the session category-trust first,
      // verified against THIS fresh scan's still-gated set (a code change
      // between gate and grant invalidates it, like every consent). The scan
      // output itself is never filtered — the floor stays intact; trust only
      // decides which offenses still GATE.
      if (trustUnverified) grantUnverifiedTrust(nodeId, gatedOffenses(verdict.offenses), trustUnverified);
      const gated = gatedOffenses(verdict.offenses);
      // SM3 gate. A run past the floor needs an explicit, scope-bound consent
      // token re-validated against THIS fresh scan (don't-trust-client applied
      // to consent: a stale/blanket/tampered token is rejected, and the user
      // re-consents to the new effect set). Without valid consent, refuse and
      // hand back the detected effects + a freshly minted token to confirm.
      if (gated.length && !verifyEffectConsent(nodeId, gated, effectConsent)) {
        // M-RUN2.3 — while refusing, check whether any fs offense reads a
        // string-literal data path that doesn't exist: the gate can then
        // OFFER drafting an example file (detection only; nothing runs).
        const missingData = detectMissingDataFiles(verdict.offenses, analyzedRoot(), _readSourceLine);
        // M-TRAINED.3 — the artifact sibling: a missing artifact never gets
        // a drafting offer; it gets its PRODUCER thread named instead.
        const missingArtifacts = detectMissingArtifacts(
          verdict.offenses, computeArtifactIndex(), _readSourceLine, _statProjectFile,
        );
        return fail("requires-confirmation", verdict.reason, {
          effects: gated,
          effectConsentToken: mintEffectConsent(nodeId, gated),
          // Only when unverifiable calls are among what's gating: the
          // category-trust affordance token (proven effects never trust away).
          ...(gated.some(isTrustableOffense)
            ? { trustUnverifiedToken: mintUnverifiedTrust(nodeId, gated) }
            : {}),
          ...(missingData.length ? { missingData } : {}),
          ...(missingArtifacts.length ? { missingArtifacts } : {}),
        });
      }
      // Consent valid → fall through and run. Stop-at-N still bounds which
      // effects execute (only those up to N), and run_to_node.py reports the
      // program's honest outcome (incl. runtime-error if the consented path
      // raises) — that is the PROGRAM's behaviour, not a harness failure.
    }

    // SM2 — re-validate synthesized args at the injection boundary, then
    // assemble the call. callArgs is "" for the no-arg (real-input) path.
    let callArgs = "";
    if (synth) {
      const v = await _validateLiterals(synthArgs!);
      if (!v.ok) return fail("harness-error", `synthesized args failed validation: ${v.error}`);
      callArgs = v.call;
    }
    // M-RUN2.1 — re-validate the instance construction the same way; the
    // constructor call string comes ONLY from the chokepoint, never client text.
    let instanceCall = "";
    if (synthInstance) {
      const vi = await _validateInstance(synthInstance.className, synthInstance.args);
      if (!vi.ok) return fail("harness-error", `synthesized instance failed validation: ${vi.error}`);
      instanceCall = vi.call;
    }
    // M-RUN2.3 — an example data file must carry a consent token bound to
    // (this node + this path + THIS content). Edited/swapped content, a
    // path outside the project, or a stale token all refuse honestly.
    let dataRel: string | null = null;
    if (synthData) {
      dataRel = safeRelPath(analyzedRoot(), synthData.path);
      if (!dataRel) return fail("harness-error", `example-file path escapes the project: ${synthData.path}`);
      if (!verifyDataConsent(nodeId, dataRel, synthData.content, synthData.consent)) {
        return fail("requires-confirmation",
          "example-file consent invalid or stale — re-request the draft and confirm it again");
      }
    }

    const temps: string[] = [];
    try {
      // 1a. (B2) optional UPSTREAM OVERRIDE — insert `<lhs> = <literal>` right
      //     AFTER override.nodeId, on a temp copy, so the downstream run to N
      //     sees the override. The SM3 floor above already scanned + gated the
      //     real path's effects up to N, and `assignment` is a
      //     check_literals-validated literal — so this cannot smuggle in an
      //     effect or arbitrary code. Same diff-confined op_insert_after path.
      let probeBase = file;
      if (override) {
        const ro = await _dryRunRewrite([file, "insert_after", override.nodeId], override.assignment);
        if (ro.error || !ro.source) {
          return fail("unsupported-target", ro.error || "override insert produced no source");
        }
        const ovrTmp = path.join(os.tmpdir(), `vg-ovr-${process.pid}-${Date.now()}.py`);
        fs.writeFileSync(ovrTmp, ro.source, "utf-8");
        temps.push(ovrTmp);
        probeBase = ovrTmp;
      }

      // 1b. Probe. An assignment gets the classic insert-after probe (reads
      //     its LHS name); a return / bare-call statement has no name, so
      //     M-RUN3 rewrites it in the TEMP COPY via capture_probe — the value
      //     is REAL, only the holding variable is synthetic. The shape
      //     decision comes from the SERVER's IR (never the client), and both
      //     paths run the same diff-confined pipeline (never --no-diff).
      const captureShape = node.type === "return_stmt" || node.type === "call";
      const r1 = captureShape
        ? await _dryRunRewrite([probeBase, "capture_probe", nodeId, "__vg_value"])
        : await _dryRunRewrite(
            [probeBase, "insert_after", nodeId],
            // JSON-encoded so a multi-line repr survives run_to_node's
            // line-based marker scan intact (see _CAPTURE_PROBE_TEMPLATE).
            `print("__VG__::" + __import__("json").dumps(repr(${exprN})))\nraise _VGStop()`,
          );
      if (r1.error || !r1.source) {
        // insert_after only rebuilds Module/IndentedBlock bodies — a target inside
        // an else/try clause won't match (honest decline, deferred fix).
        return fail("unsupported-target", r1.error || "probe rewrite produced no source");
      }

      const tmp = path.join(os.tmpdir(), `vg-run-${process.pid}-${Date.now()}.py`);
      temps.push(tmp);
      // 2. Append the _VGStop class + the entry-call scaffold via the
      //    append-only-confined op_append_end, on the probed source.
      fs.writeFileSync(tmp, r1.source, "utf-8");
      // M-RUN2.1 — an instance run constructs the example object first, then
      // calls the method on it; both strings are chokepoint-validated.
      const entryCall = synthInstance
        ? `_vg_obj = ${instanceCall}\n    _vg_obj.${entryFn}(${callArgs})`
        : `${entryFn}(${callArgs})`;
      const scaffold =
        `\n\nclass _VGStop(BaseException):\n    pass\n\n\n` +
        `try:\n    ${entryCall}\n    print("__VG_DONE__")\nexcept _VGStop:\n    pass\n`;
      const r2 = await _dryRunRewrite([tmp, "append_end"], scaffold);
      if (r2.error || !r2.source) return fail("harness-error", r2.error || "append_end produced no source");
      fs.writeFileSync(tmp, r2.source, "utf-8");

      // 3. Run the fully-patched temp module in the analyzed project's env.
      // M-RUN2.2 — a run whose premise includes a synthesized artifact beyond
      // literal args (an example instance) executes in a THROWAWAY COPY of
      // the project: consent means "run it", never "run it on my real files".
      // Plain runs keep the fast in-place path (clean-tree separately proven).
      const sandbox = (synthInstance || synthData) ? makeRunSandbox(analyzedRoot()) : null;
      const runRoot = sandbox?.root ?? analyzedRoot();
      // M-RUN2.3 — the consented example file exists ONLY in the sandbox.
      if (synthData && dataRel && sandbox) {
        const dst = path.join(sandbox.root, dataRel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, synthData.content, "utf-8");
      }
      const env = pythonEnv();
      env.PYTHONPATH = `${runRoot}:${env.PYTHONPATH ?? ""}`;
      const raw = await new Promise<string>((resolve) => {
        execFile("python3", [RUN_TO_NODE_SCRIPT, tmp],
          { cwd: runRoot, env, timeout: 15000 },
          (err, stdout) => resolve(stdout || (err ? `{"outcome":"harness-error","error":${JSON.stringify(err.message)}}` : "")),
        );
      }).finally(() => sandbox?.dispose());
      try {
        const r = JSON.parse(raw);
        // M-RUN2.3 post-run tier: a FileNotFoundError naming a project path
        // → offer drafting an example file on the result card. Catches
        // non-literal paths the pre-run tier can't see — honestly, after.
        const fnfPath = r.outcome === "runtime-error"
          ? missingPathFromStderr(r.stderr ?? "", analyzedRoot())
          : null;
        return {
          outcome: r.outcome ?? "harness-error",
          value: r.value ?? null,
          valueOpaque: !!r.valueOpaque,
          provenance,
          synthArgs: synth ? callArgs : null,
          synthInstance: synthInstance ? instanceCall : null,
          synthData: synthData && dataRel
            ? `${dataRel} (${synthData.content.split("\n").length - 1} lines)`
            : null,
          sandboxed: !!sandbox,
          // M-TRAINED.3 — an artifact-shaped FNF path is never a drafting
          // offer: name the producer thread instead (empty producers when
          // none is known — honest, not silent).
          ...(fnfPath && !isArtifactPath(fnfPath)
            ? { missingData: [{ path: fnfPath, file: "", line: 0 }] }
            : {}),
          ...(fnfPath && isArtifactPath(fnfPath)
            ? { missingArtifacts: [missingArtifactFor(computeArtifactIndex(), fnfPath)] }
            : {}),
          stdout: r.stdout ?? "",
          stderr: r.stderr ?? "",
          error: r.error,
        };
      } catch {
        return fail("harness-error", "could not parse run_to_node output");
      }
    } finally {
      for (const t of temps) { try { fs.unlinkSync(t); } catch { /* ignore */ } }
    }
  })();
}

// B1 (PLAN-v6) — server-side resolution of a run-to-node target from an IR
// node id ALONE. Ports the IR-only gates of the client `planRunToNode`
// (src/webview/threads/runToNode.ts) so the MCP tool can take just a node id
// and the SERVER derives entryFn/exprN — the don't-trust-the-client posture
// the SM3 floor already takes (the agent's derivation is never trusted).
//
// The thread-edge resolution the client does (thread node -> call-site assign)
// is deliberately NOT needed here: an MCP agent addresses the call-site
// `assignment` node directly (the value-of-interest), so N is already that node.
// Effect purity is NOT decided here — that stays with the authoritative floor
// inside runThreadToNodeCore. This is purely the IR-SHAPE gate.
type RunTargetResolution =
  | { ok: true; entryFn: string; exprN: string; needsSynth: boolean; className?: string }
  | { ok: false; outcome: string; reason: string };

const _RUN_IDENT = /^[A-Za-z_]\w*$/;

function resolveRunTarget(nodeId: string, filePath?: string): RunTargetResolution {
  const decline = (outcome: string, reason: string): RunTargetResolution => ({ ok: false, outcome, reason });

  // Locate the file's IR node list with the SAME resolution findNode uses.
  let nodes: any[] | null = null;
  if (isDirectory) {
    if (filePath) {
      nodes = projectParse[resolveProjectPath(filePath)]?.nodes ?? null;
    } else {
      for (const data of Object.values(projectParse)) {
        if ((data as any).nodes?.find((n: any) => n.id === nodeId)) { nodes = (data as any).nodes; break; }
      }
    }
  } else {
    nodes = lastParse?.nodes ?? null;
  }
  if (!nodes) return decline("unsupported-target", `file IR not found for ${nodeId}`);

  const byId = new Map<string, any>(nodes.map((n) => [n.id, n]));
  const N = byId.get(nodeId);
  if (!N) return decline("unsupported-target", `IR node not found: ${nodeId}`);

  // Enclosing function: walk parentId up to the nearest function_def.
  let fn: any;
  let cur: any = N;
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const p = byId.get(cur.parentId);
    if (p?.type === "function_def") { fn = p; break; }
    cur = p;
  }
  if (!fn?.name) return decline("unsupported-target", "node is not inside a function");

  // M-RUN2.1 — a method is runnable via a SYNTHESIZED example instance (the
  // class is same-file by construction of the parent walk). needsSynth is
  // forced: constructing the instance is itself a synthesis step.
  const fnParent = fn.parentId ? byId.get(fn.parentId) : undefined;
  let className: string | undefined;
  if (fnParent?.type === "class_def") {
    if (!fnParent.name || !_RUN_IDENT.test(fnParent.name)) {
      return decline("unsupported-target", "method's class has no usable name");
    }
    className = fnParent.name;
  }

  const params = ((fn.params ?? []) as string[]).filter((p) => p.trim() !== "self");
  const needsSynth = className !== undefined
    || params.some((p) => !p.includes("=") && !p.startsWith("*"));

  // Value-of-interest: a plain-identifier assignment LHS, or (Sitting-2 — this
  // resolver predated M-RUN3 and still declined the shapes the client planner
  // already accepts, so a METHOD return lost its class and ran as a bare
  // function) a return/bare-call statement routed through capture_probe.
  let exprN: string;
  if (N.type === "assignment" && N.name && _RUN_IDENT.test(N.name)) {
    exprN = N.name;
  } else if (N.type === "return_stmt" || N.type === "call") {
    exprN = "__vg_value";
  } else {
    return decline("value-ambiguous", "no plain-identifier value at this node");
  }
  return { ok: true, entryFn: fn.name, exprN, needsSynth, ...(className ? { className } : {}) };
}

// B5 (PLAN-v6) — resolve the enclosing module-level function of a node id
// (the entry to run). Lean cousin of resolveRunTarget without the
// value-of-interest gate (a dynamic call site is not an assignment).
function resolveEnclosingFn(
  nodeId: string,
  filePath?: string,
): { ok: true; entryFn: string } | { ok: false; outcome: string; reason: string } {
  const decline = (outcome: string, reason: string) => ({ ok: false as const, outcome, reason });
  let nodes: any[] | null = null;
  if (isDirectory) {
    if (filePath) nodes = projectParse[resolveProjectPath(filePath)]?.nodes ?? null;
    else for (const data of Object.values(projectParse)) {
      if ((data as any).nodes?.find((n: any) => n.id === nodeId)) { nodes = (data as any).nodes; break; }
    }
  } else {
    nodes = lastParse?.nodes ?? null;
  }
  if (!nodes) return decline("unsupported-target", `file IR not found for ${nodeId}`);
  const byId = new Map<string, any>(nodes.map((n) => [n.id, n]));
  if (!byId.has(nodeId)) return decline("unsupported-target", `IR node not found: ${nodeId}`);
  let fn: any;
  let cur: any = byId.get(nodeId);
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const p = byId.get(cur.parentId);
    if (p?.type === "function_def") { fn = p; break; }
    cur = p;
  }
  if (!fn?.name) return decline("unsupported-target", "node is not inside a function");
  const fnParent = fn.parentId ? byId.get(fn.parentId) : undefined;
  if (fnParent?.type === "class_def") return decline("unsupported-target", "method (needs an instance) — deferred");
  return { ok: true, entryFn: fn.name };
}

// B5 — run the enclosing function up to the dynamic call site and capture the
// receiver's runtime type (the actual dispatch target THIS run). Dedicated
// (not an overload of runThreadToNodeCore) so the proven run-to-node path is
// untouched. Inherits the SM3 floor + effect-consent: observing the receiver
// requires its binding code to run, so an effectful binding gates the same way.
function runObserveDynamicTarget(
  nodeId: string,
  filePath: string | undefined,
  entryFn: string,
  receiver: string,
  effectConsent?: string,
): Promise<DynamicObservation> {
  const fail = (outcome: string, error: string, extra?: Partial<DynamicObservation>): DynamicObservation => ({
    nodeId, outcome, observedTarget: null, note: OBSERVE_NOTE, provenance: "real-input", error, ...extra,
  });
  return (async () => {
    if (!_VG_IDENT.test(entryFn)) return fail("harness-error", `unsafe entryFn: ${entryFn}`);
    // receiver may be a dotted attribute (self.conn) but never a call — _VG_IDENT
    // allows letters/digits/_/. only, so `type(${receiver})` can't run arbitrary code.
    if (!_VG_IDENT.test(receiver)) return fail("value-ambiguous", `unsafe receiver expression: ${receiver}`);
    const node = findNode(nodeId, filePath);
    if (!node) return fail("harness-error", `Node not found: ${nodeId}`);
    const file = findNodeFile(nodeId) ?? filePath ?? resolvedPyFile;

    const verdict = await scanEffectsToNode(nodeId, filePath);
    if (!verdict.pure) {
      // Sitting-2 — the session category-trust applies here too (same gating
      // rules as the run path); the observe gate has no trust affordance of
      // its own, it just honours a grant made at a run/synth gate.
      const gated = gatedOffenses(verdict.offenses);
      if (gated.length && !verifyEffectConsent(nodeId, gated, effectConsent)) {
        return fail("requires-confirmation", verdict.reason, {
          effects: gated,
          effectConsentToken: mintEffectConsent(nodeId, gated),
        });
      }
    }

    const temps: string[] = [];
    try {
      // Probe inserted BEFORE the dynamic call: capture type(receiver), then stop.
      // Same JSON encoding as the other two probes — a type repr is always
      // single-line, but one wire contract beats two.
      const probe = `print("__VG__::" + __import__("json").dumps(repr(type(${receiver}))))\nraise _VGStop()`;
      const r1 = await _dryRunRewrite([file, "insert_before", nodeId], probe);
      if (r1.error || !r1.source) return fail("unsupported-target", r1.error || "insert_before produced no source");
      const tmp = path.join(os.tmpdir(), `vg-obs-${process.pid}-${Date.now()}.py`);
      temps.push(tmp);
      fs.writeFileSync(tmp, r1.source, "utf-8");
      const scaffold =
        `\n\nclass _VGStop(BaseException):\n    pass\n\n\n` +
        `try:\n    ${entryFn}()\n    print("__VG_DONE__")\nexcept _VGStop:\n    pass\n`;
      const r2 = await _dryRunRewrite([tmp, "append_end"], scaffold);
      if (r2.error || !r2.source) return fail("harness-error", r2.error || "append_end produced no source");
      fs.writeFileSync(tmp, r2.source, "utf-8");

      const env = pythonEnv();
      env.PYTHONPATH = `${analyzedRoot()}:${env.PYTHONPATH ?? ""}`;
      const raw = await new Promise<string>((resolve) => {
        execFile("python3", [RUN_TO_NODE_SCRIPT, tmp],
          { cwd: analyzedRoot(), env, timeout: 15000 },
          (err, stdout) => resolve(stdout || (err ? `{"outcome":"harness-error","error":${JSON.stringify(err.message)}}` : "")),
        );
      });
      try {
        const r = JSON.parse(raw);
        return {
          nodeId,
          outcome: r.outcome ?? "harness-error",
          observedTarget: r.outcome === "ok" ? (r.value ?? null) : null,
          note: OBSERVE_NOTE,
          provenance: "real-input" as const,
          error: r.error,
        };
      } catch {
        return fail("harness-error", "could not parse run_to_node output");
      }
    } finally {
      for (const t of temps) { try { fs.unlinkSync(t); } catch { /* ignore */ } }
    }
  })();
}

function handleRunThreadToNode(
  payload: { nodeId: string; irTargetId: string; filePath?: string; entryFn: string; exprN: string; synthArgs?: Record<string, string>; effectConsent?: string; trustUnverified?: string; synthInstanceArgs?: Record<string, string>; synthData?: { path: string; content: string; consent?: string } },
  ws: WebSocket,
): void {
  // irTargetId is the IR node the harness probes (the call-site assignment);
  // nodeId is only the routing key echoed back so the originating tooltip
  // matches the result. They differ for a resolved-call step node, which
  // renders under the callee id (see runToNode.ts / protocol comment).
  const irTargetId = payload.irTargetId ?? payload.nodeId;
  // M-RUN2.1 — the client never names the class: the server re-derives it
  // from the IR, so a forged className can't point the floor (or the
  // scaffold) at the wrong constructor. synthInstanceArgs only supplies the
  // constructor VALUES, which the instance chokepoint validates.
  let synthInstance: { className: string; args: Record<string, string> } | undefined;
  if (payload.synthInstanceArgs) {
    const resolved = resolveRunTarget(irTargetId, payload.filePath);
    if (!resolved.ok || !resolved.className) {
      ws.send(JSON.stringify({ type: "thread-run-result", payload: {
        nodeId: payload.nodeId, outcome: "unsupported-target", value: null, valueOpaque: false,
        provenance: "synthesized-input", stdout: "", stderr: "",
        error: "instance args supplied but the target is not a method",
      } }));
      return;
    }
    synthInstance = { className: resolved.className, args: payload.synthInstanceArgs };
  }
  // An arg-needing entry with no synthArgs is an honest needs-inputs decline,
  // not a TypeError surfaced as runtime-error. The MCP path already did this;
  // the WS path trusted the client's entryFn and skipped it, so a caller that
  // did not pre-check got an opaque traceback instead of the signal that says
  // "pass synthArgs". Same verdict on both paths now.
  if (payload.synthArgs === undefined) {
    const target = resolveRunTarget(irTargetId, payload.filePath);
    if (target.ok && target.needsSynth) {
      ws.send(JSON.stringify({ type: "thread-run-result", payload: {
        nodeId: payload.nodeId, outcome: "needs-inputs", value: null, valueOpaque: false,
        provenance: "real-input", stdout: "", stderr: "",
        error: target.className
          ? "method target — pass synthArgs for the method and synthInstanceArgs for the constructor (literal expressions)"
          : "entry function requires arguments — pass synthArgs (literal expressions)",
      } }));
      return;
    }
  }
  runThreadToNodeCore(irTargetId, payload.filePath, payload.entryFn, payload.exprN, payload.synthArgs, payload.effectConsent, undefined, synthInstance, payload.synthData, payload.trustUnverified)
    .then((result) => {
      ws.send(JSON.stringify({ type: "thread-run-result", payload: { nodeId: payload.nodeId, ...result } }));
    });
}

// SM2.c phase 1 — synthesize + validate args for an arg-needing entry
// function and PROPOSE them (no execution). The user confirms in the UI
// before phase 2 (handleRunThreadToNode with synthArgs) actually runs.
// SM3: the floor runs FIRST. A side-effectful path returns blockedByEffect
// with the detected effects + a consent token so the UI shows the SIDE-EFFECT
// consent (distinct from the synth consent). Once the user confirms that, the
// client re-calls with effectConsent; we validate it and only THEN synthesize
// — so the two consents stay strictly separate and sequential.
function handleSynthThreadArgs(
  payload: { nodeId: string; irTargetId: string; filePath?: string; entryFn: string; exprN: string; effectConsent?: string; trustUnverified?: string; className?: string },
  ws: WebSocket,
): void {
  // nodeId = routing key echoed to the tooltip; irTargetId = the IR node the
  // floor scans + whose enclosing function we read for the synth prompt.
  const { nodeId, filePath, entryFn, effectConsent, trustUnverified } = payload;
  const irTargetId = payload.irTargetId ?? nodeId;
  // M-RUN2.1 — never trust the client's class claim: re-derive from the IR.
  const resolved = resolveRunTarget(irTargetId, filePath);
  const className = resolved.ok ? resolved.className : undefined;
  const send = (p: any) => ws.send(JSON.stringify({ type: "thread-synth-proposal", payload: { nodeId, ...p } }));
  (async () => {
    if (!_VG_IDENT.test(entryFn)) { send({ ok: false, call: "", accepted: {}, rejected: [], error: `unsafe entryFn: ${entryFn}` }); return; }

    // Entry function source (with its signature/annotations) for the synth prompt.
    const file = findNodeFile(irTargetId) ?? filePath ?? resolvedPyFile;
    const fileData = isDirectory ? projectParse[file] : lastParse;
    const fnNode = _enclosingFunctionNode(findNode(irTargetId, filePath), fileData?.nodes ?? []);
    let fnSource = "";
    if (fnNode) {
      try { fnSource = getSourceSnippet(fnNode.line ?? fnNode.lineno, fnNode.endLine ?? fnNode.endLineno, filePath); } catch { /* ignore */ }
    }
    if (!fnSource) { send({ ok: false, call: "", accepted: {}, rejected: [], error: "could not read entry function source" }); return; }

    // Sitting-3 — decline BEFORE anything else when a required param is used as
    // a tensor/array: the literal synth can only make numbers/lists, never a
    // `torch.tensor(...)`, so a list arg would crash on `.mean(dim=...)` before
    // reaching the target (the pump-lab `fit_standardizer` symptom). This runs
    // AHEAD of the effect gate deliberately — fail fast on the fundamental
    // "can't seed this in isolation" rather than making the user consent to
    // effects for a run that can never work. Deterministic (arg_shape.ts,
    // lexical); a miss falls back to today's behaviour (synth + honest crash).
    const flaggedArrays = arraylikeParams(fnSource, fnNode?.params);
    if (flaggedArrays.length) {
      send({ ok: false, call: "", accepted: {}, rejected: [],
             error: arraylikeDeclineReason(entryFn, flaggedArrays),
             arraylikeParams: flaggedArrays });
      return;
    }

    // SM3 floor next. If effectful, require side-effect consent BEFORE doing
    // any synthesis. Without valid consent → blockedByEffect + effects + token.
    // Consent is minted/verified against irTargetId so it matches the run's
    // own floor check (runThreadToNodeCore uses irTargetId too). M-RUN2.1:
    // for a method target the floor covers the constructor path too — the
    // SAME combined set the run re-verifies, so consent scopes can't drift.
    const verdict = await scanEffectsForRun(irTargetId, filePath, className);
    if (!verdict.pure) {
      // Sitting-2 — same trust-grant + category-filtered gating as the run
      // path (consent scopes must not drift between synth and run).
      if (trustUnverified) grantUnverifiedTrust(irTargetId, gatedOffenses(verdict.offenses), trustUnverified);
      const gated = gatedOffenses(verdict.offenses);
      if (gated.length && !verifyEffectConsent(irTargetId, gated, effectConsent)) {
        send({ ok: false, call: "", accepted: {}, rejected: [], error: verdict.reason,
               blockedByEffect: true, effects: gated,
               effectConsentToken: mintEffectConsent(irTargetId, gated),
               ...(gated.some(isTrustableOffense)
                 ? { trustUnverifiedToken: mintUnverifiedTrust(irTargetId, gated) }
                 : {}) });
        return;
      }
    }

    // M-RUN2.1 — for a method target, hand the class source to the synth
    // prompt too (constructor signature drives the instance args).
    let instanceCtx: { className: string; classSource: string } | undefined;
    if (className) {
      const clsNode = (fileData?.nodes ?? []).find((n: any) => n.type === "class_def" && n.name === className);
      let classSource = "";
      if (clsNode) {
        try { classSource = getSourceSnippet(clsNode.line ?? clsNode.lineno, clsNode.endLine ?? clsNode.endLineno, filePath); } catch { /* ignore */ }
      }
      instanceCtx = { className, classSource: classSource.slice(0, 4000) };
    }

    const synth = await synthesizeArgs(entryFn, fnSource, analyzedRoot(), instanceCtx);
    if (!synth.args) { send({ ok: false, call: "", accepted: {}, rejected: [], error: synth.error ?? "synthesis failed" }); return; }

    // Validate through the SM2.a chokepoint (args), then — for a method —
    // the instance mode too; the proposal is ok only when BOTH validate.
    const argsResult = await _validateLiteralsRaw(synth.args);
    if (!className) {
      send(argsResult);
      return;
    }
    const vi = await _validateInstance(className, synth.instanceArgs ?? {});
    send({
      ...argsResult,
      ok: argsResult.ok && vi.ok,
      ...(vi.ok
        ? { instance: { className, args: synth.instanceArgs ?? {}, call: vi.call } }
        : { error: vi.error ?? "instance validation failed" }),
    });
  })();
}

// The proposal-shaped check_literals invocation handleSynthThreadArgs uses
// (full accepted/rejected detail, not just ok/call).
function _validateLiteralsRaw(args: Record<string, string>): Promise<{ ok: boolean; call: string; accepted: Record<string, string>; rejected: any[]; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("python3", [CHECK_LITERALS_SCRIPT], { stdio: ["pipe", "pipe", "pipe"], env: pythonEnv() });
    let out = "";
    child.stdout.on("data", (b) => { out += b.toString(); });
    child.on("close", () => {
      try {
        const r = JSON.parse(out);
        resolve({ ok: !!r.ok, call: r.call ?? "", accepted: r.accepted ?? {}, rejected: r.rejected ?? [] });
      } catch {
        resolve({ ok: false, call: "", accepted: {}, rejected: [], error: "could not parse check_literals output" });
      }
    });
    child.stdin.write(JSON.stringify({ args }));
    child.stdin.end();
  });
}

// M-RUN2.3 — draft an example data file for a missing path a thread reads.
// Reads the ENCLOSING FUNCTION's source (the reader) so the drafted content
// matches what the code parses; replies with the full content + a
// content-hash-bound consent token. Nothing is written anywhere here.
function handleSynthThreadData(
  payload: { nodeId: string; irTargetId?: string; filePath?: string; path: string },
  ws: WebSocket,
): void {
  const { nodeId, filePath } = payload;
  const irTargetId = payload.irTargetId ?? nodeId;
  const send = (p: any) => ws.send(JSON.stringify({ type: "thread-data-proposal", payload: { nodeId, ...p } }));
  (async () => {
    if (!claudeCliAvailable) { send({ ok: false, error: "claude CLI unavailable — can't draft an example file" }); return; }
    const rel = typeof payload.path === "string" ? safeRelPath(analyzedRoot(), payload.path) : null;
    if (!rel) { send({ ok: false, error: `path escapes the project: ${payload.path}` }); return; }
    if (fs.existsSync(path.join(analyzedRoot(), rel))) {
      send({ ok: false, error: `${rel} already exists — nothing to draft` });
      return;
    }
    const file = findNodeFile(irTargetId) ?? filePath ?? resolvedPyFile;
    const fileData = isDirectory ? projectParse[file] : lastParse;
    const fnNode = _enclosingFunctionNode(findNode(irTargetId, filePath), fileData?.nodes ?? []);
    let fnSource = "";
    if (fnNode) {
      try { fnSource = getSourceSnippet(fnNode.line ?? fnNode.lineno, fnNode.endLine ?? fnNode.endLineno, filePath); } catch { /* ignore */ }
    }
    if (!fnSource) { send({ ok: false, error: "could not read the reader function's source" }); return; }

    // Sitting-3 — schema evidence beyond the reader itself: the pump-lab
    // holdout draft guessed 5 columns because the 9-column contract lived in
    // a helper (`_rows_to_tensors`) and in the sibling `data/pump.csv`, and
    // the drafter saw neither. Both are deterministic project facts; the
    // consent surface is unchanged (every drafted byte still shown + hashed).
    const defs = new Map<string, { file: string; line: number; endLine: number }>();
    const defFiles: Array<[string, { nodes?: any[] } | null]> = isDirectory
      ? Object.entries(projectParse)
      : [[file, lastParse]];
    // Reader's own file first so same-file defs win name collisions.
    defFiles.sort(([a], [b]) => (a === file ? -1 : b === file ? 1 : a.localeCompare(b)));
    for (const [f, data] of defFiles) {
      for (const n of data?.nodes ?? []) {
        if (n.type === "function_def" && n.name && !defs.has(n.name)) {
          defs.set(n.name, { file: f, line: n.line, endLine: n.endLine });
        }
      }
    }
    const context = {
      siblings: collectSiblingSamples(analyzedRoot(), rel),
      helpers: collectHelperSources(fnSource, defs, (f, l, e) => {
        try { return getSourceSnippet(l, e, f); } catch { return ""; }
      }),
    };

    const draft = await synthesizeDataFile(rel, fnSource, analyzedRoot(), context);
    if (!draft.content) { send({ ok: false, error: draft.error ?? "data synthesis failed" }); return; }
    send({
      ok: true,
      path: rel,
      content: draft.content,
      dataConsentToken: mintDataConsent(irTargetId, rel, draft.content),
    });
  })();
}

// ── M7 wave 1 — selection bridge + MCP context ────────────────────────────────

// Broadcast a selection target to every webview client; webview's M5
// vg-selection bus picks it up (via `set-selection` ExtensionMessage) and
// re-dispatches as a vg-selection event with source="external".
function broadcastSetSelection(sel: { nodeId: string; filePath?: string }): void {
  currentSelection = { nodeId: sel.nodeId, filePath: sel.filePath ?? null };
  const msg = JSON.stringify({ type: "set-selection", payload: sel });
  for (const c of clients) c.send(msg);
  notifySelectionChanged(sel);
}

// Inlined shape-grammar reference -- mirrors the table in
// .claude/skills/codecanvas/SKILL.md. Kept here (not read from the
// SKILL file at runtime) so the MCP server doesn't grow a dependency
// on the file layout of the skill directory.
const SHAPE_GRAMMAR_REFERENCE = `# VibeGraph shape grammar reference

Silhouette = construct category. Role colour = syntactic role. Ports = typed connection points.

Role colours (semantic, not per-construct):
- Declaration (def, class, assignment, import): teal
- Value / literal: amber
- Control flow (if, for, while, try, return, raise): violet
- Effect (print, I/O, known side-effecting calls): rose
- Reference (name lookup, attribute access): slate

Edge types:
- control -- solid slate. Statement order in a block, branch arrows.
- data -- dashed amber. Value propagation (target <- expression; call arg <- value; loop var <- iterable).
- contains -- no stroke. Purely structural; rendered as nesting.
- reference -- dotted violet. Name use-site -> def site.

Silhouettes:
- Function def: capsule; left params inlet, right return outlet; body column inside.
- Class def: tall container; header band; body holds class attrs + methods.
- Method: function capsule nested in class container; dunders styled subtly.
- Call site: hexagon with function-name header.
- For loop: oblong with rotational arrow on left; body container to the right.
- While loop: oblong with pulsing ring motif instead of arrow.
- If / elif / else: diamond head; two or three branch rails fanning to body containers.
- Try / except: shielded rectangle; except clauses as tabs below.
- Return: right-edge chevron inside function body.
- Raise: jagged right-edge chevron.
- Assignment: rounded rectangle; name label left, value inset right.
- Literal (scalar): small pill.
- Collection: pill with stacked element preview.
- Name reference: small pill with dashed border.
- Attribute access: pill with dot-connector on left.
- Import: chevron tag on top rail.

Composition:
- Function and class bodies are vertical columns of statement nodes.
- Loop bodies and conditional branches indent one rail-width to the right.
- Data-flow edges never cross through a containing silhouette's body -- they route around.
- Role colour is applied to the silhouette stroke + a small header tab; fill stays neutral.

Use this when suggesting visual or structural edits so suggestions match the
shape grammar the user sees.
`;

// ── M20.2 — dynamic-README generation (PLAN-v5 §2.4) ─────────────────
// The agent writes the bodies via `claude -p` headless (same transport as
// Mode B's LLM tier), then we persist with the current IR's sourceHash.
// Generation is on-request only (no auto-regen on save — PLAN-v5 §2.2).

function readmeRootDir(): string {
  return isDirectory ? inputPath : path.dirname(resolvedPyFile);
}

function readmeIrFor(scope: "thread" | "file", id: string): any | null {
  if (scope === "thread") return latestThreads.find((t: any) => t.entryPointId === id) ?? null;
  return isDirectory ? relativeProjectFiles()[id] ?? null : lastParse;
}

function _readmePrompt(scope: "thread" | "file", id: string, ir: any): string {
  if (scope === "thread") {
    // M-NEST L3 — feed the LLM the COMPACT projection: nested calls collapsed,
    // each step honestly marked. Two DISTINCT states the prose must preserve:
    //   [+N nested, drillable] — N calls collapsed but IN the IR (drillable)
    //   [hides calls not in IR] — chain/comprehension/literal NOT decomposed
    // so the summary never describes an uncaptured hole as complete.
    const projected = projectThreadForAgent(ir as Thread);
    const steps = projected.nodes
      .filter((n) => ["seed", "step", "external"].includes(n.kind))
      .slice(0, 40)
      .map((n) => {
        const mark =
          (n.nestedCollapsed ? ` [+${n.nestedCollapsed} nested, drillable]` : "") +
          (n.uncaptured ? " [hides calls not in IR]" : "");
        return `- ${n.kind}: ${n.label}${n.file ? ` (${n.file})` : ""}${mark}`;
      })
      .join("\n");
    return [
      "Write a SHORT README (2-4 sentences, plain prose) summarising what this code thread does and",
      "which external systems (db / cache / http / files) it touches. It is a context anchor for a coding",
      "agent — concrete and specific. Output ONLY the summary text: no markdown headers, no preamble.",
      "",
      `Thread entry point: ${id}`,
      `Files reached: ${(ir.filesReached ?? []).join(", ")}`,
      "Steps in execution order:",
      steps,
    ].join("\n");
  }
  const syms = (ir.symbolIndex ?? []).map((s: any) => s.name).filter(Boolean).slice(0, 40).join(", ");
  return [
    "Write a SHORT README (2-4 sentences, plain prose) summarising this Python file's responsibility in",
    "the project. It is a context anchor for a coding agent. Output ONLY the summary text.",
    "",
    `File: ${id}`,
    `Top-level symbols: ${syms}`,
  ].join("\n");
}

// Tier defaults to "thinking" deliberately: three of this runner's four
// callers are validated against a machine-checked floor (thread skills and
// explain must cite real node ids; a thread agent acts on the result), and
// a model that fails that floor costs a wasted spawn AND produces nothing.
// That is the same reasoning that keeps the builder on the capable tier —
// only callers proven safe to cheapen opt into "routine".
function _runReadmeLlm(prompt: string, tier: ModelTier = "thinking"): Promise<string | null> {
  return new Promise((resolve) => {
    // gen-cwd-fix: the shared gen runner (README / thread-skill / explain /
    // thread-agent) must read the USER's project. Fail honestly if it's gone —
    // null here means callers return { ok:false } and persist nothing.
    const opts = genSpawnOptions();
    if (!opts) {
      console.warn("  [gen] analyzed project root unreachable — skipping LLM");
      resolve(null);
      return;
    }
    // CLI-drift note: see _runIntentLlm — mcpServers record + `--`.
    // M-SKILL.4 — VG_CLAUDE_BIN stubbable like every other headless path
    // (the sweep batch-drives this runner; tests must never spawn real claude).
    // Model tier: routine — READMEs and thread-skill drafts are bounded
    // summarisation, and the sweep batch-drives this one spawn per thread,
    // so the per-spawn floor lands once per entry point. This is the single
    // biggest beneficiary of the split.
    const { cmd, args: pre } = resolveClaudeBin(tier);
    const child = spawn(
      cmd,
      [...pre, "-p", "--output-format", "json", "--strict-mcp-config",
        "--mcp-config", '{"mcpServers":{}}',
        "--dangerously-skip-permissions", "--", prompt],
      opts,
    );
    let out = "";
    child.stdout.on("data", (b: Buffer) => { out += b.toString(); });
    child.on("close", (code) => {
      if (code !== 0) { resolve(null); return; }
      try {
        const parsed = JSON.parse(out);
        const text = typeof parsed.result === "string" ? parsed.result.trim() : "";
        resolve(text || null);
      } catch { resolve(null); }
    });
    child.on("error", () => resolve(null));
  });
}

async function runGenerateReadme(
  scope: "thread" | "file", id: string,
): Promise<{ ok: boolean; body?: string; error?: string }> {
  const ir = readmeIrFor(scope, id);
  if (!ir) return { ok: false, error: `No ${scope} IR for "${id}"` };
  if (!claudeCliAvailable) return { ok: false, error: "claude CLI unavailable for README generation" };
  // Routine: a prose README has no citation floor to fail.
  const body = await _runReadmeLlm(_readmePrompt(scope, id, ir), "routine");
  if (!body) return { ok: false, error: "README generation returned nothing" };
  writeReadme(readmeRootDir(), scope, id, body, sourceHashOf(ir), new Date().toISOString());
  return { ok: true, body };
}

function handleGetReadme(payload: { scope: "thread" | "file"; id: string }, ws: WebSocket): void {
  const ir = readmeIrFor(payload.scope, payload.id);
  const currentHash = ir ? sourceHashOf(ir) : "";
  const result = readReadmeFromStore(readmeRootDir(), payload.scope, payload.id, currentHash);
  ws.send(JSON.stringify({ type: "readme-status", payload: result }));
}

async function handleGenerateReadme(
  payload: { scope: "thread" | "file"; id: string }, ws: WebSocket,
): Promise<void> {
  const gen = await runGenerateReadme(payload.scope, payload.id);
  if (!gen.ok) {
    ws.send(JSON.stringify({
      type: "readme-status",
      payload: { exists: false, scope: payload.scope, id: payload.id,
        key: `${payload.scope}:${payload.id}`, error: gen.error },
    }));
    return;
  }
  handleGetReadme(payload, ws); // reply with the canonical stored record
  notifyProjectUpdated();        // nudge MCP subscribers — a resource changed
}

// ── C1 (PLAN-v6) — thread-skill generation ───────────────────────────
// Same claude -p transport as the README, but the output is a STRUCTURED
// skill, and the "Not statically known" honesty block is appended
// DETERMINISTICALLY from A1's roll-up (IR fact, not LLM). Always written as
// a draft; a human ratifies by editing the file's status.

function _threadSkillPrompt(entryPointId: string, ir: any): string {
  const projected = projectThreadForAgent(ir as Thread);
  const steps = projected.nodes
    .filter((n) => ["seed", "step", "external"].includes(n.kind))
    .slice(0, 40)
    .map((n) => {
      const mark =
        (n.nestedCollapsed ? ` [+${n.nestedCollapsed} nested, drillable]` : "") +
        (n.uncaptured ? " [hides calls not in IR]" : "");
      return `- ${n.kind}: ${n.label}${n.irNodeId ? ` \`${n.irNodeId}\`` : ""}${n.file ? ` (${n.file})` : ""}${mark}`;
    })
    .join("\n");
  return [
    "Write a THREAD SKILL: durable, grounded guidance for a coding agent working on this code thread.",
    "Use these markdown sections, in order:",
    "## Purpose — what this thread does and why (1-2 sentences).",
    "## Architecture — the key functions/files and how control flows across them.",
    "## Steps — the execution path; for each named step cite its IR node id in `backticks` (use the ids below).",
    "## Gotchas — edit hazards, ordering constraints, cross-file coupling.",
    "Be concrete and specific. Cite ONLY node ids that appear below; never invent ids. Do NOT describe the",
    "thread's unknown/dynamic/uncaptured parts — those are appended separately as verified IR fact.",
    "Output ONLY the markdown sections, no preamble. These four sections, once each, in that order, are a",
    "hard contract — a draft missing them is refused. Keep the whole skill under 8000 characters: it is",
    "injected into working prompts, so dense beats long.",
    "",
    `Thread entry point: ${entryPointId}`,
    `Files reached: ${(ir.filesReached ?? []).join(", ")}`,
    "Steps in execution order:",
    steps,
  ].join("\n");
}

async function runGenerateThreadSkill(
  entryPointId: string,
): Promise<{ ok: boolean; body?: string; error?: string }> {
  const ir = latestThreads.find((t: any) => t.entryPointId === entryPointId);
  if (!ir) return { ok: false, error: `No thread for entry point "${entryPointId}"` };
  if (!claudeCliAvailable) return { ok: false, error: "claude CLI unavailable for thread-skill generation" };
  // The grounding gate below tolerates ZERO ungrounded citations, so a
  // single invented id discards an otherwise good skill and burns the whole
  // spawn. Observed roughly half the time across projects. Retry ONCE,
  // naming the invalid ids — the gate is unchanged and still zero-tolerance
  // on what actually gets persisted; this only stops one near-miss from
  // costing a full regeneration the user has to trigger by hand.
  const known = allKnownNodeIds();
  let prose = await _runReadmeLlm(_threadSkillPrompt(entryPointId, ir));
  if (prose) {
    const first = validateCitationsCore(prose, known);
    if (first.ungrounded.length > 0 || first.grounded.length === 0) {
      const complaint = first.ungrounded.length
        ? `These node ids do NOT exist and must not be cited: ${first.ungrounded.slice(0, 12).join(", ")}. `
          + "Re-write citing ONLY ids from the step list, or drop the citation."
        : "The draft cited no node ids. Every named step must cite its IR node id in backticks, taken verbatim from the step list.";
      const retry = await _runReadmeLlm(
        `${_threadSkillPrompt(entryPointId, ir)}\n\nYour previous attempt was REJECTED. ${complaint}`,
      );
      // Keep the retry only if it is actually better — never trade a
      // near-miss for a worse draft.
      if (retry) {
        const second = validateCitationsCore(retry, known);
        if (second.grounded.length >= 1 && second.ungrounded.length === 0) prose = retry;
      }
    }
  }
  if (!prose) return { ok: false, error: "thread-skill generation returned nothing" };

  // gen-cwd-fix Step 3 — grounding gate: a skill persisted to disk is later
  // auto-injected once ratified, so confabulation must never reach the store.
  // The C1 prompt demands backticked node-id citations; require ≥1 real id and
  // zero hallucinated ones before persisting. Gate the LLM PROSE only — the
  // deterministic honesty block below is appended IR fact, not LLM output.
  // The bare "no/invalid citations" message named nothing, so a rejected
  // draft was undiagnosable: you could not tell "cited nothing" (a prompt
  // problem) from "cited one id that does not exist" (a near-miss that
  // discards an otherwise good skill, since the gate tolerates zero
  // ungrounded). Say which, and how close it came.
  {
    const check = validateCitationsCore(prose, known);
    if (!(check.grounded.length >= 1 && check.ungrounded.length === 0)) {
      const why = check.cited.length === 0
        ? "the draft cited no node ids at all"
        : `${check.grounded.length} of ${check.cited.length} citations were real; these do not exist: ${check.ungrounded.slice(0, 8).join(", ")}`;
      return {
        ok: false,
        error: `generation not grounded — ${why}; not persisted`,
      };
    }
  }

  // Skill body contract (2026-08-02) — the shape half of the gate: the four
  // sections the prompt demands, once each, in order, no preamble. A draft
  // that fails is refused with the named problems (honest failure → redraft),
  // never silently persisted in a shape the card and router can't use well.
  const shape = validateSkillBody(prose);
  if (!shape.ok) {
    return { ok: false, error: `generation violates the skill body contract — ${shape.problems.join("; ")}; not persisted` };
  }

  // Deterministic honesty block — A1's roll-up, appended as IR fact.
  const effectKindFor = (f: string | null, irNodeId: string | null): string | null => {
    if (!irNodeId) return null;
    const n = findNode(irNodeId, f ?? undefined);
    return (n && typeof n.effectKind === "string") ? n.effectKind : null;
  };
  const rollup = computeThreadBlindSpots(ir as Thread, effectKindFor);
  const body = `${prose.trim()}\n\n${formatBlindSpotsBlock(rollup)}`;

  // Size ceiling on the FULL body (prose + honesty block): the routing
  // budget (thread_remit) is the whole turn's allowance, so a body over it
  // could never inject — persisting it would be a silent lie in the store.
  if (skillBodyOverBudget(body)) {
    return { ok: false, error: `generated body is ${body.length} chars — over the ${SKILL_INJECTION_BUDGET_CHARS}-char injection budget, so it could never ride a prompt; not persisted` };
  }

  // M-SKILL.7 — stamp the step snapshot alongside the hash so a later
  // staleness can show WHAT changed, not just that something did.
  writeThreadSkill(readmeRootDir(), entryPointId, body, sourceHashOf(ir), new Date().toISOString(), "draft", makeThreadSnapshot(ir));
  return { ok: true, body };
}

/** Read the thread-skill tagged with staleness vs the thread's current IR. */
function readThreadSkill(entryPointId: string): ThreadSkillResult {
  const ir = latestThreads.find((t: any) => t.entryPointId === entryPointId);
  const currentHash = ir ? sourceHashOf(ir) : "";
  return readThreadSkillFromStore(readmeRootDir(), entryPointId, currentHash);
}

// ── M-SKILL.3 — thread-skill lifecycle over the WS wire ──────────────
// The ratification gate leaves the file editor: get-thread-skills lists
// every entry point's skill state for the UI badges/dots; ratify flips a
// DRAFT to ratified through the store's only sanctioned status writer
// (validated at the boundary — ratifying nothing, or re-ratifying, is an
// error, never a silent no-op); redraft delegates to runGenerateThreadSkill
// so the grounding gate and always-draft floor apply unchanged.

function threadSkillWireRecord(entryPointId: string): Record<string, unknown> {
  const r = readThreadSkill(entryPointId);
  return r.exists
    ? {
        entryPointId, exists: true, status: r.status, stale: r.stale,
        generatedAt: r.generatedAt, body: r.body,
        autoReaffirm: r.autoReaffirm ?? false, hasSnapshot: !!r.snapshot,
      }
    : { entryPointId, exists: false };
}

function handleGetThreadSkills(ws: WebSocket): void {
  const skills = latestEntryPoints.map((ep: any) => threadSkillWireRecord(ep.id));
  ws.send(JSON.stringify({ type: "thread-skills", payload: { skills } }));
}

function handleRatifyThreadSkill(payload: unknown, ws: WebSocket): void {
  const entryPointId = (payload as { entryPointId?: unknown } | null)?.entryPointId;
  const fail = (error: string) =>
    ws.send(JSON.stringify({ type: "thread-skill-status", payload: { entryPointId, error } }));
  if (typeof entryPointId !== "string" || !entryPointId) return fail("entryPointId must be a non-empty string");
  if (!latestEntryPoints.some((ep: any) => ep.id === entryPointId)) return fail(`unknown entry point "${entryPointId}"`);
  const current = readThreadSkill(entryPointId);
  if (!current.exists) return fail("no skill exists for this thread — draft one first");
  if (current.status === "ratified") return fail("already ratified");
  ratifyThreadSkill(readmeRootDir(), entryPointId);
  ws.send(JSON.stringify({ type: "thread-skill-status", payload: threadSkillWireRecord(entryPointId) }));
  notifyProjectUpdated();
}

// M-SKILL.7 — re-affirm + diff + auto-reaffirm. The diff comes from the
// snapshot stamped at generation; re-affirm is an INFORMED human wave-through
// (stale ratified only); auto-reaffirm is a per-skill opt-in whose injection
// always carries the caveat (injectableSkillText — the store owns the label).

function handleGetThreadSkillDiff(payload: unknown, ws: WebSocket): void {
  const entryPointId = (payload as { entryPointId?: unknown } | null)?.entryPointId;
  const reply = (p: Record<string, unknown>) =>
    ws.send(JSON.stringify({ type: "thread-skill-diff", payload: { entryPointId, ...p } }));
  if (typeof entryPointId !== "string" || !entryPointId) return reply({ error: "entryPointId must be a non-empty string" });
  const ir = latestThreads.find((t: any) => t.entryPointId === entryPointId);
  if (!ir) return reply({ error: `unknown entry point "${entryPointId}"` });
  const stored = readThreadSkill(entryPointId);
  if (!stored.exists) return reply({ error: "no skill exists for this thread" });
  if (!stored.snapshot) return reply({ unavailable: true }); // pre-M-SKILL.7 stamp — honest gap
  reply({ diff: threadSkillDiff(stored.snapshot, makeThreadSnapshot(ir)) });
}

function handleReaffirmThreadSkill(payload: unknown, ws: WebSocket): void {
  const entryPointId = (payload as { entryPointId?: unknown } | null)?.entryPointId;
  const fail = (error: string) =>
    ws.send(JSON.stringify({ type: "thread-skill-status", payload: { entryPointId, error } }));
  if (typeof entryPointId !== "string" || !entryPointId) return fail("entryPointId must be a non-empty string");
  const ir = latestThreads.find((t: any) => t.entryPointId === entryPointId);
  if (!ir) return fail(`unknown entry point "${entryPointId}"`);
  const current = readThreadSkill(entryPointId);
  if (!current.exists) return fail("no skill exists for this thread");
  if (current.status !== "ratified") return fail("only a ratified skill can be re-affirmed — ratify the draft first");
  if (!current.stale) return fail("skill is already fresh — nothing to re-affirm");
  reaffirmThreadSkill(readmeRootDir(), entryPointId, sourceHashOf(ir), makeThreadSnapshot(ir));
  ws.send(JSON.stringify({ type: "thread-skill-status", payload: threadSkillWireRecord(entryPointId) }));
  notifyProjectUpdated();
}

function handleSetSkillAutoReaffirm(payload: unknown, ws: WebSocket): void {
  const p = payload as { entryPointId?: unknown; value?: unknown } | null;
  const entryPointId = p?.entryPointId;
  const fail = (error: string) =>
    ws.send(JSON.stringify({ type: "thread-skill-status", payload: { entryPointId, error } }));
  if (typeof entryPointId !== "string" || !entryPointId) return fail("entryPointId must be a non-empty string");
  if (typeof p?.value !== "boolean") return fail("value must be a boolean");
  if (!latestEntryPoints.some((ep: any) => ep.id === entryPointId)) return fail(`unknown entry point "${entryPointId}"`);
  const updated = setThreadSkillAutoReaffirm(readmeRootDir(), entryPointId, p.value);
  if (!updated) return fail("auto-reaffirm applies to ratified skills only");
  ws.send(JSON.stringify({ type: "thread-skill-status", payload: threadSkillWireRecord(entryPointId) }));
  notifyProjectUpdated();
}

async function handleRedraftThreadSkill(payload: unknown, ws: WebSocket): Promise<void> {
  const entryPointId = (payload as { entryPointId?: unknown } | null)?.entryPointId;
  const fail = (error: string) =>
    ws.send(JSON.stringify({ type: "thread-skill-status", payload: { entryPointId, error } }));
  if (typeof entryPointId !== "string" || !entryPointId) return fail("entryPointId must be a non-empty string");
  if (!latestEntryPoints.some((ep: any) => ep.id === entryPointId)) return fail(`unknown entry point "${entryPointId}"`);
  const gen = await runGenerateThreadSkill(entryPointId);
  if (!gen.ok) return fail(gen.error ?? "generation failed");
  ws.send(JSON.stringify({ type: "thread-skill-status", payload: threadSkillWireRecord(entryPointId) }));
  notifyProjectUpdated();
}

// ── M-SKILL.4 — skill coverage sweep ─────────────────────────────────
// Batch-draft through the SAME grounding-gated generator (always draft;
// a human still ratifies each one in the card). One sweep at a time;
// per-item progress broadcasts so the launchpad dots flip live.

let sweepInFlight = false;

async function runSkillSweep(): Promise<
  { ok: true; summary: import("./src/server/skill_sweep").SweepSummary } | { ok: false; error: string }
> {
  if (sweepInFlight) return { ok: false, error: "a skill sweep is already running" };
  if (!claudeCliAvailable) return { ok: false, error: "claude CLI unavailable for skill drafting" };
  sweepInFlight = true;
  try {
    const { targets, skipped } = planSweep(latestEntryPoints.map((ep: any) => ep.id), readThreadSkill);
    const summary = await runSweep(targets, skipped, runGenerateThreadSkill, (done, total, item) => {
      broadcastToAll({
        type: "skill-sweep-progress",
        payload: { done, total, entryPointId: item.entryPointId, ok: item.ok, error: item.error },
      });
    });
    return { ok: true, summary };
  } finally {
    sweepInFlight = false;
  }
}

async function handleSkillSweep(ws: WebSocket): Promise<void> {
  const r = await runSkillSweep();
  if (!r.ok) {
    ws.send(JSON.stringify({ type: "skill-sweep-done", payload: { error: r.error } }));
    return;
  }
  broadcastToAll({ type: "skill-sweep-done", payload: { summary: r.summary } });
  handleGetThreadSkills(ws); // repaint badges/dots from the canonical store
  notifyProjectUpdated();
}

// ── C2 (PLAN-v6) — explain-this-node (labelled inference) ─────────────
// Process-local cache keyed by node id + source hash (X4): a node's
// explanation is regenerable, invalidated when its source changes.
const explainCache = new Map<string, { sourceHash: string; interpretation: string }>();

async function runExplainNode(nodeId: string, filePath?: string): Promise<NodeExplanation> {
  const fail = (error: string): NodeExplanation =>
    ({ nodeId, interpretation: null, attribution: EXPLAIN_ATTRIBUTION, cached: false, error });
  const tFile = filePath ?? (isDirectory ? findNodeFile(nodeId) : resolvedPyFile);
  if (!tFile) return fail("No file for node");
  const node = findNode(nodeId, filePath);
  if (!node) return fail(`Node not found: ${nodeId}`);
  const line = node.line ?? node.lineno;
  const endLine = node.endLine ?? node.endLineno;
  if (line == null || endLine == null) return fail("Node missing line span");
  let source: string;
  try { source = getSourceSnippet(line, endLine, tFile); }
  catch (e: any) { return fail(`Could not read source: ${e.message}`); }

  const srcHash = sourceHashOf(source);
  const hit = explainCache.get(nodeId);
  if (hit && hit.sourceHash === srcHash) {
    return { nodeId, interpretation: hit.interpretation, attribution: EXPLAIN_ATTRIBUTION, cached: true };
  }
  if (!claudeCliAvailable) return fail("claude CLI unavailable for explanation");
  const interpretation = await _runReadmeLlm(explainPrompt(source));
  if (!interpretation) return fail("explanation returned nothing");
  explainCache.set(nodeId, { sourceHash: srcHash, interpretation });
  return { nodeId, interpretation, attribution: EXPLAIN_ATTRIBUTION, cached: false };
}

// ── D1 (PLAN-v6) — per-thread agent ──────────────────────────────────
// Spawn a claude -p subagent whose context is bounded to one thread
// (projection + ratified skill + blind-spots + adjacent threads). The
// escalation protocol (buildThreadAgentPrompt) makes it honest about its
// boundary rather than confabulating across threads. v1: a one-shot
// reasoning agent (no MCP tools of its own).
async function runSpawnThreadAgent(requestedId: string, task: string): Promise<ThreadAgentResult> {
  // 2026-07-30 sitting: the first dispatch was rejected because the caller
  // passed `train:train` — the qualifiedName the UI prints EVERYWHERE (chip,
  // routed line, plan_work packets) — while only the entry-point id
  // (`train.py:train`) was accepted. Requiring an identifier the interface
  // never shows is a papercut with no upside; accept either, and when neither
  // matches, say what the valid ids are instead of just refusing.
  const thread = latestThreads.find((t: any) => t.entryPointId === requestedId)
    ?? latestThreads.find((t: any) => t.seed?.qualifiedName === requestedId);
  const entryPointId = (thread as any)?.entryPointId ?? requestedId;
  if (!thread) {
    const known = latestThreads
      .map((t: any) => t.entryPointId)
      .filter(Boolean)
      .slice(0, 12)
      .join(", ");
    return {
      entryPointId, task, result: null, escalated: false,
      error: `No thread for "${requestedId}". Pass an entry-point id or its qualified name`
        + (known ? ` — known ids: ${known}` : ""),
    };
  }
  if (!claudeCliAvailable) return { entryPointId, task, result: null, escalated: false, error: "claude CLI unavailable for thread agent" };

  // Projection (compact, honest).
  const projected = projectThreadForAgent(thread as Thread);
  // Nest labels come from the FULL thread and are attached here rather than
  // carried on the projection object, so collapse.ts keeps its bounded-marker
  // byte budget (nest_projection.test.mjs) — only the prompt pays for names.
  const nests = deriveNests((thread as Thread).nodes);
  const labelById = new Map((thread as Thread).nodes.map((n) => [n.id, n.label]));
  const projection = renderAgentProjection(
    projected.nodes.map((n) => ({
      ...n,
      nestedLabels: (nests.childrenByParent.get(n.id) ?? []).map((k) => labelById.get(k) ?? k),
    })),
  );

  // Blind-spots (A1) rendered as IR fact.
  const effectKindFor = (f: string | null, irNodeId: string | null): string | null => {
    if (!irNodeId) return null;
    const n = findNode(irNodeId, f ?? undefined);
    return (n && typeof n.effectKind === "string") ? n.effectKind : null;
  };
  const blindSpots = formatBlindSpotsBlock(computeThreadBlindSpots(thread as Thread, effectKindFor));

  // Ratified + fresh thread-skill (C1) only.
  const skillRes = readThreadSkill(entryPointId);
  // M-SKILL.7 — bounded agents get the same labeled gate (caveat included).
  const skill = injectableSkillText(skillRes);

  // Cross-thread adjacency (the visible boundary).
  const graph = deriveThreadCalls(latestThreads as any, latestEntryPoints as any);
  const reaches = graph.edges.filter((e) => e.from === entryPointId).map((e) => e.to);
  const reachedBy = graph.edges.filter((e) => e.to === entryPointId).map((e) => e.from);

  const prompt = buildThreadAgentPrompt({
    entryPointId,
    qualifiedName: (thread as any).seed?.qualifiedName ?? entryPointId,
    projection, skill, blindSpots,
    filesReached: (thread as any).filesReached ?? [],
    reaches, reachedBy,
  }, task);

  const result = await _runReadmeLlm(prompt);
  return { entryPointId, task, result, escalated: isEscalation(result) };
}

const mcpContext: VibegraphMcpContext = {
  isDirectory: () => isDirectory,
  resolvedPyFile: () => resolvedPyFile,
  // M8.3.3: MCP listFiles + getProjectIR mirror the envelope's
  // relative-path convention so a tool consumer can round-trip a path
  // through set-selection / extract-thread without resolving against
  // the project root themselves.
  listFiles: () => isDirectory ? Object.keys(relativeProjectFiles()) : [resolvedPyFile],
  getProjectIR: (filePath?: string) => {
    if (!isDirectory) return lastParse;
    if (filePath) return projectParse[resolveProjectPath(filePath)] ?? null;
    // M8.1 — directory-mode, no filePath: return the v2.0 envelope.
    return buildProjectEnvelope();
  },
  listEntryPoints: () => isDirectory ? latestEntryPoints : [],
  getNodeSource: (nodeId: string, filePath?: string) => {
    // "module" is the whole file. Node ids are structural paths ROOTED at
    // the module (`module/foo.fn`), so asking for the root is the obvious
    // way to request the file — but no node carries the bare id, so it used
    // to dead-end on "Node not found: module". replace_module_body already
    // treats the module as a unit; this makes reading agree with writing.
    const rootFile = filePath ?? (isDirectory ? undefined : resolvedPyFile);
    if ((nodeId === "module" || nodeId === "") && rootFile) {
      try {
        return { source: fs.readFileSync(resolveProjectPath(rootFile), "utf-8") };
      } catch (e: any) {
        return { error: `could not read ${rootFile}: ${e.message}` };
      }
    }
    const tFile = filePath
      ?? (isDirectory ? findNodeFile(nodeId) : resolvedPyFile);
    if (!tFile) return { error: "No target file" };
    const node = findNode(nodeId, filePath);
    if (!node) {
      // Name what IS available. A bare "not found" tells an agent nothing
      // and invites it to guess again or route around the tool entirely.
      // projectParse is keyed by ABSOLUTE path (see findNode) — looking it
      // up by the caller's relative path found nothing, so the error claimed
      // "no parsed nodes" for a file that has plenty.
      const ir: any = isDirectory
        ? (projectParse as any)[resolveProjectPath(tFile)]
        : lastParse;
      const ids = ((ir?.nodes ?? []) as any[]).map((n) => n.id).filter(Boolean);
      const sample = ids.slice(0, 25);
      return {
        error: `Node not found: ${nodeId}`
          + (ids.length
            ? `. Use "module" for the whole file, or one of these ${ids.length} ids`
              + `${ids.length > sample.length ? " (first 25)" : ""}: ${sample.join(", ")}`
            : `. No parsed nodes for ${tFile} — check filePath.`),
      };
    }
    const line = node.line ?? node.lineno;
    const endLine = node.endLine ?? node.endLineno;
    if (line == null || endLine == null) return { error: "Node missing line/endLine" };
    return { source: getSourceSnippet(line, endLine, tFile) };
  },
  findSymbol: (name: string, kind?: string) => {
    const results: unknown[] = [];
    const search = (entries: unknown[], filePath?: string) => {
      for (const e of entries as any[]) {
        if (e.name !== name) continue;
        if (kind && e.kind !== kind) continue;
        results.push(filePath ? { ...e, filePath } : e);
      }
    };
    if (isDirectory) {
      for (const [fp, ir] of Object.entries(projectParse)) {
        search((ir as any).symbolIndex ?? [], fp);
      }
    } else if (lastParse) {
      search(lastParse.symbolIndex ?? []);
    }
    return results;
  },
  getSelection: () => ({ ...currentSelection }),
  setSelection: (nodeId: string, filePath?: string) => {
    broadcastSetSelection({ nodeId, filePath });
  },
  rewriteNode: async ({ nodeId, op, payload, filePath }) => {
    // Adapt MCP-style { nodeId, payload } into executeToolCall's flat
    // input shape ({ nodeId, newSource | source | newName }).
    const input: Record<string, unknown> = { nodeId, ...payload };
    // The tool description documents `source` for replace_node, but the
    // executor reads `newSource` — accept both. Before this alias, the
    // documented shape left newSource undefined and the empty stdin
    // SILENTLY DELETED the target while reporting success (caught live
    // during M10 verification). Belt: alias here; braces: the non-empty
    // check below + cst_rewrite.py's empty_source guard.
    if (op === "replace_node" && input.newSource == null && typeof input.source === "string") {
      input.newSource = input.source;
    }
    const sourceKey =
      op === "replace_node" ? "newSource"
      : op === "insert_statement_before" || op === "insert_statement_after" ? "source"
      : null;
    if (sourceKey) {
      const v = input[sourceKey];
      if (typeof v !== "string" || v.trim() === "") {
        return { success: false, message: `${op} requires non-empty payload.source` };
      }
    }
    if (op === "rename_symbol" && (typeof input.newName !== "string" || input.newName.trim() === "")) {
      return { success: false, message: "rename_symbol requires non-empty payload.newName" };
    }
    // executeToolCall reads ws only for legacy reasons; pass a typed
    // no-op to satisfy the signature without sending WS noise.
    const noopWs = { send: () => { /* intentionally empty */ } } as unknown as WebSocket;
    return executeToolCall(op, input, noopWs, filePath);
  },
  composeInsert: async ({ mode, source, anchorNodeId, filePath }) => {
    // MCP exposes a friendlier op enum ("before" / "after" / "top-level")
    // than the internal one; translate here.
    const internalMode = mode === "before" ? "insert_before"
      : mode === "after" ? "insert_after"
      : "append_end";
    return composeInsertCore(internalMode, anchorNodeId ?? null, source, filePath);
  },
  extractThread: async (seedNodeId: string, filePath?: string) => {
    const file = filePath ?? (isDirectory ? findNodeFile(seedNodeId) : resolvedPyFile);
    if (!file) throw new Error("No file for seed node");
    return extractThreadCore(file, seedNodeId);
  },
  // A1 (PLAN-v6) — per-thread honesty roll-up. Extracts the thread, then the
  // PURE computeThreadBlindSpots buckets its nodes; effectKind does NOT ride on
  // thread nodes, so we join it from the per-file IR by (file, irNodeId) via
  // findNode. Read-only IR fact — no run, no floor.
  threadBlindSpots: async (seedNodeId: string, filePath?: string) => {
    const file = filePath ?? (isDirectory ? findNodeFile(seedNodeId) : resolvedPyFile);
    if (!file) throw new Error("No file for seed node");
    const thread = (await extractThreadCore(file, seedNodeId)) as Thread;
    const effectKindFor = (f: string | null, irNodeId: string | null): string | null => {
      if (!irNodeId) return null;
      const n = findNode(irNodeId, f ?? undefined);
      return (n && typeof n.effectKind === "string") ? n.effectKind : null;
    };
    return computeThreadBlindSpots(thread, effectKindFor);
  },
  // B4 (PLAN-v6) — behavioural-contract assertions for a thread. Same extract +
  // effectKind-join as threadBlindSpots; the pure computeThreadAssertions derives
  // the order/effect/terminal invariants. Read-only IR fact.
  threadAssertions: async (seedNodeId: string, filePath?: string) => {
    const file = filePath ?? (isDirectory ? findNodeFile(seedNodeId) : resolvedPyFile);
    if (!file) throw new Error("No file for seed node");
    const thread = (await extractThreadCore(file, seedNodeId)) as Thread;
    const effectKindFor = (f: string | null, irNodeId: string | null): string | null => {
      if (!irNodeId) return null;
      const n = findNode(irNodeId, f ?? undefined);
      return (n && typeof n.effectKind === "string") ? n.effectKind : null;
    };
    return computeThreadAssertions(thread, effectKindFor);
  },
  // A3 (PLAN-v6) — validate the node-id citations in a chunk of prose against
  // the live IR's full node-id universe. Read-only IR fact.
  validateCitations: (text: string) => {
    return validateCitationsCore(text, allKnownNodeIds());
  },
  // A2 (PLAN-v6) — blast radius. Normalise projectParse (relative keys;
  // reference edges with targetFile relativised) + latestThreads into the pure
  // computeBlastRadius inputs. Read-only IR fact.
  blastRadius: (nodeId: string, filePath?: string) => {
    const toRefEdges = (ir: any): BlastFile["refEdges"] =>
      (ir.edges ?? [])
        .filter((e: any) => e.type === "reference")
        .map((e: any) => ({
          source: e.source,
          target: e.target,
          targetFile: e.targetFile ? relativize(e.targetFile) : undefined,
          qualifiedTarget: e.qualifiedTarget,
        }));
    const files: Record<string, BlastFile> = {};
    let targetFile = "";
    if (isDirectory) {
      for (const [fp, ir] of Object.entries(projectParse)) {
        files[relativize(fp)] = { nodes: (ir as any).nodes ?? [], refEdges: toRefEdges(ir) };
      }
      targetFile = filePath
        ? (path.isAbsolute(filePath) ? relativize(filePath) : filePath)
        : (findNodeFile(nodeId) ? relativize(findNodeFile(nodeId)!) : "");
    } else if (lastParse) {
      files[resolvedPyFile] = { nodes: lastParse.nodes, refEdges: toRefEdges(lastParse) };
      targetFile = resolvedPyFile;
    }
    const threads: BlastThread[] = (latestThreads as any[]).map((t) => ({
      entryPointId: t.entryPointId ?? "",
      qualifiedName: t.seed?.qualifiedName ?? "",
      nodes: t.nodes ?? [],
    }));
    return computeBlastRadius(targetFile, nodeId, files, threads);
  },
  runBlock: async (nodeId: string, filePath?: string) => runBlockCore(nodeId, filePath),
  // B1 (PLAN-v6) — run-to-node as an agent-facing tool. The SERVER derives
  // entryFn/exprN from the node id (resolveRunTarget) rather than trusting an
  // agent-supplied derivation, then runs the ephemeral engine — which applies
  // the SM3 floor + effect-consent handshake. Non-executing IR-shape declines
  // (unsupported-target / value-ambiguous / needs-inputs) short-circuit BEFORE
  // any run; the floor still gates everything that does execute. The honest
  // outcome envelope (incl. provenance + effects + consent token) is returned
  // verbatim — no stdout-scraping, the whole point over runBlock.
  runThreadToNode: async ({ nodeId, filePath, synthArgs, effectConsent, synthInstanceArgs }) => {
    const synth = synthArgs !== undefined;
    const declined = (outcome: string, reason: string): WireThreadRunResult => ({
      nodeId, outcome: outcome as WireThreadRunResult["outcome"], value: null, valueOpaque: false,
      provenance: synth ? "synthesized-input" : "real-input", stdout: "", stderr: "", error: reason,
    });
    const target = resolveRunTarget(nodeId, filePath);
    if (!target.ok) return declined(target.outcome, target.reason);
    // An arg-needing entry with no synthArgs is an honest needs-inputs decline
    // (not a silent TypeError at runtime) — the agent should pass synthArgs.
    if (target.needsSynth && !synth) {
      return declined("needs-inputs", target.className
        ? "method target — pass synthArgs for the method and synthInstanceArgs for the constructor (literal expressions)"
        : "entry function requires arguments — pass synthArgs (literal expressions)");
    }
    // M-RUN2.1 — a method runs on a synthesized example instance; the class
    // is server-derived from the IR (never the agent's claim), and the
    // constructor values pass check_literals --mode instance downstream.
    if (target.className && synthInstanceArgs === undefined) {
      return declined("needs-inputs", "method target — pass synthInstanceArgs (constructor literal expressions; {} for all-defaults)");
    }
    const synthInstance = target.className
      ? { className: target.className, args: synthInstanceArgs ?? {} }
      : undefined;
    const r = await runThreadToNodeCore(nodeId, filePath, target.entryFn, target.exprN, synthArgs, effectConsent, undefined, synthInstance);
    return { nodeId, ...r } as WireThreadRunResult;
  },
  // B2 (PLAN-v6) — ephemeral upstream override. Re-bind an upstream
  // assignment's variable to a validated LITERAL, then run to N — what-if
  // debugging with no disk write. Server-derived like B1; the override value
  // passes the SAME check_literals chokepoint as synth args (so it can't be
  // arbitrary code), and the SM3 floor still gates the real path's effects.
  runThreadToNodeOverride: async ({ nodeId, filePath, overrideNodeId, value, effectConsent }) => {
    const declined = (outcome: string, reason: string): WireThreadRunResult => ({
      nodeId, outcome: outcome as WireThreadRunResult["outcome"], value: null, valueOpaque: false,
      provenance: "synthesized-input", stdout: "", stderr: "", error: reason,
    });
    const target = resolveRunTarget(nodeId, filePath);
    if (!target.ok) return declined(target.outcome, target.reason);
    if (target.needsSynth) {
      return declined("needs-inputs", "override-run does not synthesize entry args (v1) — pick a no-arg entry");
    }
    // Override target: a plain-identifier assignment (its lhs is what we re-bind).
    const m = findNode(overrideNodeId, filePath);
    if (!m) return declined("unsupported-target", `override node not found: ${overrideNodeId}`);
    if (m.type !== "assignment" || !m.name || !_RUN_IDENT.test(m.name)) {
      return declined("unsupported-target", "override target must be a plain-identifier assignment");
    }
    // The override value passes check_literals — literal-only, no calls/names.
    const v = await _validateLiterals({ [m.name]: value });
    if (!v.ok) return declined("value-ambiguous", `override value is not a literal: ${v.error}`);
    const assignment = `${m.name} = ${value}`;
    const r = await runThreadToNodeCore(
      nodeId, filePath, target.entryFn, target.exprN, undefined, effectConsent,
      { nodeId: overrideNodeId, assignment },
    );
    return { nodeId, ...r, override: assignment } as WireThreadRunResult;
  },
  // B5 (PLAN-v6) — runtime-assisted resolution of a dynamic dispatch. Server
  // derives the enclosing entry fn; the agent passes the receiver name (the
  // variable whose runtime type reveals the target). The result is a LABELLED
  // runtime sample, never a static resolution.
  observeDynamicTarget: async ({ nodeId, receiver, filePath, effectConsent }) => {
    const fn = resolveEnclosingFn(nodeId, filePath);
    if (!fn.ok) {
      return { nodeId, outcome: fn.outcome, observedTarget: null, note: OBSERVE_NOTE, provenance: "real-input", error: fn.reason };
    }
    return runObserveDynamicTarget(nodeId, filePath, fn.entryFn, receiver, effectConsent);
  },
  onSelectionChanged: (cb) => {
    selectionListeners.add(cb);
    return () => { selectionListeners.delete(cb); };
  },
  onProjectUpdated: (cb) => {
    projectUpdateListeners.add(cb);
    return () => { projectUpdateListeners.delete(cb); };
  },
  readFileSource: (filePath: string) => {
    // Mirror handleGetFileSource's path-allowlist so MCP can't escape
    // the project root.
    const inProject = isDirectory ? filePath in projectParse : filePath === resolvedPyFile;
    if (!inProject) return { error: `Unknown file: ${filePath}` };
    try { return { source: fs.readFileSync(filePath, "utf-8") }; }
    catch (e: any) { return { error: e.message }; }
  },
  getShapeGrammarReference: () => SHAPE_GRAMMAR_REFERENCE,
  // M20.1 — resolve a dynamic README + its staleness. The current hash is
  // computed from the live thread / file IR; a stored README whose
  // frontmatter sourceHash differs reads stale (PLAN-v5 §2.2). No current
  // IR → "" sentinel so an orphaned README still surfaces (as stale).
  getReadme: (scope, id) => {
    const root = isDirectory ? inputPath : path.dirname(resolvedPyFile);
    const ir = scope === "thread"
      ? (latestThreads.find((t: any) => t.entryPointId === id) ?? null)
      : (isDirectory ? relativeProjectFiles()[id] ?? null : lastParse);
    const currentHash = ir ? sourceHashOf(ir) : "";
    return readReadmeFromStore(root, scope, id, currentHash);
  },
  generateReadme: (scope, id) => runGenerateReadme(scope, id),
  // C1 (PLAN-v6) — thread-skill generate (draft) + read (with staleness/status).
  generateThreadSkill: (entryPointId) => runGenerateThreadSkill(entryPointId),
  getThreadSkill: (entryPointId) => readThreadSkill(entryPointId),
  // C2 (PLAN-v6) — labelled inference for an unresolved/external node.
  explainNode: (nodeId, filePath) => runExplainNode(nodeId, filePath),
  // D1 (PLAN-v6) — spawn a thread-bounded subagent with an escalation protocol.
  spawnThreadAgent: (entryPointId, task) => runSpawnThreadAgent(entryPointId, task),
  sweepThreadSkills: async () => {
    const r = await runSkillSweep();
    if (!r.ok) throw new Error(r.error);
    return r.summary;
  },
  // vibegraph_plan_work — deterministic decomposition over the live envelope.
  // Pure read: the driving Claude session orchestrates; this never spawns.
  planWork: (task, maxPackets) =>
    planWork({
      task,
      threads: latestThreads as never[],
      entryPoints: latestEntryPoints as never[],
      skillFor: (entryPointId) => readThreadSkill(entryPointId),
      maxPackets,
    }),
};

const mcpHandler = createMcpHttpHandler(mcpContext);

// ── HTTP server ───────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(getIndexHtml());
    return;
  }
  // M7 wave 1 -- MCP Streamable-HTTP endpoint. POST initialize + tools/call
  // + resources/*, GET (SSE) for server->client streaming, DELETE for
  // session termination. Body is JSON-RPC; read + parse before handing
  // to the SDK transport.
  if (req.url === "/mcp") {
    if (req.method === "GET" || req.method === "DELETE") {
      mcpHandler(req, res, null).catch((e: any) => {
        console.warn(`  [MCP] handler error: ${e?.message ?? e}`);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk.toString(); });
      req.on("end", () => {
        let parsed: unknown = null;
        if (body) {
          try { parsed = JSON.parse(body); }
          catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
            return;
          }
        }
        mcpHandler(req, res, parsed).catch((e: any) => {
          console.warn(`  [MCP] handler error: ${e?.message ?? e}`);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        });
      });
      return;
    }
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }
  const filePath = path.join(DIST_DIR, req.url || "");
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

// M4b wave 4 — thread extraction. Pipes the current linked project IR
// (or the single-file IR wrapped to look like a project) through
// scripts/extract_thread.py and emits the result as `thread-update`.
// `thread-error` on any failure so the webview can surface it.
// M7 wave 1 — extracted body so the MCP `vibegraph_extract_thread` tool
// can drive the same pipeline without going through the WebSocket.
function extractThreadCore(filePath: string, irNodeId: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const projectIR: Record<string, unknown> = {};
    // M8.3.3: project IR + seed file passed to the extractor use
    // relative keys, matching the wire format. Callers that pass an
    // absolute path get normalised via relativize() first.
    let seedFile = filePath;
    if (isDirectory) {
      for (const [fp, ir] of Object.entries(projectParse)) projectIR[relativize(fp)] = ir;
      if (path.isAbsolute(filePath)) seedFile = relativize(filePath);
    } else if (lastParse) {
      projectIR[resolvedPyFile] = lastParse;
    }
    if (!projectIR[seedFile]) {
      reject(new Error(`Cannot extract thread: ${seedFile} not in project IR.`));
      return;
    }

    const child = spawn("python3", [EXTRACT_THREAD_SCRIPT,
      "--seed-file", seedFile, "--seed-id", irNodeId],
      { stdio: ["pipe", "pipe", "pipe"], env: pythonEnv() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout));
        } catch (e: any) {
          reject(new Error(`Thread JSON parse error: ${e.message}`));
        }
      } else {
        const firstLine = stderr.split("\n").find((l) => l.trim().length > 0) ?? "unknown error";
        reject(new Error(`extract_thread.py exited ${code}: ${firstLine}`));
      }
    });
    child.stdin.write(JSON.stringify({ files: projectIR }));
    child.stdin.end();
  });
}

// M4b wave 4 — thread extraction WS handler. Pipes the current linked
// project IR (or the single-file IR wrapped to look like a project)
// through scripts/extract_thread.py and emits the result as
// `thread-update`. `thread-error` on any failure so the webview can
// surface it.
function handleExtractThread(filePath: string, irNodeId: string, ws: WebSocket): void {
  extractThreadCore(filePath, irNodeId).then(
    (thread) => ws.send(JSON.stringify({ type: "thread-update", payload: { thread } })),
    (err) => ws.send(JSON.stringify({ type: "thread-error", payload: { message: err.message } })),
  );
}

// M8.3.3 — append a manual thread seed and re-run discovery + extraction
// (PLAN-v2.md §1.2 "manual" kind, §1.3 right-click UX). Persists to
// `<project root>/.vibegraph/manual_seeds.json`. Stores the path
// relative to inputPath so the seeds file stays portable across
// checkouts. Validates that the requested node is actually a
// function_def in the current IR before writing.
async function handleAddManualSeed(filePath: string, irNodeId: string, ws: WebSocket): Promise<void> {
  if (!isDirectory) {
    ws.send(JSON.stringify({ type: "error",
      payload: { message: "Manual seeds are only available in directory mode." } }));
    return;
  }
  // filePath comes in relative (the webview only sees relative paths
  // via the envelope). Resolve to projectParse's absolute key, then
  // re-relativise for the seeds file (portable across checkouts).
  const absPath = resolveProjectPath(filePath);
  const relPath = relativize(absPath);
  const ir = projectParse[absPath];
  const node = ir?.nodes.find((n: any) => n.id === irNodeId);
  if (!node || node.type !== "function_def") {
    ws.send(JSON.stringify({ type: "error",
      payload: { message: `Cannot pin ${irNodeId}: not a function_def in ${relPath}.` } }));
    return;
  }
  const seedsDir = path.join(inputPath, ".vibegraph");
  const seedsPath = path.join(seedsDir, "manual_seeds.json");
  fs.mkdirSync(seedsDir, { recursive: true });
  let payload: { seeds: { file: string; irNodeId: string }[] } = { seeds: [] };
  if (fs.existsSync(seedsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(seedsPath, "utf-8"));
      if (Array.isArray(parsed)) payload.seeds = parsed;
      else if (Array.isArray(parsed.seeds)) payload.seeds = parsed.seeds;
    } catch (e: any) {
      console.warn(`  [Project] manual_seeds.json corrupt — overwriting (${e.message})`);
    }
  }
  // De-dupe on (relative path, irNodeId) — pinning twice is a no-op.
  const exists = payload.seeds.some((s) => s.file === relPath && s.irNodeId === irNodeId);
  if (!exists) {
    payload.seeds.push({ file: relPath, irNodeId });
    fs.writeFileSync(seedsPath, JSON.stringify(payload, null, 2) + "\n");
  }
  // Re-run discovery + extraction so the new seed appears in the next
  // project-update payload. Both consume the relative-keyed view.
  const relFiles = relativeProjectFiles();
  latestEntryPoints = await runDiscoverEntryPoints(relFiles);
  latestThreads = await runExtractAllThreads(relFiles, latestEntryPoints);
  latestSystem = await runBuildSystemTier(relFiles, latestEntryPoints, latestThreads);
  broadcastProjectUpdate();
  // Sitting-2 — the pin used to be SILENT: discovery seeds manual pins LAST
  // and dedups against already-seeded functions, so pinning a function that
  // already has a thread produced no new row and no feedback at all ("start
  // a thread from here did nothing"). Answer with the honest outcome: what
  // the function's thread actually is (manual = the pin took; any other kind
  // = it already had one; absent = discovery dropped the seed).
  const ep = (latestEntryPoints ?? []).find(
    (e: any) => e.file === relPath && e.irNodeId === irNodeId,
  );
  ws.send(JSON.stringify({ type: "manual-seed-result", payload: {
    file: relPath,
    irNodeId,
    outcome: ep ? (ep.kind === "manual" ? "added" : "already-seeded") : "not-seeded",
    entryPointId: ep?.id ?? null,
    qualifiedName: ep?.qualifiedName ?? null,
    kind: ep?.kind ?? null,
  } }));
}

// M5 wave 2 — full-file source read for the code-view panel. Single
// reply or single error, mirroring the edit-node-source contract but
// for whole files instead of node spans.
function handleGetFileSource(filePath: string, ws: WebSocket): void {
  // U1.1 — the webview now sees relative paths post-M8.3.3 but
  // projectParse keeps absolute keys internally; resolve through
  // resolveProjectPath() so either format works.
  //   - directory mode: must point at a real file inside the project.
  //   - single-file mode: must echo resolvedPyFile; any other value
  //     is rejected so the WS can't read arbitrary paths.
  let resolved: string;
  if (isDirectory) {
    resolved = resolveProjectPath(filePath);
    if (!(resolved in projectParse)) {
      ws.send(JSON.stringify({
        type: "file-source-error",
        payload: { filePath, message: `Unknown file in project: ${filePath}` },
      }));
      return;
    }
  } else {
    if (filePath !== resolvedPyFile) {
      ws.send(JSON.stringify({
        type: "file-source-error",
        payload: { filePath, message: "Only the active file is readable in single-file mode." },
      }));
      return;
    }
    resolved = resolvedPyFile;
  }
  try {
    const source = fs.readFileSync(resolved, "utf-8");
    ws.send(JSON.stringify({
      type: "file-source",
      payload: { filePath, source },
    }));
  } catch (e: any) {
    ws.send(JSON.stringify({
      type: "file-source-error",
      payload: { filePath, message: `Read failed: ${e.message}` },
    }));
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

const clients = new Set<WebSocket>();

function setupWebSocket() {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    clients.add(ws);
    // M6 wave 1 — surface runtime feature flags so the webview can show
    // a banner when Analyze/Intent are silently disabled. M7 wave 2:
    // the flag now reflects whether the Claude Code CLI is on PATH, not
    // whether ANTHROPIC_API_KEY is set. Field name kept stable so the
    // webview doesn't need a protocol bump.
    ws.send(JSON.stringify({
      type: "runtime-state",
      payload: { anthropicAvailable: claudeCliAvailable },
    }));
    broadcastProjectWarnings(ws);
    sendParse(ws);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "run-node") {
          handleRun(msg.payload.nodeId, ws, msg.payload.filePath);
        } else if (msg.type === "run-thread-to-node") {
          // M-RUN SM1 — ephemeral probe run of the path to node N (SM2: with
          // confirmed synthesized args when payload.synthArgs is present).
          handleRunThreadToNode(msg.payload, ws);
        } else if (msg.type === "synth-thread-args") {
          // M-RUN SM2.c phase 1 — synthesize + validate args, propose for confirm.
          handleSynthThreadArgs(msg.payload, ws);
        } else if (msg.type === "synth-thread-data") {
          // M-RUN2.3 — draft an example data file for a missing path; the
          // reply carries the full content + a content-hash consent token.
          handleSynthThreadData(msg.payload, ws);
        } else if (msg.type === "edit-node-open") {
          handleEditOpen(msg.payload.nodeId, ws, msg.payload.filePath);
        } else if (msg.type === "edit-node-save") {
          handleEditSave(msg.payload.nodeId, msg.payload.newSource, ws, msg.payload.filePath);
        } else if (msg.type === "replace-body-save") {
          // M18.3 — Mode A commit through op_replace_function_body / _module_body.
          handleReplaceBodySave(msg.payload, ws);
        } else if (msg.type === "place-intent") {
          // M18.5 — Mode B: intent → heuristic/LLM proposal → preview.
          handlePlaceIntent(msg.payload, ws);
        } else if (msg.type === "set-model-tiers") {
          // Boundary validation: sanitiseTiers whitelists both fields, so an
          // arbitrary --model string from a WS client can never reach the CLI.
          const tiers = sanitiseTiers(msg.payload);
          setModelTiers(tiers);
          console.log(`[models] thinking=${tiers.thinking ?? "cli-default"} routine=${tiers.routine}`);
        } else if (msg.type === "chat-send") {
          // Boundary validation: only a whitelisted id ever reaches the
          // CLI as --model; anything else falls back to the CLI default.
          handleChat(msg.payload.text, msg.payload.contextNodeId ?? null, !!msg.payload.clearHistory, ws, msg.payload.filePath, msg.payload.threadEntryPointId ?? null,
            isKnownChatModel(msg.payload?.model) ? msg.payload.model : null);
        } else if (msg.type === "stage-chat-send") {
          // M-GF3.4 — per-stage dialogue turn (scoped session).
          handleStageChat(msg.payload.plan, msg.payload.itemId, msg.payload.text, ws);
        } else if (msg.type === "stage-chat-close") {
          // M-GF3.4 — dialog closed: drop the scoped session + child.
          handleStageChatClose(msg.payload.itemId, ws);
        } else if (msg.type === "build-plan-item-modify") {
          // M-GF3.4 — apply a dialogue-proposed revision to the ratified
          // roadmap (validated + persisted; pending plans apply client-side).
          handleBuildPlanItemModify(msg.payload.itemId, msg.payload.revision, ws);
        } else if (msg.type === "compose-propose") {
          // PLAN-v7 Stage 1 — dry-run preview; no write. Reply: compose-proposal.
          handleComposePropose(
            msg.payload.mode,
            msg.payload.anchorNodeId ?? null,
            msg.payload.source,
            msg.payload.filePath,
            ws
          );
        } else if (msg.type === "compose-propose-intent") {
          // PLAN-v7 Stage 1b — plain-language intent → claude -p draft →
          // dry-run → drafted ghost. Reply: compose-proposal (drafted: true).
          handleComposeProposeIntent(
            msg.payload.intent,
            msg.payload.mode,
            msg.payload.anchorNodeId ?? null,
            msg.payload.filePath,
            ws
          );
        } else if (msg.type === "system-propose") {
          // PLAN-v7 Stage 3 — validate a proposed architecture at the
          // boundary; echo as a pending proposal. Reply: system-proposal.
          handleSystemPropose(msg.payload.plan, ws);
        } else if (msg.type === "system-propose-intent") {
          // PLAN-v7 Stage 3b — describe → claude -p architecture draft →
          // system-proposal (drafted plan, grounding-enforced).
          handleSystemProposeIntent(msg.payload.description, ws);
        } else if (msg.type === "system-plan-accept") {
          // PLAN-v7 Stage 3 — human ratification: persist the plan artifact
          // + rebroadcast the envelope. Reply: system-plan-saved.
          handleSystemPlanAccept(msg.payload.plan, ws);
        } else if (msg.type === "changeset-propose") {
          // PLAN-v7 Stage 4 — build-increment proposal: dry floor (parse +
          // sandboxed behavioural check), no write. Reply: changeset-proposal.
          // 6b: an optional effectConsentToken authorizes running an
          // EFFECTFUL check (scope-bound, fresh-scan re-validated).
          handleChangesetPropose(msg.payload.changeset, ws, msg.payload.effectConsentToken, msg.payload.runItemId, msg.payload.trustUnverified);
        } else if (msg.type === "build-plan-propose") {
          // PLAN-v7 Stage 5 — canned/validated roadmap proposal (5a path).
          handleBuildPlanPropose(msg.payload.plan, ws);
        } else if (msg.type === "build-plan-propose-intent") {
          // PLAN-v7 Stage 5b — draft the roadmap from the ratified plan.
          // M-GF3.5: optional guidance + previous draft turn it into a revise.
          handleBuildPlanProposeIntent(ws, msg.payload?.guidance, msg.payload?.previous);
        } else if (msg.type === "changeset-modify") {
          // M-GF3.5 — Modify at the gate: re-draft the current increment
          // with the human's instruction; same floor, same gate.
          handleChangesetModify(msg.payload.instruction, msg.payload.runItemId, msg.payload.label, ws);
        } else if (msg.type === "build-plan-accept") {
          // PLAN-v7 Stage 5 — ratify the roadmap (persist + envelope).
          handleBuildPlanAccept(msg.payload.plan, ws);
        } else if (msg.type === "build-run-start" || msg.type === "build-run-pause"
          || msg.type === "build-run-reject" || msg.type === "build-run-retry"
          || msg.type === "build-run-skip" || msg.type === "build-run-stop") {
          // PLAN-v7 Stage 5 — orchestrator run controls (accept advances via
          // the changeset-accept path; these are the human's other dials).
          handleBuildRunControl(msg);
        } else if (msg.type === "changeset-propose-intent") {
          // PLAN-v7 Stage 4b — capability intent → builder-drafted increment
          // → the full 4a floor → the same gate. Reply: changeset-proposal.
          handleChangesetProposeIntent(msg.payload.intent, ws);
        } else if (msg.type === "changeset-accept") {
          // PLAN-v7 Stage 4 — accepted increment: wet create_file per file
          // through the chokepoint, re-parse, derived refresh (ghosts
          // solidify). Reply: changeset-done.
          handleChangesetAccept(msg.payload.changeset, ws);
        } else if (msg.type === "compose-insert") {
          handleComposeInsert(
            msg.payload.mode,
            msg.payload.anchorNodeId ?? null,
            msg.payload.source,
            msg.payload.filePath,
            ws
          );
        } else if (msg.type === "analyze-file") {
          handleAnalyzeFile(msg.payload?.filePath, ws);
        } else if (msg.type === "extract-thread") {
          handleExtractThread(msg.payload.filePath, msg.payload.irNodeId, ws);
        } else if (msg.type === "get-file-source") {
          handleGetFileSource(msg.payload.filePath, ws);
        } else if (msg.type === "resolve-external-call") {
          // M13.2 — tooltip request for inspect-based signature lookup.
          handleResolveExternalCall(msg.payload, ws);
        } else if (msg.type === "add-manual-seed") {
          // M8.3.3 — append a manual thread seed and re-discover.
          handleAddManualSeed(msg.payload.filePath, msg.payload.irNodeId, ws);
        } else if (msg.type === "get-thread-skills") {
          // M-SKILL.3 — skill lifecycle states for the UI badges/dots.
          handleGetThreadSkills(ws);
        } else if (msg.type === "get-artifact-index") {
          // M-TRAINED.2 — trained-ness as artifact state, for the chip.
          ws.send(JSON.stringify({ type: "artifact-index", payload: { artifacts: computeArtifactIndex() } }));
        } else if (msg.type === "ratify-thread-skill") {
          handleRatifyThreadSkill(msg.payload, ws);
        } else if (msg.type === "redraft-thread-skill") {
          handleRedraftThreadSkill(msg.payload, ws);
        } else if (msg.type === "get-thread-skill-diff") {
          // M-SKILL.7 — what changed since the skill's stamp.
          handleGetThreadSkillDiff(msg.payload, ws);
        } else if (msg.type === "reaffirm-thread-skill") {
          handleReaffirmThreadSkill(msg.payload, ws);
        } else if (msg.type === "set-skill-auto-reaffirm") {
          handleSetSkillAutoReaffirm(msg.payload, ws);
        } else if (msg.type === "skill-sweep-start") {
          // M-SKILL.4 — batch-draft every non-authoritative thread skill.
          handleSkillSweep(ws);
        } else if (msg.type === "get-readme") {
          // M20.2 — README status (exists / stale / body) for the badge.
          handleGetReadme(msg.payload, ws);
        } else if (msg.type === "generate-readme") {
          // M20.2 — generate / refresh on request (never on save).
          handleGenerateReadme(msg.payload, ws);
        } else if (msg.type === "selection-changed") {
          // M7 wave 1 — webview broadcasts each vg-selection emit so the
          // server (and any MCP clients) learn about clicks. We don't
          // re-broadcast back -- the webview already replicates state
          // locally via the M5 bus -- but we do fire MCP listeners so a
          // subscribed Claude Code session sees the resource update.
          const nid = msg.payload?.irNodeId ?? msg.payload?.nodeId;
          if (typeof nid === "string") {
            currentSelection = { nodeId: nid, filePath: msg.payload?.filePath ?? null };
            notifySelectionChanged({ nodeId: nid, filePath: msg.payload?.filePath });
          }
        }
      } catch {}
    });

    ws.on("close", () => {
      clients.delete(ws);
      // M27.1 — never let a chat child outlive its client. M-GF3.4: every
      // scope (main panel + any stage dialogues) goes with it.
      for (const state of chatSessions.get(ws)?.values() ?? []) state.session.dispose();
      chatSessions.delete(ws);
    });
  });
}

async function sendParse(ws?: WebSocket) {
  if (isDirectory) {
    // M26.1 follow-up — don't launch a full parseAllFiles per WS
    // connect: it competed with the edit chokepoint (see the stamp
    // guard in parseAllFiles) and made every new tab pay seconds of
    // re-parse for state the boot parse + watcher already keep fresh.
    // Primed connect → the new client just gets the current envelope.
    // ONLY for per-connection sends: the no-ws callers (boot prime,
    // watcher debounce) exist to run the full pass.
    if (ws && Object.keys(projectParse).length > 0) {
      broadcastProjectUpdate(ws);
      return;
    }
    await parseAllFiles();
    if (ws) broadcastProjectUpdate(ws);
    return;
  }
  try {
    const result = await parseFile();
    lastParse = result;
    const msg = JSON.stringify({ type: "ast-update", payload: { filePath: resolvedPyFile, ...result } });
    if (ws) {
      ws.send(msg);
    } else {
      for (const c of clients) c.send(msg);
    }
  } catch (err: any) {
    const msg = JSON.stringify({ type: "error", payload: { message: err.message } });
    if (ws) ws.send(msg);
    else for (const c of clients) c.send(msg);
  }
}

// ── File watcher ──────────────────────────────────────────────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function debounceReparse() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => sendParse(), 300);
}

// A watcher's async "error" event is fatal if unhandled (the try/catch
// around fs.watch only covers synchronous setup). The recursive watcher
// emits one when a watched subdirectory vanishes mid-scan — e.g.
// `.vibegraph/` deleted while the server runs (6d pre-flight round 4).
// Log and keep serving; external-edit watching degrades until restart.
function guardWatcher(w: fs.FSWatcher): fs.FSWatcher {
  return w.on("error", (err) => {
    console.warn(`  [Watch] watcher error (external-edit watching may stop) — ${(err as Error).message}`);
  });
}

if (isDirectory) {
  try {
    guardWatcher(fs.watch(inputPath, { recursive: true }, (_, filename) => {
      if (!filename) return;
      if (!filename.endsWith(".py")) {
        // Not source — but an artifact write still changes what the chip must
        // say (see refreshArtifactIndex). Everything else is ignored as before.
        if (isKnownArtifactPath(filename)) refreshArtifactIndex();
        return;
      }
      // M26.1 — our own edit chokepoint already re-parsed this file and
      // scheduled the incremental derived refresh; the full pipeline is
      // only for edits made outside VibeGraph.
      if (isRecentSelfEdit(filename)) return;
      debounceReparse();
    }));
  } catch {
    // Fallback: watch individual files
    for (const f of findPyFiles(inputPath)) {
      guardWatcher(fs.watch(f, (_, filename) => {
        if (filename && isRecentSelfEdit(filename)) return;
        debounceReparse();
      }));
    }
  }
} else {
  guardWatcher(fs.watch(resolvedPyFile, debounceReparse));
}

// ── Start ─────────────────────────────────────────────────────────────────────

let port = parseInt(process.env.PORT || "4200", 10);

// Every tryListen() retry stacks another once('listening') callback on the
// SAME server, and all of them fire when a later port finally binds — the
// boot block ran once per attempted port, setupWebSocket() double-registered
// the upgrade handler, and the first real WS connection crashed the server
// ("handleUpgrade() was called more than once"). Guard the boot block so a
// port bump boots exactly once. (Found live in the M-GF3 rehearsal.)
let booted = false;

function tryListen() {
  server.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.log(`  Port ${port} in use, trying ${port + 1}...`);
      port++;
      server.close();
      tryListen();
    } else {
      throw err;
    }
  });

  // M27.0 — bind loopback by default. The server exposes an
  // edit-capable MCP endpoint (and, with M27, a persistent agent
  // session); listening on all interfaces hands that to the LAN.
  // VG_HOST opts out explicitly — and loudly.
  const host = process.env.VG_HOST ?? "127.0.0.1";
  server.listen(port, host, () => {
    if (booted) return;
    booted = true;
    setupWebSocket();
    if (host !== "127.0.0.1" && host !== "localhost") {
      console.warn(`\n  ⚠ VG_HOST=${host} — VibeGraph is reachable beyond this machine.`);
      console.warn(`    Anyone who can reach it can read AND EDIT the loaded project.`);
    }
    console.log(`\n  VibeGraph is running!`);
    if (isDirectory) {
      const count = findPyFiles(inputPath).length;
      console.log(`  Project:  ${inputPath} (${count} Python files)`);
    } else {
      console.log(`  Watching: ${resolvedPyFile}`);
    }
    console.log(`  Open:     http://localhost:${port}`);
    console.log(`  MCP:      http://localhost:${port}/mcp\n`);
    // M7 wave 1 — eager parse at boot so MCP clients (Claude Code) can
    // read the IR before any webview connects. Per-connection sendParse
    // calls remain for WS clients; this just primes the cache.
    sendParse().catch((e: any) => {
      console.warn(`  [Boot] initial parse failed: ${e?.message ?? e}`);
    });
  });
}

tryListen();

// ── HTML template ─────────────────────────────────────────────────────────────

function getIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VibeGraph</title>
  <link rel="stylesheet" href="/webview.css">
  <style>
    /* Anti-FOUC: matches --bg-canvas in tokens.css. HSL form (no raw hex). */
    html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    body { background: hsl(220 14% 8%); }
  </style>
</head>
<body>
  <div id="root"></div>
  <script src="/webview.js"></script>
</body>
</html>`;
}
