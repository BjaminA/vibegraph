// Quality layer, Run 3: structural helpers every verb shares. Pure over
// FactNode arrays; no IR walking of its own beyond parent links and
// positions, which is all the structural-path ids and `parentId` give.

import type { FactNode } from "./check_registry.ts";

export interface IrIndex {
  byId: Map<string, FactNode>;
  byParent: Map<string, FactNode[]>;
}

export function indexNodes(nodes: readonly FactNode[]): IrIndex {
  const byId = new Map<string, FactNode>();
  const byParent = new Map<string, FactNode[]>();
  for (const n of nodes) {
    byId.set(n.id, n);
    const k = n.parentId ?? "";
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(n);
  }
  for (const list of byParent.values()) list.sort(comparePos);
  return { byId, byParent };
}

export function comparePos(a: FactNode, b: FactNode): number {
  return a.line - b.line || a.col - b.col;
}

/** Every node below `id`, breadth-first. */
export function descendants(idx: IrIndex, id: string): FactNode[] {
  const out: FactNode[] = [];
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const ch of idx.byParent.get(cur) ?? []) { out.push(ch); queue.push(ch.id); }
  }
  return out;
}

/** Parent chain of `id`, nearest first, ending at the module root's child. */
export function ancestors(idx: IrIndex, id: string): FactNode[] {
  const out: FactNode[] = [];
  let cur = idx.byId.get(id)?.parentId ?? null;
  while (cur) {
    const n = idx.byId.get(cur);
    if (!n) break;
    out.push(n);
    cur = n.parentId;
  }
  return out;
}

/** The innermost enclosing function's id: the longest id prefix ending in
 *  `.fn`. `module/A.class/f.fn/for@0/x.call` -> `module/A.class/f.fn`. */
export function innermostFn(id: string): string | null {
  const parts = id.split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].endsWith(".fn")) return parts.slice(0, i + 1).join("/");
  }
  return null;
}

export function fnName(fnId: string): string {
  const seg = fnId.split("/").pop() ?? "";
  return seg.endsWith(".fn") ? seg.slice(0, -3) : seg;
}

/** Is `g` the test expression of `stmt`? The parser emits a test's calls
 *  BEFORE the if/while node and parents them beside it (48a8146), so the
 *  test call shares the statement's parent and line and sits to its right. */
export function isTestOf(g: FactNode, stmt: FactNode): boolean {
  return (stmt.type === "if_stmt" || stmt.type === "while_loop")
    && g.parentId === stmt.parentId && g.line === stmt.line && g.col >= stmt.col;
}

/** `then` or `else`: which arm of if-statement `ifNode` does `child` (a
 *  direct child) sit in. M17.3's rule: line < elseLine is the then-arm. */
export function armOf(ifNode: FactNode, child: FactNode): "then" | "else" {
  if (ifNode.elseLine == null) return "then";
  return child.line < ifNode.elseLine ? "then" : "else";
}

/** A leading `not` on the condition text. Anything more composed is not
 *  read; the caller says so in notFollowed. */
export function conditionNegated(cond: string | null | undefined): boolean {
  const c = (cond ?? "").trim();
  return c.startsWith("not ") || c.startsWith("not(");
}

/** The last dotted segment of a call label: `conn.execute` -> `execute`,
 *  `requests.get().json` -> `json`. */
export function labelTail(label: string): string {
  const s = label.replace(/\(\)/g, "");
  const i = s.lastIndexOf(".");
  return i >= 0 ? s.slice(i + 1) : s;
}

/** Every dotted segment of a label, with call parens stripped. */
export function labelSegments(label: string): string[] {
  return label.replace(/\(\)/g, "").split(".").filter(Boolean);
}
