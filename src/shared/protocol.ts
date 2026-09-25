// Shared types produced by parse_cst.py

// M-STACK.1 — the stack ROLE/ORIGIN vocabulary lives in the taxonomy
// table (webview-safe, no imports of its own), and the wire shapes below
// bind to it so the panel, the server index, and the constraint store
// cannot drift apart.
import type { StackRole, StackOrigin } from "./stack_taxonomy";
export type { StackRole, StackOrigin };

export type AstNodeType =
  | "import" | "import_from"
  | "assignment"
  | "function_def" | "class_def"
  | "for_loop" | "if_stmt"
  | "return_stmt" | "raise_stmt"
  | "call"
  // IR 1.5 (M17.2) control-flow containers — were emitted + rendered
  // since M17 but missing from this union until M-LANG1's drift fix.
  | "try_stmt" | "except_handler" | "finally_block" | "while_loop"
  // M-COMP — the fifth container kind. A comprehension IS a loop; without
  // a container the round-trip detector could not see the N+1 that
  // `[fetch(u) for u in urls]` performs, while seeing the identical
  // spelled-out for-loop.
  | "comprehension"
  // M-SKILLS.3 — JS/TS only. Not a thread construct (the extractor never
  // walks it, and an interface calls nothing): a node is also the ADDRESS
  // an edit is sent to, and without one a TypeScript `interface` could not
  // be changed at all. A work-run packet escalated on exactly that.
  | "interface_def";

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
  // for_loop: how the SOURCE spells the for-each separator, when the
  // language has more than one. JS `for…in` walks keys and `for…of` walks
  // values; a label that picks one for the other names a different
  // construct. Absent = the language has one spelling and the reader uses
  // its default (Python and bash `in`, C++ `:`).
  iterSep?: string;
  // M-COMP — "list" | "set" | "dict" | "generator" on a `comprehension`.
  compKind?: string;
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
  // M-NEST: this statement's expression hides at least one call beyond its
  // outermost one (arg-nests, method chains). Drives the dashed
  // "path shown incomplete" badge, so a reader knows the externals list is
  // not exhaustive here. `nestExtracted` says whether v1 actually minted
  // the child `call` nodes, or only flagged that they exist.
  nestsInnerCalls?: boolean;
  nestExtracted?: boolean;
  // assignment (M-CONTRACT.5): the operator of an AUGMENTED assignment
  // (`total += f()` → "+="). Absent on a plain assignment.
  augmented?: string;
  // if_stmt (M17.3): the 1-based first line of the else/elif arm. What
  // `guards` reads to tell an arm's polarity.
  elseLine?: number;
  // function_def (M-CONTRACT.4): {param name → annotation source text}.
  // Additive beside `params`, which stays the plain name list.
  paramTypes?: Record<string, string>;
  // function_def / class_def (M-CONTRACT.6): the 1-based line of the FIRST
  // decorator, when the def is decorated. Every line-slicing reader and the
  // confinement span start HERE, not at `line` — reading and writing a
  // decorated node must agree on where it begins.
  decoratorLine?: number;
}

// IR 1.3+ (M9.1): closed enum, mirrors schemas/ir.schema.json:EffectKind.
export type EffectKind = "db" | "http" | "fs" | "subprocess" | "log";

export interface AstEdge {
  source: string;
  target: string;
  type: "contains" | "data" | "reference" | "control";
  /** M4a: absolute path of the file holding the target node. Absent for an
   *  intra-file edge. */
  targetFile?: string;
  /** v1.4+: the local variable this edge resolves THROUGH
   *  (`parser.add_subparsers()` bound to a local, then called). §5.5 uses
   *  the same field for a return-type hop. */
  viaLocal?: string;
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
  // Through "1.5" = parse_cst.py output; "2.0" = M-LANG1 multi-language
  // major (language discriminator required at 2.0, server-stamped below it).
  version: "1.0" | "1.1" | "1.2" | "1.3" | "1.4" | "1.5" | "2.0";
  filePath: string;
  // M-LANG1: source-language discriminator. Stamped by the server on
  // every parse (absence in old payloads means python).
  language?: LanguageId;
  nodes: AstNode[];
  edges: AstEdge[];
  symbolIndex: SymbolEntry[];
  // M4a: the file's module identity relative to the project root, as its
  // LANGUAGE defines one (Python: the dotted path; `__init__` collapses to
  // its package). The cross-file linker matches an import's module against
  // this, so a solo re-parse that drops it silently breaks linking INTO the
  // edited file until the next full pass — the M26 verification bug.
  modulePath?: string;
}

