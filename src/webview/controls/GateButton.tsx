// Sitting-2 — the shared gate-decision button. Every ratification gate
// (architecture bar, proposal bar, roadmap, changeset) had its own inline
// button object and NONE of them responded to a click: the UI sat frozen
// until the server round-tripped. This is the ChangesetGate `modifying`
// treatment (Loader2 vg-spin + disabled + opacity/cursor swap) extracted
// into the one place all gates share, plus an :active press cue
// (.vg-gate-btn in motion.css).
//
// Pending has two drivers:
//   - `pending` prop — the parent tracks the in-flight work (e.g. roadmap
//     drafting);
//   - `armOnClick` — the button arms its own pending on click and stays
//     armed until `resetKey` changes or the gate unmounts. Right for
//     accept/consent buttons whose gate disappears when the server answers.
//
// Aesthetic: tokens.css accents only, lucide only, no new hues.

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

type Accent = "thread" | "error" | "warning" | "chat" | "neutral";

const ACCENT_VAR: Record<Exclude<Accent, "neutral">, string> = {
  thread: "var(--accent-thread)",
  error: "var(--accent-error)",
  warning: "var(--accent-warning)",
  chat: "var(--accent-chat)",
};

export interface GateButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  accent?: Accent;
  /** color-mixed background (a gate's primary action); outline otherwise */
  filled?: boolean;
  /** externally-tracked in-flight state */
  pending?: boolean;
  /** label swap while pending (defaults to children) */
  pendingLabel?: React.ReactNode;
  /** arm pending on click, until resetKey changes or the gate unmounts */
  armOnClick?: boolean;
  resetKey?: unknown;
}

export function GateButton({
  accent = "neutral", filled = false, pending, pendingLabel,
  armOnClick = false, resetKey, onClick, disabled, style, className, children, ...rest
}: GateButtonProps) {
  const [fired, setFired] = useState(false);
  useEffect(() => { setFired(false); }, [resetKey]);
  const isPending = !!pending || (armOnClick && fired);
  const color = accent === "neutral" ? "var(--text-muted)" : ACCENT_VAR[accent];
  const off = disabled || isPending;
  return (
    <button
      {...rest}
      disabled={off}
      data-pending={isPending ? "true" : undefined}
      onClick={(e) => {
        if (armOnClick) setFired(true);
        onClick?.(e);
      }}
      className={`vg-gate-btn${className ? ` ${className}` : ""}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        background: filled ? `color-mix(in oklab, ${color} 16%, transparent)` : "none",
        border: `1px solid ${accent === "neutral"
          ? "var(--border-edge)"
          : `color-mix(in oklab, ${color} 45%, transparent)`}`,
        borderRadius: 5, color, fontSize: "var(--fs-11)", fontWeight: 700,
        padding: "5px 12px", fontFamily: "var(--font-mono)",
        cursor: off ? (isPending ? "wait" : "not-allowed") : "pointer",
        opacity: off && !isPending ? 0.5 : 1,
        ...style,
      }}
    >
      {isPending && <Loader2 size={14} strokeWidth={1.5} className="vg-spin" />}
      {isPending && pendingLabel != null ? pendingLabel : children}
    </button>
  );
}
