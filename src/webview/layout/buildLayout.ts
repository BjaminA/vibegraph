import type { Node } from "@xyflow/react";
import type { AstNode } from "../types";
import { docSummary, docLineCount, DOC_WRAP_CHARS, DOC_LINE_H } from "../util/docSummary";

// ── size constants ────────────────────────────────────────────────────────────

// Per-type *minimum* width. A node never renders narrower than this (keeps
// the compact look for short statements), but its width climbs from here to
// fit the longest line it shows — see ownWidth()/calcWidth(). There is no
// fixed horizontal cap; width is dynamic to content, clamped only at
// MAX_NODE_W to bound pathological one-liners.
const NODE_W: Record<string, number> = {
  import: 240, import_from: 270,
  assignment: 260,
  function_def: 290, class_def: 310,
  for_loop: 280, if_stmt: 270,
  return_stmt: 240, raise_stmt: 230,
  call: 240,
  try_stmt: 160, finally_block: 160,
};

// Content-fit sizing. CHAR_W ≈ a monospace advance at the node's body font
// size; W_RESERVE covers the icon, the action strip and horizontal padding.
const CHAR_W = 7;
const W_RESERVE = 96;
const MAX_NODE_W = 1000;
const COLUMN_CHANNEL = 120; // inter-column gap (matches the prior ~100–130px channels)

// Header height with NO docstring. function_def was 76 — a constant that had
// to cover a docstring band measuring 43px (none) to 112px (7 wrapped lines),
// so it wasted ~45px on most cards and overlapped the body on the long ones.
// The docstring's share is now derived per node in headerHeight().
const HEADER_H: Record<string, number> = {
  import: 50, import_from: 50,
  assignment: 72,
  function_def: 44, class_def: 68,
  for_loop: 68, if_stmt: 52,
  return_stmt: 44, raise_stmt: 44,
  call: 58,
  // try / finally have no header bar — only ThreadContainerNode's chip,
  // which floats over the top border. A small reserve gives the chip
  // clearance + top padding before the first nested statement.
  try_stmt: 22, finally_block: 22,
};

// Phase 6: single-row height for compact `self.X = …` assignments inside a
// class method. Matches AssignmentNode's CompactRow render.
const ASSIGNMENT_COMPACT_H = 40;
const FN_PARAM_ROW_H = 22;

const CONTAINER_TYPES = new Set([
  "function_def", "class_def", "for_loop", "if_stmt",
  // try / finally are grouping regions that hold nested statements; without
  // them here their children were never emitted and the regions fell through
  // to the assignment renderer's blank "ref" card (M-FV try/finally fix).
  "try_stmt", "finally_block",
]);

// try / finally render with thread-view's container shell rather than a
// forked file-view container style: a bordered region + Family-1 chip. Maps
// the file-view AST type to the ContainerKind + chip label ThreadContainerNode
// expects (see src/webview/threads/ThreadContainerNode.tsx).
const THREAD_CONTAINER: Record<string, { containerKind: string; label: string }> = {
  try_stmt: { containerKind: "try", label: "try" },
  finally_block: { containerKind: "finally", label: "finally" },
};
const BODY_PAD_TOP = 14;
const BODY_PAD_BOT = 14;
const CHILD_PAD_LEFT = 12; // right gutter inside a container

// M-FV.2 (W1) — syntax-faithful vertical rhythm. Named constants on the 4px
// spacing scale replace the old magic gaps (top-level +24, BODY_GAP=8):
//   BASELINE_GAP  contiguous statements (no blank line between them)
//   GROUP_GAP     a blank line (or comment) in source becomes a visual break
//   INDENT_STEP   per-nesting-level left inset, applied RELATIVE to each
//                 container, so it accumulates through the react-flow parent
//                 chain and structural depth maps to indentation depth.
const BASELINE_GAP = 16;
const GROUP_GAP = 32;
const INDENT_STEP = 24;

// The vertical gap that precedes `curr`, given the sibling `prev` directly
// above it in source order. A line-number gap > 1 means at least one blank
// (or comment) line sat between them in the source — render that as a group
// break. Derived purely from the IR's required line/endLine spans (no schema
// change, no raw-source read). Falls back to the baseline when spans are
// missing.
// Everything above a container's first body statement: title band, docstring
// summary lines, param rows, and any multi-line preview growth. calcHeight (to
// reserve the space) and emitNode (to place the children in it) MUST agree —
// they read the same constant from two places before, and the docstring was in
// neither, which is what put `prepare_tensors`' params under its `if not rows`.
function headerHeight(n: AstNode): number {
  const base = HEADER_H[n.type] ?? 44;
  const docH = n.type === "function_def" ? docLineCount(n.docstring) * DOC_LINE_H : 0;
  const extraLines = (previewLines(n) - 1) * PREVIEW_LINE_H;
  return base + docH + visibleParams(n) * FN_PARAM_ROW_H + extraLines;
}