// M-LANG1 — mirrors schemas/ir.schema.json `language`. The full registry
// (extensions, Monaco language, capabilities) lives in src/shared/languages.ts.
export type LanguageId = "python" | "bash" | "jsts" | "cpp" | "rust";

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

// M-LANG1 opened this from a closed Python-framework union to an open
// string: each language frontend's discover step names its own frameworks.
// Well-known Python values: argparse, click, typer, flask, fastapi,
// django, pytest, pytorch. (Future: shell, express, fastify, …)
export type EntryPointFramework = string | null;

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
  | "frontend" | "backend" | "db" | "cache" | "external_http" | "library"
  // PLAN-v5 5.4 - the three effects v5 parked as "intra-backend detail".
  // Promoted once the polyglot examples made them the story rather than
  // the detail (an ops script IS subprocess + remote work).
  | "fs" | "subprocess" | "log";

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
  /** PLAN-v5 5.3 - every thread that TOUCHES this subsystem, not just the
   *  ones that start in it. A thread belongs to as many subsystems as it
   *  reaches; `ingest_route` is a backend route that also writes the db
   *  and posts a webhook, and reading it as "a backend thread" hides two
   *  thirds of what it does. Derived from the effect edges' existing
   *  `viaThread` handles - no new evidence. */
  threadRefs?: string[];
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
  // M-AGENT1 — the Agent Manager's durable work run, when one exists.
  // Optional + additive, same rules. Transitions happen server-side only
  // (src/server/work_run.ts); the webview renders and sends gate messages.
  workRun?: WorkRun;
  // M-CONTRACT.3 — stated constraints (.vibegraph/constraints.json), when
  // any exist. Optional + additive. The store lives server-side
  // (src/server/constraint_store.ts); the board lists/adds/removes.
  constraints?: ConstraintRecord[];
  // M-STACK.1 — the STACK FACTS (which tools this project uses, with the
  // parse evidence behind each). Optional + additive, rebuilt on every
  // derived refresh; pure derivation, never persisted.
  stack?: StackIndexRecord;
  // PLAN-M-RUNTIME phase 3 — the TRACE OVERLAY: what one consented run of
  // an entry point actually dispatched to, per call site. Optional +
  // additive. Unlike `stack`/`crossings` this is NOT a derivation — a human
  // authorised a run and this is what it saw — so it is persisted
  // (.vibegraph/observations.json) and merely projected here.
  observations?: ObservationStoreRecord;
}

// ── PLAN-M-RUNTIME phase 3 — trace-overlay wire shapes ───────────────────
// Declared here so the server store (src/server/observations.ts) and the
// webview share ONE definition, the StackIndexRecord precedent.

export interface ObservedCalleeRecord {
  callee: string;
  count: number;
}

/** A LIST of callees, because one site can genuinely dispatch to several
 *  within a single run. Collapsing that would invent a winner. */
export interface NodeObservationRecord {
  line: number;
  callees: ObservedCalleeRecord[];
}

export interface TraceRunRecord {
  entryPointId: string;
  entryFn: string;
  language: string;
  at: string;
  outcome: string;
  inputs: string;
  observations: Record<string, Record<string, NodeObservationRecord>>;
  sourceHashes: Record<string, string>;
  /** Files whose source has MOVED since the run. Computed server-side, where
   *  the files are; a stale observation greys out rather than vanishing. */
  staleFiles?: string[];
  truncated?: boolean;
  error?: string;
}

export interface ObservationStoreRecord {
  version: number;
  runs: Record<string, TraceRunRecord>;
}

// ── M-CONTRACT.3 — stated-constraint wire shapes ─────────────────────────
// Declared here (the wire-contract home) so the webview board and the
// server store share one definition; the kind list is pinned in the
// store (CONSTRAINT_KINDS) against this union.
export type ConstraintKind =
  | "payload-schema" | "proxy" | "backend-call" | "perf-lever" | "invariant" | "objective"
  // M-STACK.2 — a decision ABOUT A TOOL (prefer the project's wrapper over
  // bare requests; the tensor program is torch, do not add tensorflow).
  // Carries a structured `policy` the deterministic checks can read.
  | "stack-policy";
