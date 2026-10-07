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
//
// 2026-10-07 — and it reads as the code's STORY, left to right, all from the
// IR: the block that runs when the file runs is marked and comes first; every
// CALL is its own line from the line that makes it to what it calls, labelled
// with what it passes (the call's arguments); a callee sits level with the
// line that calls it, in call order; a call into another file ends at a small
// stub naming the function and its file, so the story does not stop at the
// file's edge.

import { callIO, ioLabel, dataFlows, scopeOf, type CallIO, type CallNodeLike } from "../../shared/call_flow.ts";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { AstNode } from "../types";
import { layoutDefinitions, runsFirst } from "./defs_layout.ts";

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
/** the gap either side of a lane of stubs (calls into other files) */
const LANE_GAP = 40;
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
  /** lines that make a call drawn from this block (each gets its own handle) */
  callLines?: number[];
  /** runs when the file runs: where the story starts */
  entry?: boolean;
  [k: string]: unknown;
}

/** A call into another file: the function and where it lives. */
export interface CodeStubData { label: string; file: string; targetFile: string; targetId: string; /** what the call's result is bound to */ returns?: string[]; [k: string]: unknown }
export const STUB_H = 48;
/** the extra line a stub takes to say what comes back */
export const STUB_RETURN_H = 16;

/** The y of a line's middle inside its block (the handle a call leaves from). */
export const lineMid = (line: number, firstLine: number) => CODE_HEAD_H + CODE_PAD_Y + (line - firstLine) * CODE_LINE_H + CODE_LINE_H / 2;

