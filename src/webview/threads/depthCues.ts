// M9.3 — cross-file depth cues for the thread view.
//
// Three primitives, all 2D, all driven from this single computation:
//
//   1. fileDepth: BFS from the seed file over cross-file hops in the
//      thread graph. The seed file is depth 0; each cross-file edge
//      bumps depth by 1; capped at MAX_FILE_DEPTH. Drives the diagonal
//      flow offset (useThreadLayout) and the cross-depth edge weight
//      (ThreadEdge).
//
//   2. fileHueIndex: each unique file in the thread is assigned an
//      index in 0..HUE_COUNT-1. The seed file is always index 0 (so
//      it inherits the teal --accent-thread hue). Other files get
//      indices in BFS-discovery order, modulo HUE_COUNT. Drives the
//      per-file colour wash on node backdrops and same-file edges.
//
//   3. (derived) cross-depth detection on edges — happens at edge-
//      build time in ThreadView using fileDepth.
//
// Pure function over Thread → FileGroups. No DOM, no React, no state.
// One pass over thread.nodes + one BFS over thread.edges.

import type { Thread } from "./types";

export const MAX_FILE_DEPTH = 4;
export const HUE_COUNT = 8;

export interface FileGroups {
  // file → BFS depth from the seed file (cross-file hops). 0 for seed.
  // Files that never appear in thread.nodes / thread.edges are not
  // present; consumers should treat absent as "same as seed" or skip.
  fileDepth: Map<string, number>;
  // file → 0..HUE_COUNT-1. Seed file always 0. Others assigned in
  // BFS-discovery order, modulo HUE_COUNT.
  fileHueIndex: Map<string, number>;
}

export function computeFileGroups(thread: Thread): FileGroups {
  const seedFile = thread.seed.file;
  const fileDepth = new Map<string, number>([[seedFile, 0]]);
  const fileHueIndex = new Map<string, number>([[seedFile, 0]]);

  // Build a file-level adjacency: file → set of files reachable in
  // one cross-file thread edge. Terminals (file=null on external /
  // dynamic) are excluded — they're library boundaries, not project
  // file boundaries, and they shouldn't propagate file depth.
  const nodeFile = new Map<string, string | null>();
  for (const n of thread.nodes) nodeFile.set(n.id, n.file);

  const fileAdj = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    let set = fileAdj.get(a);
    if (!set) { set = new Set(); fileAdj.set(a, set); }
    set.add(b);
  };
  for (const e of thread.edges) {
    const fa = nodeFile.get(e.from);
    const fb = nodeFile.get(e.to);
    if (!fa || !fb || fa === fb) continue;
    addEdge(fa, fb);
    addEdge(fb, fa); // undirected file proximity — both endpoints reach each other
  }

  // BFS from the seed file. Depth caps at MAX_FILE_DEPTH so deep
  // call chains don't push every leaf node 32px off-axis.
  const queue: string[] = [seedFile];
  let hueCursor = 1;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curDepth = fileDepth.get(cur)!;
    const neighbours = fileAdj.get(cur);
    if (!neighbours) continue;
    const nextDepth = Math.min(curDepth + 1, MAX_FILE_DEPTH);
    for (const next of neighbours) {
      if (fileDepth.has(next)) continue;
      fileDepth.set(next, nextDepth);
      fileHueIndex.set(next, hueCursor % HUE_COUNT);
      hueCursor += 1;
      queue.push(next);
    }
  }

  // Any thread.nodes whose file never landed in the BFS (orphan
  // files reachable only by an irSource we couldn't resolve, etc.)
  // pick up the next hue and the cap depth so they still render
  // with a sensible grouping cue.
  for (const n of thread.nodes) {
    if (!n.file || fileDepth.has(n.file)) continue;
    fileDepth.set(n.file, MAX_FILE_DEPTH);
    fileHueIndex.set(n.file, hueCursor % HUE_COUNT);
    hueCursor += 1;
  }

  return { fileDepth, fileHueIndex };
}