function gapBetween(prev: AstNode, curr: AstNode): number {
  if (prev.endLine != null && curr.line != null && curr.line - prev.endLine > 1) {
    return GROUP_GAP;
  }
  return BASELINE_GAP;
}

// ── layout helpers ────────────────────────────────────────────────────────────

function visibleParams(n: AstNode): number {
  if (n.type !== "function_def") return 0;
  return (n.params ?? []).filter((p) => p !== "self" && p !== "cls").length;
}

// Phase 6: identify a class-field assignment that renders as a single-row
// CompactRow rather than the two-row card. Two cases qualify:
//   1. a dataclass-style field declared directly in the class body
//      (`uid: int`) — parent is the class_def; and
//   2. a `self.X = …` assignment inside a class method.
function isClassFieldAssignment(
  n: AstNode,
  byId: Map<string, AstNode>,
): boolean {
  if (n.type !== "assignment") return false;
  // (1) field declared directly in the class body.
  const parent = n.parentId ? byId.get(n.parentId) : undefined;
  if (parent?.type === "class_def") return true;
  // (2) self.X = … inside a class method.
  const name = (n as any).name as string | undefined;
  if (!name || !name.startsWith("self.")) return false;
  // Walk up: must be inside a function_def whose parent is class_def.
  let cursorId: string | null | undefined = n.parentId;
  while (cursorId) {
    const cursor = byId.get(cursorId);
    if (!cursor) return false;
    if (cursor.type === "function_def") {
      const gp = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      return gp?.type === "class_def";
    }
    cursorId = cursor.parentId;
  }
  return false;
}

// ── width: dynamic to the longest line a node renders ─────────────────────────

// Multi-line preview text (a `nn.Sequential(...)` RHS keeps its source
// newlines) must size by its WIDEST line — sizing by total string length
// stretched the card to fit a paragraph while pre-wrap broke the text at
// the embedded newlines, leaving a wide box that the text never filled.
function longestLineLen(s: string): number {
  let max = 0;
  for (const line of s.split("\n")) max = Math.max(max, line.length);
  return max;
}

// Rendered line count of an assignment/return preview — extra lines beyond
// the first grow the node in calcHeight so the full expression is visible
// (matched by the clampLines the node components pass to TextLine).
function previewLines(n: AstNode): number {
  const text = n.type === "assignment"
    ? (n.preview && n.preview.length > 0 ? n.preview : (n.annotation ?? ""))
    : n.type === "return_stmt" ? (n.value ?? "") : "";
  return text.length === 0 ? 1 : text.split("\n").length;
}
const PREVIEW_LINE_H = 15; // fontSize-11 monospace line + breathing room

// Character length of the dominant text line for a node — what the node's
// width must accommodate. Mirrors what each node component actually paints.
function contentLen(n: AstNode): number {
  switch (n.type) {
    case "import":
    case "import_from": {
      const names = (n.names ?? []).join(", ");
      const prefix = n.type === "import_from" ? `from ${n.module ?? ""} `.length : 0;
      return prefix + names.length;
    }
    case "assignment": {
      const rhs = n.preview && n.preview.length > 0 ? n.preview : (n.annotation ?? "");
      return (n.name?.length ?? 0) + 3 + longestLineLen(rhs);
    }
    case "function_def": {
      const params = (n.params ?? []).filter((p) => p !== "self" && p !== "cls");
      const longestParam = params.reduce((m, p) => Math.max(m, p.length), 0);
      // The summary gets real horizontal room (was capped at 48 chars, which
      // forced long summaries to wrap 5-7 times in a band nobody had measured).
      const doc = Math.min(docSummary(n.docstring).length, DOC_WRAP_CHARS);
      return Math.max((n.name?.length ?? 0) + 6, longestParam + 6, doc);
    }
    case "class_def":
      return `class ${n.name ?? ""}(${(n.bases ?? []).join(", ")})`.length;
    case "for_loop":
      return Math.max((n.target?.length ?? 0) + 9, n.iterName?.length ?? 0);
    case "if_stmt":
      return 4 + (n.condition?.length ?? 0);
    case "call":
      // +12: the hexagon's real chrome (20px clip inset + 108px action
      // reserve + icon + gap ≈ 158px) exceeds W_RESERVE by ~9 chars, which
      // made e.g. `super().__init__` soft-break mid-identifier ("__in/it__").
      return Math.max((n.funcName?.length ?? 0) + 12, (n.args ?? []).join(", ").length + 4);
    case "return_stmt":
      return 7 + longestLineLen(n.value ?? "None");
    case "raise_stmt":
      return 6 + (n.exc?.length ?? 0);
    case "try_stmt":
      return 3; // "TRY" chip — real width comes from the nested children
    case "finally_block":
      return 7; // "FINALLY" chip
    default:
      return 24;
  }
}

