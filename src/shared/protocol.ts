// Shared types produced by parse_cst.py

export type AstNodeType =
  | "import" | "import_from"
  | "assignment"
  | "function_def" | "class_def"
  | "for_loop" | "if_stmt"
  | "return_stmt" | "raise_stmt"
  | "call";

export interface AstNode {
  id: string;
  type: AstNodeType;
  parentId: string | null;
  line: number;
  endLine: number;
  col: number;
  endCol: number;
  // import
  names?: string[];
  // import_from
  module?: string;
  // assignment
  name?: string;
  valueKind?: "scalar" | "string" | "fstring" | "list" | "tuple" | "dict" | "set" | "call" | "other";
  preview?: string;
  // assignment (IR 1.1+): dotted callee name when valueKind=='call'
  // (e.g. "nn.Conv2d"). Present in the schema + data; surfaced on the TS
  // type so consumers (cross-file link, architecture view) read it without
  // an `as any` cast.
  callTarget?: string;
  // assignment (field-additive): type-annotation source for `x: int`,
  // dataclass fields, etc. Declaration-only forms have an empty preview.
  annotation?: string;
  // function_def
  params?: string[];
  docstring?: string | null;
  // function_def + class_def (IR 1.2+, M8.2): decorator source text
  decorators?: string[];
  // function_def (IR 1.3+, M9.1): true for `async def`, false for sync
  isAsync?: boolean;
  // class_def
  bases?: string[];
  // for_loop
  target?: string;
  iterName?: string;
  // if_stmt
  condition?: string;
  hasElse?: boolean;
  // return_stmt
  value?: string | null;
  // raise_stmt
  exc?: string | null;
  // call
  funcName?: string;
  args?: string[];
  // assignment (field-additive): structured constructor args when
  // valueKind=='call'. `args` holds positional source strings (shared with
  // call nodes); `kwargs` the {name,value} keyword pairs. Used by the
  // architecture view for per-layer arg display + param counts.
  kwargs?: { name: string; value: string }[];
  isEffect?: boolean;
  // call + assignment (IR 1.3+, M9.1): external-system effect class.
  // Drives the M9 icon system + thread external-effects panel.
  effectKind?: EffectKind;
  // call (M-NEST): minted for a call nested inside another call's arguments
  // (parentId = the enclosing call/assignment/return node). Surfaced on the
  // TS type so the architecture view can expand nn.Sequential(...) members
  // without an `as any` cast. Present in the schema + data since M-NEST.
  nested?: boolean;
  nestedDepth?: number;
}

// IR 1.3+ (M9.1): closed enum, mirrors schemas/ir.schema.json:EffectKind.
export type EffectKind = "db" | "http" | "fs" | "subprocess" | "log";

export interface AstEdge {
  source: string;
  target: string;
  type: "contains" | "data" | "reference" | "control";
}

export interface SymbolEntry {
  sym: string;
  kind: "function" | "method" | "class" | "variable" | "import";
  name: string;
  scope: string;
  loc: { line: number; endLine: number; col: number; endCol: number | null };
  signature?: string;
  docstring?: string;
  valueType?: string;
  bases?: string[];
  module?: string;
  source: string;
}

export interface AstPayload {
  version: "1.0" | "1.1" | "1.2" | "1.3";
  filePath: string;
  nodes: AstNode[];
  edges: AstEdge[];
  symbolIndex: SymbolEntry[];
}

export interface ProjectFileData {
  nodes: AstNode[];
  edges: AstEdge[];
  symbolIndex: SymbolEntry[];
}

// M8.1 — project envelope IR v2.0 (PLAN-v2.md §1.1).
// Wraps the per-file IR map with project-scoped fields the v2 thread
// work depends on. entryPoints/threads ship empty in M8.1; populated in
// M8.2 / M8.3. See schemas/project_ir.schema.json for the wire shape.

export type EntryPointKind = "cli" | "route" | "public_api" | "test" | "manual" | "model";

export type EntryPointFramework =
  | null
  | "argparse" | "click" | "typer"
  | "flask" | "fastapi" | "django"
  | "pytest" | "pytorch";

export interface EntryPoint {
  id: string;                          // '<file>:<funcName>' — joins with ProjectThread.entryPointId
  kind: EntryPointKind;
  file: string;
  irNodeId: string;
  qualifiedName: string;
  label: string;
  summary?: string;
  framework?: EntryPointFramework;
  metadata?: Record<string, unknown>;
}

export interface ProjectThread {
  version: "1.0";
  seed: { file: string; irNodeId: string; qualifiedName: string };
  entryPointId: string | null;
  nodes: unknown[];                    // ThreadNode[] — see src/webview/threads/types.ts
  edges: unknown[];                    // ThreadEdge[]
  filesReached: string[];
}

