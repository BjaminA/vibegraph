// M9.4 — external-effects panel data model.
//
// Walks a Thread in DFS pre-order from the seed and emits an ordered
// list of effect rows: every thread node whose accent picker
// classifies it into Family 2 (I/O boundary). The panel renders this
// list one-for-one; the icons in the list are the SAME glyphs the
// canvas nodes show, picked via iconForNode — single source of truth.
//
// "External effect" here means "node sits in Family 2 — I/O / external
// boundary":
//   DB WRITE, DB READ, DB, HTTP, FS, SHELL, LOG, I/O
//
// We deliberately *don't* include CONFIG (Family 3) — argparse /
// framework setup isn't an effect that hits the outside world while
// the program runs; it's scaffolding. And we don't include Family 1
// (FN / CLASS / BRANCH / etc.) because those are the user's program.
//
// The accent picker (colour_for_node.ts) already runs this exact
// classification per node to colour the canvas; we reuse it so the
// panel can never disagree with the icons. If a node has the I/O
// accent on the canvas, it appears in this panel. Period.
//
// Pure function over Thread + projectIR; no React, no DOM.

import type { Thread, ThreadNode as ThreadNodeJSON } from "./types";
import type { AstNode, ProjectFileData } from "../../shared/protocol";
import { iconForNode, type ThreadNodeIcon } from "./icon_for_node";
import { accentForThreadNode } from "./colour_for_node";

export interface EffectRow {
  // Thread-node id, used as React key + click target into the
  // vg-selection bus.
  nodeId: string;
  // IR-side ids — null for terminals (external / dynamic). Terminals
  // can still appear in the list (DB / HTTP boundary calls), they
  // just don't have a clickable source.
  irNodeId: string | null;
  file: string | null;
  // Click target for the vg-selection bus. Terminals don't have IR
  // ids of their own; selectIr/selectFile point at the *parent*
  // function — the user's program-code site that calls this external
  // — so clicking "conn.execute" in the panel selects the function
  // that calls it on the canvas + code views.
  selectIr: string | null;
  selectFile: string | null;
  // Display: short label = function name / call target, arg summary
  // = call args / preview when available.
  label: string;
  argSummary: string | null;
  // The Family-2 kindLabel — "DB WRITE", "DB READ", "DB", "HTTP",
  // "FS", "SHELL", "LOG", "I/O".
  kindLabel: string;
  accentVar: string;
  // Pre-resolved icon — same glyph the canvas node already shows.
  icon: ThreadNodeIcon;
}

// Family-2 kindLabels — the only ones that show up in the panel.
// Keep in lockstep with colour_for_node.ts Family 2.
const IO_LABELS = new Set([
  "DB WRITE", "DB READ", "DB",
  "HTTP", "FS", "SHELL",
  "LOG", "I/O",
]);

const MAX_ARG_SUMMARY = 40;

export function buildEffectRows(
  thread: Thread,
  projectIR: Record<string, ProjectFileData> | null,
): EffectRow[] {
  // DFS pre-order from the seed. The extractor walks DFS internally
  // but the JSON gives us flat lists, so we re-derive the walk here.
  const adj = new Map<string, string[]>();
  // Reverse adjacency for terminal → parent lookup. Terminals don't
  // have their own IR; we surface the caller as the click target so
  // the row IS clickable (selects the call site on the canvas).
  const parentOf = new Map<string, string>();
  for (const e of thread.edges) {
    const arr = adj.get(e.from);
    if (arr) arr.push(e.to);
    else adj.set(e.from, [e.to]);
    if (!parentOf.has(e.to)) parentOf.set(e.to, e.from);
  }
  const nodeById = new Map(thread.nodes.map((n) => [n.id, n]));
  const order: ThreadNodeJSON[] = [];
  const visited = new Set<string>();
  const stack: string[] = [thread.seed.qualifiedName];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const n = nodeById.get(id);
    if (n) order.push(n);
    const children = adj.get(id);
    if (!children) continue;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  for (const n of thread.nodes) {
    if (!visited.has(n.id)) order.push(n);
  }

  // For each ordered thread node, classify via the accent picker.
  // Keep the row iff the kindLabel is in Family 2.
  const rows: EffectRow[] = [];
  for (const n of order) {
    const { accentVar, kindLabel } = accentForThreadNode(n, projectIR, null);
    if (!IO_LABELS.has(kindLabel)) continue;
    const ir = lookupIrNode(n, projectIR);
    const icon = iconForNode(kindLabel, ir, n.kind);
    // Click target: prefer the node's own IR; for terminals fall
    // back to walking up parentOf until we find a thread node with
    // an irNodeId (the function that calls this external).
    let selectIr = n.irNodeId;
    let selectFile = n.file;
    if (!selectIr || !selectFile) {
      let cursor: string | undefined = parentOf.get(n.id);
      const guard = new Set<string>();
      while (cursor && !guard.has(cursor)) {
        guard.add(cursor);
        const p = nodeById.get(cursor);
        if (p && p.irNodeId && p.file) {
          selectIr = p.irNodeId;
          selectFile = p.file;
          break;
        }
        cursor = parentOf.get(cursor);
      }
    }
    rows.push({
      nodeId: n.id,
      irNodeId: n.irNodeId,
      file: n.file,
      selectIr,
      selectFile,
      label: deriveLabel(n, ir),
      argSummary: deriveArgSummary(n, ir),
      kindLabel,
      accentVar,
      icon,
    });
  }
  return rows;
}

function lookupIrNode(
  n: { irNodeId: string | null; file: string | null },
  projectIR: Record<string, ProjectFileData> | null,
): AstNode | null {
  if (!n.irNodeId || !n.file || !projectIR) return null;
  const ir = projectIR[n.file];
  if (ir) {
    const found = ir.nodes.find((m) => m.id === n.irNodeId);
    if (found) return found;
  }
  for (const [k, v] of Object.entries(projectIR)) {
    if (k === n.file || k.endsWith(n.file)) {
      const found = v.nodes.find((m) => m.id === n.irNodeId);
      if (found) return found;
    }
  }
  return null;
}

function deriveLabel(threadNode: ThreadNodeJSON, ir: AstNode | null): string {
  // Internal IR-backed call/assign: prefer the IR funcName / name —
  // it's the canonical thing the user reads in code.
  if (ir?.type === "call" && ir.funcName) return ir.funcName;
  if (ir?.type === "assignment" && ir.name) return ir.name;
  // Terminals + function steps: the thread label is already the
  // qualified-name shown on the canvas.
  return threadNode.label;
}

function deriveArgSummary(threadNode: ThreadNodeJSON, ir: AstNode | null): string | null {
  // IR-backed call args.
  if (ir?.type === "call" && ir.args && ir.args.length > 0) {
    return truncate(`(${ir.args.join(", ")})`, MAX_ARG_SUMMARY + 2);
  }
  // IR-backed assignment-call: the preview is "name = funcCall(...)";
  // strip the LHS so the panel doesn't echo what's already in `label`.
  if (ir?.type === "assignment" && ir.preview) {
    const eqIdx = ir.preview.indexOf("=");
    const rhs = eqIdx >= 0 ? ir.preview.slice(eqIdx + 1).trim() : ir.preview;
    return truncate(rhs, MAX_ARG_SUMMARY);
  }
  // Terminals (no IR): fall back to the thread node's preview, which
  // the extractor often populates with the call expression.
  if (threadNode.preview) {
    return truncate(threadNode.preview, MAX_ARG_SUMMARY);
  }
  return null;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
