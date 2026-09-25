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
    <div data-key-banner title="Chat, Analyze & Intent are disabled: the claude CLI is not on PATH (install Claude Code)" style={{
      // A compact chip INSIDE the toolbar (TopToolbar \`notices\`), not a
      // floating banner: centred under the toolbar it covered each view's own
      // controls (the System view's Subsystems / Architecture toggles, the
      // lens bar, the thread view's nests toggle). The full text is the title.
      display: "flex", alignItems: "center", gap: 6,
      background: "color-mix(in oklab, var(--accent-warning) 12%, var(--bg-node))",
      border: "1px solid color-mix(in oklab, var(--accent-warning) 40%, transparent)",
      borderRadius: 6, padding: "4px 8px",
      fontSize: "var(--fs-11)", fontFamily: "var(--font-mono)",
      color: "var(--accent-warning)", whiteSpace: "nowrap", maxWidth: 160,
    }}>
      <AlertCircle size={14} strokeWidth={1.5} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>no claude</span>
      <button onClick={onDismiss} title="Dismiss"
        style={{ background: "none", border: "none", color: "var(--accent-warning)",
          cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
