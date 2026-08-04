// M-GF3.2 — the drafting placeholder: mounted in the system view while
// `claude -p` drafts an architecture from a describe submit. Speaks the
// --proposed-* ghost language, but ANIMATED: marching dashes on an SVG
// border (the plan literally being drawn) plus the glow breathe, with the
// --accent-chat spinner saying who is working. Unmounts when the proposal
// (or error) arrives — the loops are bounded by the round-trip, the
// motion.css tokenised exception.

import React from "react";
import { Loader2 } from "lucide-react";

export function DraftingGhostCard({ description }: { description: string }) {
  return (
    <div
      data-drafting-ghost
      className="vg-drafting-card"
      style={{
        position: "relative", minWidth: 260, maxWidth: 340,
        background: "var(--bg-node)", borderRadius: 14, padding: "16px 20px",
        opacity: "var(--proposed-opacity)",
        display: "flex", flexDirection: "column", gap: 8,
      }}
    >
      {/* The border is an SVG rect so the dashes can march. */}
      <svg
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      >
        <rect
          x="1" y="1" rx="13"
          className="vg-drafting-ants"
          style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }}
        />
      </svg>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Loader2 size={16} strokeWidth={1.5} className="vg-spin" color="var(--accent-chat)" />
        <span
          style={{
            fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", fontWeight: 700,
            color: "var(--text-primary)",
          }}
        >
          Drafting architecture…
        </span>
      </div>
      <div
        style={{
          fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)",
          color: "var(--text-muted)", lineHeight: 1.5,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        “{description}”
      </div>
    </div>
  );
}