// A node's own width before accounting for children: clamp(min, fit, max).
function ownWidth(n: AstNode, byId: Map<string, AstNode>): number {
  const min = NODE_W[n.type] ?? 260;
  // Compact class-field rows lay icon + name + op + the 108px action
  // reserve INLINE with the value — ~170px of chrome where W_RESERVE
  // budgets 96 — so without this the value column soft-wraps ~11 chars
  // short of the fit (the `nn.Sequential(` → `nn.Sequential` + `(` split).
  const compactExtra = n.type === "assignment" && isClassFieldAssignment(n, byId) ? 11 : 0;
  const fit = W_RESERVE + (contentLen(n) + compactExtra) * CHAR_W;
  return Math.min(MAX_NODE_W, Math.max(min, fit));
}

// Container width must also fit its widest descendant (plus side padding),
// so a long call/return inside a function body never overflows its parent.
function calcWidth(
  nodeId: string,
  children: Map<string, string[]>,
  byId: Map<string, AstNode>,
  cache: Map<string, number>,
): number {
  if (cache.has(nodeId)) return cache.get(nodeId)!;
  const n = byId.get(nodeId);
  if (!n) return 260;
  let w = ownWidth(n, byId);
  const kids = children.get(nodeId) ?? [];
  if (kids.length > 0 && CONTAINER_TYPES.has(n.type)) {
    let maxKid = 0;
    for (const k of kids) maxKid = Math.max(maxKid, calcWidth(k, children, byId, cache));
    // Children are left-inset by INDENT_STEP (not centered), so the
    // container must fit that inset + the widest child + a right gutter.
    w = Math.max(w, INDENT_STEP + maxKid + CHILD_PAD_LEFT);
  }
  cache.set(nodeId, w);
  return w;
}

// Character budget a node of this width supports — fed to the text
// components so they stop truncating short of the (now wider) node.
function charBudgetFor(width: number): number {
  return Math.max(8, Math.floor((width - W_RESERVE) / CHAR_W));
}

export function calcHeight(
  nodeId: string,
  children: Map<string, string[]>,
  byId: Map<string, AstNode>,
  cache: Map<string, number>
): number {
  if (cache.has(nodeId)) return cache.get(nodeId)!;
  const n = byId.get(nodeId);
  if (!n) return 40;
  // A multi-line preview (assignment RHS / return value with source
  // newlines) grows the node so every line is visible — the width side of
  // this contract is longestLineLen in contentLen.
  const extraLines = (previewLines(n) - 1) * PREVIEW_LINE_H;
  // Phase 6: compact self-field rows have their own height.
  if (isClassFieldAssignment(n, byId)) {
    const h = ASSIGNMENT_COMPACT_H + extraLines;
    cache.set(nodeId, h);
    return h;
  }
  const hdr = headerHeight(n);
  const kids = children.get(nodeId) ?? [];
  if (kids.length === 0 || !CONTAINER_TYPES.has(n.type)) {
    cache.set(nodeId, hdr);
    return hdr;
  }
  const kidsH = kids.reduce((s, k) => s + calcHeight(k, children, byId, cache), 0);
  // Sum the per-sibling rhythm gaps (baseline vs group) rather than a flat
  // gap × (n-1), so the height matches the variable spacing emitNode lays out.
  let gaps = 0;
  for (let i = 1; i < kids.length; i++) {
    const a = byId.get(kids[i - 1]);
    const b = byId.get(kids[i]);
    if (a && b) gaps += gapBetween(a, b);
  }
  const h = hdr + BODY_PAD_TOP + kidsH + gaps + BODY_PAD_BOT;
  cache.set(nodeId, h);
  return h;
}

function typeToNodeType(type: string): string {
  switch (type) {
    case "import": return "importNode";
    case "import_from": return "importFromNode";
    case "assignment": return "assignmentNode";
    case "function_def": return "functionDefNode";
    case "class_def": return "classDefNode";
    case "for_loop": return "forLoopNode";
    case "if_stmt": return "ifNode";
    case "return_stmt": return "returnNode";
    case "raise_stmt": return "raiseNode";
    case "call": return "callNode";
    case "try_stmt":
    case "finally_block": return "threadContainer";
    default: return "assignmentNode";
  }
}

