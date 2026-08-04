import type {
  AstNode, AstEdge, AstNodeType, AstPayload,
  SymbolEntry, RunOutput, ThreadRunResult, ThreadSynthProposal, ThreadDataProposal, EffectOffense, ProjectFileData,
  ProjectEnvelope, EntryPoint, ProjectThread, EffectKind,
  SystemTier, Subsystem, SystemEdge, SubsystemKind, SystemEffectKind,
  SystemPlan, PlannedSubsystem, PlannedSystemEdge,
  Changeset, ChangesetFile, ChangesetCheck, ChangesetFloor,
  BuildPlan, BuildPlanItem, BuildItemStatus,
} from "../shared/protocol";
import type { Thread } from "./threads";
export type {
  AstNode, AstEdge, AstNodeType, AstPayload,
  SymbolEntry, RunOutput, ThreadRunResult, ThreadSynthProposal, ThreadDataProposal, EffectOffense, ProjectFileData,
  ProjectEnvelope, EntryPoint, ProjectThread, EffectKind,
  SystemTier, Subsystem, SystemEdge, SubsystemKind, SystemEffectKind,
  SystemPlan, PlannedSubsystem, PlannedSystemEdge,
  Changeset, ChangesetFile, ChangesetCheck, ChangesetFloor,
  BuildPlan, BuildPlanItem, BuildItemStatus,
};

// PLAN-v7 Stage 4 — the app-held pending build increment: the changeset +
// its verification floor, held as a SIBLING overlay until accept/reject.
// Stage 5: when the increment belongs to an orchestrator run, runItemId
// names its roadmap item (reject then notifies the server to pause).
export interface PendingChangeset {
  changeset: Changeset;
  floor: ChangesetFloor;
  runItemId?: string;
}

// PLAN-v7 Stage 5 — the orchestrator's live dial, mirrored from the server's
// build-run-state broadcasts.
export interface BuildRunState {
  active: boolean;
  runItemId: string | null;
  note?: string;
}

// PLAN-v7 Stage 1 — a proposed (not-yet-written) node from a dry-run parse.
// Structural id + kind + label only; carries no resolution truth (the temp
// parse is pre-link). Reconciled against the post-link re-parse on accept.
export interface ComposeGhostNode {
  id: string;
  type: string;
  label: string;
}

// PLAN-v7 Stage 1 — the app-held proposal overlay. A SIBLING of the honest
// node/thread state, never merged into it; composed only at render. Cleared on
// accept (compose-done) or reject.
export interface PendingProposal {
  ghostNodes: ComposeGhostNode[];
  mode: "replace" | "insert_before" | "insert_after" | "append_end";
  anchorNodeId: string | null;
  filePath?: string;
  source: string;
  // PLAN-v7 Stage 1b — the source was drafted by `claude -p`. Drives the ghost
  // badge ("CLAUDE DRAFT" vs "PROPOSED"); the loop is otherwise identical.
  drafted?: boolean;
}

// M-SKILL.3 — one thread's skill lifecycle state as the server reports it.
// `error` rides a thread-skill-status reply when a ratify/redraft was refused
// (boundary validation or a grounding-gate failure) — stated, never silent.
export interface ThreadSkillRecord {
  entryPointId: string;
  exists: boolean;
  status?: "draft" | "ratified";
  stale?: boolean;
  generatedAt?: string;
  body?: string;
  error?: string;
  // M-SKILL.7 — human opt-in: keep injecting across code changes (with a
  // stated caveat); hasSnapshot gates whether a staleness diff is available.
  autoReaffirm?: boolean;
  hasSnapshot?: boolean;
}

// M-TRAINED.2 — one artifact's state as the server reports it: a file the
// project's own code produces (model.pt, *.pkl…), with its producer and
// consumer threads and freshness vs the producers' source mtimes.
export interface ArtifactRecordWire {
  path: string;
  producers: Array<{ entryPointId: string; qualifiedName: string; file: string; line: number; nodeId: string; call: string }>;
  consumers: Array<{ entryPointId: string; qualifiedName: string; file: string; line: number; nodeId: string; call: string }>;
  exists: boolean;
  mtimeMs: number | null;
  stale: boolean;
  staleReason: string | null;
}

// M-SKILL.7 — what changed in the thread since the skill's stamp.
export interface ThreadSkillDiff {
  added: Array<{ id: string; kind: string; label: string; file: string | null }>;
  removed: Array<{ id: string; kind: string; label: string; file: string | null }>;
  relabeled: Array<{ id: string; from: string; to: string }>;
}