export type ConstraintSource = "human" | "orchestrator" | "agent";
export interface ConstraintScope {
  all?: boolean;
  entryPointIds?: string[];
  files?: string[];
  // M-STACK.2 — scope by TOOL: reaches every thread whose stack (the
  // M-STACK.1 facts) includes one of these names. Dynamic by
  // construction — a new file that imports `requests` is inside the
  // scope the moment it is parsed, with no scope edit.
  stack?: string[];
}
export interface ConstraintRecord {
  id: string;
  kind: ConstraintKind;
  text: string;
  scope: ConstraintScope;
  source: ConstraintSource;
  createdAt: string;
  note?: string;
  // M-STACK.2 — kind "stack-policy": the structured decision the
  // deterministic pre-checks read. `text` stays the human sentence.
  policy?: StackPolicy;
  // M-GRAMMAR — the CHECKABLE half. `text` is still what a worker reads;
  // this is what the pre-checks EVALUATE against the IR, so a rule like
  // "no other module may call notify" stops being prose a reviewer nods at.
  // Optional and additive: a constraint without it behaves exactly as
  // before. The shape and its three verdicts live in
  // src/server/constraint_grammar.ts.
  check?: import("../server/constraint_grammar.ts").ConstraintCheck | import("../server/quality/verbs/index.ts").Run1Check;
  // M-SWEEP W6 — a constraint may have SEVERAL structural clauses. c3 is
  // the case that forced it: "paged ONLY through alerts.notify, and only
  // after alerts.should_notify has applied its dedup. No other module may
  // call notify" is two checkable rules in one sentence, and a single
  // `check` could only ever carry one of them.
  //
  // `check` is kept and still honoured, so nothing already stored breaks.
  checks?: Array<import("../server/constraint_grammar.ts").ConstraintCheck | import("../server/quality/verbs/index.ts").Run1Check>;
}

// ── M-STACK (PLAN-M-STACK.md) — stack facts + stack policies ────────
// Facts are IR-derived and carry EVIDENCE; a policy is STATED and carries
// a SOURCE. They are declared side by side here and never merged: a
// render shows both, and their disagreement is the signal.

/** A STATED decision about a tool. `tool` is a stack-index tool name (or a
 *  name the index has not seen yet — a policy may precede the code). */
export interface StackPolicy {
  tool: string;
  role?: StackRole;
  // M-CMD.3 — `describe`: this policy CLASSIFIES the tool (its `role` is
  // required) and decides nothing about its use. The rule the classify
  // pass writes, and the honest rule for a person stating what a private
  // SDK is; `require` said more than they meant.
  rule: "require" | "prefer" | "forbid" | "replace-with" | "describe";
  /** Required for "replace-with": what to use instead. */
  with?: string;
  reason?: string;
}

/** Re-exported so the wire record is self-describing. */
import type { ImportBinding, LocalBinding } from "./stack_attribution.ts";
export type { ImportBinding, LocalBinding };

export interface StackEvidenceRef {
  file: string;
  nodeId?: string;
  line?: number;
  kind: "import" | "call" | "include" | "config";
}

export interface StackToolRecord {
  tool: string;
  role: StackRole;
  origin: StackOrigin;
  /** Declared version from a manifest. Absent = no manifest said so. */
  version?: string;
  /** origin "project": the tools this funnel wraps. */
  wraps?: string[];
  /** M-BOUNDARY.1 — origin "project": the file that IS the funnel. Its
   *  importers are in `files` too and are BESIDE it, not inside it, which
   *  is the difference between "this call goes through the wrapper" and
   *  "this call happens to live in a file that imports the wrapper". */
  home?: string;
  files: string[];
  /** Threads whose reached FILES contain this tool (presence). */
  threads: string[];
  /** M-BOUNDARY.2 — threads with a BOUNDARY attributed to this tool (use).
   *  A subset of `threads`: present ⊇ called. */
  calledOn?: string[];
  evidence: StackEvidenceRef[];
  /** M-CMD.2 — where the role came from. ABSENT means a taxonomy table
   *  classified it. "stated" means a stack-policy in
   *  `.vibegraph/constraints.json` named this tool with a role because no
   *  table could, and `roleStatedBy` is that constraint's id. */
  roleSource?: "stated";
  roleStatedBy?: string;
  /** M-CMD.3 — the stating constraint's source. "agent" = a model's
   *  classification (the `classify` pass), NOT human-reviewed. */
  roleStatedSource?: ConstraintSource;
}