// Resolve any node id to its top-level ancestor (walk the parent chain).
function topAncestor(id: string, byId: Map<string, AstNode>): string | null {
  let n = byId.get(id);
  while (n && n.parentId) n = byId.get(n.parentId);
  return n ? n.id : null;
}

// M-FV.6 (W2b) — order the definitions band by call flow instead of pure
// source line: each definition is immediately followed by the definitions it
// calls (resolved to their top-level ancestors), so a caller and its callees
// sit adjacent and the column reads as a flow. A DFS pre-order seeded by
// source order — stable, cycle-safe (visited set), and a no-op for files with
// no intra-band calls (falls back to source order). Single column preserved
// (band x is fixed), so flow reads top→down here; the band stays one column
// to keep the M-FV.2 rhythm and M-FV.5 banding contracts intact.
function flowOrderBand(
  band: AstNode[],
  refEdges: Array<{ source: string; target: string }>,
  byId: Map<string, AstNode>,
): AstNode[] {
  if (band.length < 2 || refEdges.length === 0) return band;
  const inBand = new Set(band.map((n) => n.id));
  // caller top-id → ordered callee top-ids in this band; hasCaller marks any
  // definition that is itself called by an in-band definition.
  const callees = new Map<string, string[]>();
  const hasCaller = new Set<string>();
  for (const e of refEdges) {
    const s = topAncestor(e.source, byId);
    const t = topAncestor(e.target, byId);
    if (!s || !t || s === t || !inBand.has(s) || !inBand.has(t)) continue;
    if (!callees.has(s)) callees.set(s, []);
    if (!callees.get(s)!.includes(t)) callees.get(s)!.push(t);
    hasCaller.add(t);
  }
  if (callees.size === 0) return band;
  const order = new Map(band.map((n, i) => [n.id, i]));
  const visited = new Set<string>();
  const out: AstNode[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const n = byId.get(id);
    if (n) out.push(n);
    // Emit this definition's callees right after it (source order among them),
    // pulling them adjacent even when they were defined earlier in the file.
    const next = (callees.get(id) ?? []).slice().sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    for (const c of next) visit(c);
  };
  // Roots — definitions not called by any in-band definition — anchor the
  // order in source sequence; each carries its callee subtree beneath it.
  for (const n of band) if (!hasCaller.has(n.id)) visit(n.id);
  // Anything left (mutual-recursion cycles) falls back to source order.
  for (const n of band) visit(n.id);
  return out;
}

