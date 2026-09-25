/**
 * M7 wave 1 — contract between server.ts and the MCP layer.
 *
 * server.ts owns the runtime state (projectParse / lastParse / isDirectory,
 * the python subprocess helpers, the WebSocket client set). The MCP layer
 * doesn't import server.ts directly; instead server.ts constructs a
 * VibegraphMcpContext and passes it into createMcpHttpHandler. Keeps the
 * import graph one-way and means future test harnesses can stub these
 * methods without booting the full server.
 */

import type { ReadmeResult } from "../server/readme_store";
import type { ThreadSkillResult } from "../server/thread_skill_store";
import type { ThreadRunResult } from "../shared/protocol";
import type { ThreadBlindSpots } from "../webview/threads/blindSpots";
import type { ThreadAssertions } from "../webview/threads/threadAssertions";
import type { CitationCheck } from "../server/citations";
import type { BlastRadius } from "../server/blast_radius";
import type { IrDelta } from "../server/ir_delta";
import type { NodeExplanation } from "../server/explain";
import type { DynamicObservation } from "../server/observe";
import type { ThreadAgentResult } from "../server/thread_agent";
import type { WorkPlan } from "../server/plan_work";
import type { ThreadContract } from "../server/thread_contract";
import type { Constraint } from "../server/constraint_store";
import type { StackIndex, StackTool } from "../server/stack";
import type { Crossing } from "../server/crossings";

export type RewriteOp =
  | "replace_node"
  | "insert_statement_before"
  | "insert_statement_after"
  | "delete_node"
  | "rename_symbol";

export interface VibegraphMcpContext {
  /** True when the runtime was launched against a directory (project mode). */
  isDirectory(): boolean;

  /** Absolute path of the launched .py file or root directory. */
  resolvedPyFile(): string;

  /** Project-mode: list of file paths in projectParse. Single-file mode: [resolvedPyFile]. */
  listFiles(): string[];

  /**
   * Project-mode: returns the IR for filePath (per-file IR v1.x), or the
   * v2.0 project envelope when filePath is omitted.
   * Single-file mode: returns lastParse regardless of filePath.
   */
  getProjectIR(filePath?: string): unknown;

  /**
   * M8.2.4 — entry points discovered for the loaded project (PLAN-v2.md
   * §1.2). Empty in single-file mode.
   */
  listEntryPoints(): unknown[];

  /** Returns the source slice for a structural-path node id, or an error message. */
  getNodeSource(nodeId: string, filePath?: string): { source: string } | { error: string };

  /** Search every file's symbolIndex for entries whose name (and optional kind) match. */
  findSymbol(name: string, kind?: string): unknown[];

  /** Current selection on the webview ({} if nothing selected). */
  getSelection(): { nodeId: string | null; filePath: string | null };

  /** Drive selection from outside the webview; broadcasts via WebSocket to all connected clients. */
  setSelection(nodeId: string, filePath?: string): void;

  /** Apply a CST-backed rewrite through scripts/cst_rewrite.py. Re-parses and
   *  broadcasts on success. `delta` (B3) reports the structural IR change for
   *  self-verification. */
  rewriteNode(args: {
    nodeId: string;
    op: RewriteOp;
    payload: Record<string, unknown>;
    filePath?: string;
    /** M-ORCH.4 — set by a WORKER session's MCP URL (`/mcp?packet=p3`):
     *  the edit is confined to that packet's edit scope. */
    packetId?: string;
  }): Promise<{ success: boolean; message?: string; errorKind?: string; delta?: IrDelta }>;

  /** Insert new code via scripts/cst_rewrite.py (compose palette path). */
  composeInsert(args: {
    mode: "before" | "after" | "top-level";
    source: string;
    anchorNodeId?: string;
    filePath?: string;
    packetId?: string;
  }): Promise<{ success: boolean; message?: string; delta?: IrDelta }>;

  /** M-ORCH.3 — create a NEW Python module through cst_rewrite's
   *  create_file. Allowed ONLY while a run packet is RUNNING and lists the
   *  path among its files (the human confirmed that list at the objective
   *  gate); refuses existing files, non-Python paths, and paths outside the
   *  project. Re-parses, links, and refreshes derived data on success.
   *  M-ORCH.4 — `packetId` names the calling worker's packet (its MCP URL);
   *  without it, only an unambiguous single running packet qualifies. */
  createFile(path: string, source: string, packetId?: string): Promise<{ ok: boolean; message: string }>;

