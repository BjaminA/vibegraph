// The setup guide's few styles (SetupGuide.tsx, SetupRun.tsx): one button, one
// tag, one quiet line, bound to the tokens.

import type React from "react";

export const ico = { size: 16, strokeWidth: 1.5 } as const;

export const quiet: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", color: "var(--text-muted)", lineHeight: 1.5 };

export const btn = (primary = false): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, cursor: "pointer",
  fontFamily: "var(--font-ui)", fontSize: "var(--fs-13)", fontWeight: primary ? 600 : 400,
  border: `1px solid ${primary ? "var(--accent-thread)" : "var(--border-edge)"}`,
  background: primary ? "color-mix(in oklab, var(--accent-thread) 18%, var(--bg-node))" : "transparent",
  color: primary ? "var(--text-primary)" : "var(--text-secondary)",
});

export const tag = (accent: string): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 4, padding: "0 8px", borderRadius: 999, whiteSpace: "nowrap",
  border: `1px solid color-mix(in oklab, ${accent} 45%, transparent)`, color: accent,
  fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", lineHeight: 1.8,
});