/** M-XLANG.1 - one route a crossing could land on. */
export interface CrossingTargetRecord {
  entryPointId: string;
  route: string;
  method: string;
  framework?: string | null;
  /** the receiver's method is the framework's documented default, not a
   *  parsed `methods=` - Flask's bare `@app.route` is implicit GET. */
  methodAssumed?: true;
}

/** M-XLANG.1 - one hop out of a thread's own language or process. */
export interface CrossingRecord {
  /** M-FLOW.2 — what kind of hop. `http`: a URL shape → a route. `command`:
   *  a string literal naming a script this project parses → that script's
   *  entry (`path` is the literal, a target's `route` the parsed file).
   *  `tool`: an MCP tool name → its registration (`path` is the name).
   *  Absent = http (records written before the field existed). */
  kind?: "http" | "command" | "tool";
  entryPointId: string;
  file: string;
  nodeId: string;
  callee: string;
  /** the static path shape the URL yields; `*` is an interpolated segment. */
  path: string;
  method: string | null;
  methodAssumed?: true;
  targets: CrossingTargetRecord[];
  /** `ambiguous` names every candidate and claims none; `unmatched` means
   *  the path resolved but nothing in this project serves it. */
  confidence: "path+method" | "path" | "ambiguous" | "unmatched";
  /** what the match could NOT establish - always present, always read. */
  note: string;
}

export interface CrossingIndexRecord {
  all: CrossingRecord[];
  byThread: Record<string, CrossingRecord[]>;
}

// ── M-ARCH (PLAN-M-ARCH.md) — the ARCHITECTURE model ──────────────────────
// Three strata that never blur: `derived` (aggregated from entry points,
// hops, contracts and the stack — IR fact with refs), `stated` (a person's
// .vibegraph/architecture.json), `proposed` (a model's, grounded or not).
// Wire shape here so the System view and the server read one record.

export type ArchSource = "derived" | "stated" | "proposed";

/** Where an element comes from in the code: a file, and the IR node that is
 *  also the address an edit is sent to. */
export interface ArchRef {
  file: string;
  nodeId?: string;
  text?: string;
}

export interface ArchNodeRecord {
  /** `cluster:<family>:<root>` | `tool:<name>` | `hub:<entryPointId>` |
   *  `actor:<name>` (Bird's-eye only: who reaches a web app). */
  id: string;
  kind: "cluster" | "tool" | "hub" | "actor";
  label: string;
  sublabel: string;
  category: import("./arch_protocol.ts").ArchCategory;
  source: ArchSource;
  /** cluster: the family (web | api | mcp | scripts | cli | model | library)
   *  and the package root it lives under ("" = the project root). */
  family?: string;
  root?: string;
  entryPoints?: string[];
  frameworks?: string[];
  /** cluster: distinct files its threads reach. */
  files?: number;
  /** cluster: hops whose both ends sit inside it, by kind. */
  internalHops?: Record<string, number>;
  /** tool: the stack record's facts. */
  tool?: string;
  role?: string;
  origin?: string;
  version?: string;
  roleStatedBy?: string;
  /** tool: project funnels that wrap it. */
  wrappedBy?: string[];
  threads: string[];
  refs: ArchRef[];
  notes?: string[];
  /** M-ARCH.4 — the label came from `.vibegraph/architecture.json`
   *  (stated) or a pending proposal; `derivedLabel` keeps the code's. */
  labelSource?: "stated" | "proposed";
  derivedLabel?: string;
  labelEvidence?: string[];
  /** layout only (the Overview's collapsed category box): the tool ids inside it. */
  members?: string[];
  /** hub: the cluster the dispatcher belongs to. */
  cluster?: string;
  /** HIERARCHY (arch_hierarchy.ts): the innermost group that holds this
   *  node — wrapped directly, or through a dispatcher's cluster. */
  group?: string;
  /** HIERARCHY: the direct parent — a dispatcher's cluster, else `group`. */
  parent?: string;
  /** hub: the files that name it (other than itself). */
  callers?: string[];
  /** hub: the scripts its own file names and runs, grouped by directory
   *  relative to it — the allow-list, read from its command hops. */
  dispatches?: Array<{ dir: string; scripts: Array<{ entryPointId: string; file: string }> }>;
}

