// U3.3 — edge-label argument resolver.
//
// For each thread edge, surface the args being passed at the call site.
// The thread JSON gives us `irSource: string | null` — the call-site
// IR node id in the FROM file (extract_thread.py:51). With the from
// node's file we can look up the IR and read CallNode.args directly.
//
// Gap: assignment-RHS calls (e.g. `cursor = conn.execute(sql, params)`)
// don't carry `args` in the IR (protocol.ts:46-53 — args is on Call
// only). The plan §3 notes this as a v1.4 parser change. Fallback for
// U3.3: when the call's args aren't reachable, fall through to the
// target function's `params` so the edge still carries SOMETHING
// resembling the call shape (`(name, email)` rather than nothing).
//
// Returns a short formatted string + the source of the data so the
// renderer can style differently for inferred-from-params vs literal-
// from-args (future).

import type { Thread, ThreadEdge as ThreadEdgeJSON } from "./types";
import type { ProjectFileData } from "../../shared/protocol";
import { callIO, type CallNodeLike } from "../../shared/call_flow";

export type EdgeLabelSource = "call-args" | "fn-params";

export interface EdgeLabel {
  text: string;             // already-truncated, paren-wrapped
  fullText: string;         // pre-truncation for hover tooltips
  source: EdgeLabelSource;
}

const MAX_DISPLAY = 28;     // visible chars in the label (excl. parens)

export function resolveEdgeLabel(
  edge: ThreadEdgeJSON,
  thread: Thread,
  projectIR: Record<string, ProjectFileData> | null,
): EdgeLabel | null {
  if (!projectIR) return null;

  // 1. Try the call-site args directly. edge.irSource is the IR id of
  //    the call node IN the FROM thread node's file.
  const fromNode = thread.nodes.find((n) => n.id === edge.from);
  if (fromNode?.file && edge.irSource) {
    const sourceIR = lookupFile(projectIR, fromNode.file);
    if (sourceIR) {
      const callNode = sourceIR.nodes.find((n) => n.id === edge.irSource);
      if (callNode) {
        // 2026-10-07 — what goes in AND what comes back (shared/call_flow.ts):
        // an assignment-valued call carries its args now, and its bound names
        const io = callIO(callNode as CallNodeLike);
        if (io.args.length || io.binds.length) return formatIO(io.args, io.binds);
      }
    }
  }

  // 2. Fallback: pull params from the target function_def.
  const toNode = thread.nodes.find((n) => n.id === edge.to);
  if (toNode?.file && toNode.irNodeId) {
    const targetIR = lookupFile(projectIR, toNode.file);
    if (targetIR) {
      const fn = targetIR.nodes.find((n) => n.id === toNode.irNodeId);
      if (fn?.type === "function_def" && fn.params && fn.params.length > 0) {
        // Filter out `self` / `cls` — pure noise on edge labels.
        const params = fn.params.filter((p) => p !== "self" && p !== "cls");
        if (params.length > 0) {
          return formatLabel(params, "fn-params");
        }
      }
    }
  }

  return null;
}

/** `(args) → names`: the arguments, then what the result is bound to. */
function formatIO(args: string[], binds: string[]): EdgeLabel {
  const inn = args.join(", ");
  const out = binds.join(", ");
  const fullText = `(${inn})${out ? ` → ${out}` : ""}`;
  const shortIn = inn.length <= MAX_DISPLAY ? inn : inn.slice(0, MAX_DISPLAY - 1).trimEnd() + "…";
  const shortOut = out.length <= 22 ? out : out.slice(0, 21).trimEnd() + "…";
  return { text: `(${shortIn})${out ? ` → ${shortOut}` : ""}`, fullText, source: "call-args" };
}

function formatLabel(items: string[], source: EdgeLabelSource): EdgeLabel {
  const inner = items.join(", ");
  const fullText = `(${inner})`;
  if (inner.length <= MAX_DISPLAY) {
    return { text: fullText, fullText, source };
  }
  const truncated = inner.slice(0, MAX_DISPLAY - 1).trimEnd() + "…";
  return { text: `(${truncated})`, fullText, source };
}

function lookupFile(
  projectIR: Record<string, ProjectFileData>,
  file: string,
): ProjectFileData | null {
  const direct = projectIR[file];
  if (direct) return direct;
  for (const [k, v] of Object.entries(projectIR)) {
    if (k === file || k.endsWith(file)) return v;
  }
  return null;
}
