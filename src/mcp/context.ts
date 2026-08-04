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
  }): Promise<{ success: boolean; message?: string; errorKind?: string; delta?: IrDelta }>;

  /** Insert new code via scripts/cst_rewrite.py (compose palette path). */
  composeInsert(args: {
    mode: "before" | "after" | "top-level";
    source: string;
    anchorNodeId?: string;
    filePath?: string;
  }): Promise<{ success: boolean; message?: string; delta?: IrDelta }>;

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
}