// ── System tier (M19.1, PLAN-v5 §1) ───────────────────────────────────
// A pure roll-up of threads + per-file effectKind + entryPoints into
// architectural subsystems and the cross-subsystem edges between them.
// Emitted by scripts/build_system_tier.py; rendered by the system view
// (M19.2). See schemas/project_ir.schema.json $defs/System.

export type SubsystemKind =
  | "frontend" | "backend" | "db" | "cache" | "external_http" | "library";

export interface Subsystem {
  id: string;                          // kind, or `external_http:<host>`
  kind: SubsystemKind;
  label: string;
  framework?: string | null;
  endpointRefs?: string[];             // backend: route entryPoints[].id; library: owned non-manual entries (M-NN-2)
  fileCount?: number;                  // backend / library-with-entries
  detectedBy?: string;                 // frontend: convention-scan summary
  path?: string;                       // frontend: source dir (relative)
  evidence?: string;                   // derived subsystems: why
}

export type SystemEffectKind = "db" | "cache" | "http";

export interface SystemEdge {
  from: string;                        // `<owner>:<entryPointId>` | `frontend`
  to: string;                          // `db`|`cache`|`external_http:<host>` | `backend:<ep>`
  kind: "calls" | "effect";
  confidence: "high" | "low";
  evidence: string;                    // 'effectKind' | 'name-match' | 'string-scan'
  effectKind?: SystemEffectKind;       // effect edges only
  viaThread?: string | null;           // drill-down handle into threads[]
  refs: string[];                      // '<relpath>:<line>'
}

export interface SystemTier {
  subsystems: Subsystem[];
  edges: SystemEdge[];
}

// ── PLAN-v7 Stage 3 — the PROPOSED architecture (a LABELLED PLAN) ──────────
//
// A SystemPlan is Claude's (or a fixture's) architecture PROPOSAL: a plan
// traceable to the user's description, NEVER honest IR. It rides the envelope
// as a SIBLING of the honest `system` tier and is composed with it only at
// render time (planned subsystems ghost-render; an id that exists in the
// honest tier is already real — the solid wins). It becomes honest only when
// built code re-parses into matching subsystems.
//
// Deliberately NOT reusing Subsystem/SystemEdge: those carry parse-derived
// facts (endpointRefs, refs, confidence, evidence) a plan cannot honestly
// claim. The plan shape is minimal + carries per-item GROUNDING instead:
// `groundedIn` quotes (or closely paraphrases) the user's description; null
// means INFERRED — proposed unasked — and the gate renders that distinction.

export interface PlannedSubsystem {
  id: string;                          // same id convention as Subsystem.id
  kind: SubsystemKind;
  label: string;
  groundedIn: string | null;           // quote from the description | null = inferred
}

export interface PlannedSystemEdge {
  from: string;                        // planned/honest subsystem id
  to: string;
  groundedIn: string | null;
}

export interface SystemPlan {
  version: "1";
  description: string;                 // the user's words the plan traces to
  subsystems: PlannedSubsystem[];
  edges: PlannedSystemEdge[];
  drafted: boolean;                    // true when `claude -p` drafted it (3b)
  ratifiedAt?: string;                 // ISO timestamp — present once accepted
}

// ── PLAN-v7 Stage 4 — a build-increment CHANGESET (a LABELLED PLAN) ────────
//
// One thread-capability's worth of new code, proposed as a single reviewable
// unit: the files it touches (full contents per op) + the behavioural check
// that must pass before the human gate enables acceptance. 4a shipped
// CREATE-only; 6c adds MIXED create+edit — every op still routes through the
// cst_rewrite chokepoint (create_file / append_end / replace_node), so the
// format-and-diff confinement guards edits exactly as everywhere else.
// Accept runs each op WET through the chokepoint, then the re-parse is
// authoritative — ghost subsystems solidify only when the parsed reality
// matches the ratified plan.

// The changeset op set (PLAN-v7 6c) — a deliberate SUBSET of the chokepoint
// CLI: creation, adding to an existing module, and replacing one structural
// node. Widening it is an explicit decision (vibegraph-cst-ops guards).
export type ChangesetOp = "create_file" | "append_end" | "replace_node";

export interface ChangesetFile {
  path: string;                        // project-relative .py
  content: string;                     // full module source (create) / the added or replacement source (edits)
  op?: ChangesetOp;                    // absent = create_file (4a back-compat). create → path must NOT exist; edits → path MUST exist
  nodeId?: string;                     // structural target — required by replace_node, forbidden otherwise
}

