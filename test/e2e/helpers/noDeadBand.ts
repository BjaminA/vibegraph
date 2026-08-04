// Shared cross-view layout assertion: rendered nodes along the main axis must
// have NO dead band — no gap between consecutive nodes that dwarfs the typical
// inter-node spacing. Catches the "collapsed/hidden steps leave a void"
// regression (thread §A) and the file-view "dead space after junctions" class.
// One mechanism, used by thread AND file-view specs.

export interface Box { x: number; y: number; width: number; height: number }

export function deadBandReport(boxes: Box[], axis: "x" | "y"): { maxGap: number; median: number; count: number } {
  const size = axis === "x" ? "width" : ("height" as const);
  const sorted = [...boxes].sort((a, b) => a[axis] - b[axis]);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(Math.max(0, sorted[i][axis] - (sorted[i - 1][axis] + sorted[i - 1][size])));
  }
  if (gaps.length === 0) return { maxGap: 0, median: 0, count: boxes.length };
  const ordered = [...gaps].sort((a, b) => a - b);
  const median = ordered[Math.floor(ordered.length / 2)];
  return { maxGap: Math.max(...gaps), median, count: boxes.length };
}
