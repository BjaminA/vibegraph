import { bootMarkup } from "./src/shared/boot_markup";
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
// M-STACK (PLAN-M-STACK.md) — stack facts (pure, IR-derived) + the system
// spec that renders them WITH the stated policies bound to each tool.
import { buildStackIndex, contractStackForFile, stackForThread, stackCalledOnThread, toolsAddedByDelta, type StackIndex } from "./src/server/stack";
import { buildCrossingIndex, type CrossingIndex } from "./src/server/crossings";
import { archModelForEnvelope } from "./src/server/arch_envelope";
import { applyArchStore, loadArchStore, saveArchStore, ratifyProposal, rejectProposal } from "./src/server/arch_store";
import { buildProposePrompt, docExcerpts, parseProposal } from "./src/server/arch_propose";
import { readInfraManifests } from "./src/server/infra_manifests";
import { readManualSeeds } from "./src/server/manual_seeds";
import type { ArchModelRecord } from "./src/shared/protocol";
// M-STACK.3 — the SYSTEM SPEC: the one render of stack facts WITH the
// policies stated about each tool. Every prompt that needs the stack
// reads this, so they cannot drift into four different summaries.
import { formatSystemSpec, stackSummaryLine, packetStackLine } from "./src/server/stack_spec";
import {
  checkConstraint, describeCheck, isConstraintCheck,
  type CheckFacts, type ReferenceFact, type UnresolvedFact,
} from "./src/server/constraint_grammar";
// Quality layer (reviews/quality-layer/RUN3.md §9/§10) — the five Run 1
// verbs in the live pre-checks, gated by their calibration standings; the
// closing bar computed at the objective gate.
import { buildQualityFacts } from "./src/server/quality/facts";
import { run1Registry, isRun1Check, describeRun1Check } from "./src/server/quality/verbs/index";
import { verbMayGate, calibratedVerbs } from "./src/server/quality/standings";
import { deriveStackProfile } from "./src/server/quality/profile";
import { deriveQualityModel } from "./src/server/quality/model";
import { computeAcceptance } from "./src/server/quality/acceptance";
import type { QualityFacts, RunDelta } from "./src/server/quality/check_registry";
import { execFileSync } from "node:child_process";
import { buildArtifactIndex, detectMissingArtifacts, missingArtifactFor, isArtifactPath, type ArtifactRecord } from "./src/server/artifact_index";
import { planSweep, runSweep } from "./src/server/skill_sweep";
import { parseReviseStageBlock, applyItemRevision } from "./src/server/build_plan_modify";
import { makeRunSandbox } from "./src/server/run/sandbox";
import { getReadme as readReadmeFromStore, writeReadme, sourceHashOf, PROJECT_README_ID, type ReadmeScope } from "./src/server/readme_store";
import { VIBEREADME_REQUIRED_SECTIONS, validateVibeReadmeBody } from "./src/server/vibereadme_contract";
import {
  getThreadSkill as readThreadSkillFromStore,
  readStoredThreadSkill,
  threadSkillKey,
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
// M-CRYSTAL.2 — the stamp and its rules block are a pure module now, so the
// export (no server) reads a stored skill through the SAME function.
import { skillRulesBlock, threadSkillStamp as stampThreadSkill } from "./src/server/thread_skill_stamp";
import { extractFunctionSource } from "./src/server/intent_extract";
import { synthesizeArgs, resolveClaudeBin, spawnEnv, setShimPath, getModelTiers, type SpawnTarget } from "./src/server/run/synth_args";
// M-PROVIDER — model routes on disk + the local-endpoint probe; the local chat backend.
import { loadModelRoutes, saveModelRoutes, probeOllamaEndpoint } from "./src/server/model_store";
import { OllamaChatBackend } from "./src/server/chat/ollama_backend";
import { LOCAL_CHAT_MODEL_ID } from "./src/shared/chat_models";
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
import { draftThreadSkill } from "./src/server/thread_skill_draft";
import { computeBlastRadius, type BlastFile, type BlastThread } from "./src/server/blast_radius";
import { diffIR, type IrDelta } from "./src/server/ir_delta";
// M-LANG1 — the language-frontend registry (PLAN-M-LANG.md). File
// discovery, watching, and parse spawns dispatch through it; python is
// the only registered frontend until M-LANG2.
import {
  languageForPath, languageForFile, isSourceFile, shouldSkipDir,
  parseCommand, batchParseCommand, moduleIdentity,
  linkCommand, discoverCommand, discoverProjectCommand, rewriteCommand,
  type LanguageInfo,
} from "./src/server/languages";
// The capability table itself lives in the SHARED registry (the webview
// reads the same one), and the run gate has to be the same fact on both
// sides or an affordance and its operation drift apart.
import { capabilitiesForPath } from "./src/shared/languages";
import { assessBashTrace, BASH_TRACE_LIMITS } from "./src/server/bash_floor";
import { BASH_KEYWORDS, BASH_SHELL_BUILTINS } from "./src/shared/stack_taxonomy";
// M-AGENT1 (PLAN-M-AGENT.md) — the Agent Manager spine (pure, tested).
import {
  draftWorkRun, loadWorkRun, persistWorkRun, WORK_RUN_FILE,
  setRunStatus, setPacketStatus, packetTransitionError,
  runOutcome, runSummary, MAX_PACKET_ATTEMPTS,
  // M-ORCH.4 — lanes: the scheduler fills them with disjoint edit scopes.
  editScopeOf, inFlightPackets, startablePackets, MAX_LANES,
  warmSessionFor, clearWorkerSessions, MAX_SESSION_PACKETS,
  type WorkRun, type RunPacket, type PacketEvidence,
} from "./src/server/work_run";
import { AUTONOMY_RULING, resolveEscalationAutonomously } from "./src/server/work_run";
import { addSpend, costOf, emptySpend, type SpendKind } from "./src/server/spend";
import { derivedGate } from "./src/server/quality/derived_gate";
// M-AGENT3 — the worker-session contract (prompt, output block, diff).
import { buildWorkerPrompt, buildSystemWorkerPrompt, parsePacketResult, lineDiff, WORKER_TURN_BUDGET } from "./src/server/work_worker";
// M-CONTRACT (PLAN-M-CONTRACT.md) — the thread contract (IR fact) and the
// stated-constraint store (provenance-labelled), both pure + tested.
import { computeThreadContract, formatContractBlock, summarizeContract, type ThreadContract } from "./src/server/thread_contract";
import {
  loadConstraints, addConstraint, removeConstraint, routeConstraints, formatConstraintsBlock,
  validateConstraintInput, findDuplicate, type Constraint, type ConstraintSource,
} from "./src/server/constraint_store";
// M-ORCH — the holistic orchestrator (brief + review), pure + tested.
import {
  buildBriefPrompt, parseBrief, unavailableBrief, packetTaskText, briefThreadSummaries,
  preCheckReport, buildReviewPrompt, parseVerdict, noChangePackets, materializeSystemPackets, applyBriefOrdering,
  stackPolicyInputs,
} from "./src/server/orchestration";
import type { PacketReview } from "./src/shared/protocol";
import { explainPrompt, EXPLAIN_ATTRIBUTION, type NodeExplanation } from "./src/server/explain";
import { OBSERVE_NOTE, type DynamicObservation } from "./src/server/observe";
import {
  clearTraceRun, hashSource, joinTraceToNodes, markStaleness, observationsForNode,
  readObservations, writeTraceRun, type TraceRun, type TracedSite,
} from "./src/server/observations";
import { buildThreadAgentPrompt, isEscalation, renderAgentProjection, type ThreadAgentResult } from "./src/server/thread_agent";
import { deriveThreadCalls, threadAdjacency } from "./src/webview/system/threadInteraction";
import { refreshExportedArchitecture } from "./src/server/arch_refresh";
import { isKnownChatModel } from "./src/shared/chat_models";
import { sanitiseTiers, resolveTierRoute, routeLabel, DEFAULT_LOCAL, type ModelTier } from "./src/shared/model_tiers";
import { setModelTiers } from "./src/server/run/synth_args";
// M-SKILLS.2 — generic direction skills: shipped with VibeGraph, enabled
// per analysed project, selected by the stack profile, injected after the
// thread skill under the same budget.
import {
  loadGenericSkills, readSkillsConfig, saveSkillsConfig, sanitiseSkillsConfig, selectGenericSkills,
  renderGenericSkillsBlock, packetTaskFacts, catalogueOf, auditOf, describeAudit,
  type GenericSkill, type SkillsConfig,
} from "./src/server/generic_skills";
import { mergeRelinked, ParseGenerations } from "./src/server/relink";

// When bundled, __dirname = dist/, so go up one level for project root
const PROJECT_ROOT = path.join(__dirname, "..");
// M-PROVIDER — a tier routed to a local model spawns this shim in place of claude.
setShimPath(path.join(PROJECT_ROOT, "scripts", "vg_ollama_shim.mjs"));
// M-SKILLS.2 — the six generic skills ship with VibeGraph (skills/); the
// ENABLE file is per analysed project and is read below. A skill that fails
// its own contract is refused at boot and named, never half-loaded.
const genericSkillsLoaded = loadGenericSkills(path.join(PROJECT_ROOT, "skills"));
for (const [name, ps] of Object.entries(genericSkillsLoaded.problems)) console.warn(`  [skills] ${name}: ${ps.join("; ")}`);
const GENERIC_SKILLS: GenericSkill[] = genericSkillsLoaded.skills;
// (parse_cst.py's path moved into src/server/languages.ts — M-LANG1: the
// registry owns per-language parse commands; the consts below stay until
// their scripts gain a second-language variant.)
const RUN_BLOCK_SCRIPT = path.join(PROJECT_ROOT, "scripts", "run_block.py");
const RUN_TO_NODE_SCRIPT = path.join(PROJECT_ROOT, "scripts", "run_to_node.py");
const TRACE_RUN_SCRIPT = path.join(PROJECT_ROOT, "scripts", "trace_run.py");
const TRACE_BASH_SCRIPT = path.join(PROJECT_ROOT, "scripts", "trace_bash.mjs");
const SCAN_EFFECTS_SCRIPT = path.join(PROJECT_ROOT, "scripts", "scan_effects.py");
const CHECK_LITERALS_SCRIPT = path.join(PROJECT_ROOT, "scripts", "check_literals.py");
const REWRITE_SCRIPT = path.join(PROJECT_ROOT, "scripts", "cst_rewrite.py");
const EXTRACT_THREAD_SCRIPT = path.join(PROJECT_ROOT, "scripts", "extract_thread.py");
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

// M-STACK.1 (PLAN-M-STACK.md) — the STACK FACTS: which software tools the
// project uses, with the parse evidence behind each. Pure derivation over
// the relative-keyed file map + threads + the manifests at inputPath;
// rebuilt with the rest of the derived state, never persisted. Rides the
// envelope as an OPTIONAL sibling of `constraints`.
let latestStack: StackIndex = { tools: [], byFile: {}, byThread: {} };

// M-XLANG.1 (PLAN-M-V5FORKS.md) - CROSSINGS: where a thread leaves its own
// language over HTTP and which route serves it. Pure derivation over the
// relative-keyed map + entry points + threads, rebuilt with the rest of
// the derived state, never persisted. Rides the envelope as an OPTIONAL
// sibling of `stack`.
let latestCrossings: CrossingIndex = { all: [], byThread: {} };

function rebuildCrossings(relFiles: typeof projectParse): void {
  try {
    latestCrossings = buildCrossingIndex({
      files: relFiles as any,
      entryPoints: latestEntryPoints as any,
      threads: latestThreads as any,
    });
  } catch (e: any) {
    console.warn(`  [Crossings] index failed: ${e?.message ?? e}`);
    latestCrossings = { all: [], byThread: {} };
  }
}

// M-ARCH.1 (PLAN-M-ARCH.md) — the derived architecture: clusters of entry
// points, boundary tools, and the edges the hops and contracts already say,
// each with a protocol read from the fact. Rebuilt after the crossings (it
// aggregates them); rides the envelope as an OPTIONAL sibling of `system`.
let latestArch: ArchModelRecord | null = null;
// M-ARCH.4 — the derived model held apart from the stated/proposed layer,
// so ratify / reject / a new proposal re-apply without re-deriving.
let latestArchDerived: ArchModelRecord | null = null;

function rebuildArch(relFiles: typeof projectParse): void {
  try {
    latestArchDerived = archModelForEnvelope(
      { files: relFiles as any, entryPoints: latestEntryPoints as any, threads: latestThreads as any },
      latestStack, latestCrossings, isDirectory ? inputPath : null, undefined, { applyStore: false },
    );
    reapplyArchStore();
  } catch (e: any) {
    console.warn(`  [Architecture] model failed: ${e?.message ?? e}`);
    latestArch = null;
    latestArchDerived = null;
  }
}

function reapplyArchStore(): void {
  if (!latestArchDerived) { latestArch = null; return; }
  try {
    latestArch = isDirectory ? applyArchStore(latestArchDerived, loadArchStore(inputPath)) : latestArchDerived;
  } catch (e: any) {
    console.warn(`  [Architecture] stated layer failed to apply: ${e?.message ?? e}`);
    latestArch = latestArchDerived;
  }
}

// M-ARCH.4 — the ONE token-spending path of the architecture layer. The
// model sees the derived model, the deployment facts and doc excerpts, and
// may propose groups / names / a primary path / a narrative; the reply is
// grounded against what it was shown and stored PENDING. Nothing it says
// becomes stated until a human ratifies (arch-ratify, GUI only).
async function archProposeCore(guidance?: string): Promise<{ ok: boolean; error?: string; refused?: number; groups?: number; names?: number }> {
  if (!isDirectory) return { ok: false, error: "the architecture layer needs a project directory" };
  if (!latestArchDerived || !latestArchDerived.nodes.length) return { ok: false, error: "no derived architecture yet — the project has not finished parsing" };
  if (!claudeCliAvailable) return { ok: false, error: "the claude CLI is unavailable — can't propose an architecture" };
  const facts = readInfraManifests(inputPath).facts;
  const docs = docExcerpts(inputPath, latestArchDerived);
  // Modify (the M-GF3 gate): a revision re-drafts the PENDING proposal with
  // the person's words; the same grounding floor applies to what comes back.
  const pending = loadArchStore(inputPath).proposal;
  const g = typeof guidance === "string" ? guidance.trim() : "";
  if (g && !pending) return { ok: false, error: "there is no pending proposal to modify" };
  const prompt = buildProposePrompt(latestArchDerived, facts, docs, g && pending ? { previous: pending, guidance: g } : undefined);
  const text = await _runReadmeLlm(prompt, "thinking", "gen");
  if (text === null) return { ok: false, error: `the model returned nothing${genFailureSuffix()}` };
  const parsed = parseProposal(text, latestArchDerived, facts, docs, { model: tierLabel("thinking") });
  if (!parsed.proposal) return { ok: false, error: parsed.error ?? "the reply was not a usable proposal" };
  const store = loadArchStore(inputPath);
  store.proposal = parsed.proposal;
  saveArchStore(inputPath, store);
  reapplyArchStore();
  broadcastProjectUpdate();
  refreshArchDocs();
  return { ok: true, groups: parsed.proposal.groups.length, names: Object.keys(parsed.proposal.names).length, refused: parsed.proposal.refused.length };
}

/** After a proposal changes, the exported architecture documents follow it
 *  (src/server/arch_refresh.ts) — an agent reading .vibegraph/knowledge must
 *  not see the map from before the person decided. */
function refreshArchDocs(): void {
  if (!isDirectory || !latestArch) return;
  try {
    const r = refreshExportedArchitecture(inputPath, latestArch, {
      entryPoints: latestEntryPoints as any, system: latestSystem as any,
      threadGraph: deriveThreadCalls(latestThreads as any, latestEntryPoints as any, latestCrossings),
      tool: "VibeGraph (live server)",
    });
    if (r.written.length) console.log(`  [Architecture] refreshed ${r.written.join(", ")}`);
    if (r.stale.length) console.log(`  [Architecture] not refreshed (needs the CLI's git provenance): ${r.stale.join(", ")}`);
  } catch (e: any) {
    console.warn(`  [Architecture] exported documents not refreshed: ${e?.message ?? e}`);
  }
}

function archDecide(decision: "ratify" | "reject"): { ok: boolean; error?: string } {
  if (!isDirectory) return { ok: false, error: "the architecture layer needs a project directory" };
  const store = loadArchStore(inputPath);
  if (!store.proposal) return { ok: false, error: "there is no pending architecture proposal" };
  saveArchStore(inputPath, decision === "ratify" ? ratifyProposal(store) : rejectProposal(store));
  reapplyArchStore();
  broadcastProjectUpdate();
  refreshArchDocs();
  return { ok: true };
}

function rebuildStack(relFiles: typeof projectParse): void {
  try {
    latestStack = buildStackIndex(
      { files: relFiles as any, threads: latestThreads as any },
      isDirectory ? inputPath : undefined,
    );
  } catch (e: any) {
    console.warn(`  [Stack] index failed: ${e?.message ?? e}`);
    latestStack = { tools: [], byFile: {}, byThread: {} };
  }
}

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
// M-ARCH.2 — the TS parser reads tsconfig `paths` relative to the project,
// and it is handed absolute paths: every frontend spawn inherits the root.
if (isDirectory) process.env.VG_PROJECT_ROOT = inputPath;
// M-PROVIDER — .vibegraph/models.json is the source of truth for model
// routes (a headless driver and the board must route the same way).
{
  const stored = isDirectory ? loadModelRoutes(inputPath) : null;
  if (stored) {
    setModelTiers(stored);
    console.log(`[models] routes loaded: ${(["thinking", "routine", "worker"] as ModelTier[]).map((t) => `${t}=${routeLabel(resolveTierRoute(t, stored))}`).join(" ")}`);
  }
}
// M-SKILLS.2 — .vibegraph/skills.json: which generic skills this project
// enabled, with who and when. Off by default; a malformed file enables
// nothing and says so rather than half-applying.
let skillsConfig: SkillsConfig = { version: "1.0", enabled: [] };
if (isDirectory) {
  const loaded = readSkillsConfig(inputPath);
  skillsConfig = loaded.config;
  for (const p of loaded.problems) console.warn(`  [skills] ${p}`);
  console.log(`[skills] ${GENERIC_SKILLS.length} shipped; enabled here: ${skillsConfig.enabled.join(", ") || "(none)"}`);
}
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
  // M-LANG1 — dispatch through the language registry. Unregistered
  // extensions reject loudly rather than being fed to the wrong parser.
  const lang = langOf(filePath);
  if (!lang) {
    return Promise.reject(new Error(`No language frontend registered for: ${filePath}`));
  }
  const cmd = parseCommand(lang, path.join(PROJECT_ROOT, "scripts"), filePath, modulePath);
  // Server-stamps the discriminator (like `filePath`): parse_cst.py emits
  // v1.5 IRs with no language field; frontends emitting IR 2.0 carry their own.
  const stamp = (parsed: any) => ({ language: lang.id, ...parsed });
  return new Promise((resolve, reject) => {
    const opts = { timeout: 10000, env: cmd.needsPythonEnv ? pythonEnv() : process.env };
    execFile(cmd.bin, cmd.argv, opts, (err, stdout, stderr) => {
      if (err && cmd.fallbackBin) {
        execFile(cmd.fallbackBin, cmd.argv, opts, (err2, stdout2, stderr2) => {
          if (err2) {
            reject(new Error(stderr || stderr2 || "Parser failed (libcst missing? run runVis.sh to bootstrap)"));
            return;
          }
          try { resolve(stamp(JSON.parse(stdout2))); } catch { reject(new Error(`Parse failed: ${filePath}`)); }
        });
        return;
      }
      if (err) {
        reject(new Error(stderr || "Parser failed"));
        return;
      }
      try { resolve(stamp(JSON.parse(stdout))); } catch { reject(new Error(`Parse failed: ${filePath}`)); }
    });
  });
}

function parseFile(): Promise<any> {
  return parseOneFile(resolvedPyFile);
}

// M4a — convert an absolute file path under inputPath to its language-
// defined module identity (Python: dotted path matching
// cross_file_link.py:file_to_module_path; __init__.py collapses to the
// package name). M-LANG1 moved the per-language rule into the registry.
function fileToModulePath(filePath: string): string {
  const lang = langOf(filePath);
  const rel = path.relative(inputPath, filePath);
  if (!lang) return rel.split(path.sep).filter(Boolean).join("/");
  return moduleIdentity(lang, rel);
}

// M-LANG2b — split a project map into per-language sub-maps (keyed by
// each file's registered language; unregistered extensions can't be in
// projectParse — findSourceFiles filters them at discovery).
function filesByLanguage(files: typeof projectParse): Map<LanguageInfo, typeof projectParse> {
  const out = new Map<LanguageInfo, typeof projectParse>();
  for (const [f, ir] of Object.entries(files)) {
    const lang = langOf(f);
    if (!lang) continue;
    let bucket = out.get(lang);
    if (!bucket) { bucket = {}; out.set(lang, bucket); }
    bucket[f] = ir;
  }
  return out;
}

