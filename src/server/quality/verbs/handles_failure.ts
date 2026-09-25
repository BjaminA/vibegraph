// `handles-failure` (RUN1.md 3.3, narrowed twice by measurement; RUN3.md
// sections 3 and 10): every except arm in scope raises, returns, reports,
// or names the failure it expects. Forced by AS-7, the observability
// persona's level rule, SP-6.
//
// Scope: `thread` walks the arms the thread reaches (the packet's
// behaviour); `files` walks every arm in facts.scopeFiles (the packet's
// edit scope, or a whole tree for calibration).
//
// An arm is HANDLED when its descendants include a raise_stmt or a
// return_stmt, a call the parser stamped effectKind `log`, a call to one
// of the language's own reporting calls (`print`, `sys.exit`,
// `traceback.print_exc`, ...), or a resolved project call whose own body
// (one hop) does any of those. An EMPTY arm that names a NARROW exception
// (`except FieldDoesNotExist: continue`, `except ImportError: pass`) is
// also handled: the author declared the failure they expect and chose to
// skip it, which is AS-7's own "catch specific" practice, not a swallow.
// The calibration review found seventeen such arms in production library
// code and not one of them was a defect.
//
// The only shape the IR can call a swallow WITH CONFIDENCE is therefore
// the EMPTY arm with a BROAD type: bare `except:`, `Exception`,
// `BaseException`, or a tuple containing one. Even there it cannot tell
// `pass` from `continue` or `break` (no node is emitted for any of them;
// gap G13). Everything else is said as `unverifiable` with its exact
// cause: a dynamic or unresolved call that could be a logger (the family
// rule); a project callee that neither raises nor reports within one hop
// (`depth-limit`); an arm that only ASSIGNS, which carries the failure
// into a name whose later read needs data-flow the IR lacks (gap G1;
// cause `precondition`).

import { derivedBy, type CheckDefinition, type CheckResult, type FactNode, type NodeRef, type QualityFacts, type Unverifiable } from "../check_registry.ts";
import { descendants, indexNodes, type IrIndex } from "../ir_walk.ts";
import { PYTHON_BUILTINS } from "../../../shared/stack_attribution.ts";

export interface HandlesFailureOp { rule: "handles-failure"; scope: "thread" | "files" }

const BY = "quality/verbs/handles_failure.ts";
/** The language runtime's own ways of making a failure visible. A table,
 *  not a heuristic: each is a Python-owned name. */
const REPORTS: Record<string, string> = {
  "print": "prints", "sys.exit": "exits", "os._exit": "exits",
  "traceback.print_exc": "prints the traceback", "traceback.print_exception": "prints the traceback",
  "warnings.warn": "warns",
};
/** A bare except, `Exception`, `BaseException`, or a tuple holding one. */
export function isBroadExcept(exceptType: string | null | undefined): boolean {
  if (exceptType == null || !exceptType.trim()) return true;
  return /(^|[^\w.])(Base)?Exception(?![\w])/.test(exceptType);
}

function isOp(v: unknown): v is HandlesFailureOp {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return r.rule === "handles-failure" && (r.scope === "thread" || r.scope === "files") && Object.keys(r).every((k) => k === "rule" || k === "scope");
}

type Arm = { file: string; id: string; label: string; exceptType: string | null };
type Judgement =
  | { kind: "handled"; how: string }
  | { kind: "empty" }
  | { kind: "assigns"; at: NodeRef[] }
  | { kind: "hidden"; at: NodeRef[]; cause: "dynamic" | "unresolved" }
  | { kind: "depth"; at: NodeRef[]; callee: string };

const labelOf = (n: FactNode) => n.funcName ?? n.callTarget ?? "";
const isCallish = (n: FactNode) => n.type === "call" || (n.type === "assignment" && n.callTarget !== undefined);

function handlesDirectly(nodes: readonly FactNode[]): string | null {
  if (nodes.some((n) => n.type === "raise_stmt")) return "raises";
  if (nodes.some((n) => n.type === "return_stmt")) return "returns";
  const log = nodes.find((n) => isCallish(n) && n.effectKind === "log");
  if (log) return `logs (${labelOf(log)})`;
  const rep = nodes.find((n) => isCallish(n) && REPORTS[labelOf(n)]);
  if (rep) return `${REPORTS[labelOf(rep)]} (${labelOf(rep)})`;
  return null;
}

