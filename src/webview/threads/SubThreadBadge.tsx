// Thread hierarchy (2026-09-29) — the badge on a step that IS another entry
// point's head: the thread it starts is a sub-tree of this one. Bottom-left,
// opposite the remit badge; the same vg-open-thread the crossing hops use.

import React from "react";
import { CornerDownRight } from "lucide-react";

export function SubThreadBadge({ entryPointId, name }: { entryPointId: string; name: string }) {
  const open = () => document.dispatchEvent(new CustomEvent("vg-open-thread", { detail: { entryPointId } }));
  return (
    <div
      className="vg-thread-subthread-badge"
      data-subthread-badge={entryPointId}
      role="button"
      tabIndex={0}
      title={`Starts the thread ${name} — open it`}
      onClick={(e) => { e.stopPropagation(); open(); }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        open();
      }}
      style={{
        position: "absolute",
        bottom: -10,
        left: 8,
        display: "flex",
        alignItems: "center",
        gap: 3,
        padding: "1px 6px",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontFamily: "var(--font-ui)",
        color: "var(--accent-thread)",
        background: "color-mix(in oklab, var(--accent-thread) 18%, var(--bg-canvas))",
        border: "1px solid color-mix(in oklab, var(--accent-thread) 55%, transparent)",
        borderRadius: 4,
        lineHeight: 1.35,
        cursor: "pointer",
      }}
    >
      <CornerDownRight size={11} strokeWidth={1.8} />
      sub-thread
    </div>
  );
}