  /** Run scripts/extract_thread.py against a seed node id, returning the thread payload. */
  extractThread(seedNodeId: string, filePath?: string): Promise<unknown>;

  /**
   * A1 (PLAN-v6) — the per-thread honesty roll-up for the thread seeded at
   * seedNodeId: what in the thread is NOT statically known. Buckets the
   * thread's nodes into resolutionGaps (unresolved), runtimeDispatch
   * (dynamic), and uncaptured (undecomposed nested calls), plus a separate
   * parse-time `effects` axis. Pure IR fact, read-only — no execution, no
   * effect floor. Renders the same roll-up the deferred view badge will.
   */
  threadBlindSpots(seedNodeId: string, filePath?: string): Promise<ThreadBlindSpots>;

  /**
   * B4 (PLAN-v6) — the behavioural contract for the thread at seedNodeId: its
   * ordered execution path, the effects on it, terminals by kind, and
   * human-readable invariant strings to drop into a regression test. Pure IR
   * fact (not LLM), read-only.
   */
  threadAssertions(seedNodeId: string, filePath?: string): Promise<ThreadAssertions>;

  /**
   * A3 (PLAN-v6) — grounded-citation self-check. Splits the node-id-shaped
   * tokens in a chunk of prose into grounded (exist in the current IR) vs
   * ungrounded (hallucinated citations). The companion to the in-prompt
   * citation contract. Read-only.
   */
  validateCitations(text: string): CitationCheck;

  /**
   * A2 (PLAN-v6) — blast radius for a node: the statically-linked callers
   * (reverse reference index), the entry-point threads that traverse it, and
   * an HONEST flag that callers reaching it through a dynamic/unresolved hop
   * emit no edge (with name-matched suspects surfaced, clearly unverified).
   * Read-only.
   */
  blastRadius(nodeId: string, filePath?: string): BlastRadius;