/** M-ARCH.3 — one shape read at one end of an edge. */
export interface ArchPayloadRecord {
  side: "caller" | "callee" | "stated" | "observed";
  source: "derived" | "stated" | "observed";
  /** the shape as read: call text, a signature, a stated rule, a dispatch. */
  text: string;
  /** object-literal keys / keyword names the code spells (never values). */
  keys?: string[];
  where?: ArchRef;
  note?: string;
}

export interface ArchEdgeRecord {
  id: string;
  from: string;
  to: string;
  /** `http` | `command` | `tool` — a hop between clusters; `uses` — a
   *  cluster's threads call a tool. */
  kind: "http" | "command" | "tool" | "uses";
  protocol: string;
  /** the fact the protocol was read from. */
  protocolBasis: string;
  /** the protocol's carrier is a PRESENCE claim (imported, not seen called). */
  protocolPresence?: true;
  /** http: the methods parsed on the caller side. tool (MCP): tool names. */
  details?: string[];
  /** call sites (uses) or hops (http/command/tool) aggregated. */
  count: number;
  threads: string[];
  /** hops: the weakest confidence among them; uses: "called". */
  confidence: "path+method" | "path" | "ambiguous" | "called";
  /** uses: the project funnels the calls go through. */
  via?: string[];
  refs: ArchRef[];
  source: ArchSource;
  /** M-ARCH.3 — what crosses it, by side and source (the Payloads lens). */
  payloads?: ArchPayloadRecord[];
  /** M-ARCH.3 — the Payloads lens's label. */
  payloadSummary?: string;
  /** layout only (an edge into a collapsed category box): the model edge ids it merges. */
  members?: string[];
}

export interface ArchGroupRecord {
  id: string;
  kind: string;
  label: string;
  wraps: string[];
  parent?: string;
  source: ArchSource;
  /** proposed: the evidence it cites; empty = INFERRED (ghosted). */
  evidence?: string[];
}

export interface ArchModelRecord {
  version: "1";
  nodes: ArchNodeRecord[];
  edges: ArchEdgeRecord[];
  groups: ArchGroupRecord[];
  /** What the picture leaves out, counted — never silently dropped. */
  unplaced: {
    tests: number;
    unmatchedHops: number;
    /** boundary-role tools present in a cluster's files and called on none of its threads. */
    toolsPresentNotCalled: string[];
    /** boundaries no attribution rule reached, summed over cluster threads. */
    unattributedBoundaries: number;
  };
  notes: string[];
  /** M-ARCH.4 — the entry points a reader should walk first. */
  primaryPath?: { entryPoints: string[]; source: "stated" | "proposed"; evidence?: string[] };
  /** M-ARCH.4 — a pending model proposal (its items are in groups/labels
   *  with source "proposed"); what the validator refused, named. */
  proposal?: { at: string; model: string; narrative: string | null; refused: Array<{ item: string; reason: string }> };
}

export interface StackIndexRecord {
  tools: StackToolRecord[];
  byFile: Record<string, string[]>;
  /** entry point → tools PRESENT in the files it reaches. Routing key. */
  byThread: Record<string, string[]>;
  /** M-BOUNDARY.2 — entry point → tools a boundary actually reaches. */
  byThreadCalled?: Record<string, string[]>;
  /** M-BOUNDARY.1 — per file, the local names its imports bind, so a
   *  boundary's receiver head can be resolved to a tool by the server, the
   *  contract and the webview through one shared function. */
  importsByFile?: Record<string, ImportBinding[]>;
  /** M-RESOLVE — per file, the local names its ASSIGNMENTS bind. A third
   *  of every "unknown" receiver in the real fixtures is bound to a
   *  literal three lines up; this is what makes that free to resolve. */
  localsByFile?: Record<string, LocalBinding[]>;
}

