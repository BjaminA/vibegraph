// Claude-Code-missing banner.
//
// Pulled out of App.tsx to keep that file under the 500-line cap. Pure
// presentational; parent owns the dismiss state. Shown only when the
// server reports the Claude CLI is not on PATH (Analyze, the editor's
// Intent mode and README generation would otherwise silently fail).
// M7 wave 2 retargeted this from the "ANTHROPIC_API_KEY missing"
// message; M10-chat-removal dropped Chat from the list.

import React from "react";
import { AlertCircle, X } from "lucide-react";

interface Props {
  show: boolean;
  onDismiss: () => void;
}

export function KeyBanner({ show, onDismiss }: Props) {
  if (!show) return null;
  return (
    <div data-key-banner style={{
      // Below the 48px TopToolbar band (z 1010 > this 870): centered at
      // top:10 the toolbar row overlapped the banner at common widths and
      // its dismiss X became unclickable.
      position: "fixed", top: 56, left: "50%", transform: "translateX(-50%)",
      zIndex: 870, display: "flex", alignItems: "center", gap: 8,
      background: "color-mix(in oklab, var(--accent-warning) 12%, var(--bg-node))",
      border: "1px solid color-mix(in oklab, var(--accent-warning) 40%, transparent)",
      borderRadius: 6, padding: "5px 10px 5px 12px",
      fontSize: "var(--fs-11)", fontFamily: "var(--font-mono)",
      color: "var(--accent-warning)", boxShadow: "var(--shadow-control)",
    }}>
      <AlertCircle size={14} strokeWidth={1.5} />
      <span>Chat, Analyze &amp; Intent disabled — <code>claude</code> CLI not on PATH (install Claude Code)</span>
      <button onClick={onDismiss} title="Dismiss"
        style={{ background: "none", border: "none", color: "var(--accent-warning)",
          cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
