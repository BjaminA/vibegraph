// Thread ranks in the view (2026-09-25) — the level control, the per-node
// remit expansion, and the projection ThreadCanvas draws. The ranking itself
// is src/shared/thread_rank.ts, fed through `factsFrom`: the same attribution
// call the tooltip and the thread contract make.
//
// Level 1 draws the primary nodes, 2 adds secondary, 3 draws everything (the
// raw thread, byte-for-byte what the view drew before ranks existed). The
// first level comes from the server (VG_THREAD_RANK, a meta tag — the e2e
// suites pin "all", as they pin the start view), then the user's choice,
// remembered.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  rankThread, projectRanks, remitText,
  type Rank, type RankProjection, type Ranked, type RankNode, type NodeFacts,
} from "../../shared/thread_rank";
import { threadFacts as sharedThreadFacts } from "../../shared/thread_rank_facts";
import type { Thread } from "./types";
import type { ProjectFileData, StackIndexRecord, CrossingIndexRecord } from "../../shared/protocol";

const LEVEL_KEY = "vg-thread-rank-level";
const OPEN_KEY = "vg-thread-rank-open";

export const RANK_LEVELS: ReadonlyArray<{ level: Rank; label: string; title: string }> = [
  { level: 1, label: "Primary", title: "What the thread does: the boundaries it reaches and the path to them" },
  { level: 2, label: "+ Secondary", title: "Also the project helpers, guards, gaps and outputs" },
  { level: 3, label: "All", title: "Every node the static walk reached" },
];

function serverDefault(): Rank {
  const v = typeof document === "undefined"
    ? null
    : document.querySelector('meta[name="vg-thread-rank"]')?.getAttribute("content");
  return v === "all" ? 3 : v === "secondary" ? 2 : 1;
}

/** The level and the opened remits, persisted like the nest toggles. */
export function useRankState(): {
  level: Rank; setLevel: (l: Rank) => void;
  openRemits: Set<string>; toggleRemit: (id: string) => void;
} {
  const [level, setLevelState] = useState<Rank>(() => {
    try {
      const v = Number(localStorage.getItem(LEVEL_KEY));
      if (v === 1 || v === 2 || v === 3) return v;
    } catch { /* ignore */ }
    return serverDefault();
  });
  const [openRemits, setOpen] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || "[]")); } catch { return new Set(); }
  });
  const setLevel = useCallback((l: Rank) => {
    setLevelState(l);
    try { localStorage.setItem(LEVEL_KEY, String(l)); } catch { /* ignore */ }
  }, []);
  const toggleRemit = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(OPEN_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);
  // Badge clicks dispatch vg-toggle-remit — ThreadNode stays a dumb renderer
  // (the vg-toggle-nest pattern).
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<{ nodeId?: string }>).detail?.nodeId;
      if (id) toggleRemit(id);
    };
    window.addEventListener("vg-toggle-remit", on);
    return () => window.removeEventListener("vg-toggle-remit", on);
  }, [toggleRemit]);
  return { level, setLevel, openRemits, toggleRemit };
}

/** Per-node decoration the canvas copies onto a node's data. */
export interface RankDecoration {
  rank: Rank;
  foldLabel?: string;
  repeat?: number;
  remitCount?: number;
  remitText?: string;
  remitOpen?: boolean;
}

export interface RankedView {
  ranked: Ranked;
  projection: RankProjection;
  decorate: (id: string) => RankDecoration;
}

/** The facts one thread's terminals are ranked from — now shared
 *  (src/shared/thread_rank_facts.ts) so the server and the CLI rank a thread
 *  exactly as the thread view and the code view do. */
export function threadFacts(
  thread: Pick<Thread, "nodes" | "entryPointId">,
  projectIR: Record<string, ProjectFileData> | null,
  stack: StackIndexRecord | null,
  crossings: CrossingIndexRecord | null,
): (n: RankNode) => NodeFacts {
  return sharedThreadFacts(thread as never, projectIR as never, stack as never, crossings as never);
}

/** Rank the RAW thread (before nest collapse) and project it. */
export function useRankedView(
  thread: Thread,
  projectIR: Record<string, ProjectFileData> | null,
  stack: StackIndexRecord | null,
  crossings: CrossingIndexRecord | null,
  level: Rank,
  openRemits: ReadonlySet<string>,
): RankedView {
  const ranked = useMemo(
    () => rankThread(thread, threadFacts(thread, projectIR, stack, crossings)),
    [thread, projectIR, stack, crossings],
  );

  const projection = useMemo(
    () => projectRanks(thread, ranked, level, openRemits),
    [thread, ranked, level, openRemits],
  );

  const decorate = useCallback((id: string): RankDecoration => {
    const r = projection.remit.get(id);
    return {
      rank: ranked.rank.get(id) ?? 2,
      ...(projection.relabel.has(id) ? { foldLabel: projection.relabel.get(id) } : {}),
      ...(projection.repeat.has(id) ? { repeat: projection.repeat.get(id) } : {}),
      ...(r ? { remitCount: r.count, remitText: remitText(r) } : {}),
      ...(openRemits.has(id) ? { remitOpen: true } : {}),
    };
  }, [projection, ranked, openRemits]);

  // ONE object per change of inputs: ThreadCanvas keys its thread and node
  // memos on it, so a fresh literal per render re-laid the whole canvas on
  // every outer re-render (a tooltip hover) and a click could land mid-update.
  return useMemo(() => ({ ranked, projection, decorate }), [ranked, projection, decorate]);
}