export interface ChangesetCheck {
  // A full check MODULE that must define `__vg_check__()` (validated
  // structurally after the sandbox parse). It runs in a SANDBOX COPY of the
  // project, and ONLY if the effect-scan floor says the check path is
  // confidently pure — OR under explicit human consent (PLAN-v7 6b): an
  // effectful check is never silently run; the gate lists every detected
  // offense and a scope-bound token (changesetConsentScope + the SM3
  // effect_consent machinery) authorizes exactly this changeset content +
  // this offense set.
  module: string;
  description: string;                 // what passing proves, in human words
}

export interface Changeset {
  label: string;                       // "the create-note flow"
  files: ChangesetFile[];
  check: ChangesetCheck;
  drafted?: boolean;                   // true when a builder agent drafted it (4b)
}

// ── PLAN-v7 Stage 5 — the BUILD PLAN (the roadmap; a LABELLED PLAN) ────────
//
// The orchestrator's input and its durable state: an ordered, dependency-
// aware capability list decomposing the ratified SystemPlan, itself drafted
// → human-ratified → persisted (.vibegraph/build-plan.json). Per-item status
// is written back to the artifact as the run advances, so a run survives
// reloads and resumes from disk. The gates stay at every increment — the
// orchestrator automates BETWEEN gates, never through them.

export type BuildItemStatus =
  | "pending"    // not started
  | "drafting"   // builder is drafting this increment
  | "gated"      // at the changeset gate, awaiting the human
  | "built"      // accepted + built + re-parsed
  | "failed"     // floor red / builder declined / build error — run pauses
  | "skipped";   // human chose to skip; dependents are flagged

export interface BuildPlanItem {
  id: string;                          // short slug, unique in the plan
  capability: string;                  // the intent handed to the builder
  needs: string[];                     // item ids that must be built first
  groundedIn: string | null;           // quote from the description | null = inferred
  status: BuildItemStatus;
  failReason?: string;                 // honest reason when failed/skipped
  // The check's actual stdout+stderr (the Python traceback / assertion
  // message). Without it a failure persists as "check failed (exit 1)" and
  // nothing else, so by the time anyone asks WHY, the answer is gone.
  failOutput?: string;
}

export interface BuildPlan {
  version: "1";
  description: string;                 // the user's words the roadmap traces to
  items: BuildPlanItem[];
  drafted: boolean;                    // true when `claude -p` drafted it (5b)
  ratifiedAt?: string;                 // present once accepted/persisted
}

// The verification floor's verdict, computed at propose time. The gate
// enables "Accept & build" ONLY when ok — parse + behavioural both green.
export interface ChangesetFloor {
  files: Array<{
    path: string;
    ok: boolean;
    formatted?: string;                // dry-run create_file output (=== what accept writes)
    newNodes?: number;                 // IR nodes the file parses into
    error?: string;
  }>;
  check: {
    ok: boolean;                       // ran AND exit 0
    ran: boolean;                      // false when declined (impure) or files failed
    pure: boolean | null;              // effect-scan verdict (null = scan not reached)
    offenses?: Array<{ kind: string; effectKind?: string; target: string; file: string; line: number }>;
    // PLAN-v7 6b — consent for an effectful check. When the scan refuses,
    // the server MINTS a token scoped to (this changeset's content + this
    // offense set) and attaches it; the gate renders the offenses with a
    // consent affordance; re-proposing WITH the token runs the check anyway,
    // marked consented. A stale token (edited changeset / drifted offense
    // set) fails re-validation against the fresh scan — re-consent required.
    consentToken?: string;             // minted when declined; absent once consented
    consented?: boolean;               // true when the check ran under explicit consent
    // Sitting-2 — when the declined offenses include unverifiable calls, a
    // trust token: re-proposing with it grants the session-wide "stop asking
    // about unverifiable calls" (proven effects still gate per-run).
    trustToken?: string;
    output: string;                    // captured stdout/stderr tail
    error?: string;
  };
  ok: boolean;
}

export interface ProjectEnvelope {
  version: "2.1";
  files: Record<string, ProjectFileData>;
  symbolIndex: SymbolEntry[];          // project-wide flattened union
  entryPoints: EntryPoint[];           // empty in M8.1
  threads: ProjectThread[];            // empty in M8.1
  system: SystemTier;                  // M19.1 — empty in single-file mode
  // PLAN-v7 Stage 3 — the ratified (persisted) architecture plan, when one
  // exists. Optional + additive: envelopes without it validate unchanged.
  // A SIBLING of `system`, never merged into it.
  systemPlan?: SystemPlan;
  // PLAN-v7 Stage 5 — the ratified build plan (the roadmap + its live
  // per-item status), when one exists. Optional + additive, same rules.
  buildPlan?: BuildPlan;
}

