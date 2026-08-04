// M18.1 — resolve the "editable unit" for a selected IR node.
//
// The M18 thesis is "code is the medium": clicking any node opens its
// *enclosing function* in the editor, not the bare statement. This
// helper walks the IR `parentId` chain from the selected node up to the
// nearest `function_def` (the node itself counts if it IS a function),
// and returns the target the panel should load.
//
// Node lookup is done against the right *file's* node pool. In directory
// mode the selection can refer to a node in any file, so we resolve from
// `projectData[filePath].nodes` when available and fall back to the
// single-file `astNodes` array otherwise.
//
// No enclosing function (module-level statement) → `isModule: true`. The
// scaffold shows the whole file in that case and labels the breadcrumb
// "(module)". Real module-body editing lands with op_replace_module_body
// in M18.2 — this helper does NOT decide how the edit commits, only what
// source the editor presents.

import type { AstNode, ProjectFileData } from "../types";

export interface EditTarget {
  // The enclosing function_def (or the selected node itself when no
  // function ancestor exists — see isModule).
  node: AstNode;
  // Display name for the breadcrumb's function segment.
  fnName: string;
  filePath: string;
  // True when the selection has no enclosing function_def. The editor
  // shows the whole file; M18.2's op_replace_module_body owns the commit.
  isModule: boolean;
  // M18.3 — true when the *originally clicked* node IS the function_def
  // itself (not a node inside its body). Only then may a save change the
  // signature: it sets op_replace_function_body's --allow-signature-change.
  // Always false for module targets.
  signatureEditable: boolean;
  // A stable identity for "what is currently loaded", so the panel can
  // detect a genuine target switch (and fire the dirty-guard) vs. a
  // re-selection of the same function.
  key: string;
}

function functionName(node: AstNode): string {
  const n = node as unknown as { name?: string; funcName?: string };
  return n.name ?? n.funcName ?? node.id.split("/").pop() ?? node.id;
}

export function resolveEditTarget(
  node: AstNode | null,
  filePath: string | null,
  projectData: Record<string, ProjectFileData>,
  astNodes: AstNode[],
): EditTarget | null {
  if (!node || !filePath) return null;

  const pool = projectData[filePath]?.nodes ?? astNodes;
  const byId = new Map(pool.map((n) => [n.id, n]));

  // Start from the pool's copy of the node (authoritative parentId /
  // line span) but fall back to the passed-in node if the pool doesn't
  // have it (e.g. a stale cross-file selection before the file swap).
  let cursor: AstNode | undefined = byId.get(node.id) ?? node;
  let guard = 0;
  while (cursor && guard++ < 10_000) {
    if (cursor.type === "function_def") {
      return {
        node: cursor,
        fnName: functionName(cursor),
        filePath,
        isModule: false,
        // Signature edits allowed only when the def itself was clicked.
        signatureEditable: cursor.id === node.id,
        key: `${filePath}::${cursor.id}`,
      };
    }
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  // No enclosing function — module-level statement.
  return {
    node,
    fnName: "(module)",
    filePath,
    isModule: true,
    signatureEditable: false,
    key: `${filePath}::(module)`,
  };
}

// A loaded-target key is `${file}::${fnId}` or `${file}::(module)`. The
// dirty-guard prompt only needs the function segment for display.
export function loadedKeyToName(loadedKey: string | null): string | null {
  if (!loadedKey) return null;
  const seg = loadedKey.split("::")[1] ?? "";
  if (seg === "(module)") return "(module)";
  return seg.split("/").pop() ?? seg;
}

// Slice the source lines that belong to the edit target. IR line/endLine
// are 1-based and inclusive. For a module target there is no span to
// slice — the whole file is the unit, so we return it verbatim.
export function sliceTargetSource(source: string, target: EditTarget): string {
  if (target.isModule) return source;
  const lines = source.split("\n");
  const { line, endLine } = target.node;
  if (line == null || endLine == null) return source;
  return lines.slice(line - 1, endLine).join("\n");
}