// ── M-AGENT (PLAN-M-AGENT.md) — the Agent Manager wire shapes ──────────
// Declared here (the wire-contract home, like BuildPlan) so the webview
// board and the server spine share one definition. The transition rules
// and persistence live in src/server/work_run.ts.

export type WorkRunStatus = "draft" | "ratified" | "running" | "paused" | "done" | "failed";
export type WorkPacketStatus =
  | "pending" | "running" | "awaiting-review"
  | "done" | "failed" | "escalated" | "skipped"
  // M-ORCH.2 — the confirmed brief said this packet needs NO change
  // (a file-token match the objective does not touch): terminal, clean,
  // no worker spawned, no evidence. Distinct from `skipped` (a dependency
  // FAILED) on purpose — one is a decision, the other a casualty.
  | "no-change";

/** The plan_work packet a run packet was born from (wire mirror of
 *  src/server/plan_work.ts:WorkPacket — provenance, boundaries, skill). */
export interface WorkRunPacketPlan {
  order: number;
  entryPointId: string;
  qualifiedName: string;
  kind: string | null;
  matchedOn: string[];
  score: number;
  filesReached: string[];
  boundaries: {
    staticallyComplete: boolean;
    resolutionGaps: number;
    runtimeDispatch: number;
    uncaptured: number;
    dependsOn: string[];
    outsidePlan: { reaches: string[]; reachedBy: string[] };
  };
  skill: { status: "authoritative" | "stale" | "draft" | "none"; note: string };
  // M-CONTRACT — compact contract facts (IR) + routed constraint count.
  // Optional + additive: runs persisted before M-CONTRACT load unchanged.
  contract?: {
    params: number;
    returns: string | null;
    effects: Record<string, number>;
    roundTrips: number;
    constraints: number;
    /** RUN1 4.2 — unattributed boundaries at plan time (absent on older runs). */
    unattributed?: number;
  };
  // M-ORCH.3 — SYSTEM packets (kind "system", entryPointId "system:<id>"):
  // proposed by the brief, confirmed by the human. No thread, no skill.
  origin?: "plan" | "brief";
  rationale?: string;
  integrates?: string[];
}

export interface WorkPacketEvidence {
  /** Worker self-report — labelled, ranked BELOW the structural facts. */
  summary: string | null;
  irDelta: unknown | null;
  diffs: { file: string; nodeId: string | null; diff: string }[];
  assertions: unknown | null;
  blindSpots: unknown | null;
  // M-ORCH.4 — the deterministic pre-check audit trail: what was verified
  // and why (if at all) the packet was handed to a model reviewer.
  preCheck?: { passed: string[]; needsEyes: string[]; advisories?: string[] };
}

/** Quality layer — the packet's closing bar, computed at the objective gate
 *  from the envelope and shipped to the worker (schemas/quality/acceptance.json).
 *  `checks` are the routed constraints' checkable halves plus the derived
 *  quality-model bindings that apply; the review runs the same list. */
export interface PacketAcceptance {
  version: "1.0";
  packetId: string;
  entryPointId: string;
  closingBar: string;
  checks: Array<{
    check: Record<string, unknown>; mode: "advisory" | "gate-blocking"; mustBe: string; basis: Record<string, unknown>;
    /** What this check ALREADY reported before any packet ran, captured at
     *  the objective gate. A DERIVED gate rejects only an offender absent
     *  from here: a rule nobody stated may not reject a packet for code it
     *  inherited (h2h3 arm A's p1 carried a derived resolvability violation
     *  naming three functions that were already unannotated). */
    baseline?: { offenders: string[]; verdict?: "pass" | "violated" | "unverifiable"; at: string };
  }>;
  invariants: Array<{ kind: string; exception?: { reason: string; provenance: Record<string, unknown> } }>;
  evidenceRequired: string[];
  advisories: Array<{ kind: string; text: string }>;
  scope: { files: string[]; declaredBy: string };
  provenance: Record<string, unknown>;
  computedAt: string;
}