export type ExtensionMessage =
  | { type: "ast-update"; payload: AstPayload }
  | { type: "project-update"; payload: ProjectEnvelope }
  // M26.4 — server-side derived refresh (re-link / re-extract) in
  // progress; the toolbar shows a muted pulse between started and done.
  | { type: "graph-refresh"; payload: { state: "started" | "done" } }
  | { type: "error"; payload: { message: string } }
  | { type: "modify-started"; payload: { nodeId: string } }
  | { type: "modify-done"; payload: { nodeId: string; success: boolean; message?: string } }
  | { type: "run-output"; payload: { nodeId: string } & RunOutput }
  | { type: "thread-run-result"; payload: ThreadRunResult }
  | { type: "thread-synth-proposal"; payload: ThreadSynthProposal }
  | { type: "thread-data-proposal"; payload: ThreadDataProposal }
  // Sitting-2 — the pin's honest outcome: manual = the pin took;
  // already-seeded = the function already had a thread (discovery dedups
  // manual seeds last); not-seeded = discovery dropped the seed.
  | { type: "manual-seed-result"; payload: {
      file: string;
      irNodeId: string;
      outcome: "added" | "already-seeded" | "not-seeded";
      entryPointId: string | null;
      qualifiedName: string | null;
      kind: string | null;
    }}
  | { type: "edit-node-source"; payload: { nodeId: string; source: string; error?: string } }
  | { type: "edit-node-saved"; payload: { nodeId: string; success: boolean; error?: string } }
  | { type: "intent-proposal"; payload: {
      // M18.5 — reply to place-intent. previewSource is the proposed new
      // enclosing function (or whole module when the change is module-
      // scope); the panel loads it into Edit-mode Monaco for the human-
      // approval gate, and Save commits it via the Mode A path against
      // commitTargetId (replace_function_body, or replace_module_body when
      // isModule). tier records which placer produced it.
      previewSource: string | null;
      commitTargetId: string | null;
      isModule: boolean;
      tier: "heuristic" | "llm" | "none";
      reason: string;
      error?: string;
    }}
  | { type: "replace-body-saved"; payload: {
      // M18.3 — reply to replace-body-save. nodeId echoes the request so
      // a panel can match its in-flight save; errorKind/diff surface the
      // M18.2 op's structured rejection for the inline error row.
      nodeId: string | null;
      success: boolean;
      error?: string;
      errorKind?: string;
      diff?: string;
    }}
  | { type: "compose-done"; payload: { success: boolean; message?: string } }
  // PLAN-v7 Stage 1 — reply to compose-propose. The dry-run parse of the
  // (unwritten) edit: ghostNodes are the NEW structural nodes the op would
  // create. Proposal-only — never honest IR. The echo (mode/anchor/source/
  // filePath) rides along so accept can re-run the SAME op wet.
  | { type: "compose-proposal"; payload: {
      ok: boolean;
      ghostNodes: ComposeGhostNode[];
      mode: "replace" | "insert_before" | "insert_after" | "append_end";
      anchorNodeId: string | null;
      filePath?: string;
      source: string;
      // PLAN-v7 Stage 1b — true when the source came from a `claude -p` draft.
      drafted?: boolean;
      error?: string;
    }}
  // PLAN-v7 Stage 3 — reply to system-propose. ok → the webview holds the
  // plan as pendingSystemPlan (a SIBLING overlay, never merged into the
  // honest system tier); !ok surfaces the validation reason.
  | { type: "system-proposal"; payload: { ok: boolean; plan?: SystemPlan; error?: string } }
  // PLAN-v7 Stage 4 — reply to changeset-propose: the changeset echoed back
  // with its verification floor (parse + sandboxed behavioural check). The
  // gate enables acceptance only when floor.ok.
  | { type: "changeset-proposal"; payload: { ok: boolean; changeset?: Changeset; floor?: ChangesetFloor; runItemId?: string; error?: string } }
  // PLAN-v7 Stage 5 — reply to build-plan-propose/-intent: the roadmap for
  // ratification. Held as pendingBuildPlan until ratified/rejected.
  | { type: "build-plan-proposal"; payload: { ok: boolean; plan?: BuildPlan; error?: string } }
  | { type: "build-plan-saved"; payload: { ok: boolean; path?: string; error?: string } }
  // PLAN-v7 Stage 5 — the orchestrator's run dial (active/paused + which
  // item is in flight + an honest note about why the state changed).
  | { type: "build-run-state"; payload: { active: boolean; runItemId: string | null; note?: string } }
  // PLAN-v7 Stage 4 — reply to changeset-accept. ok → files written through
  // the chokepoint; the follow-on envelope refresh solidifies ghosts.
  | { type: "changeset-done"; payload: { ok: boolean; error?: string } }
  // PLAN-v7 Stage 3 — reply to system-plan-accept. ok → the ratified plan is
  // persisted; the follow-on project-update carries it as envelope.systemPlan.
  | { type: "system-plan-saved"; payload: { ok: boolean; path?: string; error?: string } }
  | { type: "analyze-result"; payload: { filePath: string; summary: string } }
  | { type: "analyze-error"; payload: { message: string } }
  | { type: "thread-update"; payload: { thread: Thread } }
  | { type: "thread-error"; payload: { message: string } }
  | { type: "file-source"; payload: { filePath: string; source: string } }
  | { type: "file-source-error"; payload: { filePath: string; message: string } }
  | { type: "runtime-state"; payload: { anthropicAvailable: boolean } }
  | { type: "chat-backend-info"; payload: { backend: "claude-stdio" | "claude-p-headless" | "agent-sdk"; sessionId?: string | null; resumed?: boolean } }
  // M-GF3.4 — `scope` marks a NON-main conversation ("stage:<itemId>"):
  // the ChatPanel ignores scoped chat messages; the StageDetailDialog
  // renders only its own scope. Absent = the main panel.
  | { type: "chat-chunk"; payload: { text: string; scope?: string } }
  // M-CHAT-POLISH.1 — toolUseId pairs a result to its tool card. The
  // result payload carries NO toolName: the backend's tool-use-end event
  // has no name, and the old "(mcp)" placeholder matched nothing.
  | { type: "chat-tool-use"; payload: { toolUseId: string; toolName: string; toolInput: Record<string, unknown>; scope?: string } }
  | { type: "chat-tool-result"; payload: { toolUseId: string; success: boolean; message?: string; scope?: string } }
  // M-SKILL.2 — remit-routing provenance: sent before the reply streams when
  // the question deterministically matched other threads' remits.
  | { type: "chat-routed"; payload: { matches: Array<{ entryPointId: string; qualifiedName: string; matchedOn: string[]; skillInjected: boolean; skillStale?: boolean }>; scope?: string } }
  // M-SKILL.3 — thread-skill lifecycle states (all threads / one thread).
  | { type: "thread-skills"; payload: { skills: ThreadSkillRecord[] } }
  | { type: "thread-skill-status"; payload: ThreadSkillRecord }
  // M-TRAINED.2 — the artifact index (trained-ness as artifact state).
  | { type: "artifact-index"; payload: { artifacts: ArtifactRecordWire[] } }
  // M-SKILL.7 — staleness diff reply (unavailable = pre-snapshot skill).
  | { type: "thread-skill-diff"; payload: { entryPointId: string; diff?: ThreadSkillDiff; unavailable?: boolean; error?: string } }
  // M-SKILL.4 — coverage sweep: per-item progress, then the honest summary
  // (failed lists every grounding refusal; nothing is silently skipped).
  | { type: "skill-sweep-progress"; payload: { done: number; total: number; entryPointId: string; ok: boolean; error?: string } }
  | { type: "skill-sweep-done"; payload: { summary?: { total: number; drafted: Array<{ entryPointId: string; ok: boolean; error?: string }>; failed: Array<{ entryPointId: string; ok: boolean; error?: string }>; skipped: string[] }; error?: string } }
  | { type: "chat-done"; payload: { scope?: string } }
  | { type: "chat-error"; payload: { message: string; scope?: string } }
  // M-GF3.4 — a dialogue turn ended with a ```vg-revise-stage block: the
  // server's parsed + dry-run-validated revision proposal for the stage.
  | { type: "build-plan-item-revision"; payload:
      | { itemId: string; ok: true; revised: { capability: string; needs: string[] } }
      | { itemId: string; ok: false; error: string } }
  // M-GF3.4 — result of applying a revision to the RATIFIED roadmap.
  | { type: "build-plan-item-modified"; payload: { ok: boolean; itemId: string; error?: string } }
  | { type: "set-selection"; payload: { nodeId: string; filePath?: string } }
  | { type: "external-call-resolved"; payload: {
      // M13.2 — reply for resolve-external-call. Tagged with the
      // requesting nodeId/qualifiedName so concurrent tooltip swaps
      // don't race. Shape mirrors scripts/resolve_external_callable.py.
      nodeId: string;
      qualifiedName: string;
      kind: "stdlib" | "third_party" | "unresolved";
      signature: string | null;
      signatureSource: "inspect" | "stub" | null;
      docstring: string | null;
      module: string | null;
      sourceFile: string | null;
      isBuiltin: boolean;
      error: string | null;
    }};

