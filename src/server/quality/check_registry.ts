// Quality layer, Run 2 (reviews/quality-layer/RUN2.md): the check registry
// INTERFACE; Run 3 registers the verbs (./verbs/).
//
// What this file enforces by TYPE, so a check cannot be written wrong:
//
//   * a check result is one of three shapes and never a boolean;
//   * a `pass` MUST carry `notFollowed` with at least one entry, because a
//     pass that followed everything is a claim no static check can make;
//   * a `violated` MUST name at least one offender as `file:node`;
//   * a result's provenance is derived, observed or stated; a model's
//     judgement and a worker's self-report are not types this union admits;
//   * a definition names the Run 1 assertions that forced it (an unforced
//     verb does not exist) and a cost class derived from its procedure.
//
// What it enforces at RUNTIME, for callers the type system cannot see
// (JSON from a store, a script): `isCheckResult` mirrors
// schemas/quality/evidence.json, `CheckRegistry.run` refuses a result that
// fails it by THROWING rather than by coercing, and registering a rule
// twice throws, because a second definition would silently replace the
// first. The tests pin both halves (test/quality_schemas.test.mjs).
//
// Vocabulary is the grammar's: CheckFacts is the same object
// constraint_grammar.ts already evaluates over, extended by OPTIONAL
// read-only handles a verb may need. A verb whose handle is absent returns
// `unverifiable` with cause `precondition`, never `pass`.

import type { CheckFacts as GrammarFacts } from "../constraint_grammar.ts";

export type Verdict = "pass" | "violated" | "unverifiable";
export type CostClass = "local" | "thread" | "delta" | "graph" | "observed";
/** Run 3 added `depth-limit`: the verb's bounded traversal ended before an
 *  answer (one hop into a project callee, say). Not a resolution gap and
 *  not runtime dispatch; a re-link will not lift it, a deeper walk would. */
export type UnverifiableCause = "dynamic" | "unresolved" | "precondition" | "no-such-name" | "not-yet" | "depth-limit";

/** A tuple with at least one element. The type-level form of `minItems: 1`. */
export type NonEmpty<T> = readonly [T, ...T[]];

/** `file:module/...` — the only form an offender or supporting node takes. */
export type NodeRef = `${string}:module${string}`;
export const NODE_REF = /^[^:]+:module(\/[^/]+)*$/;

/** A value that could not be derived and was not stated. Never a default. */
export interface Unknown { unknown: true; reason: string }

export interface DerivedProvenance { kind: "derived"; by: string; commit: string; at: string }
export interface StatedProvenance { kind: "stated"; source: "human" | "orchestrator" | "agent"; id: string; at: string }
export interface ObservedProvenance { kind: "observed"; run: string; entryPointId: string; stale: boolean; at: string }
export interface ModelJudgement { kind: "model_judgement"; model: string; promptHash: string; at: string; entersGate: false }
export interface SelfReport { kind: "self_report"; by: "worker"; loadBearing: false; entersGate: false }

export type Provenance = DerivedProvenance | StatedProvenance | ObservedProvenance | ModelJudgement | SelfReport;
/** The only provenances a deterministic gate may read. */
export type GateProvenance = DerivedProvenance | ObservedProvenance | StatedProvenance;

export interface Pass {
  verdict: "pass";
  reason: string;
  /** What the check did NOT verify. Never empty. */
  notFollowed: NonEmpty<string>;
  offenders: readonly [];
  provenance: GateProvenance;
}
export interface Violated {
  verdict: "violated";
  reason: string;
  offenders: NonEmpty<NodeRef>;
  provenance: GateProvenance;
}
export interface Unverifiable {
  verdict: "unverifiable";
  reason: string;
  cause: UnverifiableCause;
  /** The terminals that made it unverifiable; may be empty for precondition / no-such-name. */
  at: readonly NodeRef[];
  offenders: readonly [];
  provenance: GateProvenance;
}
export type CheckResult = Pass | Violated | Unverifiable;

/** One IR node as a verb may read it: id, type, parent, position, and the
 *  language-optional fields the Python and tree-sitter frontends emit. */