// Generic stdin-JSON → stdout-JSON spawn used by the per-language
// derived-data fan-outs. Resolves null on any failure (callers fall
// back per stage, keeping the M4a "diagram still renders" contract).
function spawnDerived(cmd: { bin: string; argv: string[]; needsPythonEnv: boolean },
                      payload: unknown, label: string): Promise<any | null> {
  return new Promise((resolve) => {
    const child = spawn(cmd.bin, cmd.argv, {
      stdio: ["pipe", "pipe", "pipe"],
      env: cmd.needsPythonEnv ? pythonEnv() : process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", () => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        if (stderr) console.warn(`  [Project] ${label} failed — ${stderr.split("\n")[0]}`);
        resolve(null);
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

// M4a — run the cross-file linkers on the per-file IRs and return the
// enriched map. M-LANG2b: one linker spawn PER LANGUAGE, each seeing
// only its own files (a bash IR can never be mutated by the Python
// linker's conventions, and vice versa). Falls through to the input
// subset on any error (the diagram view still renders, just without
// cross-file edges). Threads never cross languages — PLAN-v5 §5.1's
// separate fork.
async function runCrossFileLink(files: typeof projectParse): Promise<typeof projectParse> {
  const merged: typeof projectParse = {};
  for (const [lang, subset] of filesByLanguage(files)) {
    const cmd = linkCommand(lang, path.join(PROJECT_ROOT, "scripts"));
    if (!cmd) { Object.assign(merged, subset); continue; }
    const parsed = await spawnDerived(cmd, { files: subset }, `${lang.id} cross-file linker`);
    Object.assign(merged, parsed?.files ?? subset);
  }
  return merged;
}

// Re-linking is a read-modify-write across an await; anything that patches
// the map meanwhile (a worker's chokepoint edit, a rejected packet's
// restore, an evidence re-parse, a created file) would be reverted in
// memory by the linker's output while its bytes stayed on disk — the
// stack pre-check e2e read an EMPTY IR delta for a file whose text diff
// showed `import requests`, and approved it (src/server/relink.ts).
// Every in-memory patch bumps its file's generation; the merge keeps any
// entry patched since the link started. parseAllFiles guards its own full
// pass the same way with self-edit stamps.
// VG_TRACE_MAP=<file>: append one line per live-map event (patch, re-link,
// refresh, full pass, restore, review). Diagnostic only; off by default.
const TRACE_MAP = process.env.VG_TRACE_MAP;
function traceMap(line: string): void {
  if (!TRACE_MAP) return;
  try { fs.appendFileSync(TRACE_MAP, `${new Date().toISOString()} ${line}\n`); } catch { /* trace only */ }
}
const parseGens = new ParseGenerations();
function touchParsed(file: string): void {
  parseGens.touch(file);
  traceMap(`touch ${path.basename(file)}`);
}
async function relinkProjectParse(): Promise<void> {
  const snap = parseGens.snapshot();
  traceMap("relink start");
  const linked = await runCrossFileLink(projectParse);
  const changed = parseGens.changedSince(snap);
  const kept = Object.keys(projectParse).filter(changed).map((f) => path.basename(f));
  projectParse = mergeRelinked(projectParse, linked, changed);
  traceMap(`relink end kept=[${kept.join(",")}]`);
}

// M8.2.4 — pipe the linked project IR through discover_entry_points.py.
// Returns [] on any error (parser missing, JSON parse fail, etc.); the
// diagram view stays usable either way. Manual seeds: looks for
// `<project root>/.vibegraph/manual_seeds.json` and passes the path
// through if it exists.
async function runDiscoverEntryPoints(files: typeof projectParse): Promise<any[]> {
  // M-LANG2b: one discover spawn per language over its own subset;
  // entries concatenate. Manual seeds stay on the Python discoverer
  // (they're validated against its rules; a bash manual-seed story is
  // the arc's later work).
  const entries: any[] = [];
  for (const [lang, subset] of filesByLanguage(files)) {
    const cmd = discoverCommand(lang, path.join(PROJECT_ROOT, "scripts"));
    if (!cmd) continue;
    const argv = [...cmd.argv];
    if (lang.id === "python") {
      const seedsPath = path.join(inputPath, ".vibegraph", "manual_seeds.json");
      if (fs.existsSync(seedsPath)) argv.push("--manual-seeds", seedsPath);
    }
    const parsed = await spawnDerived({ ...cmd, argv }, { files: subset },
      `${lang.id} entry-point discovery`);
    entries.push(...(parsed?.entryPoints ?? []));
  }
  // M-FLOW.2 — project-level discovery over the WHOLE map: a script another
  // file names by a literal is run, whatever its own file says.
  const extra = await spawnDerived(discoverProjectCommand(path.join(PROJECT_ROOT, "scripts")), { files, entryPoints: entries },
    "project-level entry-point discovery");
  entries.push(...(extra?.entryPoints ?? []));
  // M-ARCH.2 — manual seeds in EVERY language (the CLI's reader); the Python
  // discoverer above already honours Python ones, so ids are deduped.
  if (isDirectory) {
    const { seeds, unresolved } = readManualSeeds(inputPath, files as any);
    for (const seed of seeds) if (!entries.some((e) => e.id === seed.id)) entries.push(seed);
    for (const u of unresolved) console.warn(`  [Project] manual seed ${u.seed} not used: ${u.reason}`);
  }
  return entries;
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
    // M-LANG2b — dep-probing is a Python concept (find_spec over import
    // roots); bash IRs' `source` imports would read as bogus missing
    // modules. Only the python subset goes in.
    const pyFiles: typeof projectParse = {};
    for (const [f, ir] of Object.entries(files)) {
      if (langOf(f)?.id === "python") pyFiles[f] = ir;
    }
    child.stdin.write(JSON.stringify({ files: pyFiles }));
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

// M-LANG1 — walks for every REGISTERED language's extensions (just .py
// until M-LANG2 registers bash), so discovery cannot change before a
// frontend exists. Skip rules live in the registry alongside the table.
function findSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !shouldSkipDir(entry.name)) {
      results.push(...findSourceFiles(full));
    } else if (entry.isFile() && isSourceFile(entry.name, full)) {
      results.push(full);
      noteExtensionless(full);
    }
  }
  return results;
}

// M-ARCH.2 — an extensionless `#!` script (`bin/orders-cli`) has a language
// only by its first line. The CLI's walker (M-CMD.1) records it; the server
// looked every file up by extension, so the script was never parsed and no
// thread saw it. The walker records what it found here, keyed both ways,
// and every language lookup in this file goes through langOf().
const extensionlessLang = new Map<string, LanguageInfo>();
function noteExtensionless(full: string): void {
  if (languageForPath(full)) return;
  const lang = languageForFile(path.basename(full), full);
  if (!lang) return;
  extensionlessLang.set(full, lang);
  if (isDirectory) extensionlessLang.set(path.relative(inputPath, full).split(path.sep).join("/"), lang);
}
function langOf(file: string): LanguageInfo | null {
  return languageForPath(file) ?? extensionlessLang.get(file) ?? null;
}

// M6 wave 3b -- batch every file through one python3 process so libcst's
// cold-import cost is paid once per project parse, not once per file.
// Falls back to per-file parses if the batch run produces no usable
// output (parser old enough not to know --batch, or a startup error).
// M-LANG1 — one batch spawn PER LANGUAGE present in the file set (each
// frontend speaks the same --batch stdin contract as parse_cst.py), the
// results merged into one map with the language stamped per file. With
// only python registered this is exactly the old single-spawn behaviour.
function runOneBatch(lang: LanguageInfo, files: string[]): Promise<typeof projectParse> {
  const cmd = batchParseCommand(lang, path.join(PROJECT_ROOT, "scripts"));
  return new Promise((resolve) => {
    const child = spawn(cmd.bin, cmd.argv, {
      stdio: ["pipe", "pipe", "pipe"],
      env: cmd.needsPythonEnv ? pythonEnv() : process.env,
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
        const out: typeof projectParse = {};
        for (const [f, ir] of Object.entries(parsed.files ?? {})) {
          out[f] = { language: lang.id, ...(ir as object) } as any;
        }
        resolve(out);
      } catch {
        if (stderr) console.warn(`  [Project] ${lang.id} batch parser failed — ${stderr.split("\n")[0]}`);
        resolve({});
      }
    });
    for (const f of files) {
      child.stdin.write(`${f}\t${fileToModulePath(f)}\n`);
    }
    child.stdin.end();
  });
}

async function parseAllFilesBatch(files: string[]): Promise<typeof projectParse> {
  const byLang = new Map<LanguageInfo, string[]>();
  for (const f of files) {
    const lang = langOf(f);
    if (!lang) continue; // findSourceFiles only returns registered extensions
    const bucket = byLang.get(lang);
    if (bucket) bucket.push(f); else byLang.set(lang, [f]);
  }
  const merged: typeof projectParse = {};
  for (const [lang, langFiles] of byLang) {
    Object.assign(merged, await runOneBatch(lang, langFiles));
  }
  return merged;
}

let fullPassRunning = false;
async function parseAllFiles(): Promise<void> {
  if (!isDirectory) return;
  fullPassRunning = true;
  try { await parseAllFilesInner(); } finally { fullPassRunning = false; }
}
async function parseAllFilesInner(): Promise<void> {
  const genSnap = parseGens.snapshot();
  traceMap("fullpass start");
  const files = findSourceFiles(inputPath);
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
  // M4a: run the cross-file linker before broadcasting so the renderer
  // gets cross-file `reference` edges in the same project-update payload.
  const linkedNext = await runCrossFileLink(next);
  // M26.1 follow-up: a full pass races the edit chokepoint. The batch read
  // each file from disk at some unknown time after it started, so an
  // in-memory patch that landed since (before OR during the link) may be
  // NEWER than what the batch saw; merging `linkedNext` verbatim would
  // clobber the edit out of the graph (on disk but invisible until the
  // next external event). Per-file generations, the same rule every
  // re-link applies (relinkProjectParse): a patched entry wins, a file
  // deleted meanwhile stays deleted.
  const changed = parseGens.changedSince(genSnap);
  for (const f of Object.keys(projectParse)) if (changed(f)) linkedNext[f] = projectParse[f];
  for (const f of Object.keys(linkedNext)) if (changed(f) && !(f in projectParse)) delete linkedNext[f];
  projectParse = linkedNext;
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
    rebuildStack(relFiles);
    rebuildCrossings(relFiles);
    rebuildArch(relFiles);
    latestMissingDeps = await runCheckProjectDeps(relFiles);
    broadcastProjectUpdate();
    broadcastProjectWarnings();
  } finally {
    broadcastGraphRefresh("done");
    traceMap("fullpass end");
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
  if (derivedRunning) { derivedQueued = true; traceMap("refresh queued"); return; }
  derivedRunning = true;
  traceMap("refresh start");
  broadcastGraphRefresh("started");
  try {
    await relinkProjectParse();
    const relFiles = relativeProjectFiles();
    latestEntryPoints = await runDiscoverEntryPoints(relFiles);
    latestThreads = await runExtractAllThreads(relFiles, latestEntryPoints);
    latestSystem = await runBuildSystemTier(relFiles, latestEntryPoints, latestThreads);
    rebuildStack(relFiles);
    rebuildCrossings(relFiles);
    rebuildArch(relFiles);
    latestMissingDeps = await runCheckProjectDeps(relFiles);
    broadcastProjectUpdate();
    broadcastProjectWarnings();
  } finally {
    broadcastGraphRefresh("done");
    traceMap("refresh end");
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
    derivedTimer = undefined;
    refreshDerived().catch((e: any) =>
      console.warn(`  [Derived] refresh failed: ${e?.message ?? e}`));
  }, 250);
}

// M-ORCH.4 — evidence must be read from a SETTLED envelope. A worker's
// last edit schedules the debounced refresh above; reading threads and
// contracts before it lands reports a stale thread — or, on a four-language
// fixture whose refresh outlasts the worker's exit, a momentarily ABSENT
// one (the polyglot e2e escalated "entry point no longer in the envelope"
// on a packet that had merely added a comment). Run a pending refresh now
// and wait for anything in flight, bounded.
async function settleDerived(): Promise<void> {
  if (!isDirectory) return;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (derivedTimer) {
      clearTimeout(derivedTimer);
      derivedTimer = undefined;
      try { await refreshDerived(); } catch (e: any) { console.warn(`  [Derived] settle refresh failed: ${e?.message ?? e}`); }
      continue;
    }
    if (derivedRunning || derivedQueued || fullPassRunning) { await new Promise((r) => setTimeout(r, 50)); continue; }
    traceMap("settle done");
    return;
  }
  console.warn("  [Derived] settle timed out after 30s — evidence may read a stale envelope");
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
// The stamp alone was not enough: the chokepoint stamped AFTER its
// re-parse, hundreds of ms after the rewriter's write, so a write that
// followed a >2 s quiet period reached the watcher before any fresh stamp
// and launched the full pass mid-packet. A write we are about to make is
// marked in flight from before the rewriter runs until it returns.
const selfEditsInFlight = new Map<string, number>();
function beginSelfEdit(filePath: string): void {
  const k = path.basename(filePath);
  selfEditsInFlight.set(k, (selfEditsInFlight.get(k) ?? 0) + 1);
  noteSelfEdit(filePath);
}
function endSelfEdit(filePath: string): void {
  const k = path.basename(filePath);
  const n = (selfEditsInFlight.get(k) ?? 1) - 1;
  if (n <= 0) selfEditsInFlight.delete(k); else selfEditsInFlight.set(k, n);
  noteSelfEdit(filePath);
}
function isRecentSelfEdit(filename: string): boolean {
  const k = path.basename(filename);
  if (selfEditsInFlight.has(k)) return true;
  const t = selfEditStamps.get(k);
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
  workRun?: WorkRun;
  constraints?: Constraint[];
  stack?: StackIndex;
  crossings?: CrossingIndex;
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
  // M-CONTRACT.3 — stated constraints ride as an OPTIONAL sibling too
  // (present only when at least one exists; read fresh from disk so an
  // MCP-stated constraint and a GUI-stated one share one truth).
  const constraints = isDirectory ? loadConstraints(readmeRootDir()) : [];
  return {
    version: "2.1",
    files,
    symbolIndex,
    entryPoints: latestEntryPoints,
    threads: latestThreads,
    system: latestSystem,
    ...(plan ? { systemPlan: plan } : {}),
    ...(roadmap ? { buildPlan: roadmap } : {}),
    // M-AGENT1 — the work run rides as an OPTIONAL sibling (systemPlan
    // precedent): run-less envelopes stay byte-identical.
    ...(getWorkRun() ? { workRun: getWorkRun()! } : {}),
    ...(constraints.length ? { constraints } : {}),
    // M-STACK.1 — the stack facts ride as an OPTIONAL sibling too
    // (present only when the index found something; stack-less envelopes
    // stay byte-identical to pre-M-STACK ones).
    ...(latestStack.tools.length ? { stack: latestStack } : {}),
    // M-XLANG.1 - the cross-language crossings, when any were found.
    ...(latestCrossings.all.length ? { crossings: latestCrossings } : {}),
    // M-ARCH.1 - the derived architecture, when it has anything to draw.
    ...(latestArch && latestArch.nodes.length ? { architecture: latestArch } : {}),
    // PLAN-M-RUNTIME phase 3 - the TRACE OVERLAY, when a run has produced
    // one. Read from disk rather than held in memory: it is the only
    // derived-looking thing here that a HUMAN authorised and that survives a
    // restart, so the file is the truth and this is a projection of it. An
    // untraced project's envelope stays byte-identical to a pre-phase-3 one.
    ...(observationsForEnvelope()),
  };
}

/** The stored overlay, or nothing. Never throws: a project with no
 *  observations must render exactly as it did before phase 3 existed.
 *
 *  Staleness is computed HERE rather than stored, because the server is the
 *  side that has the files — and because a stored staleness flag would
 *  itself go stale the moment someone saved. */
function observationsForEnvelope(): { observations?: ReturnType<typeof readObservations> } {
  try {
    const store = readObservations(readmeRootDir());
    if (!Object.keys(store.runs).length) return {};
    const root = analyzedRoot();
    markStaleness(store, (file) => {
      try { return fs.readFileSync(path.join(root, file), "utf-8"); }
      catch { return null; }
    });
    return { observations: store };
  } catch {
    return {};
  }
}

// ── M-AGENT1 — the Agent Manager orchestrator (PLAN-M-AGENT.md) ──────────────
// Sequences the pure work_run.ts transitions BETWEEN the two human gates
// (plan ratification; per-packet evidence review) — never through them.
// Every transition persists to .vibegraph/work-run.json and rides the
// envelope, so the run survives restarts (PAUSED) and the board renders
// from the same data channel as everything else. v1: ONE run, SERIAL
// packets; the worker is the M-AGENT1 STUB — it gathers REAL structural
// evidence (thread assertions + blind spots) but performs no edits.
// The real worker session (chat-backend spawn shape, tool allowlist,
// turn budget) lands in M-AGENT3.

let workRun: WorkRun | null = null;

function getWorkRun(): WorkRun | null {
  // The server is the single writer of an ACTIVE run — an in-memory
  // draft/ratified/running/paused run is never clobbered by a file
  // change. Disk is consulted when there is no run in memory (boot,
  // discard) or the in-memory run is TERMINAL (done/failed = history,
  // supersedable by a newly appearing file — restart recovery, a
  // seeded state). loadWorkRun applies the restart rule (running →
  // paused).
  if (!isDirectory) return workRun;
  if (!workRun || workRun.status === "done" || workRun.status === "failed") {
    const fromDisk = loadWorkRun(inputPath);
    if (fromDisk) workRun = fromDisk;
  }
  return workRun;
}

function commitWorkRun(): void {
  if (workRun && isDirectory) persistWorkRun(inputPath, workRun);
  broadcastProjectUpdate();
}

function workRunError(ws: WebSocket, error: string): void {
  ws.send(JSON.stringify({ type: "work-run-error", payload: { error } }));
}

// M-ORCH — ONE draft path for the board and the MCP launcher: plan_work
// (with M-CONTRACT annotations) → DRAFT run carrying its `mode`. Returns
// the error message, or null when the draft was committed. In
// "orchestrated" mode the orchestrator brief is drafted asynchronously
// after the commit; the board shows the objective gate either way.
// M-ORCH.4 — lanes: the orchestrated default runs independent packets in
// parallel (their edit scopes are disjoint by construction); the gated
// default stays serial so a human reads one diff at a time unless they
// ask otherwise.
const DEFAULT_LANES_ORCHESTRATED = 3;

interface RunStartOptions { parallel?: number; review?: "full" | "pre-checks"; autonomous?: boolean }

function createDraftRun(task: unknown, mode: "gated" | "orchestrated", opts: RunStartOptions = {}): string | null {
  if (!isDirectory) return "work runs need a project directory";
  if (typeof task !== "string" || !task.trim()) return "empty task";
  if (opts.parallel !== undefined && (!Number.isInteger(opts.parallel) || opts.parallel < 1 || opts.parallel > MAX_LANES)) {
    return `parallel must be an integer 1..${MAX_LANES}`;
  }
  if (opts.review !== undefined && opts.review !== "full" && opts.review !== "pre-checks") return "review must be full | pre-checks";
  if (opts.autonomous && mode !== "orchestrated") return "autonomous runs are orchestrated runs — autonomy takes over the objective gate, which only that mode has";
  const existing = getWorkRun();
  if (existing && !["done", "failed"].includes(existing.status)) {
    return `a run is already ${existing.status} — one active run in v1`;
  }
  const plan = planWork({
    task,
    threads: latestThreads as never[],
    entryPoints: latestEntryPoints as never[],
    skillFor: (entryPointId) => readThreadSkill(entryPointId),
    contractFor: (entryPointId) => packetContractFor(entryPointId),
  });
  if (plan.packets.length === 0) return plan.planNote;
  workRun = draftWorkRun(plan);
  workRun.mode = mode;
  workRun.parallel = opts.parallel ?? (mode === "orchestrated" ? DEFAULT_LANES_ORCHESTRATED : 1);
  if (mode === "orchestrated") workRun.review = opts.review ?? "pre-checks";
  // AUTONOMY — the run carries the ruling it acts under from the draft on,
  // so the board, the run file and the summary all say it.
  if (opts.autonomous) workRun.autonomy = { mode: "autonomous", ruling: AUTONOMY_RULING, ratifiedBy: "orchestrator", escalationsResolved: 0 };
  commitWorkRun();
  if (mode === "orchestrated") void draftOrchestrationBrief(workRun);
  return null;
}

function handleWorkRunStart(payload: unknown, ws: WebSocket): void {
  const p = (payload ?? {}) as { task?: unknown; mode?: unknown; parallel?: unknown; review?: unknown; autonomous?: unknown };
  const mode = p.mode === "orchestrated" ? "orchestrated" : "gated";
  const opts: RunStartOptions = {};
  if (p.parallel !== undefined) opts.parallel = typeof p.parallel === "number" ? p.parallel : Number.NaN;
  if (p.review !== undefined) opts.review = p.review as RunStartOptions["review"];
  if (p.autonomous === true) opts.autonomous = true;
  const err = createDraftRun(p.task, mode, opts);
  if (err) workRunError(ws, err);
}

function handleWorkRunRatify(ws: WebSocket): void {
  const run = getWorkRun();
  if (!run) { workRunError(ws, "no run to ratify"); return; }
  // M-ORCH — in orchestrated mode ratification IS the objective gate:
  // the human confirms the brief (or, when it is honestly unavailable,
  // the bare task). A brief still drafting cannot be confirmed — the
  // human has not seen it yet.
  if (run.mode === "orchestrated" && run.orchestration?.status === "drafting") {
    workRunError(ws, "the orchestrator brief is still drafting — wait for the objective, or discard the draft");
    return;
  }
  const err = ratifyWorkRun(run);
  if (err) workRunError(ws, err);
}

// The objective gate's EFFECTS, shared by the human's confirmation and an
// AUTONOMOUS run's self-confirmation (ruling:2026-09-12:human-out-of-the-loop):
// stored constraints, stack policies, no-change packets, the brief's
// ordering, system packets. One function, so the two paths cannot drift.
function ratifyWorkRun(run: WorkRun): string | null {
  const err = setRunStatus(run, "ratified") ?? setRunStatus(run, "running");
  if (err) return err;
  if (run.mode === "orchestrated" && run.orchestration?.status === "ready") {
    // The brief's global constraints become STATED constraints on the
    // human's confirmation — source "orchestrator", never "human".
    const ids: string[] = [];
    let restated = 0;
    for (const g of run.orchestration.globalConstraints) {
      const v = validateConstraintInput({ ...g, note: `orchestrator brief for run: ${run.task.slice(0, 80)}` });
      if (!v.ok || !isDirectory) continue;
      // H2H #2 finding: a brief RESTATES the constraints it was shown —
      // never persist a twin of an existing (often human-authoritative) one.
      if (findDuplicate(loadConstraints(readmeRootDir()), v.value.text)) { restated++; continue; }
      ids.push(addConstraint(readmeRootDir(), v.value, "orchestrator").id);
    }
    // M-STACK.4 — the brief's TOOL proposals become `stack-policy`
    // constraints HERE and only here: the human confirmed them with the
    // objective. Same source ("orchestrator"), same duplicate check.
    // Nothing is installed — a policy is a decision, not an act.
    let tools = 0;
    for (const input of stackPolicyInputs(run)) {
      if (!isDirectory) continue;
      if (findDuplicate(loadConstraints(readmeRootDir()), input.text)) { restated++; continue; }
      ids.push(addConstraint(readmeRootDir(), input, "orchestrator").id);
      tools++;
    }
    run.orchestration.storedConstraintIds = ids;
    if (tools) run.orchestration.note += `. ${tools} proposed tool(s) stored as stack policies — no package was installed`;
    if (restated) run.orchestration.note += `. ${restated} global constraint(s) restated existing ones — not stored twice`;
    // M-ORCH.2 — packets the confirmed brief marked "no change needed"
    // are settled HERE, at the objective gate: pending → no-change with
    // the brief's reason recorded as the review. No worker is spawned,
    // no evidence exists, and the summary says so.
    for (const { id, reason } of noChangePackets(run)) {
      if (setPacketStatus(run, id, "no-change") === null) {
        const packet = run.packets.find((p) => p.id === id);
        if (packet) packet.review = { by: "orchestrator", verdict: "approve", reason: `no change needed (confirmed brief): ${reason}`, at: new Date().toISOString() };
      }
    }
    // M-ORCH.4 — the brief's `after` ordering becomes real dependencies
    // now (on-disk dependencies the call graph cannot see); a cycle is
    // refused and named.
    const orderingProblems = applyBriefOrdering(run);
    if (orderingProblems.length) run.orchestration.note += `. ${orderingProblems.join("; ")}`;
    // M-ORCH.3 — the brief's SYSTEM packets become run packets NOW, on the
    // human's confirmation: work no thread owns, still one bounded worker
    // each, still through the chokepoint, ordered after the plan packets
    // that own their files.
    const systemPackets = materializeSystemPackets(run);
    if (systemPackets.length) {
      run.packets.push(...systemPackets);
      run.orchestration.note += `. ${systemPackets.length} system packet(s) confirmed: ${systemPackets.map((p) => `${p.id} ${p.plan.qualifiedName}`).join("; ")}`;
    }
  }
  // Quality layer — the closing bar per packet, computed HERE at the
  // objective gate (human-confirmed or autonomous) and shipped to the worker.
  attachAcceptance(run);
  commitWorkRun();
  void advanceWorkRun();
  return null;
}

// M-AGENT4 review semantics, shared by the human gate and the M-ORCH
// orchestrator: approve keeps the edits; the FIRST rejection sends the
// packet back for ONE re-draft (its work restored first); the second —
// and every escalation resolution — is final. `review` is recorded on
// the packet so the board and summary say WHO decided and why.
async function applyPacketReview(
  run: WorkRun, packetId: string, approve: boolean, review: PacketReview,
): Promise<string | null> {
  const packet = run.packets.find((x) => x.id === packetId);
  const retry = !approve
    && packet?.status === "awaiting-review"
    && (packet?.attempts ?? MAX_PACKET_ATTEMPTS) < MAX_PACKET_ATTEMPTS;
  const next = approve ? "done" : retry ? "pending" : "failed";
  const illegal = packetTransitionError(run, packetId, next);
  if (illegal) return illegal;
  // M-AGENT3 — Reject UNDOES the packet: restore the pre-packet snapshot
  // (re-parse + re-link ride along) BEFORE the status flips. With lanes
  // (M-ORCH.4) another packet's commit can persist the run mid-await, and
  // a "failed"/"pending" packet whose rejected bytes are still on disk is
  // a lie a reader can act on (the stack pre-check e2e read exactly that).
  // Approve keeps the edits and drops the snapshot; either way this
  // attempt's snapshot is done.
  if (packet) {
    if (approve) dropPacketSnapshot(packet.id);
    else await restorePacketSnapshot(packet);
  }
  const err = setPacketStatus(run, packetId, next);
  if (err) return err;
  if (packet) packet.review = review;
  return null;
}

async function handleWorkRunReview(payload: unknown, ws: WebSocket): Promise<void> {
  const run = getWorkRun();
  const p = payload as { packetId?: unknown; approve?: unknown; reason?: unknown } | null;
  if (!run || typeof p?.packetId !== "string" || typeof p?.approve !== "boolean") {
    workRunError(ws, "bad review payload");
    return;
  }
  const err = await applyPacketReview(run, p.packetId, p.approve, {
    by: "human",
    verdict: p.approve ? "approve" : "reject",
    reason: typeof p.reason === "string" && p.reason.trim() ? p.reason.trim().slice(0, 400) : "(human gate)",
    at: new Date().toISOString(),
  });
  if (err) { workRunError(ws, err); return; }
  commitWorkRun();
  void advanceWorkRun();
}

function handleWorkRunPauseResume(resume: boolean, ws: WebSocket): void {
  const run = getWorkRun();
  if (!run) { workRunError(ws, "no run"); return; }
  const err = setRunStatus(run, resume ? "running" : "paused");
  if (err) { workRunError(ws, err); return; }
  commitWorkRun();
  if (resume) void advanceWorkRun();
}

function handleWorkRunDiscard(ws: WebSocket): void {
  const run = getWorkRun();
  if (!run) { workRunError(ws, "no run"); return; }
  // Discard is DELETION, not a transition — and only a DRAFT may be
  // deleted: anything past ratification is history the board keeps.
  if (run.status !== "draft") { workRunError(ws, `only a draft can be discarded (run is ${run.status})`); return; }
  workRun = null;
  try { fs.rmSync(path.join(inputPath, WORK_RUN_FILE), { force: true }); } catch { /* best-effort */ }
  broadcastProjectUpdate();
}

// M-ORCH.4 — the scheduler fills the run's LANES: every startable packet
// (dependencies done, edit scope disjoint from everything in flight) is
// marked running in ONE synchronous pass — no await between the pick and
// the transition, so overlapping calls can never double-start a packet —
// then each worker runs on its own promise and re-enters here when it
// finishes. With parallel = 1 this is the M-AGENT serial loop, unchanged.
async function advanceWorkRun(): Promise<void> {
  const run = getWorkRun();
  if (!run || run.status !== "running") return;
  const starting = startablePackets(run);
  if (starting.length) {
    for (const p of starting) setPacketStatus(run, p.id, "running");
    commitWorkRun();
    if (starting.length > 1 || inFlightPackets(run).length > starting.length) {
      console.log(`  [WorkRun] lanes ×${run.parallel ?? 1}: started ${starting.map((p) => p.id).join(", ")} (${inFlightPackets(run).length} in flight)`);
    }
    for (const p of starting) void runOnePacket(run, p);
    return;
  }
  if (inFlightPackets(run).length) return; // workers mid-flight or gates pending
  const outcome = runOutcome(run);
  if (outcome) {
    setRunStatus(run, outcome);
    // M-AGENT4 — the honest completion report rides the terminal run.
    run.summary = runSummary(run);
    commitWorkRun();
  }
}

// AUTONOMY (ruling:2026-09-12:human-out-of-the-loop) — under an autonomous run an
// escalation has no human to return to. It is resolved as a FAILED packet
// with its reason kept (dependents skip, the summary names the ruling);
// it is never approved. On a run that is not autonomous these are no-ops.
async function autonomyResolve(run: WorkRun, packetId: string, reason: string): Promise<void> {
  if (!run.autonomy) return;
  // RESTORE FIRST, exactly as the human reject path does (see `decide`).
  // FAILED means the packet's work is UNDONE — that is what the status
  // means to a reader, what cascadeSkips assumes of its dependents, and
  // what the summary states out loud ("their edits were restored"). This
  // path set the status and left the bytes on disk, so an autonomous run
  // reported a floor that had not held: the 2026-09-22 local-worker drill
  // ended with a worker's destructive rewrite of three telemetry files
  // still in the tree, under a summary saying they were restored. A
  // claimed floor that did not hold is worse than no floor, because the
  // claim is what gets believed.
  const packet = run.packets.find((x) => x.id === packetId);
  if (packet) await restorePacketSnapshot(packet);
  const err = resolveEscalationAutonomously(run, packetId, reason);
  if (err) console.warn(`  [WorkRun] autonomy could not resolve ${packetId}: ${err}`);
}
async function autonomyEscalate(run: WorkRun, packet: RunPacket, reason: string): Promise<void> {
  if (!run.autonomy) return;
  const err = setPacketStatus(run, packet.id, "escalated", { escalation: { reason } });
  if (err) { console.warn(`  [WorkRun] autonomy could not escalate ${packet.id}: ${err}`); return; }
  await autonomyResolve(run, packet.id, reason);
  void advanceWorkRun();
}

async function runOnePacket(run: WorkRun, packet: RunPacket): Promise<void> {
  const outcome = await runPacketWorker(packet);
  if (workRun !== run) return; // the run was discarded/replaced while the worker ran
  if (outcome.kind === "escalate") {
    setPacketStatus(run, packet.id, "escalated", {
      ...(outcome.evidence ? { evidence: outcome.evidence } : {}),
      escalation: { reason: outcome.reason },
    });
    await autonomyResolve(run, packet.id, outcome.reason);
    commitWorkRun();
    // An escalation is surfaced on the board while INDEPENDENT packets
    // proceed — dependents are blocked by dependsOn already.
    void advanceWorkRun();
    return;
  }
  // The run may have been paused meanwhile; the packet transition is
  // still legal (running → awaiting-review) and the gate simply waits.
  setPacketStatus(run, packet.id, "awaiting-review", { evidence: outcome.evidence });
  commitWorkRun(); // STOP — the reviewer judges the evidence
  if (run.mode === "orchestrated") {
    // M-SWEEP W5 — fill the freed lane BEFORE waiting on the verdict.
    //
    // This used to await the review and only then advance, so a lane freed
    // by a finished worker sat idle for the whole review — including for a
    // packet with nothing to do with the one being judged. On the fleet
    // drill that is a model spawn's worth of wall clock per packet, times
    // every packet.
    //
    // Safe because the guards were already there, not because we hope:
    //   * inFlightPackets INCLUDES awaiting-review, so startablePackets
    //     refuses anything not lane-compatible with the packet under
    //     review — a reader of a file it changed still waits;
    //   * a rejection restores only THAT packet's snapshot, over files
    //     laneCompatible has already guaranteed disjoint from whatever
    //     started meanwhile.
    // So the only thing that changes is which packets are allowed to be
    // running while a reviewer reads — and those are exactly the packets
    // the scheduler would have started anyway a few seconds later.
    void advanceWorkRun();
    // M-ORCH — the human delegated this gate at the objective gate. The
    // packet is ALREADY at awaiting-review on disk, so a reviewer that
    // fails leaves the human gate exactly where it was — never approved
    // on silence.
    await orchestratorReview(run, packet, outcome.evidence);
    return;
  }
  // Gated: the human reviews; other lanes (if any) keep moving.
  void advanceWorkRun();
}

// ── M-ORCH (PLAN-M-CONTRACT.md) — the orchestrator's two spawns ─────────────
// Both are one-shot `claude -p` text spawns through the shared gen runner
// (VG_CLAUDE_BIN-stubbable, cwd = the analyzed project, no tools): the
// brief reads the packets' contracts; the reviewer reads the packet's
// SERVER-collected evidence. Neither edits anything.

async function draftOrchestrationBrief(run: WorkRun): Promise<void> {
  run.orchestration = { ...unavailableBrief("drafting"), status: "drafting", note: "orchestrator brief drafting…" };
  commitWorkRun();
  const summaries = briefThreadSummaries(run, (entryPointId) => {
    const ctx = threadContractFor(entryPointId);
    return ctx.contract
      ? {
        contract: ctx.rendered.contract, constraints: ctx.rendered.constraints,
        language: ctx.contract.language,
        // M-STACK.3 — the compact per-packet tool line the brief reads
        // when it chooses which existing tool a packet's task uses.
        stack: packetStackLine(latestStack, entryPointId),
      }
      : null;
  });
  const projectStack = formatSystemSpec(latestStack, isDirectory ? loadConstraints(readmeRootDir()) : []);
  const text = claudeCliAvailable
    ? await _runReadmeLlm(buildBriefPrompt({ task: run.task, packets: run.packets, threads: summaries, projectStack }), "thinking", "brief")
    : null;
  // The draft may have been discarded or replaced while the spawn ran.
  if (workRun !== run) return;
  // Known threads for system-packet integration points: every entry point,
  // not just the plan's (a migration may integrate with a thread the task
  // never named).
  const parsed = parseBrief(text, run, new Set(latestEntryPoints.map((e: any) => e.id as string)));
  run.orchestration = parsed
    ? { ...parsed.orchestration, model: tierLabel("thinking") }
    : unavailableBrief(text === null ? (claudeCliAvailable ? "spawn failed" : "claude CLI unavailable") : "no valid vg-orchestration block");
  if (parsed?.problems.length) console.warn(`  [Orchestrator] brief problems: ${parsed.problems.join("; ")}`);
  commitWorkRun();
  // AUTONOMY — the brief has landed (ready, or honestly unavailable, in
  // which case the bare task runs exactly as a human could have confirmed
  // it): the run confirms its own objective under the ruling it carries.
  if (run.autonomy && workRun === run) {
    const err = ratifyWorkRun(run);
    if (err) { console.warn(`  [WorkRun] autonomy could not confirm the objective: ${err}`); return; }
    run.autonomy.ratifiedAt = new Date().toISOString();
    commitWorkRun();
  }
}

// M-GRAMMAR's check facts are built by src/server/quality/facts.ts
// (buildQualityFacts — "the grammar's four fields, as server.ts builds
// them"), read from the live relative-keyed map AFTER settleDerived() by
// qualityFactsFor above. The copy that used to live here had no caller
// left; M-CRYSTAL.3's `check` command found it while looking for the one
// facts builder to share, and there already was one.

/** The analysed project's own commit, for derived provenance. */
function projectCommitLabel(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: readmeRootDir(), encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "unversioned";
  } catch { return "unversioned"; }
}

