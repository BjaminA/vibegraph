// M16.3 — type inference for blank-thread-node link drops.
//
// When ThreadNodeLinker fires `vg-thread-link-drop`, ThreadCanvas
// resolves the target's IR via projectIR and classifies it:
//
//   function_def → call (placeholder args from the function's params)
//   class_def    → instantiation (args from __init__, if found)
//   assignment / variable → reference (no args)
//   call / other → rejected
//
// Per PLAN-v4 §4.2 step 4. The placeholder arg list is a STRING[] in
// the same shape parse_cst.py emits for function_def IRs
// (e.g. ["radius", "limit=5"]) — the M16.4 ArgumentEditorPanel will
// upgrade these to structured rows.

import type { AstNode, ProjectFileData } from "../../shared/protocol";

export type ResolvedLinkType = "call" | "instantiation" | "reference";

export interface ResolvedLink {
  type: ResolvedLinkType;
  funcName: string;
  placeholderArgs: string[];
  targetIrNodeId: string;
  targetIrType: AstNode["type"];
}

export type LinkInference =
  | { kind: "resolved"; resolved: ResolvedLink }
  | { kind: "rejected"; reason: string };

// Path-tolerant IR lookup — mirrors the same shape used by
// ThreadView's `lookupIrNode` (absolute vs relative path quirks).
function findIrNode(
  irNodeId: string,
  projectIR: Record<string, ProjectFileData> | null,
): AstNode | null {
  if (!projectIR) return null;
  for (const file of Object.values(projectIR)) {
    const found = file.nodes.find((n) => n.id === irNodeId);
    if (found) return found;
  }
  return null;
}

// Find the __init__ method whose parentId matches the class. Returns
// null if the class has no explicit __init__ (we then default to an
// empty placeholder args list — Python's implicit __init__ accepts
// no positional args).
function findClassInit(
  classNodeId: string,
  projectIR: Record<string, ProjectFileData> | null,
): AstNode | null {
  if (!projectIR) return null;
  for (const file of Object.values(projectIR)) {
    for (const n of file.nodes) {
      if (
        n.type === "function_def" &&
        n.parentId === classNodeId &&
        n.name === "__init__"
      ) {
        return n;
      }
    }
  }
  return null;
}

// Strip `self` from method param lists — it's not user-supplied.
function stripSelf(params: string[]): string[] {
  if (params.length > 0 && (params[0] === "self" || params[0].startsWith("self="))) {
    return params.slice(1);
  }
  return params;
}

export function inferLinkTarget(
  targetIrNodeId: string | null,
  projectIR: Record<string, ProjectFileData> | null,
): LinkInference {
  if (!targetIrNodeId) {
    return { kind: "rejected", reason: "target has no IR node id" };
  }
  const ir = findIrNode(targetIrNodeId, projectIR);
  if (!ir) {
    return { kind: "rejected", reason: `target IR not found: ${targetIrNodeId}` };
  }

  if (ir.type === "function_def") {
    return {
      kind: "resolved",
      resolved: {
        type: "call",
        funcName: ir.name ?? "anon",
        placeholderArgs: stripSelf(ir.params ?? []),
        targetIrNodeId,
        targetIrType: ir.type,
      },
    };
  }

  if (ir.type === "class_def") {
    const init = findClassInit(targetIrNodeId, projectIR);
    return {
      kind: "resolved",
      resolved: {
        type: "instantiation",
        funcName: ir.name ?? "anon",
        placeholderArgs: stripSelf(init?.params ?? []),
        targetIrNodeId,
        targetIrType: ir.type,
      },
    };
  }

  if (ir.type === "assignment") {
    return {
      kind: "resolved",
      resolved: {
        type: "reference",
        funcName: ir.name ?? "var",
        placeholderArgs: [],
        targetIrNodeId,
        targetIrType: ir.type,
      },
    };
  }

  // `call` is explicitly rejected per §4.2 step 4 — linking call-to-call
  // would create a nested-call edge with ambiguous insertion semantics.
  // Same for import / control-flow / return — they aren't callables.
  return {
    kind: "rejected",
    reason: `target IR type '${ir.type}' is not a callable / referenceable`,
  };
}
