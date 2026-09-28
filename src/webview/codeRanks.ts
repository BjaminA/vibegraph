// Thread ranks in the CODE view (2026-09-28). The same primary / secondary /
// tertiary the thread view draws, marked beside the source: a bar in the
// line-decoration gutter per ranked line, and a hover that says what the line
// is and how many threads reach it. Reading a file, the lines that leave the
// project stand out from the local work around them.
//
// Computed here, never stamped into the IR: a rank is derived from
// attribution, and attribution stays out of the parser and the IR
// (M-BOUNDARY's refusal). One ranking — src/shared/thread_rank.ts, through
// `threadFacts`, the thread view's own facts — so the two views agree.

import { useMemo } from "react";
import { rankByLocation, categoryWord, type Rank, type RankThread } from "../shared/thread_rank";
import { threadFacts } from "./threads/useThreadRanks";
import type { ProjectFileData, ProjectThread, StackIndexRecord, CrossingIndexRecord } from "../shared/protocol";

export interface RankedLine {
  line: number;
  rank: Rank;
  /** hover text: the rank, what the line is, how many threads reach it. */
  text: string;
}

const RANK_WORD: Record<Rank, string> = { 1: "primary", 2: "secondary", 3: "tertiary" };

/** One entry per source line that some thread reaches — its BEST rank. */
export function useCodeRanks(
  filePath: string | null,
  astNodes: ReadonlyArray<{ id: string; line?: number | null }>,
  threads: ReadonlyArray<ProjectThread> | undefined,
  projectIR: Record<string, ProjectFileData> | null | undefined,
  stack: StackIndexRecord | null | undefined,
  crossings: CrossingIndexRecord | null | undefined,
  enabled: boolean,
): RankedLine[] {
  // Only the threads that walk through this file — every other one cannot
  // put a rank on its lines, and ranking 363 threads per file open is waste.
  const touching = useMemo(
    () => (!enabled || !filePath || !threads)
      ? []
      : threads.filter((t) => (t.nodes as Array<{ file?: string | null }>).some((n) => n.file === filePath)),
    [enabled, filePath, threads],
  );
  const byLocation = useMemo(
    () => rankByLocation(
      touching as unknown as RankThread[],
      (t) => threadFacts(t as never, projectIR ?? null, stack ?? null, crossings ?? null),
    ),
    [touching, projectIR, stack, crossings],
  );
  return useMemo(() => {
    if (!filePath || !byLocation.size) return [];
    const best = new Map<number, { rank: Rank; parts: Map<string, number>; threads: number }>();
    for (const n of astNodes) {
      if (n.line == null) continue;
      const r = byLocation.get(`${filePath}|${n.id}`);
      if (!r) continue;
      const cur = best.get(n.line) ?? { rank: 3 as Rank, parts: new Map(), threads: 0 };
      if (!best.has(n.line) || r.rank < cur.rank) cur.rank = r.rank;
      const w = categoryWord(r.category);
      cur.parts.set(w, (cur.parts.get(w) ?? 0) + 1);
      cur.threads = Math.max(cur.threads, r.threads);
      best.set(n.line, cur);
    }
    return [...best].sort((a, b) => a[0] - b[0]).map(([line, v]) => ({
      line,
      rank: v.rank,
      text: `**${RANK_WORD[v.rank]}** · ${[...v.parts].map(([w, c]) => (c > 1 ? `${w} ×${c}` : w)).join(", ")}`
        + ` — reached by ${v.threads} thread${v.threads === 1 ? "" : "s"}`,
    }));
  }, [filePath, astNodes, byLocation]);
}

/** Monaco decorations for the ranked lines (whole-line, gutter class). */
export function rankDecorations(
  monaco: { Range: new (a: number, b: number, c: number, d: number) => unknown },
  lines: RankedLine[],
): Array<{ range: unknown; options: Record<string, unknown> }> {
  return lines.map((l) => ({
    range: new monaco.Range(l.line, 1, l.line, 1),
    options: {
      isWholeLine: true,
      linesDecorationsClassName: `vg-rank-gutter vg-rank-gutter-${l.rank}`,
      hoverMessage: { value: l.text },
    },
  }));
}
