// The remit badge (2026-09-25): what a node is hiding at the current rank
// level — "+12" on the card, the categories in the title, a click to show
// them in place. An opened remit keeps the badge so it can be closed again.
// Bottom-right, below the M-NEST badge's top-right slot; teal like it, because
// a remit is navigation, not severity.

import React from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";

export function RemitBadge({ nodeId, count, text, open }: {
  nodeId: string; count?: number; text?: string; open?: boolean;
}) {
  if (!open && !count) return null;
  return (
    <div
      className="vg-thread-remit-badge"
      data-remit-badge
      data-remit-open={open ? "true" : "false"}
      data-remit-count={count ?? 0}
      role="button"
      tabIndex={0}
      title={open ? "Hide what this node owns again" : `${text ?? `${count} hidden`} — click to show`}
      aria-label={open ? "Hide owned nodes" : text ?? `${count} hidden nodes`}
      onClick={(e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("vg-toggle-remit", { detail: { nodeId } }));
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("vg-toggle-remit", { detail: { nodeId } }));
      }}
      style={{
        position: "absolute",
        bottom: -10,
        right: 8,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 4px",
        fontSize: "var(--fs-11)",
        fontWeight: 600,
        fontFamily: "var(--font-ui)",
        color: "var(--accent-thread)",
        background: "color-mix(in oklab, var(--accent-thread) 18%, var(--bg-canvas))",
        border: "1px solid color-mix(in oklab, var(--accent-thread) 55%, transparent)",
        borderRadius: 4,
        lineHeight: 1.35,
        cursor: "pointer",
      }}
    >
      {open
        ? <ChevronsDownUp size={12} strokeWidth={1.5} />
        : <ChevronsUpDown size={12} strokeWidth={1.5} />}
      {open ? "hide" : `+${count}`}
    </div>
  );
}