/** The run's combined server-collected delta, for `co-changes`: every
 *  packet's diffs so far; `complete` once no packet is still to run. */
function runDeltaOf(run: WorkRun | null): RunDelta | null {
  if (!run) return null;
  const entries: RunDelta["entries"][number][] = [];
  for (const p of run.packets) for (const d of p.evidence?.diffs ?? []) entries.push({ packetId: p.id, file: d.file, nodeId: d.nodeId, change: "changed" });
  return { entries, complete: !run.packets.some((p) => p.status === "pending" || p.status === "running") };
}

/** Quality layer — the facts a check reads: the live envelope after
 *  settleDerived(), the stack index, the packet's thread and edit scope,
 *  the run's delta. `unresolved` stays deliberately GENEROUS (any call node
 *  with no reference edge), so a checker says "unverifiable" sooner than it
 *  claims a pass it has not earned. */
function qualityFactsFor(run: WorkRun | null, packet: RunPacket | null): QualityFacts {
  return buildQualityFacts({
    envelope: { files: relativeProjectFiles() as never, threads: latestThreads, entryPoints: latestEntryPoints },
    root: readmeRootDir(), commit: projectCommitLabel(), stack: latestStack,
    ...(packet && packet.plan.kind !== "system" ? { entryPointId: packet.plan.entryPointId } : {}),
    ...(run && packet ? { scopeFiles: editScopeOf(run, packet) } : {}),
    runDelta: runDeltaOf(run),
  });
}

interface RoutedCheckResult {
  id: string; source: string; described: string; rule: string;
  verdict: "pass" | "violated" | "unverifiable"; reason: string;
  /** May this check REJECT? A STATED clause gates on its verb's standing
   *  (standings.ts). A DERIVED binding additionally needs its dimension
   *  calibrated AND an offender this packet introduced — see `newOffenders`. */
  gates: boolean;
  /** Derived bindings only: the offenders absent from the gate-time
   *  baseline. Empty means the violation is inherited, so it advises. */
  newOffenders?: string[];
}

/** An offender ref as the baseline stores it, comparable across runs. */
function offenderRefs(r: { offenders?: readonly unknown[] }): string[] {
  return (r.offenders ?? []).map((o) =>
    typeof o === "string" ? o : `${(o as { file?: string }).file ?? ""}:${(o as { node?: string }).node ?? ""}`);
}

/** M-GRAMMAR + quality layer — evaluate every routed constraint that carries
 *  a checkable half, and every derived quality-model binding the packet's
 *  acceptance lists. The three M-GRAMMAR verbs run as before; a Run 1 verb
 *  runs through the registry and may reject only when its calibration
 *  record reads MAY-GATE; a derived binding is always advisory. Malformed
 *  checks are DROPPED with a warning rather than coerced. */
function evaluateRoutedChecks(run: WorkRun | null, packet: RunPacket | null, constraints: Constraint[]): RoutedCheckResult[] {
  const clausesOf = (c: Constraint) => [...(c.checks ?? []), ...(c.check ? [c.check] : [])];
  const withChecks = constraints.filter((c) => clausesOf(c).length > 0);
  const derived = (packet?.acceptance?.checks ?? []).filter((c) => c.basis && typeof c.basis.dimension === "string");
  if (!withChecks.length && !derived.length) return [];
  const facts = qualityFactsFor(run, packet);
  const registry = run1Registry();
  const out: RoutedCheckResult[] = [];
  const evalClause = (id: string, source: string, clause: unknown, mayGate: boolean, baseline?: readonly string[]) => {
    if (isConstraintCheck(clause)) {
      const r = checkConstraint(facts, clause);
      out.push({ id, source, described: describeCheck(clause), rule: clause.rule, verdict: r.verdict, reason: r.reason, gates: mayGate });
      return;
    }
    if (isRun1Check(clause)) {
      const r = registry.run(facts, clause);
      const row: RoutedCheckResult = {
        id, source, described: describeRun1Check(clause), rule: clause.rule,
        verdict: r.verdict, reason: r.reason,
        gates: mayGate && verbMayGate(clause.rule),
      };
      // A DERIVED binding carries a baseline: what this same check already
      // reported before any packet ran. src/server/quality/derived_gate.ts
      // owns the rule and the reason it gives.
      if (source === "derived") {
        const d = derivedGate({
          mode: mayGate ? "gate-blocking" : "advisory",
          verbMayGate: verbMayGate(clause.rule),
          verdict: r.verdict,
          current: offenderRefs(r as { offenders?: readonly unknown[] }),
          baseline,
        });
        row.gates = d.gates;
        row.newOffenders = d.newOffenders;
        if (r.verdict === "violated" && !d.gates) row.reason = `${r.reason}. Not rejected: ${d.why}`;
      }
      out.push(row);
      return;
    }
    console.warn(`  [Constraint] ${id} has a malformed check — not evaluated`);
  };
  for (const c of withChecks) for (const clause of clausesOf(c)) evalClause(c.id, c.source, clause, true);
  // A derived binding that IS a stated clause (the model derives guards
  // from calls-through and not-in-loop from a perf-lever) has already run
  // above with the constraint as its basis; running it twice would put
  // the same verdict in the evidence under two names.
  const stated = new Set(withChecks.flatMap((c) => clausesOf(c).map((cl) => JSON.stringify(cl))));
  for (const d of derived) {
    if (stated.has(JSON.stringify(d.check))) continue;
    // Gate-blocking only once the dimension's every binding is calibrated
    // (model.ts) — and then only on an offender absent from the baseline.
    const mayGate = d.mode === "gate-blocking";
    evalClause(`derived:${String(d.basis.dimension)}`, "derived", d.check, mayGate, d.baseline?.offenders ?? []);
  }
  return out;
}

/** M-SKILLS.2 — the stack profile as it stands NOW, for the skill selector
 *  at every worker spawn, thread-agent spawn and chat turn, and for the
 *  objective gate. Computed fresh each call rather than memoised: a memo
 *  keyed on object identity would go stale if the thread list were ever
 *  mutated in place instead of replaced, and a stale profile selecting a
 *  skill for the wrong thread is the "node in the wrong place" class. The
 *  cost is one envelope walk (milliseconds on the fleet example). */
