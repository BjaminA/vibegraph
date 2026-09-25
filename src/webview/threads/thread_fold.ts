// Big threads fold BY FILE at the overview zoom tier.
//
// Measured on a private production codebase's largest thread (a Next.js page: 3,988 nodes,
// 5,564 edges, 128 files): 73,694 DOM elements, 13 s to open, panning at
// ~9 fps. At the overview tier (z < 0.28) no step label is legible anyway —
// M-NA7 already keeps only landmarks — so a thread above FOLD_ABOVE nodes
// draws one card per FILE instead, carrying how many steps and boundary
// calls it holds, with the thread's cross-file edges merged into one edge
// per file pair. Zoom back in (or click a card) and the steps return; with
// react-flow drawing only what is on screen, only the steps in view mount.
//
// The cards get their OWN compact layout: one column per file DEPTH (a
// directed breadth-first walk from the seed file over cross-file edges;
// files it never reaches go in a last column), stacked by step count. The
// first cut placed each card at the centre of its steps, and on the largest
// thread that layout is so long that at z 0.22 exactly one card was on
// screen — a fold that shows one file is not an overview.
//
// Pure.

export const FOLD_ABOVE = 400;
/** the fold layout's grid: a card is 560 x 150 (ThreadFileCard). */
export const FOLD_COL = 900;
export const FOLD_ROW = 210;

export interface FoldInputNode { id: string; kind: string; file: string | null }
export interface FoldInputEdge { from: string; to: string; kind?: string }
export interface FileCard {
  id: string;            // `file:<path>`
  file: string;
  steps: number;         // nodes that live in the file
  boundaries: number;    // terminals (no file) reached from it
  members: string[];     // every node id folded into the card
  x: number; y: number;  // top-left of the card in the fold layout
  depth: number;         // file hops from the seed file
  seed: boolean;         // the file the thread starts in
}
export interface FileEdge { id: string; from: string; to: string; count: number }

export function foldByFile(
  nodes: FoldInputNode[], edges: FoldInputEdge[],
  positions: Map<string, { x: number; y: number }>, seedFile: string | null,
): { cards: FileCard[]; edges: FileEdge[] } {
  const fileOf = new Map<string, string>();
  for (const n of nodes) if (n.file) fileOf.set(n.id, n.file);
  // A terminal has no file: it belongs to the file that calls it.
  for (const e of edges) {
    if (fileOf.has(e.to) || !fileOf.has(e.from)) continue;
    fileOf.set(e.to, fileOf.get(e.from)!);
  }
  const byFile = new Map<string, FileCard>();
  for (const n of nodes) {
    const f = fileOf.get(n.id);
    const p = positions.get(n.id);
    if (!f || !p) continue;
    let c = byFile.get(f);
    if (!c) { c = { id: `file:${f}`, file: f, steps: 0, boundaries: 0, members: [], x: 0, y: 0, depth: 0, seed: f === seedFile }; byFile.set(f, c); }
    c.members.push(n.id);
    if (n.file) c.steps++; else c.boundaries++;
  }
  // Directed file adjacency, then depth from the seed file.
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.kind === "contains") continue;
    const a = fileOf.get(e.from), b = fileOf.get(e.to);
    if (!a || !b || a === b) continue;
    adj.set(a, (adj.get(a) ?? new Set()).add(b));
  }
  const depth = new Map<string, number>();
  if (seedFile && byFile.has(seedFile)) {
    depth.set(seedFile, 0);
    const q = [seedFile];
    while (q.length) {
      const f = q.shift()!;
      for (const g of [...(adj.get(f) ?? [])].sort()) if (!depth.has(g)) { depth.set(g, depth.get(f)! + 1); q.push(g); }
    }
  }
  const lastCol = Math.max(0, ...depth.values()) + 1;
  const columns = new Map<number, FileCard[]>();
  for (const c of byFile.values()) {
    c.depth = depth.get(c.file) ?? lastCol;
    columns.set(c.depth, [...(columns.get(c.depth) ?? []), c]);
  }
  for (const [d, list] of columns) {
    list.sort((a, b) => b.members.length - a.members.length || a.file.localeCompare(b.file));
    list.forEach((c, row) => { c.x = d * FOLD_COL; c.y = row * FOLD_ROW; });
  }
  const cards = [...byFile.values()].sort((a, b) => a.depth - b.depth || a.y - b.y);
  const counts = new Map<string, FileEdge>();
  for (const e of edges) {
    if (e.kind === "contains") continue;
    const a = fileOf.get(e.from), b = fileOf.get(e.to);
    if (!a || !b || a === b || !byFile.has(a) || !byFile.has(b)) continue;
    const id = `file:${a}->file:${b}`;
    const cur = counts.get(id);
    if (cur) cur.count++; else counts.set(id, { id, from: `file:${a}`, to: `file:${b}`, count: 1 });
  }
  return { cards, edges: [...counts.values()] };
}
