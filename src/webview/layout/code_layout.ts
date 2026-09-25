// The file view in CODE mode (2026-09-24): the same grouping, the source as
// written. Ben: "a toggle to turn off the bubble view — still show code in a
// similar layout in the outlined boxes, but the actual code as it appears in
// VS Code, grouped the way we are doing, so it is more compact".
//
// Blocks are the file's TOP-LEVEL statements, cut from the source by their
// own line span (a decorated definition from its decorator):
//   * the imports      — ONE block, in their own column;
//   * module state      — one block per statement, one column, source order;
//   * definitions/flow  — one block each, laid out as call flows packed for a
//                         laptop (defs_layout.ts, the same function the card
//                         view uses).
// A block is sized from its text (monospace, 12px), not from nested cards,
// which is what makes this view compact — and sized to ALL of its text, so
// no block ever scrolls or clips (Ben, 2026-09-25). Edges keep their meaning: an edge
// between two statements is drawn between the blocks that hold them.

import type { Edge, Node } from "@xyflow/react";
import type { AstNode } from "../types";
import { layoutDefinitions } from "./defs_layout.ts";

export const CODE_CHAR_W = 7.3;   // JetBrains Mono 12px (fallback; the browser measures)
export const CODE_LINE_H = 18;
// The block's geometry, shared with CodeBlockNode so the box is exactly the
// size of what it paints — every line, whole, with nothing to scroll:
//   border | gutter (pad-left, digits, pad-right) | code | pad-right | border
export const CODE_HEAD_H = 30;    // label row, its bottom border included
export const CODE_PAD_Y = 10;
export const CODE_GUTTER_L = 12, CODE_GUTTER_R = 10, CODE_PAD_R = 16;
const BORDER = 1;
const SLACK = 4;                  // sub-pixel rounding of a measured glyph
const LABEL_CHAR_W = 7.5;         // Inter 12px semibold, generous
const LABEL_CHROME = 12 + 8 + 12 + 40; // pads + gap + the `L123` marker
const COLUMN_GAP = 120;
const STACK_GAP = 24;
const IMPORT_TYPES = new Set(["import", "import_from"]);
const STATE_TYPES = new Set(["assignment"]);

export interface CodeBlockData {
  label: string;
  kind: string;
  code: string;
  firstLine: number;
  language: string;
  /** the IR node ids this block holds (the first is the node itself) */
  holds: string[];
  [k: string]: unknown;
}

const topOf = (id: string, byId: Map<string, AstNode>): string | null => {
  let n = byId.get(id);
  while (n && n.parentId) n = byId.get(n.parentId);
  return n ? n.id : null;
};

/** A block's outer size: every line fits whole, so the body never scrolls. */
/** A line's painted width in px: a monospace advance, or — in the browser — a
 *  canvas measurement, which also gets full-width and fallback-font glyphs
 *  right (a currency-symbol table ran 40px past a character count). */
export type LineMeasure = number | ((line: string) => number);

export function codeBlockSize(code: string, firstLine: number, label: string, measure: LineMeasure = CODE_CHAR_W): { w: number; h: number } {
  const px = typeof measure === "number" ? (s: string) => s.length * measure : measure;
  const lines = code.split("\n");
  const longest = Math.max(px("0".repeat(10)), ...lines.map((l) => px(l.replace(/\t/g, "    "))));
  const digits = String(firstLine + lines.length - 1).length;
  const body = CODE_GUTTER_L + px("0".repeat(digits)) + CODE_GUTTER_R + longest + CODE_PAD_R;
  const head = label.length * LABEL_CHAR_W + LABEL_CHROME;
  return {
    w: Math.ceil(Math.max(body, head) + 2 * BORDER + SLACK),
    h: CODE_HEAD_H + 2 * CODE_PAD_Y + lines.length * CODE_LINE_H + 2 * BORDER,
  };
}

function labelOf(n: AstNode): string {
  const name = (n as { name?: string }).name;
  switch (n.type) {
    case "function_def": return `${name ?? "function"}()`;
    case "class_def": return `class ${name ?? ""}`.trim();
    case "assignment": return name ?? "assignment";
    default: return n.type.replace(/_/g, " ");
  }
}