/** A callee's name from its structural id: `module/load.fn` → load, `module/K.class/m.fn` → K.m. */
function calleeName(id: string): string {
  const parts = id.split("/").slice(1).map((p) => p.replace(/\.(fn|class)(@\d+)?$/, ""));
  return parts.filter((p) => p && !/^(if|for|while|try|with)@/.test(p)).join(".") || id;
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
  refEdges: Array<{ source: string; target: string; targetFile?: string }>,
  source: string,
  language: string,
  measure: LineMeasure = CODE_CHAR_W,
): { nodes: Node[]; mapEdge: (e: Edge) => Edge | null; callEdges: Edge[] } {
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

  const size = new Map(defBlocks.map((b) => [b.id, b]));
  const firstLineOf = new Map([...(importBlock ? [importBlock] : []), ...stateBlocks, ...defBlocks].map((b) => [b.id, b.data.firstLine]));
  const holder = (id: string) => { const t = topOf(id, byId); return t && IMPORT_TYPES.has(byId.get(t)!.type) ? "code:imports" : t; };
  // Every call site: the block and line it is made from, what it reaches
  // (a block of this file, or a stub for a function in another one), and
  // what it passes.
  type Site = { from: string; line: number; to: string; label: string; io: CallIO; node: string };
  const sites: Site[] = [];
  const stubs = new Map<string, { id: string; data: CodeStubData; w: number; h: number }>();
  for (const e of refEdges) {
    const from = holder(e.source);
    const src = byId.get(e.source);
    if (!from || !src?.line) continue;
    let to: string | null;
    if (e.targetFile && !byId.has(e.target)) {
      const id = `stub:${e.targetFile}#${e.target}`;
      if (!stubs.has(id)) {
        const label = `${calleeName(e.target)}()`, file = e.targetFile.split(/[\\/]/).pop() ?? e.targetFile;
        // what comes back rides the stub: "→ train_x, train_y, …"
        const binds = callIO(src as CallNodeLike).binds;
        const back = binds.length ? `→ ${binds.join(", ")}` : "";
        const backShown = back.length > 40 ? `${back.slice(0, 39)}…` : back;
        stubs.set(id, {
          id, w: Math.ceil(Math.max(label.length * LABEL_CHAR_W, file.length * 7, backShown.length * 6.7) + 44), h: STUB_H + (back ? STUB_RETURN_H : 0),
          data: { label, file, targetFile: e.targetFile, targetId: e.target, ...(binds.length ? { returns: binds } : {}) },
        });
      }
      to = id;
    } else to = holder(e.target);
    if (!to || to === from) continue;
    // 2026-10-07 — what goes in AND what comes back (shared/call_flow.ts)
    const io = callIO(src as CallNodeLike);
    if (!sites.some((x) => x.from === from && x.line === src.line && x.to === to)) sites.push({ from, line: src.line, to, label: ioLabel(io), io, node: src.id });
  }
  // In-file calls shape the flow; a call into another file ends at a stub in
  // its caller's LANE, level with the line that makes it (placed below).
  const calls: Array<[string, string]> = sites.filter((c) => !stubs.has(c.to)).map((c) => [c.from, c.to]);
  const firstCall = new Map<string, number>();
  for (const c of sites) { const k = `${c.from}->${c.to}`; firstCall.set(k, Math.min(firstCall.get(k) ?? Infinity, c.line)); }
  // Each stub belongs to the first block (in story order) that calls it.
  const laneOf = new Map<string, string[]>();
  const owned = new Set<string>();
  for (const c of [...sites].sort((a, b) => a.line - b.line)) {
    if (!stubs.has(c.to) || owned.has(c.to)) continue;
    owned.add(c.to);
    laneOf.set(c.from, [...(laneOf.get(c.from) ?? []), c.to]);
  }
  const laneW = (id: string) => { const l = laneOf.get(id); return l?.length ? Math.max(...l.map((s) => stubs.get(s)!.w)) + 2 * LANE_GAP : 0; };
  // Columns: imports, state, then the definitions region.
  const pos = new Map<string, { x: number; y: number }>();
  let x = 40;
  const stack = (list: Block[]) => {
    if (!list.length) return;
    let y = 40;
    for (const b of list) { pos.set(b.id, { x, y }); y += b.h + STACK_GAP; }
    // a column whose blocks call into other files keeps room for their lane
    x += Math.max(...list.map((b) => b.w + laneW(b.id))) + COLUMN_GAP;
  };
  if (importBlock) stack([importBlock]);
  stack(stateBlocks);
  const besideHeight = Math.max(0, ...[importBlock ? [importBlock] : [], stateBlocks]
    .map((l) => l.reduce((k, b) => k + b.h + STACK_GAP, 0)));
  const rel = layoutDefinitions({
    defs, calls, besideHeight, lane: laneW,
    width: (id) => size.get(id)?.w ?? 300, height: (id) => size.get(id)?.h ?? 60,
    entries: runsFirst(top),
    // level with the line that calls it: the callee's header (a stub's
    // middle) on the call line's middle
    callAt: (caller, callee) => {
      const line = firstCall.get(`${caller}->${callee}`);
      const first = firstLineOf.get(caller);
      if (line === undefined || first === undefined) return 0;
      return lineMid(line, first) - (stubs.has(callee) ? stubs.get(callee)!.h / 2 : CODE_HEAD_H / 2);
    },
  });
  for (const [id, p] of rel) pos.set(id, { x: x + p.x, y: 40 + p.y });
  // The lanes: each stub beside its caller, at the line that calls it,
  // pushed down only by the stub above it.
  for (const [caller, list] of laneOf) {
    const at = pos.get(caller), first = firstLineOf.get(caller);
    const w = size.get(caller)?.w ?? stateBlocks.find((b) => b.id === caller)?.w ?? importBlock?.w;
    if (!at || first === undefined || w === undefined) continue;
    let below = -Infinity;
    // the rows where this block's IN-FILE calls leave: a stub never sits on
    // one, or the line to the next block would run behind it
    const keepClear = sites.filter((c) => c.from === caller && !stubs.has(c.to)).map((c) => at.y + lineMid(c.line, first));
    for (const st of list) {
      const h = stubs.get(st)!.h;
      const want = at.y + lineMid(firstCall.get(`${caller}->${st}`) ?? first, first) - h / 2;
      let y = Math.max(want, below);
      for (let moved = true, n = 0; moved && n < 20; n++) {
        moved = false;
        for (const r of keepClear) if (r > y - 4 && r < y + h + 4) { y = r + 6; moved = true; }
      }
      pos.set(st, { x: at.x + w + LANE_GAP, y });
      below = y + h + 8;
    }
  }

  const entries = runsFirst(top);
  const linesFrom = new Map<string, number[]>();
  for (const c of sites) linesFrom.set(c.from, [...new Set([...(linesFrom.get(c.from) ?? []), c.line])].sort((a, b) => a - b));
  const nodes: Node[] = [...(importBlock ? [importBlock] : []), ...stateBlocks, ...defBlocks].map((b) => ({
    id: b.id,
    type: "codeBlock",
    position: pos.get(b.id) ?? { x: 0, y: 0 },
    data: { ...b.data, callLines: linesFrom.get(b.id) ?? [], entry: entries.has(b.id) },
    width: b.w,
    height: b.h,
    style: { width: b.w, height: b.h },
    draggable: true,
    selectable: true,
  }));
  for (const st of stubs.values()) {
    nodes.push({ id: st.id, type: "codeStub", position: pos.get(st.id) ?? { x: 0, y: 0 }, data: st.data, width: st.w, height: st.h, style: { width: st.w, height: st.h }, draggable: true, selectable: true });
  }
  // One line per call site, from the line that makes it, saying what it passes.
  const callEdges: Edge[] = sites.map((c) => ({
    id: `call:${c.from}:L${c.line}->${c.to}`,
    source: c.from, sourceHandle: `L${c.line}`, target: c.to, targetHandle: "in",
    type: "default",
    className: "vg-flow-edge",
    // a call into another file ends a stub's width away, beside the line that
    // reads the same — the stub says what comes back; the long lines to the
    // next block say what they pass and what comes back
    ...(c.label && !stubs.has(c.to) ? { label: c.label, labelStyle: { fill: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 11 }, labelBgStyle: { fill: "var(--bg-canvas)", fillOpacity: 0.92 }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 4 } : {}),
    style: { stroke: "var(--accent-thread)", strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent-thread)", width: 14, height: 14 },
    data: { kind: "call", family: "flow" },
  }));
  // Data flow: a call's result reaching a later call's arguments, in one
  // function — a quieter dashed line from what produced the names to what
  // takes them, labelled with the names (shared/call_flow.ts).
  const flowSites = sites.map((c) => ({ key: `${c.from}|${c.line}|${c.to}`, scope: scopeOf(c.node, byId as Map<string, CallNodeLike>), line: c.line, io: c.io }));
  const toOf = new Map(sites.map((c) => [`${c.from}|${c.line}|${c.to}`, c.to]));
  for (const f of dataFlows(flowSites)) {
    const a = toOf.get(f.from)!, b = toOf.get(f.to)!;
    if (a === b) continue;
    const id = `data:${a}->${b}`;
    const prior = callEdges.find((e) => e.id === id);
    if (prior) { prior.label = [...new Set([...String(prior.label).split(", "), ...f.names])].join(", "); continue; }
    callEdges.push({
      id, source: a, sourceHandle: "out", target: b, targetHandle: "in", type: "default",
      label: f.names.join(", "),
      labelStyle: { fill: "var(--accent-warning)", fontFamily: "var(--font-mono)", fontSize: 11 },
      labelBgStyle: { fill: "var(--bg-canvas)", fillOpacity: 0.92 }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 4,
      style: { stroke: "var(--accent-warning)", strokeWidth: 1.25, strokeDasharray: "5 4", opacity: 0.85 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent-warning)", width: 12, height: 12 },
      data: { kind: "data-flow", family: "flow", names: f.names },
    });
  }


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
  return { nodes, mapEdge, callEdges };
}