export interface RunOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// M-RUN SM1 — thread test-run ("run to this node"). Distinct from RunOutput:
// carries the captured VALUE at N + provenance, with honest distinct outcomes.
export type ThreadRunOutcome =
  | "ok"                      // clean stop at N; `value` is N's repr
  | "probe-not-reached"       // fn ran to completion without hitting N
  | "value-opaque"            // captured, but repr is non-deterministic (mem addr)
  | "stop-not-enforced"       // a user except/finally swallowed the stop; ran past N
  | "import-error"            // a dependency could not be imported (env)
  | "runtime-error"           // the real code raised before reaching N
  | "timeout"                 // exceeded the run time limit
  | "value-ambiguous"         // no clean value-of-interest at N (SM2: ask Claude)
  | "needs-inputs"            // entry function requires arguments (SM2: synthesize)
  | "unsupported-target"      // N not in a rebuildable body / method / unformatted
  | "requires-confirmation"   // side-effectful/unknown path (SM3 confirm gate)
  | "harness-error";          // assembly/runner failure (never a user result)

// SM3 — one offense the authoritative scan detected on the path up to N. The
// confirm dialog lists these so the user gives INFORMED consent, not a generic
// "Run?". `kind` is the floor's refusal reason; effectKind names the side
// effect (fs/db/http/subprocess/log) when kind==="effect".
export interface EffectOffense {
  // "external-unprovable" — §5.5 floor safety: a viaReturnType-resolved call
  // with no parse-time effectKind (scan_effects emits it; was missing here).
  kind: "effect" | "dynamic" | "unresolved" | "external-unprovable";
  effectKind?: string | null;
  target: string;
  file: string;
  line: number;
}

export interface ThreadRunResult {
  nodeId: string;
  outcome: ThreadRunOutcome;
  value: string | null;
  valueOpaque: boolean;
  provenance: "real-input" | "synthesized-input";
  // SM3 — on a requires-confirmation outcome, the detected effects + a
  // server-minted, scope-bound consent token the client echoes back to run.
  effects?: EffectOffense[];
  effectConsentToken?: string | null;
  // Sitting-2 — when the gate contains unverifiable calls (kind !== "effect"),
  // a second token: echoing it as `trustUnverified` grants the session-wide
  // "stop asking about unverifiable calls" (proven effects still gate).
  trustUnverifiedToken?: string | null;
  // SM2 — when provenance is synthesized-input, the validated keyword-arg
  // call string actually used (e.g. "factor=2.5, label='hi'"), so the result
  // is read in light of the made-up premise. null/absent for real-input runs.
  synthArgs?: string | null;
  // M-RUN2.1 — for a method run: the validated example-instance construction
  // actually used (e.g. "Gauge(scale=2)"). null/absent otherwise.
  synthInstance?: string | null;
  // M-RUN2.2 — true when the run executed in a throwaway copy of the
  // project (any synthetic premise beyond literal args). The real tree is
  // untouched by construction, not by luck.
  sandboxed?: boolean;
  // M-RUN2.3 — the consented example data file actually used, as a display
  // string ("data/signals.csv (12 lines)"). null/absent otherwise.
  synthData?: string | null;
  // M-RUN2.3 — data files this path READS that don't exist yet (pre-run:
  // literal-path detection on the refused gate; post-run: a runtime
  // FileNotFoundError's project path). Detection only — an OFFER hook.
  missingData?: { path: string; file: string; line: number }[];
  // M-TRAINED.3 — ARTIFACT paths this run needs that don't exist (model
  // checkpoints etc.). Never a drafting offer: the producer thread is named
  // instead ("run training"). producers may be empty — honest, not silent.
  missingArtifacts?: {
    path: string;
    producers: { entryPointId: string; qualifiedName: string; nodeId: string; file: string }[];
  }[];
  // B2 (PLAN-v6) — when an ephemeral upstream override was applied, the
  // injected `<lhs> = <literal>` assignment, so the captured value is read
  // under that what-if premise. Absent on a normal run.
  override?: string | null;
  stdout: string;
  stderr: string;
  error?: string;
}

