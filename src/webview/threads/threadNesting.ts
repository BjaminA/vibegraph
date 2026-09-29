// Thread hierarchy (2026-09-29) — the Threads list, nested.
//
// A thread whose walk passes through another entry point's head already
// CONTAINS that thread as a sub-tree; deriveThreadCalls records the edge.
// This places every thread ONCE: under the first caller the walk reaches
// (discovery order), with the other callers counted beside it, and the
// threads nothing calls at the top. A thread only reachable round a cycle
// is promoted to the top, so no thread is ever hidden by the nesting.
//
// Pure, webview-safe, and deliberately free of react-flow imports so a node
// test can drive it.

export interface NestEdge { from: string; to: string }

export interface NestedRow {
  id: string;
  depth: number;
  /** The caller this row is placed under (null at the top). */
  parent: string | null;
  /** Every thread that calls this one, placed parent first. */
  callers: string[];
  /** Sub-threads placed under this row. */
  childCount: number;
}

/** `order` is the entry points in display order (kind groups, discovery
 *  order within). Returns the rows in display order, each root followed by
 *  its sub-tree depth-first. */
export function nestThreads(order: string[], edges: NestEdge[]): NestedRow[] {
  const known = new Set(order);
  const rank = new Map(order.map((id, i) => [id, i]));
  const children = new Map<string, string[]>();
  const callers = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const e of edges) {
    if (!known.has(e.from) || !known.has(e.to) || e.from === e.to) continue;
    const key = `${e.from}|${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (children.get(e.from) ?? children.set(e.from, []).get(e.from)!).push(e.to);
    (callers.get(e.to) ?? callers.set(e.to, []).get(e.to)!).push(e.from);
  }
  for (const list of children.values()) list.sort((a, b) => rank.get(a)! - rank.get(b)!);

  const placedUnder = new Map<string, string | null>();
  const tree = new Map<string, string[]>();
  const place = (root: string) => {
    placedUnder.set(root, null);
    const stack = [root];
    // Breadth-first so a thread sits under its NEAREST caller from this root.
    while (stack.length) {
      const id = stack.shift()!;
      for (const c of children.get(id) ?? []) {
        if (placedUnder.has(c)) continue;
        placedUnder.set(c, id);
        (tree.get(id) ?? tree.set(id, []).get(id)!).push(c);
        stack.push(c);
      }
    }
  };
  const roots: string[] = [];
  for (const id of order) {
    if ((callers.get(id) ?? []).length === 0) { roots.push(id); place(id); }
  }
  // Cycle-only threads: promote the first unplaced one, place what it
  // reaches, repeat.
  for (const id of order) {
    if (!placedUnder.has(id)) { roots.push(id); place(id); }
  }
  roots.sort((a, b) => rank.get(a)! - rank.get(b)!);

  const rows: NestedRow[] = [];
  const emit = (id: string, depth: number) => {
    const parent = placedUnder.get(id) ?? null;
    const all = callers.get(id) ?? [];
    const ordered = parent ? [parent, ...all.filter((c) => c !== parent)] : all;
    const kids = tree.get(id) ?? [];
    rows.push({ id, depth, parent, callers: ordered, childCount: kids.length });
    for (const k of kids) emit(k, depth + 1);
  };
  for (const r of roots) emit(r, 0);
  return rows;
}
