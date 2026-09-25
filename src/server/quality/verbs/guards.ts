// `guards` (RUN1.md 3.1): every call to `target` is governed by a call to
// `guard` in the same function. The ordering half `calls-through` admits
// it lacks. Forced by AR-6, PT-2, AS-8, AS-9, fleet c3.
//
// Decision procedure, over the file's IR nodes (structural ids, parent
// links, positions):
//   (b) some guard call G precedes the target call T in the same or an
//       enclosing block: G is a direct child of a block on T's ancestor
//       chain, sits before T's ancestor in that block, and no return or
//       raise sits between them at that block's level. A guard written as
//       an if/while TEST counts as preceding the statement it tests
//       (the parser parents a test call beside its statement, 48a8146).
//   arm polarity: when G is the test of an `if` on T's chain, the arm T
//       sits in must be the one the guard's truth selects: then-arm for a
//       plain test, else-arm for a leading `not`. The other pairing is an
//       offender, because the guard's result selects the OTHER arm.
// Not read: the guard's return value beyond a leading `not`, `and`/`or`
// composition, exception short-circuits, and whether the guard governs
// anything at all semantically. Every pass says so.

import { derivedBy, type CheckDefinition, type CheckResult, type FactNode, type NodeRef, type QualityFacts, type Unverifiable } from "../check_registry.ts";
import { ancestors, armOf, comparePos, conditionNegated, fnName, indexNodes, innermostFn, isTestOf, labelTail, type IrIndex } from "../ir_walk.ts";

export interface GuardsOp { rule: "guards"; target: string; guard: string }

const BY = "quality/verbs/guards.ts";
const NOT_FOLLOWED = [
  "the guard's return value beyond a leading `not`",
  "`and`/`or` composition of the guard condition",
  "exception short-circuits (a raise inside the guard, a try around the call)",
  "whether the guard semantically governs the call (only that it precedes it in flow)",
] as const;

function isOp(v: unknown): v is GuardsOp {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return r.rule === "guards" && typeof r.target === "string" && !!r.target && typeof r.guard === "string" && !!r.guard
    && Object.keys(r).every((k) => ["rule", "target", "guard"].includes(k));
}

/** Why a specific target call is or is not guarded by a specific guard call. */
function judge(idx: IrIndex, g: FactNode, t: FactNode, fnId: string): { ok: true } | { ok: false; why: string } {
  const chain = [t, ...ancestors(idx, t.id)];
  const fnIdx = chain.findIndex((n) => n.id === fnId);
  const withinFn = fnIdx >= 0 ? chain.slice(0, fnIdx + 1) : chain;
  // The block G lives in must be on T's chain (T's own parent counts).
  const blockPos = withinFn.findIndex((n) => n.id === g.parentId);
  if (blockPos < 0) return { ok: false, why: `guard call at ${g.id} sits in a block the target's flow does not pass through` };
  const tChild = blockPos === 0 ? t : withinFn[blockPos - 1]; // T's ancestor that is a direct child of G's block
  const asTest = isTestOf(g, tChild);
  if (!asTest && comparePos(g, tChild) >= 0) return { ok: false, why: `guard call at ${g.id} comes AFTER the call it should govern` };
  if (!asTest) {
    const siblings = idx.byParent.get(g.parentId ?? "") ?? [];
    const between = siblings.filter((s) => comparePos(s, g) > 0 && comparePos(s, tChild) < 0 && (s.type === "return_stmt" || s.type === "raise_stmt"));
    if (between.length) return { ok: false, why: `a ${between[0].type} at ${between[0].id} sits between the guard and the call` };
  }
  // Arm polarity: for every if on T's chain whose test IS this guard call.
  for (let i = 1; i < withinFn.length; i++) {
    const anc = withinFn[i];
    if (anc.type !== "if_stmt" || !isTestOf(g, anc)) continue;
    const arm = armOf(anc, withinFn[i - 1]);
    const negated = conditionNegated(anc.condition);
    const selected = negated ? "else" : "then";
    if (arm !== selected) {
      return { ok: false, why: `the call sits in the ${arm}-arm of \`if ${anc.condition ?? "…"}\`, which the guard's result does not select` };
    }
  }
  return { ok: true };
}