// Column-based manual layout. Keeps the existing algorithm — PLAN.md notes
// "Dagre may replace it later", so this stays as-is until then.
export function buildLayout(
  astNodes: AstNode[],
  refEdges: Array<{ source: string; target: string }> = [],
): Node[] {
  const byId = new Map(astNodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();

  for (const n of astNodes) {
    if (n.parentId) {
      if (!children.has(n.parentId)) children.set(n.parentId, []);
      children.get(n.parentId)!.push(n.id);
      hasParent.add(n.id);
    }
  }

  // Order siblings by source line so the rhythm gaps (gapBetween) and the
  // emit order both follow the file. Parse order is already source order;
  // this is a defensive, deterministic re-sort.
  for (const kids of children.values()) {
    kids.sort((a, b) => (byId.get(a)?.line ?? 0) - (byId.get(b)?.line ?? 0));
  }

  const heightCache = new Map<string, number>();
  for (const n of astNodes) calcHeight(n.id, children, byId, heightCache);

  const widthCache = new Map<string, number>();
  for (const n of astNodes) calcWidth(n.id, children, byId, widthCache);

  const topLevel = astNodes.filter((n) => !hasParent.has(n.id));

  // M-FV.5 (W2a) — three explicit left-to-right bands, replacing the old
  // five type-buckets (which split function_def / class_def / flow into
  // separate columns, leaving an L-shaped void and scattering definitions
  // across two tall columns). Bands read like the file: imports, then
  // module-level state, then the definitions + module-level flow (sorted
  // into source order within the band, so a class and a function interleave
  // exactly as written). M-FV.6 (W2b) reorders the definitions band by
  // call-flow.
  const COLUMN_TYPES: string[][] = [
    ["import", "import_from"],                                   // imports
    ["assignment"],                                             // module state
    ["function_def", "class_def", "for_loop", "if_stmt",        // definitions
     "call", "return_stmt", "raise_stmt"],                      //   + flow
  ];

  const columns: AstNode[][] = COLUMN_TYPES.map(() => []);
  for (const n of topLevel) {
    let placed = false;
    for (let c = 0; c < COLUMN_TYPES.length; c++) {
      if (COLUMN_TYPES[c].includes(n.type)) {
        columns[c].push(n);
        placed = true;
        break;
      }
    }
    if (!placed) columns[columns.length - 1].push(n);
  }

  // Stack each column in source order so gapBetween reads real line spans.
  for (const col of columns) {
    col.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  }

  // W2b — reorder ONLY the definitions band (the one holding function/class
  // defs) by call flow. The state band keeps strict source order (W2a).
  const defsBand = COLUMN_TYPES.findIndex((types) => types.includes("function_def"));
  if (defsBand >= 0) {
    columns[defsBand] = flowOrderBand(columns[defsBand], refEdges, byId);
  }

  // Column X positions are derived from the widest node in each preceding
  // column rather than fixed, so wide content can't bleed into the next
  // column. Empty columns collapse to a single channel gap.
  const COLUMN_X: number[] = [];
  let colX = 40;
  for (let c = 0; c < columns.length; c++) {
    COLUMN_X[c] = colX;
    const colMaxW = columns[c].reduce((m, n) => Math.max(m, widthCache.get(n.id) ?? 0), 0);
    colX += colMaxW + COLUMN_CHANNEL;
  }

  const flowNodes: Node[] = [];
  const topLevelPositions = new Map<string, { x: number; y: number }>();
  for (let c = 0; c < columns.length; c++) {
    let y = 40;
    let prev: AstNode | null = null;
    for (const n of columns[c]) {
      if (prev) y += gapBetween(prev, n); // baseline vs blank-line group break
      topLevelPositions.set(n.id, { x: COLUMN_X[c], y });
      y += heightCache.get(n.id) ?? 40;
      prev = n;
    }
  }

  function emitNode(nodeId: string, parentId: string | null, relX: number, relY: number): void {
    const n = byId.get(nodeId);
    if (!n) return;
    const w = widthCache.get(nodeId) ?? (NODE_W[n.type] ?? 260);
    const h = heightCache.get(nodeId) ?? 40;
    // Phase 6: forward the compact flag so AssignmentNode renders the
    // single-row CompactRow. Only assignments inside class methods
    // qualify (see isClassFieldAssignment).
    const compact = isClassFieldAssignment(n, byId);
    // try / finally carry the thread-container data shape (kind + chip label
    // + Family-1 accent) so ThreadContainerNode renders the region + chip.
    const containerData = THREAD_CONTAINER[n.type];
    const flowNode: Node = {
      id: nodeId,
      type: typeToNodeType(n.type),
      position: parentId
        ? { x: relX, y: relY }
        : (topLevelPositions.get(nodeId) ?? { x: 0, y: 0 }),
      // charBudget lets the text components fill the (now content-sized)
      // node instead of truncating at a fixed character count.
      data: {
        ...n,
        charBudget: charBudgetFor(w),
        ...(compact ? { compact: true } : {}),
        ...(containerData
          ? { ...containerData, accentVar: "--accent-thread", orientation: "vertical" as const }
          : {}),
      },
      ...(parentId ? { parentId, extent: "parent" as const } : {}),
      // Explicit width/height (not only via style) so react-flow has node
      // dimensions before DOM measurement — the MiniMap (M-FV.4) reads these
      // to draw a marker per node; without them the minimap is an empty box.
      width: w,
      height: h,
      style: { width: w, height: h },
      selectable: true,
      draggable: !parentId,
    };
    flowNodes.push(flowNode);

    const kids = children.get(nodeId);
    if (kids && kids.length > 0 && CONTAINER_TYPES.has(n.type)) {
      let childY = headerHeight(n) + BODY_PAD_TOP;
      let prevKid: AstNode | null = null;
      for (const kid of kids) {
        const kidNode = byId.get(kid);
        // Blank-line group breaks between body statements, baseline otherwise.
        if (prevKid && kidNode) childY += gapBetween(prevKid, kidNode);
        const kidH = heightCache.get(kid) ?? 40;
        // Left-inset by one indent step (relative to this container), so
        // nesting depth reads as indentation depth — see INDENT_STEP.
        emitNode(kid, nodeId, INDENT_STEP, childY);
        childY += kidH;
        if (kidNode) prevKid = kidNode;
      }
    }
  }

  const topLevelContainers = topLevel.filter((n) => CONTAINER_TYPES.has(n.type));
  const topLevelLeaves = topLevel.filter((n) => !CONTAINER_TYPES.has(n.type));
  for (const n of [...topLevelContainers, ...topLevelLeaves]) {
    emitNode(n.id, null, 0, 0);
  }

  return flowNodes;
}