export type WebviewMessage =
  | { type: "connect-nodes"; payload: { sourceId: string; targetId: string } }
  | { type: "disconnect-nodes"; payload: { sourceId: string; targetId: string } }
  | { type: "modify-node"; payload: { nodeId: string; prompt: string } }
  | { type: "edit-node-open"; payload: { nodeId: string; filePath?: string } }
  | { type: "edit-node-save"; payload: { nodeId: string; newSource: string; filePath?: string } }
  | { type: "place-intent"; payload: {
      // M18.5 Mode B — the selected node + plain-language intent. The
      // server runs the Tier 1 heuristic placer, then the Tier 2 claude
      // -p fallback, and replies with intent-proposal.
      intent: string;
      targetIrNodeId: string;
      filePath: string;
    }}
  | { type: "replace-body-save"; payload: {
      // M18.3 — Mode A commit. isModule routes to op_replace_module_body
      // (nodeId ignored); otherwise op_replace_function_body, with
      // allowSignatureChange set only when the function_def itself was the
      // selected node (see resolveEditTarget.signatureEditable).
      nodeId: string | null;
      newSource: string;
      filePath: string;
      isModule: boolean;
      allowSignatureChange: boolean;
    }}
  | { type: "set-model-tiers"; payload: { thinking: string | null; routine: string | null } }
  | { type: "chat-send"; payload: { text: string; contextNodeId: string | null; clearHistory?: boolean; filePath?: string; threadEntryPointId?: string | null; model?: string } }
  // M-GF3.4 — one turn of the per-stage dialogue. The CURRENT plan snapshot
  // rides along (pending proposal or ratified roadmap — the server only
  // holds the latter) and is validated at the boundary.
  | { type: "stage-chat-send"; payload: { itemId: string; text: string; plan: BuildPlan } }
  | { type: "stage-chat-close"; payload: { itemId: string } }
  // M-GF3.4 — apply a dialogue-proposed revision to the RATIFIED roadmap.
  | { type: "build-plan-item-modify"; payload: { itemId: string; revision: { capability?: string; needs?: string[] } } }
  | { type: "compose-insert"; payload: {
      mode: "replace" | "insert_before" | "insert_after" | "append_end";
      anchorNodeId: string | null;
      filePath?: string;
      source: string;
    }}
  // PLAN-v7 Stage 1 — same payload as compose-insert, but DRY: the server
  // dry-runs the op (no write) and replies with compose-proposal. The insert
  // path is now propose-first; the wet compose-insert fires only on accept.
  | { type: "compose-propose"; payload: {
      mode: "replace" | "insert_before" | "insert_after" | "append_end";
      anchorNodeId: string | null;
      filePath?: string;
      source: string;
    }}
  // PLAN-v7 Stage 1b — plain-language intent instead of ready source. The
  // server drafts the function via `claude -p`, then feeds it to the SAME 1a
  // propose path and replies with compose-proposal (drafted: true).
  | { type: "compose-propose-intent"; payload: {
      intent: string;
      mode: "replace" | "insert_before" | "insert_after" | "append_end";
      anchorNodeId: string | null;
      filePath?: string;
    }}
  // PLAN-v7 Stage 3 — submit a proposed architecture for boundary validation
  // (3a: canned; 3b: claude -p drafted server-side via system-propose-intent).
  | { type: "system-propose"; payload: { plan: SystemPlan } }
  // PLAN-v7 Stage 3b — a plain-language project description. The server
  // drafts the architecture via `claude -p` (grounding-enforced) and replies
  // with the SAME system-proposal shape as the canned path.
  | { type: "system-propose-intent"; payload: { description: string } }
  // PLAN-v7 Stage 4 — submit a build increment for the dry verification
  // floor (4a: canned; 4b: builder-drafted). Nothing is written. 6b: an
  // optional effectConsentToken (server-minted at decline, scope-bound to
  // this changeset + its offense set) authorizes running an EFFECTFUL
  // check; runItemId keeps an orchestrator-run gate's item association
  // across the consented re-propose.
  | { type: "changeset-propose"; payload: { changeset: Changeset; effectConsentToken?: string; runItemId?: string } }
  // PLAN-v7 Stage 4b — one capability in plain language; the builder agent
  // drafts the increment (bounded to the ratified plan), the full floor
  // re-runs, and the reply is the SAME changeset-proposal shape.
  | { type: "changeset-propose-intent"; payload: { intent: string } }
  // PLAN-v7 Stage 5 — roadmap lifecycle + run controls. Accept advances the
  // run through the normal changeset-accept; these are the other dials.
  | { type: "build-plan-propose"; payload: { plan: BuildPlan } }
  // M-GF3.5 — Modify on the proposed roadmap: `guidance` + the `previous`
  // draft ride along so the drafter revises rather than restarts.
  | { type: "build-plan-propose-intent"; payload: { guidance?: string; previous?: BuildPlan } }
  // M-GF3.5 — Modify at the changeset gate: re-draft the CURRENT increment
  // with the human's instruction. runItemId keeps a run gate's association;
  // label is the fallback base for a non-run (Build-button) changeset.
  | { type: "changeset-modify"; payload: { instruction: string; runItemId?: string; label?: string } }
  | { type: "build-plan-accept"; payload: { plan: BuildPlan } }
  | { type: "build-run-start"; payload: Record<string, never> }
  | { type: "build-run-pause"; payload: Record<string, never> }
  | { type: "build-run-reject"; payload: { itemId: string } }
  | { type: "build-run-retry"; payload: { itemId: string; capability?: string } }
  | { type: "build-run-skip"; payload: { itemId: string } }
  | { type: "build-run-stop"; payload: Record<string, never> }
  // PLAN-v7 Stage 4 — human acceptance: the full changeset rides back
  // ("same op twice") for boundary re-validation + the wet build.
  | { type: "changeset-accept"; payload: { changeset: Changeset } }
  // PLAN-v7 Stage 3 — human ratification of the pending plan ("same op twice":
  // the full plan rides the accept so the server re-validates at the boundary).
  | { type: "system-plan-accept"; payload: { plan: SystemPlan } }
  | { type: "analyze-file"; payload: { filePath?: string } }
  | { type: "extract-thread"; payload: { filePath: string; irNodeId: string } }
  | { type: "get-file-source"; payload: { filePath: string } }
  | { type: "run-node"; payload: { nodeId: string; filePath?: string } }
  | { type: "run-thread-to-node"; payload: { nodeId: string; irTargetId?: string; filePath?: string; entryFn: string; exprN: string; synthArgs?: Record<string, string>; effectConsent?: string; synthInstanceArgs?: Record<string, string>; synthData?: { path: string; content: string; consent?: string } } }
  | { type: "synth-thread-args"; payload: { nodeId: string; irTargetId?: string; filePath?: string; entryFn: string; exprN: string; effectConsent?: string } }
  | { type: "synth-thread-data"; payload: { nodeId: string; irTargetId?: string; filePath?: string; path: string } }
  // M-SKILL.3 — thread-skill lifecycle: list states for badges/dots; ratify
  // a draft (the only client-reachable status change, validated server-side);
  // re-draft through the grounding-gated generator (output is always draft).
  | { type: "get-thread-skills"; payload: Record<string, never> }
  | { type: "get-artifact-index"; payload: Record<string, never> }
  | { type: "ratify-thread-skill"; payload: { entryPointId: string } }
  | { type: "redraft-thread-skill"; payload: { entryPointId: string } }
  | { type: "get-thread-skill-diff"; payload: { entryPointId: string } }
  | { type: "reaffirm-thread-skill"; payload: { entryPointId: string } }
  | { type: "set-skill-auto-reaffirm"; payload: { entryPointId: string; value: boolean } }
  | { type: "skill-sweep-start"; payload: Record<string, never> }
  | { type: "selection-changed"; payload: { irNodeId: string; filePath?: string } }
  | { type: "add-manual-seed"; payload: { filePath: string; irNodeId: string } }
  | { type: "resolve-external-call"; payload: {
      // M13.2 — tooltip fires this when a kind=external node is
      // hovered/pinned. Server walks importlib + inspect and replies
      // with external-call-resolved tagged by the same nodeId so we
      // can match async responses to the right tooltip.
      nodeId: string;
      qualifiedName: string;
    }};

// WebSocket bridge
class WsBridge {
  private ws: WebSocket | null = null;
  private listeners: Array<(msg: ExtensionMessage) => void> = [];
  private queue: string[] = [];

  constructor() {
    this.connect();
  }

  private connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    this.ws = new WebSocket(`${proto}//${location.host}`);
    this.ws.onopen = () => {
      for (const msg of this.queue) this.ws!.send(msg);
      this.queue = [];
    };
    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ExtensionMessage;
        for (const fn of this.listeners) fn(msg);
      } catch {}
    };
    this.ws.onclose = () => setTimeout(() => this.connect(), 1000);
  }

  postMessage(msg: WebviewMessage) {
    const data = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      this.queue.push(data);
    }
  }

  onMessage(fn: (msg: ExtensionMessage) => void) {
    this.listeners.push(fn);
  }

  removeListener(fn: (msg: ExtensionMessage) => void) {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }
}

export const bridge = new WsBridge();