function liveStackProfile(): ReturnType<typeof deriveStackProfile>["profile"] {
  const env = { files: relativeProjectFiles() as never, threads: latestThreads, entryPoints: latestEntryPoints };
  return deriveStackProfile(env as never, latestStack, { project: readmeRootDir(), commit: projectCommitLabel() }).profile;
}

/** The `skills-config` wire payload: the enable file plus the shipped
 *  catalogue with each skill's breadth MEASURED on this project. */
function skillsConfigPayload(): { config: SkillsConfig; catalogue: ReturnType<typeof catalogueOf> } {
  let profile: ReturnType<typeof liveStackProfile> | null = null;
  if (isDirectory) { try { profile = liveStackProfile(); } catch (e: any) { console.warn(`  [skills] profile unavailable for the catalogue: ${e?.message ?? e}`); } }
  return { config: skillsConfig, catalogue: catalogueOf(GENERIC_SKILLS, profile) };
}

/** Quality layer — the packet's CLOSING BAR, computed at the objective gate
 *  from the envelope (derived stack profile + quality model + routed
 *  constraints) and stored on the packet: the worker reads it in its prompt
 *  and the review runs the same check list. A failure to compute it is
 *  logged and leaves the packet without one; it never blocks the gate. */
function attachAcceptance(run: WorkRun): void {
  if (!isDirectory) return;
  try {
    const commit = projectCommitLabel();
    const profile = liveStackProfile();
    const constraints = loadConstraints(readmeRootDir());
    const { model } = deriveQualityModel(profile, constraints, { commit });
    const calibrated = calibratedVerbs();
    for (const packet of run.packets) {
      const isSystem = packet.plan.kind === "system";
      const routed = isSystem
        ? routeConstraints(constraints, {
          entryPointId: null,
          filesReached: packet.plan.filesReached,
          stack: [...new Set(packet.plan.filesReached.flatMap((f) => latestStack.byFile[f] ?? []))],
        })
        : threadContractFor(packet.plan.entryPointId).constraints;
      const contract = packet.plan.contract as (RunPacket["plan"]["contract"] & { crossesInto?: string[] }) | undefined;
      const scoped = editScopeOf(run, packet);
      packet.acceptance = computeAcceptance({
        packetId: packet.id, entryPointId: packet.plan.entryPointId,
        scope: { files: scoped.length ? scoped : packet.plan.filesReached, declaredBy: run.orchestration?.packetTasks?.[packet.id]?.files?.length ? "brief" : "thread" },
        routedConstraints: routed, profile, model, calibrated,
        // M-SKILLS.2 — ONE task-facts builder for the gate and the spawn.
        task: packetTaskFacts({
          priorAttempts: packet.attempts, kind: packet.plan.kind,
          effects: (contract?.effects ?? null) as Record<string, number> | null, crossesInto: contract?.crossesInto ?? null,
          routedCount: routed.length,
        }),
        commit,
      }) as unknown as RunPacket["acceptance"];
      attachDerivedBaseline(run, packet);
    }
  } catch (e) {
    console.warn(`  [WorkRun] acceptance not computed: ${(e as Error).message}`);
  }
}

/**
 * What each DERIVED gate already reported, before any packet ran.
 *
 * A stated constraint gates on its own terms: a human said the rule, so a
 * violation is a violation whoever wrote the code. A derived dimension has
 * no such mandate — it is inferred from the stack, and the codebase it is
 * inferred from usually already violates it somewhere. Without this,
 * letting derived bindings gate would reject a packet for the tree it
 * inherited: measured on h2h3 arm A, whose p1 carried a derived
 * resolvability violation naming three functions that were unannotated
 * before the run began.
 *
 * NAMED LIMIT, and it is the one `unattributedBefore` already has: the
 * baseline is the tree at the OBJECTIVE GATE, so an offender an EARLIER
 * packet introduced reads as new to a later one. Bounded in practice —
 * the rejection names the offending node, so who wrote it is visible —
 * and the alternative (re-deriving per packet start) costs a parse per
 * packet for a case no run has yet produced.
 */
function attachDerivedBaseline(run: WorkRun, packet: RunPacket): void {
  const checks = packet.acceptance?.checks ?? [];
  const derived = checks.filter((c) => c.mode === "gate-blocking" && typeof (c.basis as { dimension?: unknown })?.dimension === "string");
  if (!derived.length) return;
  const facts = qualityFactsFor(run, packet);
  const registry = run1Registry();
  const at = new Date().toISOString();
  for (const c of derived) {
    if (!isRun1Check(c.check)) continue;
    try {
      const r = registry.run(facts, c.check);
      c.baseline = { offenders: offenderRefs(r as { offenders?: readonly unknown[] }), verdict: r.verdict, at };
    } catch (e) {
      // No baseline means no derived gate for this check: `gates` needs a
      // baseline array, and an absent one leaves the binding advisory.
      console.warn(`  [WorkRun] ${packet.id}: no baseline for ${String(c.check.rule)} — it stays advisory: ${(e as Error).message}`);
    }
  }
}

async function orchestratorReview(run: WorkRun, packet: RunPacket, evidence: PacketEvidence): Promise<void> {
  const decide = async (verdict: PacketReview["verdict"], reason: string, by: PacketReview["by"] = "orchestrator", model?: string) => {
    const review: PacketReview = { by, verdict, reason, at: new Date().toISOString(), ...(model ? { model } : {}) };
    if (verdict === "escalate") {
      const err = setPacketStatus(run, packet.id, "escalated", { escalation: { reason } });
      if (!err) packet.review = review;
      if (!err) await autonomyResolve(run, packet.id, reason);
    } else {
      await applyPacketReview(run, packet.id, verdict === "approve", review);
    }
    commitWorkRun();
    void advanceWorkRun();
  };
  // M-ORCH.4 — the deterministic pre-checks read the packet's EDIT SCOPE
  // and, for a thread packet, its entry-point contract AFTER the edit.
  // Under the "pre-checks" review policy a structurally clean packet is
  // APPROVED here with `by: "pre-checks"` — no model spawn; anything the
  // checks cannot vouch for is handed to the model with the reasons named.
  const ctx = threadContractFor(packet.plan.entryPointId);
  const contractAfter = packet.plan.kind === "system"
    ? undefined
    : (ctx.contract ? summarizeContract(ctx.contract) : null);
  if (contractAfter === null) {
    console.warn(`  [WorkRun] ${packet.id}: no contract for ${packet.plan.entryPointId} after the edit (${ctx.error ?? "unknown"}); threads now: ${latestThreads.map((t: any) => t.entryPointId).filter((id: string) => id.startsWith(packet.plan.entryPointId.split(":")[0])).join(", ") || "(none in that file)"}`);
  }
  // M-STACK.5 — the STACK pre-check: the tools this edit introduced (from
  // the IR delta's new import/include/command nodes, resolved against the
  // settled index) against the policies routed to this packet. A forbidden
  // tool is a fact, so it costs no spawn to catch; a tool the project has
  // never used is a dependency decision, so it is handed to the reviewer.
  const routedPolicies = (packet.plan.kind === "system"
    ? routeConstraints(isDirectory ? loadConstraints(readmeRootDir()) : [], {
      entryPointId: null,
      filesReached: packet.plan.filesReached,
      stack: [...new Set(packet.plan.filesReached.flatMap((f) => latestStack.byFile[f] ?? []))],
    })
    : ctx.constraints)
    .filter((c): c is Constraint & { policy: NonNullable<Constraint["policy"]> } => !!c.policy)
    .map((c) => ({ id: c.id, source: c.source, policy: c.policy }));
  // M-BOUNDARY.3 — hand the check the POST-edit IR of the files this packet
  // changed, so an added CALL is attributed (not just an added import): a
  // call added to a file that already imports the tool introduces no import
  // node at all, and the import-only reading found nothing while the policy
  // was plainly broken.
  const afterFiles: Record<string, { nodes?: any[]; language?: string }> = {};
  for (const d of evidence.diffs) {
    const ir = projectParse[resolveProjectPath(d.file)];
    if (ir) afterFiles[d.file] = ir;
  }
  const addedTools = toolsAddedByDelta(
    latestStack,
    Array.isArray(evidence.irDelta) ? (evidence.irDelta as Array<{ file?: string; delta?: unknown }>) : [],
    evidence.diffs.map((d) => d.file),
    afterFiles,
  );
  traceMap(`review ${packet.id} attempt=${packet.attempts} added=[${addedTools.map((t) => `${t.tool}@${t.file}`).join(",")}] delta=${JSON.stringify((Array.isArray(evidence.irDelta) ? (evidence.irDelta as any[]) : []).map((d: any) => ({ file: d.file, added: (d.delta?.nodesAdded ?? []).map((n: any) => n.id), created: d.delta?.created })))} stackSites=[${latestStack.tools.filter((t) => t.origin !== "project").flatMap((t) => t.evidence.filter((e) => evidence.diffs.some((d) => d.file === e.file)).map((e) => `${t.tool}:${e.file}:${e.nodeId ?? "-"}`)).join(",")}]`);
  const report = preCheckReport(packet, evidence, {
    scope: editScopeOf(run, packet),
    autoApprove: (run.review ?? "pre-checks") === "pre-checks",
    contractAfter: contractAfter === undefined ? undefined : contractAfter && { params: contractAfter.params, returns: contractAfter.returns },
    addedTools,
    policies: routedPolicies,
    // M-GRAMMAR — the same routed set, minus the prose: what the IR can
    // actually settle about this packet's edit.
    constraintChecks: evaluateRoutedChecks(
      run, packet,
      packet.plan.kind === "system"
        ? routeConstraints(isDirectory ? loadConstraints(readmeRootDir()) : [], {
          entryPointId: null,
          filesReached: packet.plan.filesReached,
          stack: [...new Set(packet.plan.filesReached.flatMap((f) => latestStack.byFile[f] ?? []))],
        })
        : ctx.constraints,
    ),
    // RUN1 4.2 — no-new-unattributed-boundary, from the contract summaries.
    unattributedBefore: packet.plan.contract?.unattributed,
    unattributedAfter: contractAfter?.unattributed,
  });
  // The audit trail rides the evidence: what the pre-checks verified and
  // why (if at all) a model was asked.
  evidence.preCheck = { passed: report.passed, needsEyes: report.needsEyes, advisories: report.advisories };
  if (report.decision) {
    const pre = report.decision;
    await decide(pre.verdict, pre.verdict === "approve" ? pre.reason : `pre-check: ${pre.reason}`, pre.verdict === "approve" ? "pre-checks" : "orchestrator");
    return;
  }
  if (!claudeCliAvailable) {
    run.orchestration = { ...(run.orchestration ?? unavailableBrief("no brief")), note: `${run.orchestration?.note ?? ""}; reviewer unavailable for ${packet.id} — human gate`.replace(/^; /, "") };
    await autonomyEscalate(run, packet, "reviewer unavailable (no claude CLI) — no human gate under autonomy");
    commitWorkRun();
    return;
  }
  const prompt = buildReviewPrompt({
    run, packet, evidence,
    task: packetTaskText(run, packet).task,
    contract: ctx.rendered.contract,
    constraints: ctx.rendered.constraints,
    preCheckNotes: report.needsEyes,
  });
  const text = await _runReadmeLlm(prompt, "thinking", "review");
  if (workRun !== run || packet.status !== "awaiting-review") return; // the human acted meanwhile
  const verdict = parseVerdict(text);
  if (!verdict) {
    // Honest fallback: NO verdict is not an approval. The packet stays at
    // the human gate and the run says why.
    run.orchestration = { ...(run.orchestration ?? unavailableBrief("no brief")), note: `${run.orchestration?.note ?? ""}; reviewer gave no verdict for ${packet.id} — human gate`.replace(/^; /, "") };
    await autonomyEscalate(run, packet, "the reviewer gave no verdict — not an approval, and no human gate under autonomy");
    commitWorkRun();
    return;
  }
  await decide(verdict.verdict, verdict.reason, "orchestrator", tierLabel("thinking"));
}

// ── M-AGENT3 — the real worker (PLAN-M-AGENT decisions 1+3) ─────────────
// One bounded headless claude session per packet: the GUI chat's exact
// tool posture (vibegraph MCP tools; raw file tools DENIED — every edit
// goes through the CST chokepoint), a turn budget, and a remit rule
// whose only outside move is escalation. Evidence is collected by the
// SERVER from snapshots — never trusted from the worker's self-report.

const WORK_SNAP_DIR = path.join(".vibegraph", "work-snapshots");

function packetSnapshotDir(packetId: string): string {
  return path.join(inputPath, WORK_SNAP_DIR, packetId);
}

// Snapshot the packet thread's files BEFORE the worker runs — the
// restore source for Reject, and the diff baseline for the evidence
// card. Persisted (not memory) so a restart mid-review can still
// restore.
// M-ORCH.4 — the snapshot covers the packet's EDIT SCOPE (the brief's
// declared files, else the thread's files): the only files this worker
// can change, and the only files a Reject may restore — a parallel packet
// owning a neighbouring file is never rolled back by someone else's
// rejection.
function snapshotPacketFiles(packet: RunPacket, scope: string[] = packet.plan.filesReached): Record<string, string> {
  const map: Record<string, string> = {};
  // M-ORCH.3 — a SYSTEM packet may CREATE files: remember which of its
  // files did not exist, so Reject can delete them (a restore that only
  // rewrites known bytes would leave a rejected creation on disk).
  const absent: string[] = [];
  for (const rel of scope) {
    const abs = resolveProjectPath(rel);
    try { map[rel] = fs.readFileSync(abs, "utf-8"); } catch { absent.push(rel); }
  }
  const dir = packetSnapshotDir(packet.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ files: map, absent }), "utf-8");
  return map;
}

function loadPacketSnapshot(packetId: string): { files: Record<string, string>; absent: string[] } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(packetSnapshotDir(packetId), "manifest.json"), "utf-8"));
    if (!raw.files) return null;
    return { files: raw.files, absent: Array.isArray(raw.absent) ? raw.absent : [] };
  } catch { return null; }
}

function dropPacketSnapshot(packetId: string): void {
  try { fs.rmSync(packetSnapshotDir(packetId), { recursive: true, force: true }); } catch { /* best-effort */ }
}

// Reject = the packet's work is UNDONE: restore the snapshot bytes,
// re-parse the touched files, re-link — the same live-refresh shape as
// the edit chokepoint's rollback.
async function restorePacketSnapshot(packet: RunPacket): Promise<void> {
  const snap = loadPacketSnapshot(packet.id);
  if (!snap) return;
  // M-BATCH — putting the tree back makes every live worker session's
  // picture of it WRONG, and a worker that believes a stale tree is worse
  // than one that knows nothing. Every session is dropped, not just this
  // packet's: any of them may have read a file this restore is rewinding.
  const activeRun = getWorkRun();
  if (activeRun) clearWorkerSessions(activeRun);
  traceMap(`restore ${packet.id} start`);
  let restored = false;
  for (const [rel, content] of Object.entries(snap.files)) {
    const abs = resolveProjectPath(rel);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : null;
    if (current === content) continue;
    fs.writeFileSync(abs, content, "utf-8");
    noteSelfEdit(abs);
    try {
      // Parse FIRST, assign after. `map[k] = await f()` evaluates `map`
      // BEFORE the await, so a re-link or full pass that replaced the map
      // meanwhile left this entry in an orphaned object: the live map kept
      // the rejected bytes' IR, the next packet's "before" already held the
      // forbidden import, its delta was empty, and the pre-checks approved
      // it (the stack pre-check e2e, ~1 in 8). test:relink pins the pattern.
      const restoredIR = await parseOneFile(abs, isDirectory ? fileToModulePath(abs) : undefined);
      projectParse[abs] = restoredIR;
      touchParsed(abs);
    } catch (e: any) {
      console.warn(`  [WorkRun] restore re-parse failed for ${rel}: ${e?.message ?? e}`);
    }
    restored = true;
  }
  // M-ORCH.3 — files the packet CREATED (absent before) are deleted on
  // Reject and dropped from the live map: the rejected work is undone.
  for (const rel of snap.absent) {
    const abs = resolveProjectPath(rel);
    if (!fs.existsSync(abs)) continue;
    try { fs.unlinkSync(abs); } catch { /* best-effort */ }
    noteSelfEdit(abs);
    delete projectParse[abs];
    touchParsed(abs);
    restored = true;
  }
  if (restored) {
    try { await relinkProjectParse(); } catch { /* linker fall-through keeps map */ }
    broadcastProjectUpdate();
    scheduleDerivedRefresh();
  }
  traceMap(`restore ${packet.id} end`);
  dropPacketSnapshot(packet.id);
}

type WorkerOutcome =
  | { kind: "review"; evidence: PacketEvidence }
  | { kind: "escalate"; reason: string; evidence: PacketEvidence | null };

// One bounded worker session: the chat backend's tool posture in one-shot
// -p form (vibegraph MCP only, raw writes denied, turn budget). Shared by
// thread packets and M-ORCH.3 system packets.
// M-ORCH.4 — the worker's MCP URL names its packet (`/mcp?packet=p3`): the
// MCP session scopes every write tool to that packet, so the chokepoint
// can confine edits to the packet's edit scope while other packets run.
// M-PROVIDER — the route label for audit trails ("who did the work").
function tierLabel(tier: ModelTier): string {
  // ONE label path. There were two: `resolveClaudeBin` reconciles the
  // tier's own model with one pinned through VG_CLAUDE_BIN, and
  // `routeLabel` alone never saw the env — so every audit field fed from
  // here (orchestration.model, review.model, packet.workerModel) still
  // recorded "claude:default" for a drill run as `claude --model
  // claude-opus-5`. The M-STACK close-out fixed the first path and left
  // this one, which the M-BOUNDARY drill then reported wrongly.
  // Delegating is the fix that cannot drift again.
  return resolveClaudeBin(tier).label;
}

// M-BATCH — `resume` carries a previous packet's session id. The MCP config
// is rebuilt for THIS packet either way, so a resumed worker is re-bound to
// the new packet and the chokepoint still refuses edits outside its scope:
// the session carries CONTEXT across packets, never AUTHORITY.
/**
 * Add one model spawn to the ACTIVE run's cost ledger.
 *
 * Both headless spawn sites parse the CLI's result envelope and, before
 * this, read `.result` and dropped `total_cost_usd` — so a run could say
 * which models ran and never what they cost (h2h3's report had to leave
 * the orchestrated arm's cost column empty while printing every plain
 * arm's). A spawn with no run in flight (a README, a chat turn) is not
 * charged to anything; that is right, and it is why this is a no-op then.
 */
function chargeRun(kind: SpendKind, envelope: unknown): void {
  const run = getWorkRun();
  if (!run || run.status === "done" || run.status === "failed") return;
  run.spend = addSpend(run.spend ?? emptySpend(), kind, costOf(envelope));
}

function spawnWorkerSession(
  prompt: string, packetId: string, resume?: string | null,
): Promise<{ result: string | null; sessionId: string | null }> {
  return new Promise((resolve) => {
    // M-PROVIDER — workers have their own tier (the small local axe can go
    // here without going to the brief and the review); a local route gets
    // the long timeout — a 25-turn session on a laptop model is slow.
    const spawnTarget = resolveClaudeBin("worker");
    const { cmd, args: pre, timeoutMs } = spawnTarget;
    const mcpCfg = JSON.stringify({ mcpServers: { vibegraph: { type: "http", url: `http://localhost:${port}/mcp?packet=${encodeURIComponent(packetId)}` } } });
    execFile(
      cmd,
      [...pre, "-p", "--output-format", "json", "--strict-mcp-config",
        "--mcp-config", mcpCfg, "--dangerously-skip-permissions",
        "--disallowedTools", CHAT_DENIED_TOOLS.join(","),
        "--max-turns", String(WORKER_TURN_BUDGET),
        ...(resume ? ["--resume", resume] : []),
        prompt],
      { cwd: analyzedRoot(), env: spawnEnv(spawnTarget), timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) { chargeRun("worker", null); resolve({ result: null, sessionId: null }); return; }
        try {
          const j = JSON.parse(stdout);
          chargeRun("worker", j);
          resolve({
            result: j.result ?? null,
            sessionId: typeof j.session_id === "string" ? j.session_id : null,
          });
        } catch { chargeRun("worker", null); resolve({ result: null, sessionId: null }); }
      },
    );
  });
}

/** M-BATCH — run one packet's worker, resuming a warm session when the rule
 *  in work_run.ts says one applies, and recording the session this packet
 *  ended up in so the NEXT packet on these files can inherit it. */
async function spawnPacketWorker(packet: RunPacket, prompt: string): Promise<string | null> {
  const run = getWorkRun();
  const warm = run ? warmSessionFor(run, packet) : null;
  if (warm) {
    console.log(`  [WorkRun] ${packet.id} resumes ${warm.from}'s worker session `
      + `(${warm.carried + 1}/${MAX_SESSION_PACKETS} packets) — no cold spawn`);
  }
  const { result, sessionId } = await spawnWorkerSession(prompt, packet.id, warm?.sessionId);
  if (sessionId) {
    packet.sessionId = sessionId;
    packet.sessionPackets = (warm?.carried ?? 0) + 1;
  }
  return result;
}