function judgeArm(facts: QualityFacts, idx: IrIndex, arm: Arm): Judgement {
  const body = descendants(idx, arm.id);
  if (!body.length) {
    if (isBroadExcept(arm.exceptType)) return { kind: "empty" };
    return { kind: "handled", how: `expects \`${arm.exceptType}\` and skips it (a named expected failure, not a swallow)` };
  }
  const direct = handlesDirectly(body);
  if (direct) return { kind: "handled", how: direct };
  const hidden: { ref: NodeRef; kind: "dynamic" | "unresolved" }[] = [];
  const depth: { ref: NodeRef; callee: string }[] = [];
  for (const c of body.filter(isCallish)) {
    const label = labelOf(c);
    const ref = `${arm.file}:${c.id}` as NodeRef;
    // A bare builtin (`str`, `type`, `isinstance`, `getattr`) cannot log.
    if (!label.includes(".") && PYTHON_BUILTINS.has(label)) continue;
    if (c.resolved === false) {
      const kind = facts.terminalKindOf?.(arm.file, c.id) ?? (label.includes(".") ? "dynamic" : "unresolved");
      hidden.push({ ref, kind });
      continue;
    }
    const target = facts.referenceTargetOf?.(arm.file, c.id);
    if (!target) continue;
    const file = target.toFile ?? arm.file;
    const nodes = facts.nodesByFile?.(file);
    if (!nodes) continue;
    const inner = handlesDirectly(descendants(indexNodes(nodes), target.toNodeId));
    if (inner) return { kind: "handled", how: `calls ${label || target.toNodeId}, which ${inner} (one hop)` };
    depth.push({ ref, callee: label || target.toNodeId });
  }
  if (hidden.length) return { kind: "hidden", at: hidden.map((h) => h.ref), cause: hidden.some((h) => h.kind === "dynamic") ? "dynamic" : "unresolved" };
  if (depth.length) return { kind: "depth", at: depth.map((d) => d.ref), callee: [...new Set(depth.map((d) => d.callee))].join(", ") };
  return { kind: "assigns", at: body.filter((n) => n.type === "assignment").map((n) => `${arm.file}:${n.id}` as NodeRef) };
}