export interface WorkRunPacket {
  id: string;
  status: WorkPacketStatus;
  attempts: number;
  plan: WorkRunPacketPlan;
  evidence: WorkPacketEvidence | null;
  escalation: { reason: string } | null;
  /** M-ORCH.4 — when the latest attempt started (lanes make order a fact worth keeping). */
  startedAt?: string;
  /** M-PROVIDER — which model the latest worker session ran on (route label). */
  workerModel?: string;
  /** M-BATCH — the worker session this packet ran in, so a packet that is
   *  about to touch what this one just touched can RESUME it instead of
   *  starting a cold one that has to rediscover the same files.
   *  Cleared whenever a rejection restores a snapshot: after a restore the
   *  session's belief about what is on disk is wrong. */
  sessionId?: string;
  /** M-BATCH — how many packets that session has carried, so context growth
   *  is bounded and named rather than unbounded and hoped-about. */
  sessionPackets?: number;
  // M-ORCH — who judged this packet's evidence and how. Present after a
  // review in EITHER mode (human clicks record `by: "human"`), so the
  // board and the run summary can say who approved what.
  review?: PacketReview;
  /** Quality layer — the closing bar computed at the objective gate. */
  acceptance?: PacketAcceptance;
  /** M-SKILLS.2 — which generic skills rode the latest worker prompt, and
   *  for every other shipped skill why it did not (disabled /
   *  not-applicable / over-budget / already-in-session). The prompt is not
   *  the audit; this is. Absent on a packet whose worker never spawned. */
  skills?: { injected: string[]; omitted: Record<string, string> };
}

export interface PacketReview {
  // M-ORCH.4 — "pre-checks": approved on deterministic evidence alone
  // (edit scope, parse, entry-point signature, resolution gaps) — no
  // model read the diff. Distinct on purpose so the summary can say so.
  by: "human" | "orchestrator" | "pre-checks";
  verdict: "approve" | "reject" | "escalate";
  reason: string;
  at: string;
  /** M-PROVIDER — which model actually reviewed (`claude:claude-opus-5`,
   *  `ollama:qwen2.5-coder:7b@http://…`); absent for human and pre-check verdicts. */
  model?: string;
}

/** M-ORCH — the orchestrator brief: the ONE thing the human confirms in
 *  orchestrated mode. Per-packet task text + the constraint handoff each
 *  worker receives, and the global constraints the brief states (stored
 *  with source "orchestrator" on confirmation). `status` is honest:
 *  "unavailable" means workers fall back to the generic run task. */
export interface WorkRunOrchestration {
  status: "drafting" | "ready" | "unavailable";
  objective: string;
  // M-ORCH.4 — `files`: the packet's EDIT SCOPE the brief declared (a
  // subset of the thread's files). Packets whose scopes do not overlap
  // run in parallel; the chokepoint refuses a worker's edit outside it.
  // `after`: packet ids this one must run AFTER because it must SEE their
  // change on disk (a column the schema packet adds) and the call graph
  // shows no dependency — merged into dependsOn at the objective gate.
  packetTasks: Record<string, { task: string; handoff: string[]; noChange?: boolean; files?: string[]; after?: string[] }>;
  globalConstraints: Array<{ kind: string; text: string; scope: { all?: boolean; entryPointIds?: string[]; files?: string[] } }>;
  /** Ids of the constraints persisted on confirmation (empty until ratified). */
  storedConstraintIds: string[];
  note: string;
  /** M-PROVIDER — which model drafted the brief (route label). */
  model?: string;
  // M-ORCH.3 — SYSTEM packets the brief proposes for work NO thread owns
  // (a migration, a new module, an integration point). Shown at the
  // objective gate; materialised as packets ONLY on the human's confirm.
  extraPackets?: SystemPacketProposal[];
  // M-STACK.4 — TOOLS the objective needs and the stack does not have.
  // Proposed, never assumed; shown at the objective gate; persisted as
  // `stack-policy` constraints ONLY on the human's confirm. Nothing here
  // installs anything.
  stackProposals?: StackProposal[];
}

/** M-STACK.4 — a tool the brief proposes because the objective needs a
 *  capability the project's stack does not provide. `alternatives` is the
 *  shortlist it rejected and why: a proposal with no alternatives
 *  considered is a preference, not a decision. */
