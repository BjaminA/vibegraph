// M-RUN SM1 — the client-side judgment-lite plan for "run to this node".
//
// Pure, view-side. Given a selected thread node, decide whether it can be run
// (SM1 = module-level, no-arg/all-default, confidently-pure) and compute the two
// things the server harness needs: the entry function name and the value-of-
// interest expression at N. Returns an honest decline outcome otherwise — the
// affordance must match the operation, so a node that can't run says why rather
// than silently doing nothing.
//
// This is NOT the authoritative side-effect gate (that is SM3, server-side). It
// is the SM1 pre-gate: fail-safe-by-refusal — any effectKind on the path OR any
// dynamic/unresolved thread terminal ⇒ requires-confirmation (deferred to SM3).

import type { AstNode, ProjectFileData, ThreadRunOutcome } from "../../shared/protocol";
import type { Thread } from "./types";

export type RunPlan =
  // needsSynth=true → the entry function requires arguments; the run goes
  // through SM2's two-phase synth→confirm flow instead of running directly.
  // irTargetId is the IR node id of the value-of-interest (the call-SITE
  // assignment), which the server probes — distinct from the thread node id
  // the tooltip routes results by (see resolution note in planRunToNode).
  // className (M-RUN2.1) → the entry is a METHOD; the run needs a synthesized
  // example instance (needsSynth is forced true) constructed as ClassName(...).
  | { runnable: true; entryFn: string; exprN: string; filePath: string; irTargetId: string; needsSynth: boolean; className?: string }
  | { runnable: false; outcome: ThreadRunOutcome; reason: string };

const IDENT = /^[A-Za-z_]\w*$/;

function lookupFileIR(file: string, projectIR: Record<string, ProjectFileData>): ProjectFileData | null {
  if (projectIR[file]) return projectIR[file];
  for (const [k, v] of Object.entries(projectIR)) if (k === file || k.endsWith(file)) return v;
  return null;
}


export function planRunToNode(
  node: { nodeId?: string; irNodeId: string | null; file: string | null },
  projectIR: Record<string, ProjectFileData> | null,
  thread: Thread,
): RunPlan {
  const decline = (outcome: ThreadRunOutcome, reason: string): RunPlan =>
    ({ runnable: false, outcome, reason });

  // A resolved-call step node's irNodeId points at the CALLEE def
  // (`module/double.fn`), not the call SITE. "Run to here" means: run the
  // enclosing function up to that call and capture the assigned value — so the
  // value-of-interest is the call-site assignment in the enclosing function,
  // which the extractor records as this node's incoming `direct` edge's
  // irSource (`module/happy.fn/result.assign`). Resolve through it when we know
  // the thread node id; fall back to the node's own irNodeId (a seed node, or a
  // caller — e.g. a unit test — that already passes an IR id directly).
  let irNodeId = node.irNodeId;
  let file = node.file;
  if (node.nodeId) {
    const inEdge = thread.edges.find((e) => e.to === node.nodeId && e.kind === "direct" && e.irSource);
    if (inEdge) {
      const from = thread.nodes.find((n) => n.id === inEdge.from);
      if (from?.file) { irNodeId = inEdge.irSource; file = from.file; }
    }
  }

  if (!irNodeId || !file || !projectIR) {
    return decline("unsupported-target", "node has no resolvable source location");
  }
  const ir = lookupFileIR(file, projectIR);
  if (!ir) return decline("unsupported-target", "file IR not found");
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  const N = byId.get(irNodeId);
  if (!N) return decline("unsupported-target", "IR node not found");

  // Enclosing function: walk parentId up to the nearest function_def.
  let fn: AstNode | undefined;
  let cur: AstNode | undefined = N;
  const seen = new Set<string>();
  while (cur && cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const p = byId.get(cur.parentId);
    if (p && p.type === "function_def") { fn = p; break; }
    cur = p;
  }
  if (!fn || !fn.name) return decline("unsupported-target", "node is not inside a function");

  // M-RUN2.1 — a method runs on a SYNTHESIZED example instance: Claude
  // proposes `ClassName(<literals>)`, you confirm it in the synth gate, and
  // only then does anything execute. The class is same-file by construction.
  const fnParent = fn.parentId ? byId.get(fn.parentId) : undefined;
  let className: string | undefined;
  if (fnParent && fnParent.type === "class_def") {
    if (!fnParent.name || !IDENT.test(fnParent.name)) {
      return decline("unsupported-target", "this method's class has no usable name");
    }
    className = fnParent.name;
  }

  // SM2: an entry function that requires arguments is no longer declined —
  // it routes through synth→confirm (needsSynth below). `self` already
  // excluded (methods declined). The decision is deferred to the END so the
  // method / value-of-interest / purity gates still apply first: an
  // effectful or value-ambiguous arg-needing node should decline for THAT
  // reason, not silently enter the synth flow.
  const params = (fn.params ?? []).filter((p) => p.trim() !== "self");
  // M-RUN2.1 — constructing an example instance is itself a synthesis step,
  // so a method target always routes through the synth→confirm flow.
  const needsSynth = className !== undefined
    || params.some((p) => !p.includes("=") && !p.startsWith("*"));

  // Value-of-interest. An assignment with a plain identifier probes its LHS
  // (SM1). A return statement or bare call routes through the M-RUN3
  // capture_probe: the server rewrites the run's TEMP copy so the statement's
  // value lands in a synthetic holding variable — the value itself is real.
  // Anything else genuinely produces no value; the tooltip hides the button
  // for those instead of declining after the click.
  let exprN: string;
  if (N.type === "assignment" && N.name && IDENT.test(N.name)) {
    exprN = N.name;
  } else if (N.type === "return_stmt" || N.type === "call") {
    exprN = "__vg_value";
  } else {
    return decline("value-ambiguous", "this node doesn't produce a value (not an assignment, return, or call), so there's nothing to capture and show");
  }

  // M-RUN2.3 — the old client-side purity pre-gate is GONE, deliberately.
  // It declined locally (reason only — no effect list, no consent token, no
  // missing-data detection), which dead-ended every directly-effectful
  // function: the user saw "needs your go-ahead" with nothing to click. The
  // SERVER floor (scan_effects, authoritative, fail-safe) makes the same
  // refusal WITH the consent affordance — so effectful paths now route to it
  // like every other run and come back as a real gate, not a dead end.

  return { runnable: true, entryFn: fn.name, exprN, filePath: file, irTargetId: irNodeId, needsSynth, ...(className ? { className } : {}) };
}