export const handlesFailure: CheckDefinition<HandlesFailureOp> = {
  rule: "handles-failure",
  costClass: "local",
  forcedBy: ["AS-7", "AS-35", "SP-6"],
  isOperands: isOp,
  describe: (op) => `every except arm ${op.scope === "thread" ? "on this thread" : "in these files"} raises, returns, reports, or names what it expects`,
  preconditions(facts, op): Unverifiable | null {
    const provenance = derivedBy(BY, facts);
    if (!facts.nodesByFile) {
      return { verdict: "unverifiable", reason: "no per-file IR nodes: the arms cannot be walked", cause: "precondition", at: [], offenders: [], provenance };
    }
    if (op.scope === "thread") {
      if (!facts.threadOf || !facts.entryPointId) return { verdict: "unverifiable", reason: "no thread in scope", cause: "precondition", at: [], offenders: [], provenance };
      const t = facts.threadOf(facts.entryPointId);
      if (!t) return { verdict: "unverifiable", reason: `no thread for entry point ${facts.entryPointId}`, cause: "precondition", at: [], offenders: [], provenance };
      const lang = facts.languageOf?.(t.seed.file) ?? null;
      if (lang !== "python") {
        return { verdict: "unverifiable", reason: `the reporting-call table, the builtin filter and the broad-exception rule are Python's; this thread is ${lang ?? "of unknown language"}`, cause: "precondition", at: [], offenders: [], provenance };
      }
    } else if (!facts.scopeFiles?.length) {
      return { verdict: "unverifiable", reason: "scope files: no files were supplied", cause: "precondition", at: [], offenders: [], provenance };
    }
    return null;
  },
  evaluate(facts: QualityFacts, op: HandlesFailureOp): CheckResult {
    const provenance = derivedBy(BY, facts);
    const arms: Arm[] = [];
    const armOf = (file: string, n: FactNode): Arm => ({ file, id: n.id, label: `except ${n.exceptType ?? ""}`.trim(), exceptType: n.exceptType ?? null });
    if (op.scope === "thread") {
      const thread = facts.threadOf!(facts.entryPointId!)!;
      // The arms are read from the IR of the FUNCTIONS this thread walks,
      // not from the thread's own container list.
      //
      // The thread is a call path, so the extractor emits a container only
      // where a walked STEP sits inside it — and an arm that swallows has
      // no step by definition. Measured on 2026-09-23 against one planted
      // `except Exception:` in an ingest loop: `pass` produced no except
      // container, `skipped = 1` produced none either, and only
      // `errors.append(...)` did. So the old reading returned
      // `pass — "no except arm on this thread"` on precisely the shape this
      // verb calls a violation, while `scope: "files"` on the same tree
      // returned `violated` and named the node. A check that silently
      // passes what it could not see is worse than the prose it replaces,
      // and this one is MAY-GATE.
      //
      // "On this thread" stays honest: an arm counts when its id sits under
      // a function the thread actually walks, which is what the thread's
      // own node ids carry. A file the thread merely touches contributes
      // only the functions it entered, never its other arms.
      const ownerFn = (id: string): string | null => {
        const i = id.lastIndexOf(".fn/");
        if (i >= 0) return id.slice(0, i + ".fn".length);
        return id.endsWith(".fn") ? id : null;
      };
      // A thread node's `file` can be absent, and falling back to the seed's
      // file pairs a function with a file that does not define it — harmless
      // until two files share an id, and `module/main.fn` is in most of them.
      // So a pairing counts only when that file's IR really defines it; if
      // the node named no file, the owning file is the one among those the
      // thread reached that does. Unresolvable ⇒ dropped, never guessed.
      const defines = (file: string, fn: string) => (facts.nodesByFile!(file) ?? []).some((x) => x.id === fn);
      const walked = new Map<string, Set<string>>();
      for (const n of thread.nodes) {
        if (!n.irNodeId) continue;
        const fn = ownerFn(n.irNodeId);
        if (!fn) continue;
        const file = n.file && defines(n.file, fn)
          ? n.file
          : [thread.seed.file, ...thread.filesReached].find((f) => defines(f, fn));
        if (!file) continue;
        if (!walked.has(file)) walked.set(file, new Set());
        walked.get(file)!.add(fn);
      }
      for (const [file, fns] of walked) {
        if ((facts.languageOf?.(file) ?? null) !== "python") continue;
        for (const n of facts.nodesByFile!(file) ?? []) {
          if (n.type !== "except_handler") continue;
          if (![...fns].some((fn) => n.id.startsWith(`${fn}/`))) continue;
          arms.push(armOf(file, n));
        }
      }
    } else {
      for (const file of facts.scopeFiles!) {
        if ((facts.languageOf?.(file) ?? null) !== "python") continue;
        for (const n of facts.nodesByFile!(file) ?? []) if (n.type === "except_handler") arms.push(armOf(file, n));
      }
    }
    const byFile = new Map<string, IrIndex>();
    const offenders: NodeRef[] = [];
    const handled: string[] = [];
    const hidden: { at: NodeRef[]; cause: "dynamic" | "unresolved" }[] = [];
    const depth: { at: NodeRef[]; callee: string }[] = [];
    const assigns: NodeRef[] = [];
    for (const arm of arms) {
      if (!byFile.has(arm.file)) byFile.set(arm.file, indexNodes(facts.nodesByFile!(arm.file) ?? []));
      const j = judgeArm(facts, byFile.get(arm.file)!, arm);
      if (j.kind === "handled") handled.push(`${arm.label} ${j.how}`);
      else if (j.kind === "empty") offenders.push(`${arm.file}:${arm.id}` as NodeRef);
      else if (j.kind === "hidden") hidden.push(j);
      else if (j.kind === "depth") depth.push(j);
      else assigns.push(...(j.at.length ? j.at : [`${arm.file}:${arm.id}` as NodeRef]));
    }
    const others = hidden.length + depth.length + (assigns.length ? 1 : 0);
    if (offenders.length) {
      return {
        verdict: "violated",
        reason: `${offenders.length} except arm(s) are EMPTY and BROAD (bare, \`Exception\` or \`BaseException\`; \`pass\`, \`continue\` and \`break\` look the same to the IR): ${offenders.join(", ")}`
          + (others ? `. ${others} other arm(s) could not be judged and are not counted here.` : ""),
        offenders: [offenders[0], ...offenders.slice(1)], provenance,
      };
    }
    if (hidden.length) {
      const cause = hidden.some((h) => h.cause === "dynamic") ? "dynamic" : "unresolved";
      const at = hidden.flatMap((h) => h.at);
      return { verdict: "unverifiable", reason: `${hidden.length} arm(s) contain a ${cause === "dynamic" ? "runtime-dispatched" : "unresolved"} call that could be a logger: ${at.join(", ")}. ${cause === "dynamic" ? "Only a trace or a stated attribution can lift this." : "A re-link may lift this."}`, cause, at, offenders: [], provenance };
    }
    if (depth.length) {
      const at = depth.flatMap((d) => d.at);
      return { verdict: "unverifiable", reason: `${depth.length} arm(s) hand the failure to a project function that neither raises nor reports within one hop (${depth.map((d) => d.callee).join(", ")}); deeper was not followed`, cause: "depth-limit", at, offenders: [], provenance };
    }
    if (assigns.length) {
      return { verdict: "unverifiable", reason: `${assigns.length} arm(s) only assign a fallback; whether the assigned name is read later needs data-flow the IR lacks (RUN1 G1)`, cause: "precondition", at: assigns, offenders: [], provenance };
    }
    return {
      verdict: "pass",
      reason: arms.length ? `all ${arms.length} except arm(s) handle the failure: ${handled.join("; ")}` : `no except arm ${op.scope === "thread" ? "on this thread" : "in these files"}`,
      notFollowed: [
        "re-raise semantics (a bare `raise` versus a new exception)",
        "whether the report precedes a swallowing return",
        "the log level (an error logged at debug is still 'logged' here)",
        "whether a narrow named exception is the only one that can occur in the try body",
        ...(arms.length ? [] : ["no arm existed to check"]),
      ],
      offenders: [], provenance,
    };
  },
};