// Snapshot-vs-current diffs + per-file IR delta over EVERY file the packet
// may touch — including files it CREATED (absent from the snapshot: the
// diff is the whole file, the delta names the new node count).
async function collectPacketDiffs(
  packet: RunPacket, snap: Record<string, string>, beforeIR: Record<string, any>,
  scope: string[] = packet.plan.filesReached,
): Promise<{ diffs: PacketEvidence["diffs"]; irDelta: unknown | null }> {
  const diffs: PacketEvidence["diffs"] = [];
  for (const rel of scope) {
    const abs = resolveProjectPath(rel);
    const pre = snap[rel] ?? "";
    const cur = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : "";
    if (cur !== pre) diffs.push({ file: rel, nodeId: null, diff: lineDiff(pre, cur) });
  }
  if (!diffs.length) return { diffs, irDelta: null };
  const irDelta: unknown[] = [];
  for (const d of diffs) {
    const abs = resolveProjectPath(d.file);
    let after = projectParse[abs];
    // Evidence must not depend on the watcher's timing: a file this packet
    // just CREATED (or re-created on a retry) can be missing from the live
    // map when the watcher's full pass lands mid-packet (the system-packet
    // e2e flaked on exactly that — `delta: null` for a file on disk). Parse
    // it now; the delta is a fact about the bytes, not about the map.
    if (!after && fs.existsSync(abs)) {
      try {
        after = await parseOneFile(abs, isDirectory ? fileToModulePath(abs) : undefined);
        projectParse[abs] = after;
        touchParsed(abs);
      } catch (e: any) {
        console.warn(`  [WorkRun] evidence re-parse failed for ${d.file}: ${e?.message ?? e}`);
      }
    }
    const importIds = (ir: any) => ((ir?.nodes ?? []) as Array<{ id: string }>).map((n) => n.id).filter((id) => /import|include/.test(id));
    traceMap(`evidence ${packet.id} ${d.file} before=[${importIds(beforeIR[d.file]).join(",")}] after=[${importIds(after).join(",")}]`);
    irDelta.push({
      file: d.file,
      delta: after
        ? (beforeIR[d.file] ? diffIR(beforeIR[d.file], after) : { created: true, nodes: after.nodes?.length ?? 0 })
        : null,
    });
  }
  return { diffs, irDelta };
}

// M-ORCH.3 — the SYSTEM packet worker: work no thread owns (a migration,
// a new module, an integration point), proposed by the brief and
// CONFIRMED by the human at the objective gate. Same session posture as
// a thread packet, a different bundle: no projection (there is no thread),
// the contracts of the threads it INTEGRATES with, the constraints routed
// to its files, and the create-file tool for NEW Python modules. Evidence
// is server-collected the same way; there are no thread assertions.
async function runSystemPacketWorker(packet: RunPacket): Promise<WorkerOutcome> {
  const run = getWorkRun();
  // A system packet's edit scope IS its confirmed file list.
  const snap = snapshotPacketFiles(packet, packet.plan.filesReached);
  const beforeIR: Record<string, any> = {};
  for (const rel of Object.keys(snap)) {
    const abs = resolveProjectPath(rel);
    if (projectParse[abs]) beforeIR[rel] = JSON.parse(JSON.stringify(projectParse[abs]));
  }
  const integrates = packet.plan.integrates ?? [];
  const contracts = integrates
    .map((ep) => threadContractFor(ep).rendered.contract)
    .filter((c): c is string => !!c);
  const constraints = isDirectory
    ? formatConstraintsBlock(routeConstraints(loadConstraints(readmeRootDir()), {
      entryPointId: null,
      filesReached: packet.plan.filesReached,
      // M-STACK.2 — a system packet has no thread, so its stack is the
      // union over the files it may touch (the ones that already exist).
      stack: [...new Set(packet.plan.filesReached.flatMap((f) => latestStack.byFile[f] ?? []))],
    }))
    : null;
  const taskText = run ? packetTaskText(run, packet).task : packet.plan.qualifiedName;
  const prompt = buildSystemWorkerPrompt({
    packetId: packet.id,
    title: packet.plan.qualifiedName,
    rationale: packet.plan.rationale ?? "",
    files: packet.plan.filesReached,
    existing: Object.keys(snap),
    integrates,
    integrationContracts: contracts,
    // M-STACK.3 — a system packet has no thread, so it gets the PROJECT
    // spec: a new module must be built with the tools already in use.
    stack: formatSystemSpec(latestStack, isDirectory ? loadConstraints(readmeRootDir()) : []),
    constraints,
    reviewer: run?.mode === "orchestrated" ? "orchestrator" : "human",
  }, taskText
    + (packet.attempts > 1
      ? `\n\nRETRY NOTICE: a previous attempt at this packet was REJECTED${packet.review?.reason ? ` ("${packet.review.reason}")` : ""} and its edits were rolled back (created files deleted). This is your final attempt — prefer a smaller, more careful change.`
      : ""));
  packet.workerModel = tierLabel("worker");
  const resultText = await spawnPacketWorker(packet, prompt);
  await settleDerived();
  const { diffs, irDelta } = await collectPacketDiffs(packet, snap, beforeIR, packet.plan.filesReached);
  const parsed = parsePacketResult(resultText);
  const evidence: PacketEvidence = {
    summary: parsed
      ? parsed.summary
      : resultText === null
        ? "WORKER SESSION FAILED (spawn error / timeout / bad output) — review the diffs below; they are what actually changed."
        : `WORKER BROKE THE OUTPUT CONTRACT (no vg-packet-result block) — treat with suspicion. Raw tail: ${resultText.slice(-300)}`,
    irDelta,
    diffs,
    assertions: null,
    blindSpots: null,
  };
  if (resultText === null && diffs.length === 0) {
    dropPacketSnapshot(packet.id);
    return { kind: "escalate", reason: "worker session failed before doing any work", evidence };
  }
  if (parsed?.outcome === "escalate") {
    return { kind: "escalate", reason: parsed.reason ?? parsed.summary ?? "worker escalated without a reason", evidence };
  }
  return { kind: "review", evidence };
}

// M-ORCH.3 — the create-file chokepoint for workers: a NEW Python module
// may be created ONLY while a run packet is RUNNING and lists the path
// among its files (the human confirmed that list at the objective gate).
// Content goes through cst_rewrite's create_file (parse-gated, formatted),
// then the live map + derived data catch up exactly as an edit would.
async function createFileForPacket(rel: string, source: string, packetId?: string): Promise<{ ok: boolean; message: string }> {
  if (!isDirectory) return { ok: false, message: "file creation needs a project directory" };
  const run = getWorkRun();
  // M-ORCH.4 — the calling worker names its packet (its MCP URL). Without
  // a name, only an UNAMBIGUOUS single running packet qualifies — with
  // lanes, "the running packet" is not a thing.
  const running = run?.packets.filter((p) => p.status === "running") ?? [];
  const active = packetId ? running.find((p) => p.id === packetId) : (running.length === 1 ? running[0] : undefined);
  if (!active) {
    return { ok: false, message: packetId
      ? `packet ${packetId} is not running — files are created only by a running, confirmed run packet`
      : running.length > 1
        ? `${running.length} packets are running — this session is not bound to one; files are created only from a worker session`
        : "no packet is running — files are created only by a confirmed run packet" };
  }
  if (!active.plan.filesReached.includes(rel)) {
    return { ok: false, message: `${rel} is not among packet ${active.id}'s files (${active.plan.filesReached.join(", ")}) — the human confirmed that list; escalate if the work needs another file` };
  }
  const abs = resolveChangesetPath(rel);
  if (!abs) return { ok: false, message: `path escapes the project root: ${rel}` };
  if (fs.existsSync(abs)) return { ok: false, message: `${rel} already exists — edit it with vibegraph_rewrite_node / vibegraph_compose_insert` };
  if (langOf(rel)?.id !== "python") {
    return { ok: false, message: `create-file is Python-only in v1 (${rel}); other languages: edit existing files or escalate` };
  }
  if (typeof source !== "string" || !source.trim()) return { ok: false, message: "source must be non-empty" };
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  beginSelfEdit(abs);
  let result: Awaited<ReturnType<typeof spawnRewrite>>;
  try { result = await spawnRewrite([abs, "create_file"], source); } finally { endSelfEdit(abs); }
  if (!result.success) return { ok: false, message: `create_file refused: ${result.error ?? "unknown"}` };
  try {
    noteSelfEdit(abs);
    const createdIR = await parseOneFile(abs, fileToModulePath(abs)); // parse first, assign after (see restorePacketSnapshot)
    projectParse[abs] = createdIR;
    touchParsed(abs);
    await relinkProjectParse();
  } catch (e: any) {
    return { ok: false, message: `created but re-parse failed: ${e?.message ?? e}` };
  }
  broadcastProjectUpdate();
  scheduleDerivedRefresh();
  return { ok: true, message: `created ${rel} (${projectParse[abs]?.nodes?.length ?? 0} IR nodes)` };
}

