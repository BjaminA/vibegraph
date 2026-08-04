// Dynamic-README badge (M20.2, PLAN-v5 §2). A small chip surfacing the
// active thread's README state — none / fresh / stale / generating —
// with a generate/refresh affordance. Regeneration is on-request only
// (§2.2); staleness is reported by the server (stored hash vs current IR).
// Bound to tokens.css; lucide only.

import React from "react";
import { BookText, RotateCw, AlertTriangle, Loader2 } from "lucide-react";

export interface ReadmeStatus {
  exists: boolean;
  stale?: boolean;
  body?: string;
  generatedAt?: string;
  error?: string;
  generating?: boolean;
}

interface Props {
  status: ReadmeStatus | null;
  onRefresh: () => void;
  /** Open the README in a readable panel. Without this the body was only
   *  ever a native `title` tooltip — truncated, unscrollable, uncopyable. */
  onOpen?: () => void;
}

export function ReadmeBadge({ status, onRefresh, onOpen }: Props) {
  if (!status) return null;

  const state = status.generating ? "generating"
    : status.error ? "error"
    : !status.exists ? "none"
    : status.stale ? "stale"
    : "fresh";

  const accent = state === "stale" || state === "error" ? "var(--accent-warning)"
    : state === "fresh" ? "var(--accent-thread)"
    : "var(--text-muted)";

  const label = {
    generating: "Generating README…",
    error: "README failed",
    none: "No README",
    stale: "README · stale",
    fresh: "README",
  }[state];

  const Icon = state === "generating" ? Loader2
    : state === "stale" || state === "error" ? AlertTriangle
    : BookText;

  return (
    <div
      data-readme-badge
      data-readme-state={state}
      onClick={onOpen}
      role={onOpen ? "button" : undefined}
      // The body is no longer crammed into `title` — the chip says what state
      // the document is in, and the panel is where you read it.
      title={onOpen ? "Open the README" : undefined}
      style={{
        // Position + stacking belong to ChipStrip (see ChipStrip.tsx) — this
        // is a flow child of that column, first row.
        pointerEvents: "auto",
        cursor: onOpen ? "pointer" : "default",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "color-mix(in oklab, var(--bg-node) 90%, transparent)",
        border: `1px solid color-mix(in oklab, ${accent} 40%, transparent)`,
        borderRadius: 16,
        padding: "4px 10px",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-11)",
        color: accent,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      {/* Static icon — no spinner (the aesthetic forbids infinite loops). */}
      <Icon size={14} strokeWidth={1.5} />
      <span>{label}</span>
      {state !== "generating" && (
        <button
          data-readme-refresh
          onClick={onRefresh}
          title={state === "none" ? "Generate a README for this thread" : "Refresh this README"}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "none", border: "none", cursor: "pointer",
            color: "var(--accent-thread)", padding: 0,
            fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)",
          }}
        >
          <RotateCw size={12} strokeWidth={1.5} />
          {state === "none" ? "Generate" : "Refresh"}
        </button>
      )}
    </div>
  );
}