  /** Run scripts/run_block.py against a node id, returning { stdout, stderr, exitCode }. */
  runBlock(nodeId: string, filePath?: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;

  /**
   * B1 (PLAN-v6) — run the thread up to an IR node and capture its value via
   * the ephemeral run-to-node engine (never writes the real file). The server
   * DERIVES entryFn/exprN from the node id (don't-trust-client, as the SM3
   * floor does); the agent passes only the value-of-interest assignment node.
   * Returns the honest-outcome envelope incl. provenance and the SM3
   * effect-consent handshake: a side-effectful path returns
   * outcome="requires-confirmation" with `effects` + a scope-bound
   * `effectConsentToken`; re-call with that token as `effectConsent` to run.
   * The token's secret resets on reboot, so a stale/tampered token simply
   * re-returns requires-confirmation with a fresh token — never a silent run.
   */
  runThreadToNode(args: {
    nodeId: string;
    filePath?: string;
    synthArgs?: Record<string, string>;
    effectConsent?: string;
    // M-RUN2.1 — METHOD targets: constructor literal expressions for the
    // synthesized example instance ({} = all-defaults). The class itself is
    // server-derived from the IR, never caller-supplied.
    synthInstanceArgs?: Record<string, string>;
  }): Promise<ThreadRunResult>;

  /**
   * B2 (PLAN-v6) — ephemeral upstream override: re-bind overrideNodeId's
   * variable to a validated LITERAL `value`, then run to nodeId and capture its
   * value. What-if debugging with NO disk write. The value passes the same
   * literal-only chokepoint as synth args; the SM3 floor still gates effects.
   * Result provenance is synthesized-input and carries the applied `override`.
   */
  runThreadToNodeOverride(args: {
    nodeId: string;
    overrideNodeId: string;
    value: string;
    filePath?: string;
    effectConsent?: string;
  }): Promise<ThreadRunResult>;

  /**
   * Subscribe to webview selection changes (M5's vg-selection bus, surfaced via WS).
   * Returns an unsubscribe function.
   */
  onSelectionChanged(cb: (sel: { nodeId: string; filePath?: string }) => void): () => void;

  /**
   * Subscribe to project-update events (any save / rewrite / compose).
   * Returns an unsubscribe function.
   */
  onProjectUpdated(cb: () => void): () => void;

  /** Read source of a file in the project. Path must be in listFiles(). */
  readFileSource(filePath: string): { source: string } | { error: string };

  /** Static reference text describing the shape grammar (so Claude has it in-context as a resource). */
  getShapeGrammarReference(): string;

  /**
   * M20.1 — the dynamic README (PLAN-v5 §2) for a thread (id =
   * entryPointId) or a file (id = project-relative path), tagged with
   * staleness vs the current IR hash. exists:false when none is
   * generated yet. Read-only; generation is M20.2.
   */
  getReadme(scope: "thread" | "file", id: string): ReadmeResult;

  /**
   * M20.2 — generate (or refresh) a dynamic README via `claude -p`, then
   * persist it stamped with the current IR hash. On-request only.
   */
  generateReadme(scope: "thread" | "file", id: string): Promise<{ ok: boolean; body?: string; error?: string }>;

  /**
   * C1 (PLAN-v6) — generate (or regenerate) a thread-skill DRAFT via `claude -p`
   * over the thread projection, with a deterministic A1 honesty block appended.
   * Always written status=draft; a human ratifies by editing the file. The
   * agent gets no ratify path (human-gating is the point).
   */
  generateThreadSkill(entryPointId: string): Promise<{ ok: boolean; body?: string; error?: string }>;

  /**
   * C1 (PLAN-v6) — read a thread-skill tagged with status (draft|ratified) and
   * staleness vs the thread's current IR. exists:false when none generated.
   */
  getThreadSkill(entryPointId: string): ThreadSkillResult;

  /**
   * C2 (PLAN-v6) — a LABELLED inference about an unresolved/external node
   * (e.g. F.relu): Claude's likely-purpose, with an attribution making clear it
   * is interpretation, NOT a resolved fact, and never changes the node's state.
   * Cached by node id + source hash. interpretation is null on an error or when
   * the claude CLI is unavailable (the attribution still travels).
   */
  explainNode(nodeId: string, filePath?: string): Promise<NodeExplanation>;

  /**
   * B5 (PLAN-v6) — runtime-assisted resolution: run the enclosing function up
   * to a dynamic call site and observe the receiver's runtime type (the actual
   * dispatch target THIS run). `receiver` is the variable name to inspect.
   * Returns a LABELLED runtime sample — NEVER promoted to a static resolution
   * (the node stays dynamic). Inherits the SM3 floor + effect-consent.
   */
  observeDynamicTarget(args: {
    nodeId: string;
    receiver: string;
    filePath?: string;
    effectConsent?: string;
  }): Promise<DynamicObservation>;

  /**
   * PLAN-M-RUNTIME phase 3 — run ONE entry point under the tracer and record
   * what every call site it touched actually called. The batch form of
   * observeDynamicTarget, with the same floor: an effectful path returns
   * requires-confirmation + a token and NOTHING has run.
   *
   * The result is an OVERLAY stored beside the IR (.vibegraph/
   * observations.json), never merged into it — every annotated node keeps
   * its `dynamic` / `unresolved` kind, because one run can lie.
   */
  traceEntryPoint(args: {
    entryPointId: string;
    effectConsent?: string;
  }): Promise<unknown>;

  /**
   * D1 (PLAN-v6) — spawn a subagent whose context is BOUNDED to one thread
   * (compact projection + ratified thread-skill + blind-spot roll-up + adjacent
   * threads), with an escalation protocol so it refuses honestly rather than
   * confabulating across threads. `escalated` is true when it did.
   */
  spawnThreadAgent(entryPointId: string, task: string): Promise<ThreadAgentResult>;

  /**
   * M-SKILL.4 — draft a skill for every thread lacking an authoritative one.
   * Serial; output is ALWAYS draft (human ratification still required); a
   * per-thread grounding failure lands in `failed`, never silently skipped.
   */
  sweepThreadSkills(): Promise<{
    total: number;
    drafted: Array<{ entryPointId: string; ok: boolean; error?: string }>;
    failed: Array<{ entryPointId: string; ok: boolean; error?: string }>;
    skipped: string[];
  }>;

  /**
   * vibegraph_plan_work — deterministic task decomposition: remit-matched
   * threads as ordered, boundary-annotated work packets. Pure read over the
   * live envelope; the CALLER orchestrates (spawn_thread_agent per packet),
   * the human ratifies. Never spawns anything.
   */
  planWork(task: string, maxPackets?: number): WorkPlan;
  /** M-AGENT2 — draft an Agent Manager work run from a task (plan_work
   *  decomposition → DRAFT). Returns a human-readable summary or an
   *  error string. RATIFICATION IS NOT EXPOSED here: only the human,
   *  in the board, can ratify a run or approve a packet. M-ORCH — `mode`
   *  "orchestrated" asks for an orchestrator brief; the human still
   *  confirms the objective in the board before anything runs. */
  startWorkRun(
    task: string,
    mode?: "gated" | "orchestrated",
    // M-ORCH.4 — lanes (packets in flight at once, edit scopes disjoint)
    // and the review policy ("pre-checks" approves deterministic-clean
    // packets without a model; "full" reads every diff).
    opts?: { parallel?: number; review?: "full" | "pre-checks"; autonomous?: boolean },
  ): { ok: boolean; message: string };

  /**
   * M-CONTRACT.2 — the thread contract for an entry point: what enters
   * (params), what leaves (declared return + return previews), every
   * effectful external call with its literal text, round trips inside
   * loops, cross-thread adjacency, and where static knowledge ends — IR
   * FACT. Plus the STATED constraints routed to the thread (each with its
   * source). Read-only.
   */
  threadContract(entryPointId: string): {
    contract: ThreadContract | null;
    constraints: Constraint[];
    rendered: { contract: string | null; constraints: string | null };
    error?: string;
  };
  /**
   * M-CONTRACT.3 — state a constraint (payload schema / proxy / backend
   * call / perf lever / invariant / objective) scoped to threads, files, or
   * everything. Persisted to .vibegraph/constraints.json with source
   * "agent" — it injects into prompts LABELLED as agent-stated, never as
   * human-authoritative. Returns the stored record or a validation error.
   */
  stateConstraint(input: unknown): { ok: true; constraint: Constraint } | { ok: false; error: string };
  /** M-CONTRACT.3 — every stored constraint (read-only). */
  listConstraints(): Constraint[];

  /**
   * M-STACK.1 — the STACK FACTS: which software tools this project uses,
   * each with its role, origin (third-party / stdlib / a PROJECT module
   * that funnels one — the proxy case), declared version (manifests only),
   * and the parse EVIDENCE behind it. Pass an entryPointId for one
   * thread's slice. Read-only, IR-derived; a tool the taxonomy does not
   * know is listed with role "unknown", never classified by guess.
   * `spec` is the rendered SYSTEM SPEC — the facts WITH the policies
   * stated about each tool and any disagreement between the two; the
   * same block the brief, the workers and the chat receive.
   */
  stack(entryPointId?: string): {
    index: StackIndex;
    thread?: { entryPointId: string; tools: StackTool[]; called?: string[] };
    spec: string;
    error?: string;
  };

  /**
   * M-XLANG.1 - the CROSSINGS: every HTTP hop that leaves a thread's own
   * language, with the route(s) in this project that serve the path. The
   * match is over parsed data on both sides (the caller's URL argument,
   * the receiver's route metadata) and it is WEIGHED, never resolved: two
   * routes that both serve a path come back as two, a framework's default
   * method is labelled as an assumption, and the base URL is never
   * followed. A thread's own `filesReached` is untouched by a crossing.
   */
  crossings(entryPointId?: string): {
    all: Crossing[];
    thread?: { entryPointId: string; crossings: Crossing[] };
    error?: string;
  };

  /**
   * M-ARCH.1 - the DERIVED architecture: clusters of entry points (a
   * framework's family × a package root), the boundary tools their threads
   * call, and the edges between them with a protocol read from the fact
   * (a hop's kind, a tool's role) and refs to the call sites.
   */
  architecture(): { model: import("../shared/protocol").ArchModelRecord | null; error?: string };

  /**
   * M-ARCH.4 - ask the thinking-tier model for deployment/trust groups,
   * names, a primary path and a narrative, grounded against the derived
   * model, the infra manifests and the docs. Stored PENDING; only a human
   * ratifies (in the GUI). Spends tokens.
   */
  proposeArchitecture(): Promise<{ ok: boolean; error?: string; groups?: number; names?: number; refused?: number; model?: import("../shared/protocol").ArchModelRecord | null }>;
}