async function runPacketWorker(packet: RunPacket): Promise<WorkerOutcome> {
  if (!claudeCliAvailable) {
    return { kind: "escalate", reason: "no worker backend — claude CLI unavailable (VG_CLAUDE_BIN can stub it)", evidence: null };
  }
  // M-ORCH.3 — a SYSTEM packet has no thread: the brief proposed it for
  // work no thread owns, the human confirmed it at the objective gate.
  if (packet.plan.kind === "system") return runSystemPacketWorker(packet);
  const thread = latestThreads.find(
    (t: any) => t.entryPointId === packet.plan.entryPointId,
  ) as Thread | undefined;
  if (!thread) {
    return { kind: "escalate", reason: `thread ${packet.plan.entryPointId} is no longer in the envelope (re-plan the run)`, evidence: null };
  }

  // M-ORCH.4 — the edit scope: snapshot, diffs, prompt, and the
  // chokepoint's refusal all read this one list.
  const scope = getWorkRun() ? editScopeOf(getWorkRun()!, packet) : packet.plan.filesReached;
  const snap = snapshotPacketFiles(packet, scope);
  const beforeIR: Record<string, any> = {};
  for (const rel of Object.keys(snap)) {
    const abs = resolveProjectPath(rel);
    if (projectParse[abs]) beforeIR[rel] = JSON.parse(JSON.stringify(projectParse[abs]));
  }

  // D1 bundle pieces, worker-framed. (Deliberately mirrors
  // runSpawnThreadAgent's assembly — consolidate at the third consumer,
  // per the abstraction rule.)
  const projected = projectThreadForAgent(thread);
  const nests = deriveNests(thread.nodes);
  const labelById = new Map(thread.nodes.map((n) => [n.id, n.label]));
  const projection = renderAgentProjection(
    projected.nodes.map((n) => ({
      ...n,
      nestedLabels: (nests.childrenByParent.get(n.id) ?? []).map((k) => labelById.get(k) ?? k),
    })),
  );
  const effectKindFor = (f: string | null, irNodeId: string | null): string | null => {
    if (!irNodeId) return null;
    const n = findNode(irNodeId, f ?? undefined);
    return (n && typeof n.effectKind === "string") ? n.effectKind : null;
  };
  const blindSpots = formatBlindSpotsBlock(computeThreadBlindSpots(thread, effectKindFor));
  const skill = injectableSkillText(readThreadSkill(packet.plan.entryPointId));
  // M-CONTRACT — the thread contract (IR fact) + routed stated constraints
  // (provenance per line) ride every worker prompt.
  const contractCtx = threadContractFor(packet.plan.entryPointId);

  const run = getWorkRun();
  // M-ORCH — the packet's task: the orchestrator brief's text + HANDOFF
  // when the run is orchestrated and the brief is ready; otherwise the
  // generic "your part of the run task" framing (M-AGENT3).
  const orchestrated = run?.mode === "orchestrated";
  const taskText = run
    ? packetTaskText(run, packet).task
    : `Within this thread, do YOUR PART of the run task. RUN TASK: ${packet.plan.qualifiedName}`;
  // M-SKILLS.2 — generic direction: the skills a human enabled for this
  // project whose applies_when fires for THIS thread, after the thread
  // skill and inside what it left of the one injection budget. Every
  // omission is named in the audit line; the prompt only carries what rode.
  const genericSel = isDirectory
    ? selectGenericSkills({
      skills: GENERIC_SKILLS, config: skillsConfig, profile: liveStackProfile(),
      entryPointId: packet.plan.entryPointId,
      task: packetTaskFacts({
        priorAttempts: packet.attempts - 1, kind: packet.plan.kind,
        effects: ((packet.plan.contract as { effects?: Record<string, number> } | undefined)?.effects ?? null),
        crossesInto: ((packet.plan.contract as { crossesInto?: string[] } | undefined)?.crossesInto ?? null),
        routedCount: contractCtx.constraints.length,
      }),
      budgetChars: Math.max(0, SKILL_INJECTION_BUDGET_CHARS - (skill?.length ?? 0)),
      alreadyInjected: new Map(),
    })
    : { routed: [], injected: [] };
  const genericText = renderGenericSkillsBlock(genericSel.routed, skillsConfig);
  // The audit lives on the packet (and so in work-run.json), not only in
  // the log: the run file is what a report reads.
  const skillAudit = auditOf(genericSel.routed);
  packet.skills = skillAudit;
  if (skillsConfig.enabled.length) console.log(`  [skills] ${packet.id}: ${describeAudit(skillAudit)}`);
  const prompt = buildWorkerPrompt({
    entryPointId: packet.plan.entryPointId,
    qualifiedName: packet.plan.qualifiedName,
    projection, skill, blindSpots,
    genericSkills: genericText || null,
    filesReached: packet.plan.filesReached,
    outsidePlan: packet.plan.boundaries.outsidePlan,
    contract: contractCtx.rendered.contract,
    stack: contractCtx.rendered.stack,
    constraints: contractCtx.rendered.constraints,
    reviewer: orchestrated ? "orchestrator" : "human",
    editScope: scope,
    autonomous: !!run?.autonomy,
    closingBar: packet.acceptance?.closingBar ?? null,
  }, taskText
    // M-AGENT4 — retry framing: the reviewer rejected attempt 1 and its
    // work was RESTORED; this is a fresh start, not a continuation.
    + (packet.attempts > 1
      ? `\n\nRETRY NOTICE: a previous attempt at this packet was REJECTED by the ${orchestrated ? "orchestrator" : "human reviewer"}${packet.review?.reason ? ` ("${packet.review.reason}")` : ""} and its edits were rolled back. This is your final attempt — prefer a smaller, more careful, easily-reviewable change.`
      : ""));

  // Spawn — the chat backend's tool posture in one-shot -p form, warm
  // where M-BATCH's rule allows it.
  packet.workerModel = tierLabel("worker");
  const resultText = await spawnPacketWorker(packet, prompt);
  // M-ORCH.4 — the worker's last edit may have a derived refresh pending:
  // the fresh thread, its contract, and the blind spots below must come
  // from the settled envelope, never from the pre-edit one.
  await settleDerived();

  // Evidence is SERVER-COLLECTED: snapshot-vs-current diffs + per-file
  // IR delta (the chokepoint already re-parsed each edit), plus the
  // thread's post-edit assertions/blind spots. The worker's summary is
  // attached as a labelled self-report only.
  const { diffs, irDelta } = await collectPacketDiffs(packet, snap, beforeIR, scope);
  const freshThread = latestThreads.find(
    (t: any) => t.entryPointId === packet.plan.entryPointId,
  ) as Thread | undefined ?? thread;
  const parsed = parsePacketResult(resultText);
  const evidence: PacketEvidence = {
    summary: parsed
      ? parsed.summary
      : resultText === null
        ? "WORKER SESSION FAILED (spawn error / timeout / bad output) — review the diffs below; they are what actually changed."
        : `WORKER BROKE THE OUTPUT CONTRACT (no vg-packet-result block) — treat with suspicion. Raw tail: ${resultText.slice(-300)}`,
    irDelta,
    diffs,
    assertions: computeThreadAssertions(freshThread, effectKindFor),
    blindSpots: computeThreadBlindSpots(freshThread, effectKindFor),
  };

  if (resultText === null && diffs.length === 0) {
    dropPacketSnapshot(packet.id);
    return { kind: "escalate", reason: "worker session failed before doing any work", evidence };
  }
  if (parsed?.outcome === "escalate") {
    return { kind: "escalate", reason: parsed.reason ?? parsed.summary ?? "worker escalated without a reason", evidence };
  }
  return { kind: "review", evidence };
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
      // M-ARCH.2 — a tsconfig alias target is stamped absolute (the linker's
      // key space); downstream reads the relative map.
      nodes: (v.nodes ?? []).map((n: any) => (typeof n?.aliasTarget === "string" && path.isAbsolute(n.aliasTarget)
        ? { ...n, aliasTarget: relativize(n.aliasTarget) } : n)),
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

// Per-file id → node index, keyed by the file's node ARRAY and rebuilt when
// that array is replaced or changes length. The linear scans these replace
// made a thread contract cost (steps × every node in the project): on
// a private production codebase (1128 files, 363 threads) one `get-thread-skills` request held
// the event loop for many minutes, so the GUI loaded threads and then never
// answered a click for a node's source.
const nodeIndex = new WeakMap<any[], Map<string, any>>();
function nodesById(nodes: any[] | undefined): Map<string, any> | null {
  if (!nodes) return null;
  let m = nodeIndex.get(nodes);
  if (!m || m.size > nodes.length || (m.size < nodes.length && m.size !== new Set(nodes.map((n: any) => n.id)).size)) {
    m = new Map();
    for (const n of nodes) if (!m.has(n.id)) m.set(n.id, n);
    nodeIndex.set(nodes, m);
  }
  return m;
}

function findNode(nodeId: string, filePath?: string): any | null {
  if (isDirectory) {
    if (filePath) {
      // M8.3.3: webview / MCP clients pass relative paths; resolve to
      // the absolute key projectParse uses internally. resolveProjectPath
      // is a no-op on already-absolute input so legacy callers still work.
      const abs = resolveProjectPath(filePath);
      return nodesById(projectParse[abs]?.nodes)?.get(nodeId) ?? null;
    }
    // search all files
    for (const data of Object.values(projectParse)) {
      const n = nodesById(data.nodes)?.get(nodeId);
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
    if (nodesById(data.nodes)?.has(nodeId)) return filePath;
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
// M-LANG4 — the wet/dry chokepoint spawns dispatch by the TARGET FILE's
// language (args[0] is the file in both CLI contracts). Case-2 vectorlab
// finding (2026-08-30): a floor-less language must REFUSE HONESTLY, not
// fall through to the Python rewriter — libcst's "ParserSyntaxError"
// on a .cpp file sent the reader debugging phantom syntax errors when
// the truth was "C++ has no edit floor". The UI gates these edits off
// via capabilities; this refusal is for MCP/agent callers that bypass
// the UI.
function rewriteCmdFor(targetFile: string):
  { cmd: { bin: string; argv: string[]; needsPythonEnv: boolean } } | { refusal: string } {
  const lang = langOf(targetFile);
  if (!lang) {
    return { refusal: `No language frontend is registered for '${targetFile}' — nothing can edit it.` };
  }
  const cmd = rewriteCommand(lang, path.join(PROJECT_ROOT, "scripts"));
  if (!cmd) {
    return {
      refusal: `${lang.label} has no edit floor yet (capabilities.edit is false) — `
        + `edits require a per-language rewriter under the diff-confinement check, `
        + `and none has shipped for ${lang.label}. The file was not touched.`,
    };
  }
  return { cmd };
}

function spawnRewrite(args: string[], stdin?: string):
  Promise<{ success: boolean; error?: string; errorKind?: string }> {
  return new Promise((resolve) => {
    const dispatch = rewriteCmdFor(args[0] ?? "");
    if ("refusal" in dispatch) {
      resolve({ success: false, error: dispatch.refusal });
      return;
    }
    const cmd = dispatch.cmd;
    const child = spawn(cmd.bin, [...cmd.argv, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: cmd.needsPythonEnv ? pythonEnv() : process.env,
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
  beginSelfEdit(file); // the rewriter's write is ours: the watcher must not see it as external
  let result: Awaited<ReturnType<typeof spawnRewrite>>;
  try { result = await spawnRewrite(args, stdin); } finally { endSelfEdit(file); }
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
      touchParsed(file);
      // M-FS5 (full-scope review P2) — re-link BEFORE diffing. The solo
      // parse carries no cross-file reference edges, so diffing it
      // against the pre-edit LINKED IR reported every edge out of the
      // edited file as "removed" and its resolved calls as external —
      // a transient lie the in-app agent spent a chat turn
      // investigating. link() is idempotent and cheap next to the full
      // derived pipeline, which stays debounced below.
      try {
        await relinkProjectParse();
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
    const sandboxFiles = findSourceFiles(sandbox);
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
    ? findSourceFiles(inputPath).map((f) => relativize(f))
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
  const existing = isDirectory ? findSourceFiles(inputPath).map((f) => relativize(f)) : [];
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
      if (isDirectory) { projectParse[t.abs] = parsed; touchParsed(t.abs); }
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
  const existing = isDirectory ? findSourceFiles(inputPath).map((f) => relativize(f)) : [];
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
  const line = node.decoratorLine ?? node.line ?? node.lineno; // M-CONTRACT.6 — a decorated def/class starts at its first decorator
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
    // M-LANG4 — same per-language dispatch as spawnRewrite: the wet and
    // dry paths MUST run the identical op pipeline (the D5/D6 parity
    // invariant), so both resolve the command from argv[0] — including
    // the honest floor-less refusal.
    const dispatch = rewriteCmdFor(argv[0] ?? "");
    if ("refusal" in dispatch) {
      resolve({ error: dispatch.refusal });
      return;
    }
    const cmd = dispatch.cmd;
    const child = spawn(cmd.bin, [...cmd.argv, ...argv, "--dry-run"], {
      stdio: ["pipe", "pipe", "pipe"], env: cmd.needsPythonEnv ? pythonEnv() : process.env,
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
    // M-CONTRACT.6 — a decorated def starts at its first decorator.
    return lines.slice((n.decoratorLine ?? n.line ?? n.lineno) - 1, (n.endLine ?? n.endLineno)).join("\n");
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
    const spawnTarget = resolveClaudeBin("thinking");
    const opts = genSpawnOptions(spawnTarget);
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
    const { cmd, args: pre } = spawnTarget;
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
    try { fnSource = getSourceSnippet(fn.decoratorLine ?? fn.line ?? fn.lineno, fn.endLine ?? fn.endLineno, filePath); } catch { /* ignore */ }
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

  // H2H drill finding (2026-09-07): vibegraph_get_node_source accepts nodeId
  // "module" (the whole file) and its own error text recommends it — but
  // the WRITE side dead-ended on "Node not found: module", so a worker that
  // needed to touch the module docstring (no IR node exists for one) had no
  // honest move but to escalate. Reading and writing now agree: a whole-file
  // replace routes to the chokepoint's replace_module_body op (Mode A's
  // path, same confinement floor); the other ops name why "module" cannot
  // be their anchor instead of a bare not-found.
  const isModule = input.nodeId === "module" || input.nodeId === "";
  const moduleHint = (op: string) =>
    `"module" is the whole file, which has no anchor node for ${op}. Use replace_node with nodeId "module" to replace the entire file (the module docstring has no IR node of its own — this is the only way to edit it), or anchor on a real structural id (e.g. the first import).`;

  switch (name) {
    case "replace_node": {
      if (isModule) {
        return rewriteAndValidate([tFile, "replace_module_body"], input.newSource as string, tFile);
      }
      const node = findNode(input.nodeId as string, tFile);
      if (!node) return { success: false, message: `Node not found: ${input.nodeId}` };
      return rewriteAndValidate(
        [tFile, "replace_node", input.nodeId as string],
        input.newSource as string, tFile,
      );
    }
    case "insert_statement_before": {
      if (isModule) return { success: false, message: moduleHint(name) };
      const node = findNode(input.nodeId as string, tFile);
      if (!node) return { success: false, message: `Node not found: ${input.nodeId}` };
      return rewriteAndValidate(
        [tFile, "insert_before", input.nodeId as string],
        input.source as string, tFile,
      );
    }
    case "insert_statement_after": {
      if (isModule) return { success: false, message: moduleHint(name) };
      const node = findNode(input.nodeId as string, tFile);
      if (!node) return { success: false, message: `Node not found: ${input.nodeId}` };
      return rewriteAndValidate(
        [tFile, "insert_after", input.nodeId as string],
        input.source as string, tFile,
      );
    }
    case "delete_node": {
      if (isModule) return { success: false, message: moduleHint(name) };
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
  /** M-SKILLS.2 — generic skills already sent this session (name → body hash). */
  injectedGenericSkills: Map<string, string>;
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
        ? getSourceSnippet(node.decoratorLine ?? node.line ?? node.lineno, node.endLine ?? node.endLineno, nodeFile)
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
  // M-PROVIDER — the picker's "Local (Ollama)" id selects the local
  // backend (the Models panel's endpoint + model); a claude id keeps the
  // claude session. Switching PROVIDER cannot resume the other's
  // conversation, so it starts a fresh session (the picker's hint says so).
  const wantLocal = model === LOCAL_CHAT_MODEL_ID;
  const backend = wantLocal ? new OllamaChatBackend(getModelTiers().local ?? DEFAULT_LOCAL) : selectBackend();
  if (wantLocal) model = null; // never reaches the claude CLI as --model

  // M27.1 — New chat: drop the old session (and its child) before
  // opening a fresh one. The flag was accepted-and-ignored since M7.
  let state = chatScopeState(ws, "main");
  if (state && (state.session as { backendId?: string }).backendId !== undefined && (state.session as { backendId?: string }).backendId !== backend.id) {
    disposeChatScope(ws, "main");
    state = undefined;
  }
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
      session: Object.assign(backend.openSession({
        mcpServerUrl: `http://localhost:${port}/mcp`,
        cwd: chatCwd(),
        disallowedTools: CHAT_DENIED_TOOLS,
        model: model ?? undefined,
      }), { backendId: backend.id }),
      prevCtx: null,
      injectedSkills: new Map(),
      injectedGenericSkills: new Map(),
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
  let selfMatch: { qualifiedName: string; matchedOn: string[] } | null = null;
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
        // Not a routed thread — the active thread's FULL context (nodes,
        // skill, artifacts) is already in the prompt, so re-routing it
        // would duplicate it. Report it, don't inject it twice.
        // matchedOn is RemitMatchToken[] ({kind, token}) straight from
        // the matcher — flatten to the tokens the human actually typed.
        // Sent with the ONE chat-routed below (M-SKILLS.3), not here: the
        // generic-skill audit is not known yet at this point.
        selfMatch = { qualifiedName: self.qualifiedName, matchedOn: self.matchedOn.map((t) => t.token) };
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

  // M-SKILLS.2 — generic direction for the thread in view (else the top
  // routed match), inside what the thread skill and the routed skills left
  // of the ONE budget; deduplicated per persistent session like they are.
  // No task facts in chat: the retry skill is a packet trigger and never
  // fires here.
  const genericDedup = backend.id === "claude-stdio" ? state.injectedGenericSkills : new Map<string, string>();
  const genericSel = isDirectory
    ? selectGenericSkills({
      skills: GENERIC_SKILLS, config: skillsConfig, profile: liveStackProfile(),
      entryPointId: threadEntryPointId ?? routed[0]?.entryPointId ?? undefined,
      budgetChars: Math.max(0, SKILL_INJECTION_BUDGET_CHARS
        - (threadCtx?.skill?.length ?? 0)
        - routed.reduce((n, r) => n + (r.skill?.length ?? 0), 0)),
      alreadyInjected: genericDedup,
    })
    : { routed: [], injected: [] };
  if (backend.id === "claude-stdio") {
    for (const [name, hash] of genericSel.injected) state.injectedGenericSkills.set(name, hash);
  }
  const genericText = renderGenericSkillsBlock(genericSel.routed, skillsConfig);

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
    // M-STACK.3 — the project MAP is files plus what they are built on.
    prompt = buildChatPrompt({ userText, ...turnCtx, routed, stackSummary: stackSummaryLine(latestStack), genericSkills: genericText || null });
  } else {
    // Routing is per-question, not a context delta: the routed block rides
    // every follow-up turn that has matches. Generic direction rides the
    // same way, deduplicated per session.
    const preamble = buildTurnPreamble(state.prevCtx, turnCtx);
    const routedText = renderRoutedBlock(routed);
    prompt = [preamble, routedText, genericText, userText].filter(Boolean).join("\n\n");
  }
  state.prevCtx = turnCtx;

  // M-SKILL.2 — provenance to the human: name every routed thread and why
  // it matched, before the reply streams. ONE send (M-SKILLS.3): the
  // self-match report (M-SKILL.6) and the generic-skill audit (M-SKILLS.2)
  // ride the same chip as the routed threads, so a generic skill shared on
  // a turn that routed nothing is still said — silence must never read as
  // "no direction was given". Disabled and not-applicable stay out of the
  // chip: the prompt and the chip are not the audit (work-run.json is).
  const genericReport = genericSel.routed
    .filter((g) => g.skill || g.omitted === "over-budget" || g.omitted === "already-in-session")
    .map((g) => ({ name: g.name, injected: g.skill != null, ...(g.omitted ? { omitted: g.omitted } : {}) }));
  if (routed.length > 0 || selfMatch || genericReport.length > 0) {
    ws.send(JSON.stringify({
      type: "chat-routed",
      payload: {
        genericSkills: genericReport,
        ...(selfMatch ? { selfMatch } : {}),
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
      injectedGenericSkills: new Map(),
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
  const spawnTarget = resolveClaudeBin("routine");
  const opts = genSpawnOptions(spawnTarget);
  if (!opts) {
    ws.send(JSON.stringify({ type: "analyze-error", payload: { message: "Analyzed project root is unreachable." } }));
    return;
  }
  // No MCP tools needed for Analyze -- it's pure text generation.
  // (CLI-drift note: see _runIntentLlm — mcpServers record + `--`.)
  // Model tier: routine — a prose summary of one file. Also the last
  // hardcoded "claude" in the codebase; VG_CLAUDE_BIN now covers every
  // headless path without exception.
  const { cmd, args: pre } = spawnTarget;
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
// M-GATEWAY — a caller that spawns the CLI passes its resolved target, so
// the child gets THAT TIER's route (a gateway endpoint, its model, its key)
// rather than the whole server's environment. Callers that spawn something
// else (python, a helper module with its own target) pass nothing and get
// the parent's environment exactly as before.
function genSpawnOptions(target?: SpawnTarget): { cwd: string; env: NodeJS.ProcessEnv } | null {
  const cwd = analyzedRoot();
  if (!fs.existsSync(cwd)) return null;
  return { cwd, env: target ? spawnEnv(target) : { ...process.env } };
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
  | { ok: true; entryFn: string; exprN: string; needsSynth: boolean; className?: string; params: string[] }
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
  return { ok: true, entryFn: fn.name, exprN, needsSynth, params, ...(className ? { className } : {}) };
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
/** The exception line of a Python traceback (the last non-empty line), or undefined. */
function tracebackTail(stderr: unknown): string | undefined {
  if (typeof stderr !== "string") return undefined;
  const lines = stderr.split("\n").map((l) => l.trimEnd()).filter(Boolean);
  return lines.length ? lines[lines.length - 1].slice(0, 400) : undefined;
}

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
    // An arg-needing enclosing function is an honest needs-inputs decline —
    // the verdict run-to-here gives (handleRunThreadToNode) — not a
    // TypeError buried in a traceback the caller never saw. Measured on the
    // fleet example: Observe on `conn.execute().fetchall` inside
    // readings_between(since, until) ran `readings_between()` bare, raised
    // "missing 2 required positional arguments", and reported
    // `runtime-error` with no text because the runner's JSON carries the
    // traceback under `stderr`, not `error`.
    const target = resolveRunTarget(nodeId, filePath);
    if (target.ok && target.needsSynth) {
      return fail("needs-inputs", target.className
        ? `${target.className}.${entryFn} is a method — Observe runs the enclosing function with no instance and no arguments; run to here instead (the run button synthesizes an example instance), or observe this call from a caller that binds them`
        : `${entryFn}(${(target.params ?? []).join(", ")}) requires arguments — Observe runs the enclosing function with none; run to here instead (the run button proposes literal inputs), or observe this call from a caller that binds them`);
    }

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
          // run_to_node reports the traceback under `stderr`; its last
          // line is the exception, which is what a reader needs.
          error: r.error ?? tracebackTail(r.stderr),
        };
      } catch {
        return fail("harness-error", "could not parse run_to_node output");
      }
    } finally {
      for (const t of temps) { try { fs.unlinkSync(t); } catch { /* ignore */ } }
    }
  })();
}

// PLAN-M-RUNTIME phase 3 — a TRACE RUN: ONE consented execution of an entry
// point under scripts/trace_run.py, annotating every call site the run
// touched at once. The batch form of B5's Observe, and it inherits B5's rule
// wholesale: the result is an overlay beside the IR, never a promotion of a
// node's `dynamic`/`unresolved` kind.
//
// The floor is the SAME SM3 scan run-to-here uses, with one difference that
// matters: a trace runs the WHOLE entry function, so the scan's stop node is
// the LAST node inside it. scan_effects scopes the top frame by
// `line <= stop.line`, so the furthest-down node is exactly the widest
// honest scope — anything narrower would consent to less than what runs.
export interface TraceRunResult {
  entryPointId: string;
  outcome: string;
  /** How many IR nodes the run actually annotated. */
  observed: number;
  run?: TraceRun;
  effects?: EffectOffense[];
  effectConsentToken?: string | null;
  note: string;
  error?: string;
  stdout?: string;
  stderr?: string;
}

// PLAN-M-RUNTIME phase 3 (bash) — the trace half of the BASH RUN FLOOR.
//
// Python's floor predicts what will run and asks. Bash's cannot: shelling
// out IS the language, and `$CMD`/`eval` are decided while running. So this
// one makes external execution IMPOSSIBLE (trace_bash.mjs points PATH at a
// missing directory and records every command instead) and then runs the
// script for real, inside a throwaway copy of the project.
//
// The human is still asked, and told two true things: which commands will be
// recorded rather than executed, and the one thing the floor cannot cover —
// a redirection is not a command, so an absolute-path redirect is REFUSED
// rather than run with a caveat (src/server/bash_floor.ts).
async function runTraceBash(
  ep: { id: string; file: string; irNodeId: string; qualifiedName: string },
  effectConsent?: string,
): Promise<TraceRunResult> {
  const fail = (outcome: string, error: string, extra?: Partial<TraceRunResult>): TraceRunResult =>
    ({ entryPointId: ep.id, outcome, observed: 0, note: OBSERVE_NOTE, error, ...extra });

  const root = analyzedRoot();
  const files = relativeProjectFiles() as Record<string, { nodes?: Array<{ id: string; type?: string; funcName?: string; line?: number }> }>;
  const thread = (latestThreads as Array<{ entryPointId?: string | null; filesReached?: string[] }>)
    .find((t) => t.entryPointId === ep.id);
  // Everything the trace can execute: the entry script plus what it sources.
  const scripts = [...new Set([ep.file, ...(thread?.filesReached ?? [])])]
    .filter((f) => /\.(sh|bash)$/.test(f));

  const sources: Record<string, string> = {};
  for (const f of scripts) {
    try { sources[f] = fs.readFileSync(path.join(root, f), "utf-8"); }
    catch { /* a file we cannot read cannot be checked - and is not run */ }
  }
  // The command words the IR found, with their lines, so consent NAMES them.
  //
  // What is excluded, and the distinction is a SAFETY one the stack index
  // does not have to make:
  //   * BASH_SHELL_BUILTINS / BASH_KEYWORDS — `cd`, `[`, `for`. These never
  //     leave the shell, so there is nothing to neutralise and nothing to
  //     consent to.
  //   * calls the linker RESOLVED to a function defined in the script.
  //     `prepare` is not a subprocess; listing it as one would bury the real
  //     commands in noise and misdescribe what the run does.
  //
  // NOT excluded: BASH_COREUTILS. `rm`, `mkdir`, `tar` are in that list
  // because they say nothing about the STACK — which is a classification
  // judgement, not a safety one. `rm -rf build/` is the single most
  // important line for a human to see before saying yes, and an earlier cut
  // of this code omitted it for exactly that reason. The M-TABLES split of
  // shell builtins from coreutils is what makes the right answer expressible.
  const resolvedCalls = new Set<string>();
  for (const f of scripts) {
    for (const e of (files[f] as { edges?: Array<{ type?: string; source?: string }> })?.edges ?? []) {
      if (e?.type === "reference" && typeof e.source === "string") resolvedCalls.add(e.source);
    }
  }
  const cmdNodes: Array<{ word: string; file: string; line: number }> = [];
  for (const f of scripts) {
    for (const n of files[f]?.nodes ?? []) {
      if (n.type !== "call" || resolvedCalls.has(n.id)) continue;
      const word = String(n.funcName ?? "").trim().split(/\s+/)[0];
      if (!word || BASH_SHELL_BUILTINS.has(word) || BASH_KEYWORDS.has(word)) continue;
      cmdNodes.push({ word, file: f, line: n.line ?? 0 });
    }
  }

  const floor = assessBashTrace({ sources, commands: cmdNodes.map((c) => c.word) });
  if (!floor.ok) return fail("refused", floor.reason);

  // Consent, always: there is no such thing as a provably pure shell script,
  // so bash never takes the python path's "pure, run it" shortcut. The
  // offenses ARE the command list, which is what makes the consent readable.
  const offenses: EffectOffense[] = cmdNodes.length
    ? [...new Map(cmdNodes.map((c) => [`${c.file}:${c.line}:${c.word}`, {
      kind: "effect" as const, effectKind: "subprocess", target: c.word, file: c.file, line: c.line,
    }])).values()]
    : [{ kind: "effect" as const, effectKind: "subprocess", target: ep.qualifiedName, file: ep.file, line: 0 }];
  if (!verifyEffectConsent(ep.id, offenses, effectConsent)) {
    return fail("requires-confirmation", `${floor.reason} ${BASH_TRACE_LIMITS.join(" ")}`, {
      effects: offenses,
      effectConsentToken: mintEffectConsent(ep.id, offenses),
    });
  }

  // A throwaway copy: the stubbed PATH stops programs, and this stops the
  // relative redirections it cannot see.
  const sandbox = makeRunSandbox(root);
  try {
    const raw = await new Promise<string>((resolve) => {
      execFile("node", [TRACE_BASH_SCRIPT, path.join(sandbox.root, ep.file), sandbox.root],
        { cwd: sandbox.root, timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout) => resolve(
          stdout || JSON.stringify({
            outcome: "harness-error", observations: [],
            error: err?.message ?? "the bash tracer produced no output",
          }),
        ),
      );
    });
    let parsed: {
      outcome?: string; observations?: TracedSite[]; error?: string;
      stdout?: string; stderr?: string; truncated?: boolean; recorded?: string[];
    };
    try { parsed = JSON.parse(raw); }
    catch { return fail("harness-error", "could not parse trace_bash output"); }

    const nodesByFile: Record<string, Array<{ id: string; line?: number | null; type?: string | null }>> = {};
    for (const [f, fileIr] of Object.entries(files)) nodesByFile[f] = fileIr?.nodes ?? [];
    const observations = joinTraceToNodes(parsed.observations ?? [], nodesByFile);

    // Hash the REAL files, never the sandbox copy: staleness has to compare
    // against what the human edits.
    const sourceHashes: Record<string, string> = {};
    for (const f of Object.keys(observations)) {
      try { sourceHashes[f] = hashSource(fs.readFileSync(path.join(root, f), "utf-8")); }
      catch { /* unreadable = staleness stays unknown, which reads as fresh */ }
    }

    const recorded = parsed.recorded ?? [];
    const run: TraceRun = {
      entryPointId: ep.id,
      entryFn: ep.qualifiedName.split(/[.:]/).pop() ?? "",
      language: "bash",
      at: new Date().toISOString(),
      outcome: parsed.outcome ?? "harness-error",
      inputs: "no arguments; every external command RECORDED, not executed"
        + (recorded.length ? ` (${recorded.join(", ")})` : ""),
      observations,
      sourceHashes,
      truncated: !!parsed.truncated,
      ...(parsed.error ? { error: parsed.error } : {}),
    };
    const observed = Object.values(observations).reduce((n, byId) => n + Object.keys(byId).length, 0);
    if (observed > 0 || run.outcome === "ok") writeTraceRun(readmeRootDir(), run);

    return {
      entryPointId: ep.id,
      outcome: run.outcome,
      observed,
      run,
      note: OBSERVE_NOTE,
      error: parsed.error,
      stdout: (parsed.stdout ?? "").slice(0, 4000),
      stderr: (parsed.stderr ?? "").slice(0, 4000),
    };
  } finally {
    sandbox.dispose();
  }
}

async function runTraceEntryPoint(
  entryPointId: string,
  effectConsent?: string,
): Promise<TraceRunResult> {
  const fail = (outcome: string, error: string, extra?: Partial<TraceRunResult>): TraceRunResult =>
    ({ entryPointId, outcome, observed: 0, note: OBSERVE_NOTE, error, ...extra });

  const ep = (latestEntryPoints as Array<{ id: string; file: string; irNodeId: string; qualifiedName: string }>)
    .find((e) => e.id === entryPointId);
  if (!ep) return fail("unsupported-target", `no entry point ${entryPointId}`);

  // The registry decides, and it decides on `trace` rather than `run`:
  // bash has a TRACE floor (scripts/trace_bash.mjs makes external execution
  // impossible) and no RUN floor, so the two capabilities are genuinely
  // different answers for it.
  if (!capabilitiesForPath(ep.file).trace) {
    return fail("unsupported-target",
      `${ep.file}: this language has no trace floor yet, so there is nothing to trace through`);
  }
  if (langOf(ep.file)?.id === "bash") return runTraceBash(ep, effectConsent);

  const files = relativeProjectFiles() as Record<string, { nodes?: Array<{ id: string; line?: number; type?: string }> }>;
  const ir = files[ep.file];
  if (!ir?.nodes?.length) return fail("harness-error", `no IR for ${ep.file}`);

  const fnName = ep.qualifiedName.split(/[.:]/).pop() ?? "";
  if (!_VG_IDENT.test(fnName)) return fail("harness-error", `unsafe entry function: ${fnName}`);

  const prefix = `${ep.irNodeId}/`;
  const inFn = ir.nodes
    .filter((n) => n.id.startsWith(prefix) && typeof n.line === "number")
    .sort((a, b) => (b.line as number) - (a.line as number));
  const stopId = inFn[0]?.id ?? ep.irNodeId;

  const verdict = await scanEffectsToNode(stopId, ep.file);
  if (!verdict.pure) {
    const gated = gatedOffenses(verdict.offenses);
    if (gated.length && !verifyEffectConsent(stopId, gated, effectConsent)) {
      return fail("requires-confirmation", verdict.reason, {
        effects: gated,
        effectConsentToken: mintEffectConsent(stopId, gated),
      });
    }
  }

  const root = analyzedRoot();
  const abs = path.isAbsolute(ep.file) ? ep.file : path.join(root, ep.file);
  const env = pythonEnv();
  env.PYTHONPATH = `${root}:${env.PYTHONPATH ?? ""}`;
  const raw = await new Promise<string>((resolve) => {
    execFile("python3", [TRACE_RUN_SCRIPT, abs, fnName, root],
      { cwd: root, env, timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => resolve(
        stdout || JSON.stringify({
          outcome: err ? "harness-error" : "harness-error",
          observations: [], error: err?.message ?? "tracer produced no output",
        }),
      ),
    );
  });

  let parsed: {
    outcome?: string; observations?: TracedSite[]; error?: string;
    stdout?: string; stderr?: string; truncated?: boolean;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("harness-error", "could not parse trace_run output");
  }

  // The tracer reports co_filename, which is however the module was loaded.
  // Relativise into the ONE keyspace the IR uses, and drop anything outside
  // the project rather than inventing a key for it.
  const nodesByFile: Record<string, Array<{ id: string; line?: number | null; type?: string | null }>> = {};
  for (const [f, fileIr] of Object.entries(files)) nodesByFile[f] = fileIr?.nodes ?? [];
  const sites: TracedSite[] = (parsed.observations ?? []).map((o) => ({
    ...o,
    file: path.isAbsolute(o.file) ? relativize(o.file) : o.file,
  }));
  const observations = joinTraceToNodes(sites, nodesByFile);

  const sourceHashes: Record<string, string> = {};
  for (const f of Object.keys(observations)) {
    try { sourceHashes[f] = hashSource(fs.readFileSync(path.join(root, f), "utf-8")); }
    catch { /* a file we cannot read cannot be stamped; staleness stays unknown */ }
  }

  const run: TraceRun = {
    entryPointId,
    entryFn: fnName,
    language: langOf(ep.file)?.id ?? "python",
    at: new Date().toISOString(),
    outcome: parsed.outcome ?? "harness-error",
    inputs: "no arguments — the entry point runs on its own",
    observations,
    sourceHashes,
    truncated: !!parsed.truncated,
    ...(parsed.error ? { error: parsed.error } : {}),
  };
  const observed = Object.values(observations).reduce((n, byId) => n + Object.keys(byId).length, 0);
  // A run that raised still wrote down what it saw first. Storing it is the
  // point: half a run is evidence about that half, and the outcome + error
  // ride along so nobody reads it as a clean pass.
  if (observed > 0 || run.outcome === "ok") writeTraceRun(readmeRootDir(), run);

  return {
    entryPointId,
    outcome: run.outcome,
    observed,
    run,
    note: OBSERVE_NOTE,
    error: parsed.error,
    stdout: (parsed.stdout ?? "").slice(0, 4000),
    stderr: (parsed.stderr ?? "").slice(0, 4000),
  };
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
      try { fnSource = getSourceSnippet(fnNode.decoratorLine ?? fnNode.line ?? fnNode.lineno, fnNode.endLine ?? fnNode.endLineno, filePath); } catch { /* ignore */ }
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
        try { classSource = getSourceSnippet(clsNode.decoratorLine ?? clsNode.line ?? clsNode.lineno, clsNode.endLine ?? clsNode.endLineno, filePath); } catch { /* ignore */ }
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
      try { fnSource = getSourceSnippet(fnNode.decoratorLine ?? fnNode.line ?? fnNode.lineno, fnNode.endLine ?? fnNode.endLineno, filePath); } catch { /* ignore */ }
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

function readmeIrFor(scope: ReadmeScope, id: string): any | null {
  if (scope === "thread") return latestThreads.find((t: any) => t.entryPointId === id) ?? null;
  // A project VibeReadme is derived from the WHOLE map plus the entry points
  // and threads, so its staleness hash moves when any file does.
  if (scope === "project") {
    const files = isDirectory ? relativeProjectFiles() : { single: lastParse };
    if (!files || Object.keys(files).length === 0) return null;
    return { files, entryPoints: latestEntryPoints ?? [], threads: (latestThreads ?? []).map((t: any) => ({
      entryPointId: t.entryPointId, filesReached: t.filesReached ?? [],
    })) };
  }
  return isDirectory ? relativeProjectFiles()[id] ?? null : lastParse;
}

// The whole-project VibeReadme. Structured (vibereadme_contract.ts) rather
// than free prose, for the reason thread-skills are: a document with known
// sections can be rendered, checked and diffed. Everything handed to the
// model here is IR fact — file list, entry points by kind, the effects the
// scan actually found — so the prose has something real to be grounded in.
function _vibeReadmePrompt(ir: any): string {
  const files: Record<string, any> = ir.files ?? {};
  const fileLines = Object.entries(files).slice(0, 60).map(([path, fir]: [string, any]) => {
    const defs = (fir?.symbolIndex ?? [])
      .filter((sym: any) => sym?.kind === "function" || sym?.kind === "class")
      .map((sym: any) => sym.name).filter(Boolean).slice(0, 12).join(", ");
    return `- ${path}: ${defs || "(no top-level defs)"}`;
  }).join("\n");

  const eps = (ir.entryPoints ?? []).slice(0, 40)
    .map((e: any) => `- [${e.kind}] ${e.id}${e.summary ? ` — ${e.summary}` : ""}`).join("\n");

  const effects = new Set<string>();
  for (const fir of Object.values(files)) {
    for (const n of ((fir as any)?.nodes ?? [])) {
      if (typeof n?.effectKind === "string") effects.add(n.effectKind);
    }
  }

  return [
    "Write a VibeReadme: a map of THIS application for someone who has never seen it.",
    "Describe what it is and how it is organised. Ground every claim in the facts below —",
    "if something is not in them, do not assert it.",
    "",
    "Output ONLY markdown with EXACTLY these sections, in this order, each exactly once,",
    "starting immediately with the first heading and no preamble:",
    ...VIBEREADME_REQUIRED_SECTIONS.map((h) => `  ${h}`),
    "",
    "  ## What this is — 2-4 sentences: the application's purpose and shape.",
    "  ## How it is organised — the modules and what each is responsible for.",
    "  ## Entry points — the ways execution starts, grouped as given below.",
    "  ## External surface — what it touches outside itself (files, db, http, processes).",
    "    Say 'none detected' if the effect list is empty rather than inventing one.",
    "  ## Not statically known — what a reader must NOT conclude from this document:",
    "    dynamic dispatch, unresolved calls, anything the file list cannot show.",
    "    This section is required and must never be empty.",
    "",
    `Files and their top-level definitions (${Object.keys(files).length} files):`,
    fileLines || "(none)",
    "",
    "Entry points discovered:",
    eps || "(none discovered)",
    "",
    `External effect kinds found by the parser: ${effects.size ? [...effects].join(", ") : "(none)"}`,
  ].join("\n");
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
// Why the last _runReadmeLlm call returned null, for the callers that report
// "… returned nothing": a spawn that exits non-zero, a result the CLI itself
// marks is_error (an expired login answers that way), output that is not
// JSON, or an empty result. Cleared by a successful call.
let lastGenFailure: string | null = null;
function genFailureSuffix(): string {
  return lastGenFailure ? ` — ${lastGenFailure}` : "";
}

function _runReadmeLlm(prompt: string, tier: ModelTier = "thinking", kind: SpendKind = "gen"): Promise<string | null> {
  return new Promise((resolve) => {
    // gen-cwd-fix: the shared gen runner (README / thread-skill / explain /
    // thread-agent) must read the USER's project. Fail honestly if it's gone —
    // null here means callers return { ok:false } and persist nothing.
    const spawnTarget = resolveClaudeBin(tier);
    const opts = genSpawnOptions(spawnTarget);
    if (!opts) {
      console.warn("  [gen] analyzed project root unreachable — skipping LLM");
      lastGenFailure = "analyzed project root unreachable";
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
    const { cmd, args: pre } = spawnTarget;
    // M-ORCH drill finding (2026-09-06): --strict-mcp-config removes MCP
    // servers only — the spawned claude STILL has Claude Code's native
    // Read/Bash/Write tools, and the orchestrator's reviewer used them
    // ("read api.py, executed the predicate"). Reading and running are
    // verification value; WRITING is not — every caller of this runner
    // (READMEs, thread skills, explain, D1 agents, the brief, the review)
    // is a reasoning spawn that must never mutate the project. Deny the
    // raw write tools STRUCTURALLY, the same posture as chat and workers.
    const child = spawn(
      cmd,
      [...pre, "-p", "--output-format", "json", "--strict-mcp-config",
        "--mcp-config", '{"mcpServers":{}}',
        "--dangerously-skip-permissions",
        "--disallowedTools", CHAT_DENIED_TOOLS.join(","),
        "--", prompt],
      opts,
    );
    let out = "";
    let errOut = "";
    child.stdout.on("data", (b: Buffer) => { out += b.toString(); });
    child.stderr?.on("data", (b: Buffer) => { errOut += b.toString(); });
    child.on("close", (code) => {
      let parsed: { result?: unknown; is_error?: unknown } | null = null;
      try { parsed = JSON.parse(out); } catch { parsed = null; }
      // Charged whatever the outcome: a spawn that failed still ran, and a
      // ledger that counts only successes understates what a run cost.
      chargeRun(kind, parsed);
      const reported = parsed?.is_error && typeof parsed.result === "string" ? parsed.result.trim() : "";
      if (code !== 0 || parsed?.is_error) {
        const detail = reported || errOut.trim().split("\n").filter(Boolean).slice(-1)[0] || "";
        lastGenFailure = `claude exited ${code ?? "?"}${detail ? `: ${detail.slice(0, 300)}` : ""}`;
        console.warn(`  [gen] ${lastGenFailure}`);
        resolve(null);
        return;
      }
      if (!parsed) { lastGenFailure = "claude output was not JSON"; resolve(null); return; }
      const text = typeof parsed.result === "string" ? parsed.result.trim() : "";
      lastGenFailure = text ? null : "claude returned an empty result";
      resolve(text || null);
    });
    child.on("error", (e) => { lastGenFailure = `could not spawn claude: ${e.message}`; resolve(null); });
  });
}

async function runGenerateReadme(
  scope: ReadmeScope, id: string,
): Promise<{ ok: boolean; body?: string; error?: string }> {
  const ir = readmeIrFor(scope, id);
  if (!ir) return { ok: false, error: `No ${scope} IR for "${id}"` };
  if (!claudeCliAvailable) return { ok: false, error: "claude CLI unavailable for README generation" };
  // Routine: a prose README has no citation floor to fail.
  if (scope === "project") {
    // Structured, so it goes through the shape gate before it is persisted —
    // a VibeReadme missing its honesty section would be worse than none.
    // "thinking" tier, not "routine": this one is read as the map of the
    // whole application, and every section makes claims about it.
    const prose = await _runReadmeLlm(_vibeReadmePrompt(ir), "thinking");
    if (!prose) return { ok: false, error: `VibeReadme generation returned nothing${genFailureSuffix()}` };
    const check = validateVibeReadmeBody(prose);
    if (!check.ok) {
      return { ok: false, error: `VibeReadme did not meet its structure: ${check.problems.join("; ")}` };
    }
    writeReadme(readmeRootDir(), scope, id, prose.trim(), sourceHashOf(ir), new Date().toISOString());
    return { ok: true, body: prose.trim() };
  }
  const body = await _runReadmeLlm(_readmePrompt(scope as "thread" | "file", id, ir), "routine");
  if (!body) return { ok: false, error: `README generation returned nothing${genFailureSuffix()}` };
  writeReadme(readmeRootDir(), scope, id, body, sourceHashOf(ir), new Date().toISOString());
  return { ok: true, body };
}

// Boundary validation: `scope` reaches readmePath, which builds a file path
// from it. An unrecognised value must be refused here, not normalised
// downstream into a directory nobody meant.
const README_SCOPES: readonly ReadmeScope[] = ["thread", "file", "project"];
function badReadmeScope(payload: { scope?: unknown; id?: unknown }, ws: WebSocket): boolean {
  const ok = typeof payload?.scope === "string"
    && README_SCOPES.includes(payload.scope as ReadmeScope)
    && typeof payload?.id === "string" && payload.id.length > 0;
  if (!ok) {
    ws.send(JSON.stringify({
      type: "readme-status",
      payload: { exists: false, scope: String(payload?.scope), id: String(payload?.id),
        key: `${String(payload?.scope)}:${String(payload?.id)}`,
        error: `unknown README scope (expected one of ${README_SCOPES.join(", ")})` },
    }));
  }
  return !ok;
}

function handleGetReadme(payload: { scope: ReadmeScope; id: string }, ws: WebSocket): void {
  if (badReadmeScope(payload, ws)) return;
  const ir = readmeIrFor(payload.scope, payload.id);
  const currentHash = ir ? sourceHashOf(ir) : "";
  const result = readReadmeFromStore(readmeRootDir(), payload.scope, payload.id, currentHash);
  ws.send(JSON.stringify({ type: "readme-status", payload: result }));
}

async function handleGenerateReadme(
  payload: { scope: ReadmeScope; id: string }, ws: WebSocket,
): Promise<void> {
  if (badReadmeScope(payload, ws)) return;
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

/** M-WHY — the constraints routed to one thread, as the skill's drafting
 *  input. Deliberately the FULL sentence, not the structured half: the
 *  machine half catches a violation after it is written, and the sentence is
 *  what stops it being written — "a flapping sensor once paged the on-call
 *  forty times in a minute" is what makes a worker design the next paging
 *  path correctly, including one no check anticipated. */
function _skillConstraintBlock(entryPointId: string): string {
  if (!isDirectory) return "";
  const stored = loadConstraints(readmeRootDir());
  // No stated rules → the block is empty whatever the contract says; do not
  // compute a contract to route nothing.
  if (!stored.length) return "";
  const ctx = threadContractFor(entryPointId);
  const routed = routeConstraints(stored, {
    entryPointId,
    filesReached: (ctx.contract?.filesReached as string[] | undefined) ?? [],
    stack: (ctx.contract?.stack ?? []).map((t: { tool: string }) => t.tool),
  });
  return skillRulesBlock(routed);
}

async function runGenerateThreadSkill(
  entryPointId: string,
): Promise<{ ok: boolean; body?: string; error?: string }> {
  const ir = latestThreads.find((t: any) => t.entryPointId === entryPointId);
  if (!ir) return { ok: false, error: `No thread for entry point "${entryPointId}"` };
  if (!claudeCliAvailable) return { ok: false, error: "claude CLI unavailable for thread-skill generation" };
  // The prompt, the grounding + shape gates, the honesty block and the budget
  // live in src/server/thread_skill_draft.ts, shared with the CLI's
  // `skills draft` (2026-09-25).
  const drafted = await draftThreadSkill({
    entryPointId, ir, rulesBlock: _skillConstraintBlock(entryPointId), knownIds: allKnownNodeIds(),
    runLlm: (prompt) => _runReadmeLlm(prompt),
    effectKindFor: (f, irNodeId) => {
      if (!irNodeId) return null;
      const n = findNode(irNodeId, f ?? undefined);
      return (n && typeof n.effectKind === "string") ? n.effectKind : null;
    },
    failureSuffix: genFailureSuffix,
  });
  if (!drafted.ok || !drafted.body) return { ok: false, error: drafted.error };
  const body = drafted.body;

  // M-SKILL.7 — stamp the step snapshot alongside the hash so a later
  // staleness can show WHAT changed, not just that something did.
  writeThreadSkill(readmeRootDir(), entryPointId, body, threadSkillStamp(entryPointId, ir), new Date().toISOString(), "draft", makeThreadSnapshot(ir));
  return { ok: true, body };
}

/** Read the thread-skill tagged with staleness vs the thread's current IR. */
/**
 * M-WHY — the ONE stamp a thread skill is written with and read against.
 *
 * It covers the thread's CODE and the RULES routed to it, because a skill
 * now teaches the reason behind those rules: a changed rule can make its
 * teaching wrong exactly as a changed step can. Folding both into one hash
 * reuses the whole M-SKILL.7 lifecycle (stale card, Re-affirm, per-skill
 * auto-reaffirm-with-caveat) instead of inventing a second staleness.
 *
 * ONE function on purpose. A first cut computed the composite only on the
 * READ side while the writes still stamped `sourceHashOf(ir)`, so every
 * skill read stale forever and re-affirm could not clear it —
 * test:skill-ratify caught it immediately.
 *
 * Named limit: the stale card's DIFF comes from the step snapshot, so a
 * skill stale only because a RULE changed shows "stale" with no step
 * difference. Honest but terse; a rule-level diff is a follow-up.
 */
function threadSkillStamp(entryPointId: string, ir: unknown): string {
  if (!ir) return "";
  // ADDITIVE: a project that states NO rules stamps exactly what it stamped
  // before M-WHY (src/server/thread_skill_stamp.ts holds the rule).
  return stampThreadSkill(ir, _skillConstraintBlock(entryPointId));
}

function readThreadSkill(entryPointId: string): ThreadSkillResult {
  // No stored skill → nothing can be stale; skip the stamp (it computes the
  // thread's contract when rules are stated), which every thread paid on
  // each get-thread-skills.
  if (!readStoredThreadSkill(readmeRootDir(), entryPointId)) return { exists: false, key: threadSkillKey(entryPointId), entryPointId };
  const ir = latestThreads.find((t: any) => t.entryPointId === entryPointId);
  return readThreadSkillFromStore(readmeRootDir(), entryPointId, threadSkillStamp(entryPointId, ir));
}

// ── M-CONTRACT (PLAN-M-CONTRACT.md) — thread contract + stated constraints ──
// The contract is IR FACT computed over the live envelope (per-file IR
// joined by findNode, tcall adjacency from deriveThreadCalls); the
// constraints are STATED facts loaded from the analyzed project's
// .vibegraph/constraints.json and routed by scope. Both render through
// their own formatters so every consumer (worker, D1 agent, MCP, plan
// packets) reads the same labelled blocks — one honesty split, one place.

interface ThreadContractContext {
  contract: ThreadContract | null;
  constraints: Constraint[];
  // M-STACK.3 — `stack` is the rendered SYSTEM SPEC for this thread:
  // its tools (IR fact) plus the policies stated about them.
  rendered: { contract: string | null; constraints: string | null; stack: string | null };
  error?: string;
}

function threadContractFor(entryPointId: string): ThreadContractContext {
  const thread = latestThreads.find((t: any) => t.entryPointId === entryPointId) as
    | (Thread & { entryPointId?: string; filesReached?: string[] })
    | undefined;
  const stored = isDirectory ? loadConstraints(readmeRootDir()) : [];
  if (!thread) {
    return { contract: null, constraints: [], rendered: { contract: null, constraints: null, stack: null }, error: `no thread for ${entryPointId}` };
  }
  // M-FLOW.4 — the hops count as adjacency: a page that runs a backend script
  // through the platform REACHES that script's thread, and the script is
  // REACHED BY the page (the reverse trace).
  const graph = deriveThreadCalls(latestThreads as any, latestEntryPoints as any, latestCrossings);
  const contract = computeThreadContract(thread, {
    nodeFor: (f, irNodeId) => (irNodeId ? findNode(irNodeId, f ?? undefined) : null),
    ...threadAdjacency(graph, entryPointId),
    // M-STACK.1 — the tools this thread's files use (IR fact).
    stackFor: (f) => contractStackForFile(latestStack, f),
    // M-BOUNDARY.1 — what the boundary→tool join needs. External terminals
    // carry `file: null`, so the owning file is looked up by node id and
    // relativised (the index and the contract both speak relative paths).
    fileOfNode: (irNodeId) => {
      const abs = findNodeFile(irNodeId);
      return abs ? relativize(abs) : null;
    },
    importsFor: (f) => latestStack.importsByFile?.[f] ?? [],
    localsFor: (f) => latestStack.localsByFile?.[f] ?? [],
    // M-RESOLVE.3 - the route handler a call sits inside. Node ids are
    // structural paths, so the enclosing function is a prefix; the entry
    // point on it carries the framework, and the IR node its parameters.
    handlerFor: (f, irNodeId) => {
      const fnId = irNodeId.split("/").slice(0, 2).join("/");
      const ep = latestEntryPoints.find((e: any) => e.kind === "route" && e.file === f && e.irNodeId === fnId);
      if (!ep) return null;
      const fn = findNode(fnId, f);
      return { framework: ep.framework ?? null, params: Array.isArray(fn?.params) ? fn.params : [] };
    },
    stackIndex: latestStack,
    // M-XLANG.1 - where this thread leaves its own language.
    crossingsFor: (ep) => latestCrossings.byThread[ep] ?? [],
    // PLAN-M-RUNTIME phase 3 - what a consented trace run saw. Read fresh
    // with staleness marked, so a contract riding a worker prompt says
    // whether the observation still describes the file it was made in.
    observedFor: (file, irNodeId) => observationsForNode(
      markStaleness(readObservations(readmeRootDir()), (f) => {
        try { return fs.readFileSync(path.join(analyzedRoot(), f), "utf-8"); }
        catch { return null; }
      }),
      file, irNodeId,
    ),
  });
  // M-STACK.2 — routing takes the thread's STACK too: a stack-scoped
  // policy follows the tool as the code changes, not a hand-kept file list.
  const constraints = routeConstraints(stored, {
    entryPointId,
    filesReached: contract.filesReached,
    stack: contract.stack.map((s) => s.tool),
  });
  return {
    contract,
    constraints,
    rendered: {
      contract: formatContractBlock(contract),
      constraints: formatConstraintsBlock(constraints),
      stack: formatSystemSpec(latestStack, stored, { entryPointId }),
    },
  };
}

/** plan_work / start_work_run annotation: compact facts + routed count. */
function packetContractFor(entryPointId: string) {
  const ctx = threadContractFor(entryPointId);
  return ctx.contract ? { ...summarizeContract(ctx.contract), constraints: ctx.constraints.length } : null;
}

function stateConstraint(input: unknown, source: ConstraintSource): { ok: true; constraint: Constraint } | { ok: false; error: string } {
  if (!isDirectory) return { ok: false, error: "constraints need a project directory" };
  const v = validateConstraintInput(input);
  if (!v.ok) return v;
  const constraint = addConstraint(readmeRootDir(), v.value, source);
  broadcastProjectUpdate();
  return { ok: true, constraint };
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
  reaffirmThreadSkill(readmeRootDir(), entryPointId, threadSkillStamp(entryPointId, ir), makeThreadSnapshot(ir));
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
  const line = node.decoratorLine ?? node.line ?? node.lineno; // M-CONTRACT.6 — a decorated def/class starts at its first decorator
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
  // M-LANG6 — the prompt names the node's actual language + fence.
  const interpretation = await _runReadmeLlm(explainPrompt(source, tFile));
  if (!interpretation) return fail(`explanation returned nothing${genFailureSuffix()}`);
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

  // Cross-thread adjacency (the visible boundary) — M-FLOW.4: hops included.
  const graph = deriveThreadCalls(latestThreads as any, latestEntryPoints as any, latestCrossings);
  const { reaches, reachedBy } = threadAdjacency(graph, entryPointId);

  // M-CONTRACT — contract (IR fact) + routed constraints ride the D1 bundle.
  const contractCtx = threadContractFor(entryPointId);

  // M-SKILLS.2 — the bounded agent gets the same generic direction a
  // worker on this thread would, after the thread skill, same budget rule.
  const genericSel = isDirectory
    ? selectGenericSkills({
      skills: GENERIC_SKILLS, config: skillsConfig, profile: liveStackProfile(), entryPointId,
      budgetChars: Math.max(0, SKILL_INJECTION_BUDGET_CHARS - (skill?.length ?? 0)), alreadyInjected: new Map(),
    })
    : { routed: [], injected: [] };
  const prompt = buildThreadAgentPrompt({
    entryPointId,
    qualifiedName: (thread as any).seed?.qualifiedName ?? entryPointId,
    projection, skill, blindSpots,
    genericSkills: renderGenericSkillsBlock(genericSel.routed, skillsConfig) || null,
    filesReached: (thread as any).filesReached ?? [],
    reaches, reachedBy,
    contract: contractCtx.rendered.contract,
    stack: contractCtx.rendered.stack,
    constraints: contractCtx.rendered.constraints,
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
    const line = node.decoratorLine ?? node.line ?? node.lineno; // M-CONTRACT.6 — a decorated def/class starts at its first decorator
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
  rewriteNode: async ({ nodeId, op, payload, filePath, packetId }) => {
    // M-ORCH.4 — a WORKER session's edit is confined to its packet's edit
    // scope BEFORE the chokepoint sees it (the owning packet is named).
    const scopeErr = packetScopeCheck(packetId, filePath);
    if (scopeErr) return { success: false, message: scopeErr, errorKind: "out_of_scope" };
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
  composeInsert: async ({ mode, source, anchorNodeId, filePath, packetId }) => {
    const scopeErr = packetScopeCheck(packetId, filePath);
    if (scopeErr) return { success: false, message: scopeErr };
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
  // PLAN-M-RUNTIME phase 3 — the batch tracer, same code path as the
  // thread view's trace button, so a human and an agent get the same
  // overlay and the same floor.
  traceEntryPoint: async ({ entryPointId, effectConsent }) => {
    const res = await runTraceEntryPoint(entryPointId, effectConsent);
    if (res.observed > 0) broadcastProjectUpdate();
    return res;
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
      contractFor: (entryPointId) => packetContractFor(entryPointId),
      maxPackets,
    }),
  // M-AGENT2 — the chat/MCP launch path drafts ONLY; ratification and
  // every packet approval stay human, in the board. M-ORCH — an
  // "orchestrated" draft additionally requests the orchestrator brief;
  // the human still confirms the objective before anything runs.
  startWorkRun: (task, mode, opts) => {
    const err = createDraftRun(task, mode === "orchestrated" ? "orchestrated" : "gated", opts ?? {});
    if (err) return { ok: false, message: err };
    const run = workRun!;
    return {
      ok: true,
      message: `DRAFT run created (${run.mode ?? "gated"}, lanes ×${run.parallel ?? 1}${run.review ? `, review: ${run.review}` : ""}): ${run.packets.length} packet(s) over ${run.packets.map((p) => p.plan.qualifiedName).join(", ")}. `
        + (run.mode === "orchestrated"
          ? "The orchestrator brief is being drafted; the human confirms the OBJECTIVE in the Agent Manager board before anything runs, then the orchestrator reviews each packet (escalations return to the human)."
          : "Nothing runs until the human ratifies it in the Agent Manager board (the Agents toolbar button).")
        + (run.autonomy ? ` AUTONOMOUS (${run.autonomy.ruling}): the server confirms the objective itself when the brief lands and resolves every escalation as a failed packet with its reason kept — no human gate.` : "")
        + (run.unmatchedTokens.length ? ` NOT covered: ${run.unmatchedTokens.join(", ")}.` : ""),
    };
  },
  // M-CONTRACT.2/.3 — the thread contract (IR fact) + routed stated
  // constraints, and the agent-side constraint writer (labelled "agent").
  threadContract: (entryPointId) => threadContractFor(entryPointId),
  stateConstraint: (input) => stateConstraint(input, "agent"),
  listConstraints: () => (isDirectory ? loadConstraints(readmeRootDir()) : []),
  // M-STACK.1 — the stack facts (whole project, or one thread's slice).
  stack: (entryPointId) => {
    if (entryPointId && !latestStack.byThread[entryPointId]) {
      return { index: latestStack, spec: "", error: `no thread ${entryPointId} in the current envelope` };
    }
    const stored = isDirectory ? loadConstraints(readmeRootDir()) : [];
    return {
      index: latestStack,
      // M-BOUNDARY.2 — `tools` is what the thread's files hold; `called` is
      // what a boundary of it actually reaches. A caller that conflates the
      // two reads a dead dependency as a live one.
      ...(entryPointId
        ? {
          thread: {
            entryPointId,
            tools: stackForThread(latestStack, entryPointId),
            called: stackCalledOnThread(latestStack, entryPointId).map((t) => t.tool),
          },
        }
        : {}),
      // M-STACK.3 — facts WITH the policies stated about them, and the
      // disagreements between the two: the same block the prompts get.
      spec: formatSystemSpec(latestStack, stored, entryPointId ? { entryPointId } : {}) ?? "",
    };
  },
  // M-ORCH.3 — a running system packet may CREATE a new Python module.
  // M-XLANG.1 - the cross-language crossings (whole project, or one thread).
  // M-ARCH.1 - the derived architecture model (built in rebuildArch).
  architecture: () => {
    if (!isDirectory) return { model: null, error: "the architecture model needs a project directory" };
    return latestArch ? { model: latestArch } : { model: null, error: "no architecture model yet (the project has not finished parsing, or the model failed - see the server log)" };
  },
  // M-ARCH.4 - draft a grounded proposal; it stays pending until a human ratifies.
  proposeArchitecture: async () => {
    const r = await archProposeCore();
    return r.ok ? { ...r, model: latestArch } : r;
  },
  crossings: (entryPointId) => {
    if (entryPointId && !latestCrossings.byThread[entryPointId]) {
      const known = latestThreads.some((t: any) => t.entryPointId === entryPointId);
      return known
        ? { all: [], thread: { entryPointId, crossings: [] } }
        : { all: [], error: `no thread ${entryPointId} in the current envelope` };
    }
    return {
      all: latestCrossings.all,
      ...(entryPointId ? { thread: { entryPointId, crossings: latestCrossings.byThread[entryPointId] ?? [] } } : {}),
    };
  },
  createFile: (p, source, packetId) => createFileForPacket(p, source, packetId),
};

// M-ORCH.4 — the edit-scope guard for WORKER sessions (MCP sessions bound
// to a packet via `/mcp?packet=`). An unbound session is unscoped, as
// before. A bound session may edit only files inside its packet's edit
// scope while that packet is RUNNING; the refusal names the packet that
// owns the file (if any) and the honest move — write against its
// contract/handoff, or escalate naming the exact change.
function mcpPathname(url: string | undefined): string {
  try { return new URL(url ?? "/", "http://vibegraph").pathname; } catch { return url ?? "/"; }
}

function packetScopeCheck(packetId: string | undefined, filePath: string | undefined): string | null {
  if (!packetId) return null;
  const run = getWorkRun();
  const packet = run?.packets.find((p) => p.id === packetId);
  if (!run || !packet) return `packet ${packetId} is not part of the active run — edits from a worker session need a live packet`;
  if (packet.status !== "running") return `packet ${packetId} is ${packet.status}, not running — its worker session may no longer edit`;
  if (!filePath) return `name the file (filePath) — packet ${packetId} may edit only: ${editScopeOf(run, packet).join(", ")}`;
  const rel = relativize(resolveProjectPath(filePath));
  const scope = editScopeOf(run, packet);
  if (scope.includes(rel)) return null;
  const owners = run.packets.filter((p) => p.id !== packetId && editScopeOf(run, p).includes(rel));
  return `${rel} is outside packet ${packetId}'s edit scope (${scope.join(", ")}). `
    + (owners.length
      ? `${rel} belongs to ${owners.map((o) => `${o.id} (${o.status})`).join(", ")} — that packet owns changes there${owners.some((o) => o.status === "running" || o.status === "pending") ? ", possibly in parallel with you right now" : ""}; write your part against its contract and the handoff you were given. `
      : `No packet in this run owns ${rel}. `)
    + "If your task genuinely needs this change, finish with outcome \"escalate\" naming the file and the exact change — do not route around the chokepoint.";
}

const mcpHandler = createMcpHttpHandler(mcpContext);

// ── HTTP server ───────────────────────────────────────────────────────────────

// 2026-08-04 — dist assets were served with a Content-Type and NOTHING else:
// no Cache-Control, no ETag, no Last-Modified. With no freshness information
// a browser is free to heuristically cache, so a rebuilt bundle could keep
// serving the OLD app from cache and a fix would look like it had not landed.
// The bundle comes from localhost and is rebuilt constantly, so there is
// nothing to gain by caching it and a whole class of phantom bugs to lose.
// (A tab that is never reloaded still runs the old JS — nothing server-side
// can fix that; this makes a plain reload sufficient, no hard-refresh.)
const NO_STORE = "no-store, no-cache, must-revalidate";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": NO_STORE });
    res.end(getIndexHtml());
    return;
  }
  // M7 wave 1 -- MCP Streamable-HTTP endpoint. POST initialize + tools/call
  // + resources/*, GET (SSE) for server->client streaming, DELETE for
  // session termination. Body is JSON-RPC; read + parse before handing
  // to the SDK transport.
  // M-ORCH.4 — the path may carry `?packet=<id>` (a worker session bound to
  // its packet); match on the pathname, hand the full URL to the handler.
  if (mcpPathname(req.url) === "/mcp") {
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
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": NO_STORE,
    });
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
    // M-PROVIDER — the server's model routes are the source of truth.
    ws.send(JSON.stringify({ type: "model-tiers", payload: getModelTiers() }));
    // M-SKILLS.2 — the enable file plus the shipped catalogue, breadth measured here.
    ws.send(JSON.stringify({ type: "skills-config", payload: skillsConfigPayload() }));
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
        } else if (msg.type === "work-run-start") {
          // M-AGENT1 — task → plan_work → DRAFT run (does nothing until
          // the human ratifies; the gates are transitions, not UI sugar).
          handleWorkRunStart(msg.payload, ws);
        } else if (msg.type === "work-run-ratify") {
          handleWorkRunRatify(ws);
        } else if (msg.type === "work-run-review") {
          handleWorkRunReview(msg.payload, ws);
        } else if (msg.type === "work-run-pause") {
          handleWorkRunPauseResume(false, ws);
        } else if (msg.type === "work-run-resume") {
          handleWorkRunPauseResume(true, ws);
        } else if (msg.type === "work-run-discard") {
          handleWorkRunDiscard(ws);
        } else if (msg.type === "add-constraint") {
          // M-CONTRACT.3 — the GUI states a HUMAN constraint (authoritative
          // provenance); validated at the boundary, persisted, broadcast
          // on the envelope.
          const r = stateConstraint(msg.payload, "human");
          if (!r.ok) ws.send(JSON.stringify({ type: "constraint-error", payload: { error: r.error } }));
        } else if (msg.type === "remove-constraint") {
          if (isDirectory && typeof msg.payload?.id === "string") {
            if (!removeConstraint(readmeRootDir(), msg.payload.id)) {
              ws.send(JSON.stringify({ type: "constraint-error", payload: { error: `no constraint ${msg.payload.id}` } }));
            }
            broadcastProjectUpdate();
          }
        } else if (msg.type === "explain-node") {
          // SCOPE button (tooltip) — C2 explain-this-node over WS: the
          // SAME runExplainNode the MCP tool uses (labelled inference,
          // cached, never mutates the node's kind). Boundary: nodeId
          // must be a string; runExplainNode fails soft on misses.
          if (typeof msg.payload?.nodeId === "string") {
            runExplainNode(msg.payload.nodeId, msg.payload.filePath).then((res) => {
              ws.send(JSON.stringify({ type: "node-explained", payload: res }));
            });
          }
        } else if (msg.type === "trace-thread") {
          // PLAN-M-RUNTIME phase 3 — one consented run of an entry point,
          // annotating every call site it touched. Same floor as Observe and
          // run-to-here: the first press comes back requires-confirmation
          // with the offenses and a token, and nothing has run.
          const tr = msg.payload;
          if (typeof tr?.entryPointId === "string") {
            void (async () => {
              const res = await runTraceEntryPoint(tr.entryPointId, tr.effectConsent);
              ws.send(JSON.stringify({ type: "thread-traced", payload: res }));
              // A stored overlay changes what every client should render, so
              // the envelope goes out to everyone — not just the presser.
              if (res.observed > 0) broadcastProjectUpdate();
            })();
          }
        } else if (msg.type === "clear-trace") {
          if (typeof msg.payload?.entryPointId === "string") {
            clearTraceRun(readmeRootDir(), msg.payload.entryPointId);
            broadcastProjectUpdate();
          }
        } else if (msg.type === "observe-node") {
          // OBSERVE button (PLAN-M-RUNTIME phase 2) — B5 over WS. The SAME
          // resolveEnclosingFn + runObserveDynamicTarget the MCP tool calls,
          // so a human pressing the button and an agent calling the tool get
          // the same answer AND the same floor: observing a receiver means
          // running its binding code, so an effectful binding comes back
          // requires-confirmation + a token and NOTHING has run yet.
          // Boundary: both ids must be strings; the runner re-validates the
          // receiver against _VG_IDENT before it reaches a probe.
          const obs = msg.payload;
          if (typeof obs?.nodeId === "string" && typeof obs?.receiver === "string") {
            void (async () => {
              const fn = resolveEnclosingFn(obs.nodeId, obs.filePath);
              const res: DynamicObservation = fn.ok
                ? await runObserveDynamicTarget(obs.nodeId, obs.filePath, fn.entryFn, obs.receiver, obs.effectConsent)
                : {
                  nodeId: obs.nodeId, outcome: fn.outcome, observedTarget: null,
                  note: OBSERVE_NOTE, provenance: "real-input", error: fn.reason,
                };
              ws.send(JSON.stringify({ type: "node-observed", payload: res }));
            })();
          }
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
          // M-PROVIDER — persist per project and echo the SANITISED result to
          // every client, so two tabs (and a headless driver) agree.
          if (isDirectory) { try { saveModelRoutes(inputPath, tiers); } catch (e: any) { console.warn(`  [models] could not save: ${e?.message ?? e}`); } }
          const echo = JSON.stringify({ type: "model-tiers", payload: tiers });
          for (const c of clients) c.send(echo);
          console.log(`[models] ${(["thinking", "routine", "worker"] as ModelTier[]).map((t) => `${t}=${routeLabel(resolveTierRoute(t, tiers))}`).join(" ")}`);
        } else if (msg.type === "set-skills-config") {
          // M-SKILLS.2 — boundary validation: only SHIPPED skill names
          // survive, and the server stamps who enabled each and when. The
          // sanitised result is persisted per project and echoed to every
          // client, the models.json shape.
          const next = sanitiseSkillsConfig(msg.payload, GENERIC_SKILLS.map((s) => s.name), { source: "human", at: new Date().toISOString() }, skillsConfig);
          skillsConfig = next;
          if (isDirectory) { try { saveSkillsConfig(inputPath, next); } catch (e: any) { console.warn(`  [skills] could not save: ${e?.message ?? e}`); } }
          const echo = JSON.stringify({ type: "skills-config", payload: skillsConfigPayload() });
          for (const c of clients) c.send(echo);
          console.log(`[skills] enabled: ${next.enabled.join(", ") || "(none)"}`);
        } else if (msg.type === "probe-model-endpoint") {
          // M-PROVIDER — the Models panel's Test button: the endpoint is
          // validated inside the probe; only Ollama's own routes are called.
          const p = (msg.payload ?? {}) as { endpoint?: unknown; model?: unknown };
          probeOllamaEndpoint(p.endpoint, typeof p.model === "string" ? p.model : undefined)
            .then((probe) => ws.send(JSON.stringify({ type: "model-endpoint-probe", payload: probe })))
            .catch((e: any) => ws.send(JSON.stringify({ type: "model-endpoint-probe", payload: { endpoint: String(p.endpoint ?? ""), ok: false, error: e?.message ?? String(e) } })));
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
        } else if (msg.type === "arch-propose" || msg.type === "arch-ratify" || msg.type === "arch-reject") {
          // M-ARCH.4 — propose spends tokens and stores a PENDING proposal;
          // ratify / reject are the human's. Reply: arch-proposal.
          const t = msg.type;
          const reply = (payload: unknown) => ws.send(JSON.stringify({ type: "arch-proposal", payload: { action: t.slice(5), ...(payload as object) } }));
          if (t === "arch-propose") archProposeCore(typeof msg.payload?.guidance === "string" ? msg.payload.guidance : undefined).then(reply, (e) => reply({ ok: false, error: String(e?.message ?? e) }));
          else reply(archDecide(t === "arch-ratify" ? "ratify" : "reject"));
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

/** The first full parse + derivation (the boot pass), and whether one has
 *  finished; sendParse makes a mid-pass connect wait for it. */
let fullPass: Promise<unknown> | null = null;
let fullPassDone = false;

async function sendParse(ws?: WebSocket) {
  if (isDirectory) {
    // M26.1 follow-up — don't launch a full parseAllFiles per WS
    // connect: it competed with the edit chokepoint (see the stamp
    // guard in parseAllFiles) and made every new tab pay seconds of
    // re-parse for state the boot parse + watcher already keep fresh.
    // Primed connect → the new client just gets the current envelope.
    // ONLY for per-connection sends: the no-ws callers (boot prime,
    // watcher debounce) exist to run the full pass.
    // A tab that connects DURING the boot pass waits for it: projectParse
    // fills file by file before anything is derived, so the envelope sent
    // mid-pass had files and no entry points, threads or architecture — the
    // webview dismissed its boot screen onto a raw file grid. (It also kept
    // an early connect from launching a second, concurrent full pass.)
    if (ws && fullPass && !fullPassDone) {
      await fullPass.catch(() => {});
      broadcastProjectUpdate(ws);
      return;
    }
    if (ws && Object.keys(projectParse).length > 0) {
      broadcastProjectUpdate(ws);
      return;
    }
    fullPass = parseAllFiles();
    try { await fullPass; } finally { fullPassDone = true; }
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
      if (!isSourceFile(filename, path.join(inputPath, filename))) {
        // Not source in any REGISTERED language (M-LANG1) — but an artifact
        // write still changes what the chip must say (see
        // refreshArtifactIndex). Everything else is ignored as before.
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
    for (const f of findSourceFiles(inputPath)) {
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
      // M-LANG: the banner counts every REGISTERED language's files and
      // says which — "16 Python files" on a four-language project was a
      // small lie the pump-polyglot drill surfaced (2026-09-06).
      const files = findSourceFiles(inputPath);
      const perLang = new Map<string, number>();
      for (const f of files) {
        const label = langOf(f)?.label ?? "other";
        perLang.set(label, (perLang.get(label) ?? 0) + 1);
      }
      const breakdown = [...perLang].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${n} ${l}`).join(", ");
      console.log(`  Project:  ${inputPath} (${files.length} source files${perLang.size > 1 ? `: ${breakdown}` : ""})`);
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

// The first view the webview opens once the project has parsed: the
// architecture overview by default, or the thread-index launchpad. The e2e
// suites pin "index" (playwright.config.ts); anything else is refused to the
// default rather than trusted into the page.
const START_VIEW = process.env.VG_START_VIEW === "index" ? "index" : "architecture";

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
    body { background: hsl(222 18% 7%); }
  </style>
  <meta name="vg-start-view" content="${START_VIEW}">
</head>
<body>
  ${bootMarkup()}
  <div id="root"></div>
  <script src="/webview.js"></script>
</body>
</html>`;
}