export interface StackProposal {
  tool: string;
  role?: StackRole;
  why: string;
  /** How firm: "prefer" (default) or "require". */
  rule: "prefer" | "require";
  alternatives: Array<{ tool: string; whyNot: string }>;
  scope: ConstraintScope;
}

export interface SystemPacketProposal {
  /** x1, x2, … (never collides with plan packets p1…). */
  id: string;
  title: string;
  task: string;
  handoff: string[];
  /** Files the worker may edit; a NEW .py file may be created here. */
  files: string[];
  rationale: string;
  /** entryPointIds whose contracts the worker receives (the integration points). */
  integrates: string[];
  /** Plan packet ids that must finish first (file overlap adds more automatically). */
  after: string[];
}

export type WorkRunMode = "gated" | "orchestrated";
/** M-ORCH.4 — "pre-checks": a packet whose deterministic pre-checks pass is
 *  approved without a model review; "full": the orchestrator reads every
 *  packet's diff. Meaningful in orchestrated mode only. */
export type WorkRunReviewPolicy = "full" | "pre-checks";

/** AUTONOMY (2026-09-12, ruling:2026-09-12:human-out-of-the-loop): Ben's stated intent that the
 *  agent pipeline runs with the human out of the loop, recorded in
 *  PLAN-HISTORY. An autonomous run confirms its own objective the moment
 *  the orchestrator brief lands (ready, or honestly unavailable) and
 *  resolves EVERY escalation as a FAILED packet with its reason kept,
 *  because there is no human to return it to. Nothing is silently
 *  approved: the run record names the ruling, who ratified, and how many
 *  escalations it resolved, and the summary says all three. Orchestrated
 *  runs only. */
export interface WorkRunAutonomy {
  mode: "autonomous";
  ruling: string;
  ratifiedBy: "orchestrator";
  ratifiedAt?: string;
  escalationsResolved: number;
}

/** What a run's model spawns cost. Mirrors src/server/spend.ts's `Spend`;
 *  declared here because the board and the run file share it. */
export interface RunSpend {
  /** Summed `total_cost_usd` over the spawns that reported one. */
  usd: number;
  /** Spawns counted, priced or not. */
  spawns: number;
  /** Spawns that reported NO cost — a local route, or a failure. Kept
   *  apart from a true zero so the total reads as a floor when it is one. */
  unpriced: number;
  byKind: Record<string, { usd: number; spawns: number; unpriced: number }>;
}

export interface WorkRun {
  version: "1";
  task: string;
  createdAt: string;
  status: WorkRunStatus;
  unmatchedTokens: string[];
  cycles: string[][];
  planNote: string;
  packets: WorkRunPacket[];
  // M-ORCH — absent = "gated" (every run persisted before M-ORCH).
  mode?: WorkRunMode;
  orchestration?: WorkRunOrchestration;
  // M-ORCH.4 — LANES: how many packets may be in flight at once (absent =
  // 1, the M-AGENT serial rule). Only packets whose edit scopes do not
  // overlap ever share a lane set; dependencies still order them.
  parallel?: number;
  // M-BATCH - WARM WORKER SESSIONS: a packet may resume the session of a
  // packet that just touched the same files, instead of cold-spawning a
  // worker that has to rediscover them. Absent = ON. Set false to get the
  // pre-M-BATCH behaviour (one cold session per packet) verbatim.
  warmSessions?: boolean;
  review?: WorkRunReviewPolicy;
  /** AUTONOMY — present only on an autonomous run (see WorkRunAutonomy). */
  autonomy?: WorkRunAutonomy;
  /** What the run's model spawns cost, summed from each CLI result
   *  envelope's own `total_cost_usd` (src/server/spend.ts). Absent until
   *  the first spawn. A spawn that reported no cost is counted as
   *  `unpriced`, never as free: a local Ollama route and a failed spawn
   *  are different facts from a true zero. */
  spend?: RunSpend;
  // M-AGENT4 — attached when the run reaches a terminal status: the
  // honest completion report (counts, files changed by APPROVED
  // packets only, and why the run is not clean when it is not).
  summary?: {
    done: number; failed: number; skipped: number; escalated: number;
    filesChanged: string[]; note: string;
  };
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
