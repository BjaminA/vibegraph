// The rank level switch (2026-09-25): Primary | + Secondary | All. A
// segmented control in the canvas chrome, beside the nests toggle; it shows
// how many nodes the current level draws out of the thread's total, so a
// reader always knows how much is folded away.

import React from "react";
import type { Rank } from "../../shared/thread_rank";
import { RANK_LEVELS } from "./useThreadRanks";

export function RankControl({ level, onLevel, shown, total, top }: {
  level: Rank; onLevel: (l: Rank) => void; shown: number; total: number; top: string | number;
}) {
  return (
    <div
      data-thread-rank-control
      data-level={level}
      role="radiogroup"
      aria-label="Which nodes the thread draws"
      style={{
        position: "absolute",
        top,
        left: 12,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "color-mix(in oklab, var(--bg-node) 90%, transparent)",
        border: "1px solid var(--border-edge)",
        borderRadius: 8,
        padding: 4,
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-11)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      {RANK_LEVELS.map((r) => {
        const on = r.level === level;
        return (
          <button
            key={r.level}
            role="radio"
            aria-checked={on}
            data-rank-level={r.level}
            title={r.title}
            onClick={() => onLevel(r.level)}
            style={{
              border: "none",
              borderRadius: 4,
              padding: "4px 8px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "inherit",
              color: on ? "var(--accent-thread)" : "var(--text-secondary)",
              background: on ? "color-mix(in oklab, var(--accent-thread) 16%, transparent)" : "transparent",
            }}
          >
            {r.label}
          </button>
        );
      })}
      <span data-rank-count style={{ color: "var(--text-muted)", padding: "0 8px 0 4px" }}>
        {shown} of {total}
      </span>
    </div>
  );
}
