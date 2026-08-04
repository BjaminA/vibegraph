// Floating chat toggle button (M5 wave 2 extraction; parked by
// M10-chat-removal, revived in M25 with the chat panel).
//
// Lifted from App.tsx to keep that file under the 500-line cap. Pure
// presentational: parent owns state and click handlers. The chat
// button shifts up when the chat panel slides open. (The compose
// `+` toggle was removed pre-M12 — Add-component is the toolbar
// path going forward; ComposePalette.tsx is currently orphan code
// pending M12 Merge B's decision on whether to absorb its templates.)

import React from "react";
import { X, Sparkles } from "lucide-react";

interface ToggleProps {
  open: boolean;
  onToggle: () => void;
  // visual + positioning
  accentVar: string;
  side: "left" | "right";
  shiftUp: boolean;       // chat-open: lift the button up so the panel
                          //  doesn't cover it
  shiftRight?: boolean;    // compose-open: shift the compose button
                          //  off the panel's footprint
  // M25 — right-side docks (editor / CodeView) land exactly on the
  // toggle's corner; the parent passes a CSS inset that clears them.
  rightInset?: number | string;
  titleClosed: string;
  titleOpen: string;
  iconClosed: React.ReactNode;
  iconOpen: React.ReactNode;
}

function FloatingToggle({
  open, onToggle, accentVar, side, shiftUp, shiftRight, rightInset,
  titleClosed, titleOpen, iconClosed, iconOpen,
}: ToggleProps) {
  const sideStyle: React.CSSProperties = side === "left"
    ? { left: shiftRight ? 248 : 20 }
    : { right: rightInset ?? 20 };
  return (
    <button
      onClick={onToggle}
      title={open ? titleOpen : titleClosed}
      style={{
        position: "fixed",
        // Chat-open: sit just above the bar's REAL height (user-resizable,
        // published by ChatPanel as --vg-chat-height).
        bottom: shiftUp ? "calc(var(--vg-chat-height, 320px) + 8px)" : 20,
        ...sideStyle,
        // Sitting-2 — above the bottom-left panels (roadmap 990) so the chat
        // toggle is never buried at narrow widths; still under true modals
        // (RoadmapOverviewDialog 1150), which legitimately cover everything.
        zIndex: 1020,
        background: `color-mix(in oklab, ${accentVar} ${open ? 20 : 10}%, transparent)`,
        border: `1px solid color-mix(in oklab, ${accentVar} ${open ? 50 : 30}%, transparent)`,
        borderRadius: 8,
        color: accentVar,
        width: 42, height: 42,
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "var(--shadow-control)",
        transition: "left 0.18s ease, right 0.18s ease, bottom 0.18s ease, background 0.12s",
      }}
    >
      {open ? iconOpen : iconClosed}
    </button>
  );
}

interface Props {
  chatOpen: boolean;
  onToggleChat: () => void;
  chatContextLabel: string | null;
  rightInset?: number | string;
}

export function FloatingToggles({
  chatOpen, onToggleChat, chatContextLabel, rightInset,
}: Props) {
  return (
    <FloatingToggle
      open={chatOpen}
      onToggle={onToggleChat}
      accentVar="var(--accent-chat)"
      side="right"
      rightInset={rightInset}
      shiftUp={chatOpen}
      titleClosed={`Open Claude chat${chatContextLabel ? ` · ${chatContextLabel}` : ""}`}
      titleOpen="Close chat"
      iconClosed={<Sparkles size={20} strokeWidth={1.5} />}
      iconOpen={<X size={20} strokeWidth={1.5} />}
    />
  );
}