export interface FactNode {
  id: string;
  type: string;
  parentId: string | null;
  line: number;
  col: number;
  effectKind?: string | null;
  paramTypes?: Record<string, string>;
  params?: string[];
  /** function_def / class_def name. */
  name?: string;
  /** call: the label the parser recorded (`requests.post`, `self.hook`). */
  funcName?: string;
  /** assignment with a call value: the callee (`sqlite3.connect`). */
  callTarget?: string;
  /** if_stmt / while_loop: the test's source text. */
  condition?: string;
  /** if_stmt: the first line of the else/elif arm (M17.3). */
  elseLine?: number;
  /** for_loop: the iterable's source text (`accepted`, `ADDED_COLUMNS`,
   *  `[...store.keys()]`). What a loop repeats OVER, which is what
   *  decides whether its iteration count comes from the source or the
   *  data. */
  iterName?: string;
  /** assignment: the shape of the bound value (`list`, `call`, …). With
   *  `name` and a null parentId it says whether a module constant is a
   *  literal collection the source fixes. */
  valueKind?: string;
  /** except_handler: the caught type's source text, null for a bare except. */
  exceptType?: string | null;
  /** call / assignment: a reference edge leaves this node (the linker resolved it). */
  resolved?: boolean;
}

/** A thread as the extractor emits it, narrowed to what a verb walks. */
export interface FactThread {
  seed: { file: string; irNodeId: string; qualifiedName: string };
  nodes: readonly {
    id: string; kind: string; label: string; file: string | null; irNodeId: string | null;
    effectKind?: string; containerKind?: string; receiverBoundKind?: string; receiverBoundFrom?: string;
  }[];
  edges: readonly { from: string; to: string; kind: string; irSource: string | null }[];
  filesReached: readonly string[];
}

/** The run's combined server-collected delta (or, for calibration, a git
 *  commit's file list). `complete` is false while packets are still to
 *  run, which is what turns a missing co-change into `not-yet`. */
export interface RunDelta {
  entries: readonly { packetId: string; file: string; nodeId: string | null; change: "added" | "changed" | "removed" }[];
  complete: boolean;
}

/** The facts a verb may read. The first four are constraint_grammar.ts's
 *  CheckFacts, unchanged. The rest are OPTIONAL handles; a verb that needs
 *  one and finds it absent returns `unverifiable` (cause `precondition`). */
export interface QualityFacts extends GrammarFacts {
  /** The commit the facts were read at; every derived provenance cites it. */
  commit: string;
  /** The thread under check, for thread-scoped verbs. */
  entryPointId?: string;
  /** The files under check, for file-scoped verbs (a packet's edit scope). */
  scopeFiles?: readonly string[];
  /** file -> the IR nodes of that file (containers, calls, defs, returns, raises). */
  nodesByFile?: (file: string) => readonly FactNode[] | null;
  /** The language the file was parsed as. */
  languageOf?: (file: string) => string | null;
  /** The thread for an entry point, as the extractor emits it. */
  threadOf?: (entryPointId: string) => FactThread | null;
  /** Whether the thread extractor calls this call site dynamic or unresolved. */
  terminalKindOf?: (file: string, irNodeId: string) => "dynamic" | "unresolved" | null;
  /** Attribution of a call node (stack_attribution.ts via the contract), or null when no rule reached it. */
  attributionOf?: (file: string, irNodeId: string) => { tool: string; role: string; how: string; via?: string } | null;
  /** Where a resolved call's reference edge points. */
  referenceTargetOf?: (file: string, irNodeId: string) => { toFile: string | null; toNodeId: string } | null;
  /** The run's combined server-collected delta. */
  runDelta?: () => RunDelta | null;
  /** The observed overlay for a call site, when a trace ran. */
  observedAt?: (file: string, irNodeId: string) => readonly { callee: string; run: string; stale: boolean }[] | null;
}

export interface CheckDefinition<Op extends { rule: string }> {
  readonly rule: Op["rule"];
  readonly costClass: CostClass;
  /** The Run 1 assertion ids that forced this verb. Never empty. */
  readonly forcedBy: NonEmpty<string>;
  /** Boundary validation. A malformed operand set is refused, never coerced. */
  isOperands(v: unknown): v is Op;
  /** Competence check. Non-null means the verb cannot answer here. */
  preconditions(facts: QualityFacts, op: Op): Unverifiable | null;
  evaluate(facts: QualityFacts, op: Op): CheckResult;
  describe(op: Op): string;
}

