// `annotated` (RUN1.md 3.4): the named parameters carry a type. Forced by
// PT-6, agent-skills' strict-types standard, and the local mechanism §5.5
// / M-RESOLVE: an annotation is what turns a dynamic receiver into a
// boundary the other verbs can see. Advisory by default.
//
//   at: "entry-point"       the thread's entry function's parameters
//   at: "dynamic-receivers" parameters that are the receiver of a call the
//                           thread reports `dynamic` (receiverBoundKind
//                           "param"), so the offenders are exactly the
//                           annotations that would resolve a boundary.
//
// Reads definitions (function_def.paramTypes, M-CONTRACT.4), so terminals
// only SELECT the parameter set: a dynamic receiver selects its parameter;
// an unresolved call selects nothing (a resolution gap is not an
// annotation gap) and is counted in the reason. Python only today: the
// tree-sitter frontends carry `returns` but no paramTypes.

import { derivedBy, type CheckDefinition, type CheckResult, type FactNode, type NodeRef, type QualityFacts, type Unverifiable } from "../check_registry.ts";
import { innermostFn } from "../ir_walk.ts";

export interface AnnotatedOp { rule: "annotated"; at: "entry-point" | "dynamic-receivers" }

const BY = "quality/verbs/annotated.ts";
const IMPLICIT = new Set(["self", "cls"]);

function isOp(v: unknown): v is AnnotatedOp {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return r.rule === "annotated" && (r.at === "entry-point" || r.at === "dynamic-receivers") && Object.keys(r).every((k) => k === "rule" || k === "at");
}

/** Parameter names as declared: `name`, `name=default`, `*args`, `**kw`. */
function paramNames(fn: FactNode): string[] {
  return (fn.params ?? [])
    .map((p) => p.replace(/^\*+/, "").split("=")[0].split(":")[0].trim())
    .filter((p) => p && !IMPLICIT.has(p));
}

export const annotated: CheckDefinition<AnnotatedOp> = {
  rule: "annotated",
  costClass: "local",
  forcedBy: ["PT-6", "AS-15", "VG-4"],
  isOperands: isOp,
  describe: (op) => op.at === "entry-point" ? "the entry point's parameters carry types" : "parameters that receive dynamic calls carry types",
  preconditions(facts, _op): Unverifiable | null {
    const provenance = derivedBy(BY, facts);
    if (!facts.threadOf || !facts.entryPointId || !facts.nodesByFile) {
      return { verdict: "unverifiable", reason: "no thread in scope, or no per-file IR nodes", cause: "precondition", at: [], offenders: [], provenance };
    }
    const t = facts.threadOf(facts.entryPointId);
    if (!t) return { verdict: "unverifiable", reason: `no thread for entry point ${facts.entryPointId}`, cause: "precondition", at: [], offenders: [], provenance };
    const lang = facts.languageOf?.(t.seed.file) ?? null;
    if (lang !== "python") {
      return { verdict: "unverifiable", reason: `paramTypes exist only on Python function_def nodes (M-CONTRACT.4); this thread is ${lang ?? "of unknown language"}`, cause: "precondition", at: [], offenders: [], provenance };
    }
    return null;
  },
  evaluate(facts: QualityFacts, op: AnnotatedOp): CheckResult {
    const provenance = derivedBy(BY, facts);
    const thread = facts.threadOf!(facts.entryPointId!)!;
    const fnOf = (file: string, fnId: string): FactNode | null => (facts.nodesByFile!(file) ?? []).find((n) => n.id === fnId && n.type === "function_def") ?? null;
    // Which (file, function, parameter) triples are in scope.
    const wanted = new Map<string, { file: string; fn: FactNode; params: Set<string> }>();
    let skippedUnresolved = 0;
    if (op.at === "entry-point") {
      const fn = fnOf(thread.seed.file, thread.seed.irNodeId);
      if (!fn) {
        return { verdict: "unverifiable", reason: `the entry point ${thread.seed.irNodeId} is not a function_def in ${thread.seed.file}`, cause: "precondition", at: [], offenders: [], provenance };
      }
      wanted.set(`${thread.seed.file}:${fn.id}`, { file: thread.seed.file, fn, params: new Set(paramNames(fn)) });
    } else {
      for (const n of thread.nodes) {
        if (n.kind === "unresolved") { skippedUnresolved++; continue; }
        if (n.kind !== "dynamic" || n.receiverBoundKind !== "param" || !n.irNodeId) continue;
        const fnId = innermostFn(n.irNodeId);
        if (!fnId) continue;
        const file = n.file ?? thread.filesReached.find((f) => (facts.nodesByFile!(f) ?? []).some((x) => x.id === fnId)) ?? thread.seed.file;
        const fn = fnOf(file, fnId);
        if (!fn) continue;
        const receiver = n.label.split(".")[0];
        const key = `${file}:${fn.id}`;
        if (!wanted.has(key)) wanted.set(key, { file, fn, params: new Set() });
        if (paramNames(fn).includes(receiver)) wanted.get(key)!.params.add(receiver);
      }
    }
    const offenders: NodeRef[] = [];
    const whys: string[] = [];
    const checked: string[] = [];
    for (const [key, w] of wanted) {
      const typed = new Set(Object.keys(w.fn.paramTypes ?? {}));
      const missing = [...w.params].filter((p) => !typed.has(p));
      checked.push(`${key} (${[...w.params].join(", ") || "no parameters"})`);
      if (missing.length) { offenders.push(key as NodeRef); whys.push(`${w.fn.name ?? w.fn.id}(${missing.join(", ")}) unannotated`); }
    }
    if (offenders.length) {
      return { verdict: "violated", reason: `${offenders.length} function(s) leave the parameter(s) untyped: ${whys.join("; ")}`, offenders: [offenders[0], ...offenders.slice(1)], provenance };
    }
    return {
      verdict: "pass",
      reason: wanted.size ? `every parameter in scope is annotated (${checked.join("; ")})` : `no parameter in scope (${op.at})`,
      notFollowed: [
        "the annotation's correctness (a wrong type passes)",
        ...(skippedUnresolved ? [`${skippedUnresolved} unresolved call(s) on the thread were not counted: a resolution gap is not an annotation gap`] : []),
        ...(wanted.size ? [] : ["no parameter existed to check"]),
      ],
      offenders: [], provenance,
    };
  },
};