export function buildCodeLayout(
  astNodes: AstNode[],
  refEdges: Array<{ source: string; target: string }>,
  source: string,
  language: string,
  measure: LineMeasure = CODE_CHAR_W,
): { nodes: Node[]; mapEdge: (e: Edge) => Edge | null } {
  const lines = source.split("\n");
  const byId = new Map(astNodes.map((n) => [n.id, n]));
  const top = astNodes.filter((n) => !n.parentId).sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  const slice = (from: number, to: number) => lines.slice(Math.max(0, from - 1), Math.max(from, to)).join("\n");
  const startOf = (n: AstNode) => (n as { decoratorLine?: number }).decoratorLine ?? n.line ?? 1;

  const imports = top.filter((n) => IMPORT_TYPES.has(n.type));
  const state = top.filter((n) => STATE_TYPES.has(n.type));
  const defs = top.filter((n) => !IMPORT_TYPES.has(n.type) && !STATE_TYPES.has(n.type));

  type Block = { id: string; data: CodeBlockData; w: number; h: number };
  const block = (id: string, label: string, kind: string, code: string, firstLine: number, holds: string[]): Block => {
    const { w, h } = codeBlockSize(code, firstLine, label, measure);
    return { id, w, h, data: { label, kind, code, firstLine, language, holds } };
  };
  const importBlock = imports.length
    ? block("code:imports", `imports · ${imports.length}`, "imports",
        imports.map((n) => slice(startOf(n), n.endLine ?? n.line)).join("\n"), imports[0].line ?? 1, imports.map((n) => n.id))
    : null;
  const stateBlocks = state.map((n) => block(n.id, labelOf(n), n.type, slice(startOf(n), n.endLine ?? n.line), startOf(n), [n.id]));
  const defBlocks = defs.map((n) => block(n.id, labelOf(n), n.type, slice(startOf(n), n.endLine ?? n.line), startOf(n), [n.id]));

  // Columns: imports, state, then the definitions region.
  const pos = new Map<string, { x: number; y: number }>();
  let x = 40;
  const stack = (list: Block[]) => {
    if (!list.length) return;
    let y = 40;
    for (const b of list) { pos.set(b.id, { x, y }); y += b.h + STACK_GAP; }
    x += Math.max(...list.map((b) => b.w)) + COLUMN_GAP;
  };
  if (importBlock) stack([importBlock]);
  stack(stateBlocks);
  const besideHeight = Math.max(0, ...[importBlock ? [importBlock] : [], stateBlocks]
    .map((l) => l.reduce((k, b) => k + b.h + STACK_GAP, 0)));
  const size = new Map(defBlocks.map((b) => [b.id, b]));
  const calls: Array<[string, string]> = [];
  for (const e of refEdges) {
    const a = topOf(e.source, byId), b = topOf(e.target, byId);
    if (a && b && a !== b) calls.push([a, b]);
  }
  const rel = layoutDefinitions({
    defs, calls, besideHeight,
    width: (id) => size.get(id)?.w ?? 300, height: (id) => size.get(id)?.h ?? 60,
  });
  for (const [id, p] of rel) pos.set(id, { x: x + p.x, y: 40 + p.y });

  const nodes: Node[] = [...(importBlock ? [importBlock] : []), ...stateBlocks, ...defBlocks].map((b) => ({
    id: b.id,
    type: "codeBlock",
    position: pos.get(b.id) ?? { x: 0, y: 0 },
    data: b.data,
    width: b.w,
    height: b.h,
    style: { width: b.w, height: b.h },
    draggable: true,
    selectable: true,
  }));

  // An edge between statements is drawn between the blocks holding them.
  const blockOf = new Map<string, string>();
  for (const n of astNodes) {
    const t = topOf(n.id, byId);
    if (!t) continue;
    blockOf.set(n.id, IMPORT_TYPES.has(byId.get(t)!.type) ? "code:imports" : t);
  }
  const seen = new Set<string>();
  const mapEdge = (e: Edge): Edge | null => {
    const s = blockOf.get(e.source), t = blockOf.get(e.target);
    if (!s || !t || s === t) return null;
    const key = `${s}->${t}:${(e.data as { family?: string } | undefined)?.family ?? ""}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return { ...e, id: `code:${key}`, source: s, target: t };
  };
  return { nodes, mapEdge };
}