/** The provenance every derived verdict carries. */
export function derivedBy(by: string, facts: { commit: string }): DerivedProvenance {
  return { kind: "derived", by, commit: facts.commit, at: new Date().toISOString() };
}

const GATE_KINDS = new Set(["derived", "observed", "stated"]);
const CAUSES = new Set<string>(["dynamic", "unresolved", "precondition", "no-such-name", "not-yet", "depth-limit"]);

function isGateProvenance(p: unknown): p is GateProvenance {
  if (!p || typeof p !== "object") return false;
  const r = p as Record<string, unknown>;
  if (!GATE_KINDS.has(String(r.kind))) return false;
  if (r.kind === "derived") return typeof r.by === "string" && !!r.by && typeof r.commit === "string" && !!r.commit && typeof r.at === "string";
  if (r.kind === "stated") return ["human", "orchestrator", "agent"].includes(String(r.source)) && typeof r.id === "string" && !!r.id && typeof r.at === "string";
  return typeof r.run === "string" && !!r.run && typeof r.entryPointId === "string" && typeof r.stale === "boolean" && typeof r.at === "string";
}

/** Runtime mirror of evidence.json#/$defs/CheckResult. A boolean is not a
 *  verdict; a pass without notFollowed is not a pass; a violation without
 *  an offender is not actionable. */
export function isCheckResult(x: unknown): x is CheckResult {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  if (typeof r.reason !== "string" || !r.reason) return false;
  if (!isGateProvenance(r.provenance)) return false;
  const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0);
  if (r.verdict === "pass") {
    return strs(r.notFollowed) && r.notFollowed.length > 0 && Array.isArray(r.offenders) && r.offenders.length === 0;
  }
  if (r.verdict === "violated") {
    return strs(r.offenders) && r.offenders.length > 0 && r.offenders.every((o) => NODE_REF.test(o));
  }
  if (r.verdict === "unverifiable") {
    return CAUSES.has(String(r.cause)) && strs(r.at) && r.at.every((o) => NODE_REF.test(o))
      && Array.isArray(r.offenders) && r.offenders.length === 0;
  }
  return false;
}

export class CheckRegistry {
  private readonly defs = new Map<string, CheckDefinition<{ rule: string }>>();

  register<Op extends { rule: string }>(def: CheckDefinition<Op>): void {
    if (this.defs.has(def.rule)) {
      throw new Error(`check rule "${def.rule}" is already registered — a second definition would silently replace the first`);
    }
    if (!def.forcedBy.length) throw new Error(`check rule "${def.rule}" names no forcing assertion — an unforced verb does not exist`);
    this.defs.set(def.rule, def as unknown as CheckDefinition<{ rule: string }>);
  }

  get(rule: string): CheckDefinition<{ rule: string }> | undefined { return this.defs.get(rule); }
  rules(): string[] { return [...this.defs.keys()]; }

  /** Evaluate one check. Malformed operands and unknown rules are
   *  `unverifiable` with cause `precondition`; a definition that returns
   *  something that is not a CheckResult is a BUG and throws. */
  run(facts: QualityFacts, check: { rule: string }): CheckResult {
    const rule = check.rule;
    const provenance = derivedBy("check_registry.ts", facts);
    const def = this.defs.get(rule);
    if (!def) {
      return { verdict: "unverifiable", reason: `no check rule "${rule}" is registered`, cause: "precondition", at: [], offenders: [], provenance };
    }
    if (!def.isOperands(check)) {
      return { verdict: "unverifiable", reason: `operands for "${rule}" are malformed and were refused, not coerced`, cause: "precondition", at: [], offenders: [], provenance };
    }
    const pre = def.preconditions(facts, check);
    if (pre) {
      if (!isCheckResult(pre) || pre.verdict !== "unverifiable") throw new Error(`check "${rule}" returned a malformed precondition result`);
      return pre;
    }
    const result: unknown = def.evaluate(facts, check);
    if (!isCheckResult(result)) {
      throw new Error(`check "${rule}" returned something that is not a CheckResult (a boolean, a pass with nothing in notFollowed, or a violation with no offender)`);
    }
    return result;
  }
}