export const guards: CheckDefinition<GuardsOp> = {
  rule: "guards",
  costClass: "local",
  forcedBy: ["AR-6", "PT-2", "AS-8", "AS-9", "c3"],
  isOperands: isOp,
  describe: (op) => `every call to \`${op.target}\` is guarded by \`${op.guard}\``,
  preconditions(facts, op): Unverifiable | null {
    const provenance = derivedBy(BY, facts);
    if (!facts.nodesByFile) {
      return { verdict: "unverifiable", reason: "no per-file IR nodes were supplied; the guard order cannot be read", cause: "precondition", at: [], offenders: [], provenance };
    }
    const known = new Set(facts.definedNames);
    const callers = facts.references.filter((r) => r.toName === op.target);
    if (!known.has(op.target) && callers.length === 0) {
      return { verdict: "unverifiable", reason: `the IR knows no definition of \`${op.target}\` and no call to it. NOT treated as satisfied.`, cause: "no-such-name", at: [], offenders: [], provenance };
    }
    if (!known.has(op.guard)) {
      return { verdict: "unverifiable", reason: `the IR knows no definition of \`${op.guard}\`: the guard this constraint names does not exist in the project as spelled. NOT treated as satisfied.`, cause: "no-such-name", at: [], offenders: [], provenance };
    }
    return null;
  },
  evaluate(facts: QualityFacts, op: GuardsOp): CheckResult {
    const provenance = derivedBy(BY, facts);
    const offenders: NodeRef[] = [];
    const whys: string[] = [];
    const checked: string[] = [];
    const hidden: { ref: NodeRef; kind: "dynamic" | "unresolved" }[] = [];
    // With a scope (a packet's edit scope), only call sites in those files
    // are judged: a violation elsewhere is not this packet's doing. Without
    // one, the whole project is.
    const inScope = (file: string) => !facts.scopeFiles || facts.scopeFiles.includes(file);
    const targets = facts.references.filter((r) => r.toName === op.target && inScope(r.fromFile));
    const byFile = new Map<string, IrIndex>();
    const indexFor = (file: string): IrIndex | null => {
      if (!byFile.has(file)) {
        const nodes = facts.nodesByFile!(file);
        if (!nodes) return null;
        byFile.set(file, indexNodes(nodes));
      }
      return byFile.get(file)!;
    };
    for (const ref of targets) {
      const fnId = innermostFn(ref.fromNodeId);
      if (!fnId) continue; // a module-level call has no function to be guarded in; reported below
      if (fnName(fnId) === op.guard) continue; // the guard need not guard itself
      const idx = indexFor(ref.fromFile);
      const t = idx?.byId.get(ref.fromNodeId);
      if (!idx || !t) {
        hidden.push({ ref: `${ref.fromFile}:${ref.fromNodeId}` as NodeRef, kind: "unresolved" });
        continue;
      }
      const guardCalls = facts.references
        .filter((r) => r.toName === op.guard && r.fromFile === ref.fromFile && innermostFn(r.fromNodeId) === fnId)
        .map((r) => idx.byId.get(r.fromNodeId))
        .filter((n): n is FactNode => !!n);
      checked.push(`${ref.fromFile}:${fnId}`);
      if (!guardCalls.length) {
        offenders.push(`${ref.fromFile}:${ref.fromNodeId}` as NodeRef);
        whys.push(`${fnName(fnId)} calls \`${op.target}\` and never calls \`${op.guard}\``);
        continue;
      }
      const verdicts = guardCalls.map((g) => judge(idx, g, t, fnId));
      if (verdicts.some((v) => v.ok)) continue;
      offenders.push(`${ref.fromFile}:${ref.fromNodeId}` as NodeRef);
      whys.push(`${fnName(fnId)}: ${verdicts.map((v) => (v.ok ? "" : v.why)).filter(Boolean).join("; ")}`);
    }
    // Calls that could BE the target or the guard, hidden behind dynamic
    // dispatch or a resolution gap. A hidden TARGET matters anywhere in
    // scope (`sink.notify(...)` under a guard is a call the IR cannot
    // vouch for). A hidden GUARD matters only inside a function that calls
    // the target (`self.check()` beside an unguarded `notify` may be the
    // guard running where the IR cannot see); elsewhere it governs nothing.
    const callsTarget = new Set(targets.map((r) => `${r.fromFile}:${innermostFn(r.fromNodeId) ?? ""}`));
    for (const [file, nodes] of collectFiles(facts, targets, inScope)) {
      for (const n of nodes) {
        if ((n.type !== "call" && n.type !== "assignment") || n.resolved !== false) continue;
        const label = n.funcName ?? n.callTarget ?? "";
        const tail = labelTail(label);
        if (tail === op.guard && !callsTarget.has(`${file}:${innermostFn(n.id) ?? ""}`)) continue;
        if (tail !== op.target && tail !== op.guard) continue;
        const kind = facts.terminalKindOf?.(file, n.id) ?? (label.includes(".") ? "dynamic" : "unresolved");
        hidden.push({ ref: `${file}:${n.id}` as NodeRef, kind });
      }
    }
    if (offenders.length) {
      return { verdict: "violated", reason: `\`${op.target}\` is called without \`${op.guard}\` governing it: ${whys.join(" | ")}`, offenders: [offenders[0], ...offenders.slice(1)], provenance };
    }
    if (hidden.length) {
      const dyn = hidden.filter((h) => h.kind === "dynamic");
      const cause = dyn.length ? "dynamic" : "unresolved";
      return {
        verdict: "unverifiable",
        reason: `every resolved call to \`${op.target}\` is guarded, but ${hidden.length} ${cause === "dynamic" ? "runtime-dispatched" : "unresolved"} call(s) could be \`${op.target}\` or \`${op.guard}\` `
          + `(${hidden.map((h) => `${h.ref} [${h.kind}]`).join("; ")}). ${cause === "dynamic" ? "Only a trace or a stated attribution can lift this." : "A re-link may lift this."}`,
        cause, at: hidden.map((h) => h.ref), offenders: [], provenance,
      };
    }
    const n = checked.length;
    return {
      verdict: "pass",
      reason: n ? `all ${n} function(s) calling \`${op.target}\` have a \`${op.guard}\` call governing it (${checked.join(", ")})` : `no resolved call to \`${op.target}\` inside any function`,
      notFollowed: [...NOT_FOLLOWED, ...(n ? [] : ["no call site existed to check"])] as unknown as readonly [string, ...string[]],
      offenders: [], provenance,
    };
  },
};

/** Files worth scanning for hidden target calls: every file that calls the
 *  target plus every file with an unresolved call, within scope. */
function collectFiles(facts: QualityFacts, targets: { fromFile: string }[], inScope: (file: string) => boolean): Array<[string, readonly FactNode[]]> {
  const files = new Set<string>(targets.map((t) => t.fromFile));
  for (const u of facts.unresolved) files.add(u.file);
  const out: Array<[string, readonly FactNode[]]> = [];
  for (const f of files) {
    if (!inScope(f)) continue;
    const nodes = facts.nodesByFile?.(f);
    if (nodes) out.push([f, nodes]);
  }
  return out;
}