// SM2 — phase-1 proposal: the synthesized + literal-validated args for an
// arg-needing entry function, shown for the user to CONFIRM before any run
// (interpretation-honesty gate — distinct from SM3's side-effect gate). No
// code has executed when this is sent.
export interface ThreadSynthProposal {
  nodeId: string;
  ok: boolean;                          // true iff every arg validated
  call: string;                         // assembled keyword-arg string (when ok)
  accepted: Record<string, string>;     // param -> validated literal expression
  rejected: { param: string | null; expr: string | null; reason: string }[];
  error?: string;                       // synth/scan failure detail (when !ok)
  // Sitting-3 — required params used as tensors/arrays: the literal synth
  // can't produce these, so the gate declines up front (never proposes a
  // list doomed to crash on `.mean(dim=…)`). Present ⇒ the decline is a
  // feasibility verdict, not a synth failure; the UI says so distinctly.
  arraylikeParams?: string[];
  blockedByEffect?: boolean;            // true = refused by the SM3 floor, not synth
  // SM3 — when blockedByEffect, the detected effects + consent token so the
  // side-effect consent (distinct from the synth consent) can be shown first.
  effects?: EffectOffense[];
  effectConsentToken?: string | null;
  // Sitting-2 — see ThreadRunResult.trustUnverifiedToken (same grant).
  trustUnverifiedToken?: string | null;
  // M-RUN2.1 — for a METHOD target: the synthesized example-instance
  // construction (validated via check_literals --mode instance), shown in
  // the same confirm gate. `call` is the full constructor call string.
  instance?: { className: string; args: Record<string, string>; call: string };
}

// M-RUN2.3 — the drafted example data file, shown IN FULL for consent.
// dataConsentToken binds (node + path + content hash): edited or swapped
// content invalidates the approval. Nothing has been written when sent.
export interface ThreadDataProposal {
  nodeId: string;
  ok: boolean;
  path?: string;
  content?: string;
  dataConsentToken?: string;
  error?: string;
}

export type ExtensionToWebviewMessage =
  | { type: "ast-update"; payload: AstPayload }
  | { type: "project-update"; payload: ProjectEnvelope }
  | { type: "error"; payload: { message: string } }
  | { type: "modify-started"; payload: { nodeId: string } }
  | { type: "modify-done"; payload: { nodeId: string; success: boolean; message?: string } }
  | { type: "run-output"; payload: { nodeId: string } & RunOutput }
  | { type: "thread-run-result"; payload: ThreadRunResult }
  | { type: "thread-synth-proposal"; payload: ThreadSynthProposal }
  | { type: "thread-data-proposal"; payload: ThreadDataProposal }
  | { type: "edit-node-source"; payload: { nodeId: string; source: string; error?: string } }
  | { type: "edit-node-saved"; payload: { nodeId: string; success: boolean; error?: string } }
  | { type: "compose-done"; payload: { success: boolean; message?: string } }
  | { type: "analyze-result"; payload: { filePath: string; summary: string } }
  | { type: "analyze-error"; payload: { message: string } };

export type WebviewToExtensionMessage =
  | { type: "connect-nodes"; payload: { sourceId: string; targetId: string } }
  | { type: "disconnect-nodes"; payload: { sourceId: string; targetId: string } }
  | { type: "modify-node"; payload: { nodeId: string; prompt: string } }
  | { type: "run-node"; payload: { nodeId: string } }
  // nodeId = the thread node id (routing key the tooltip filters results by).
  // irTargetId = the IR node id of the call-SITE assignment the server probes;
  // distinct from nodeId because a resolved-call step node renders under the
  // callee's id, not the call site (see runToNode.ts / planRunToNode).
  | { type: "run-thread-to-node"; payload: { nodeId: string; irTargetId: string; filePath?: string; entryFn: string; exprN: string; synthArgs?: Record<string, string>; effectConsent?: string; synthInstanceArgs?: Record<string, string>; synthData?: { path: string; content: string; consent?: string } } }
  | { type: "synth-thread-args"; payload: { nodeId: string; irTargetId: string; filePath?: string; entryFn: string; exprN: string; effectConsent?: string } }
  | { type: "synth-thread-data"; payload: { nodeId: string; irTargetId?: string; filePath?: string; path: string } }
  | { type: "edit-node-open"; payload: { nodeId: string; filePath?: string } }
  | { type: "edit-node-save"; payload: { nodeId: string; newSource: string } }
  | { type: "compose-insert"; payload: {
      mode: "replace" | "insert_before" | "insert_after" | "append_end";
      anchorNodeId: string | null;
      filePath?: string;
      source: string;
    }}
  | { type: "analyze-file"; payload: { filePath?: string } }
  // M8.3.3: append a manual thread seed (PLAN-v2.md §1.2 "manual" kind).
  // Server persists to .vibegraph/manual_seeds.json and re-runs
  // discovery + extraction so the new seed appears in the next
  // project-update payload.
  | { type: "add-manual-seed"; payload: { filePath: string; irNodeId: string } };
