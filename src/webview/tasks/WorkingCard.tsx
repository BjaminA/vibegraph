// A model at work, shown the same way wherever it runs (2026-10-21, Ben: "need
// modular animation when claude is working in GUI with briefing or proposing
// groups, should glow and animate the loading text, with updates if possible
// on what its doing"). The drafting language ArchProposingCard introduced
// (marching dashes on the border, the glow breathe) plus a shimmer on the
// title, the time it has run, and what it is doing now: the steps the server
// reports (src/server/gui_tasks.ts, llm_stream.ts). Mounted only while a task
// runs: the loops end when it does, the M-GF3.2 working-state exception to
// "no infinite loops". Reduced motion: still, the glow held.

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { GuiTaskStep } from "./guiTasks";

const elapsed = (from: number, now: number) => {
  const s = Math.max(0, Math.round((now - from) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function WorkingCard({ title, startedAt, steps = [], note, compact, onClick, style, ...data }: {
  title: string;
  /** ISO time the work began (the server's), or now when absent */
  startedAt?: string;
  steps?: GuiTaskStep[];
  note?: string;
  /** the bubble's size: the title, the time and the current step only */
  compact?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  [k: `data-${string}`]: string | undefined;
}) {
  const [from] = useState(() => (startedAt ? Date.parse(startedAt) : Date.now()));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  const current = steps[steps.length - 1];
  const before = compact ? [] : steps.slice(-4, -1);
  return (
    <div
      {...data}
      data-working
      className="vg-drafting-card vg-working"
      role="status"
      aria-live="polite"
      onClick={onClick}
      style={{
        position: "relative", background: "var(--bg-node)", borderRadius: 12, padding: compact ? "8px 12px" : "12px 16px",
        display: "flex", flexDirection: "column", gap: 4, cursor: onClick ? "pointer" : "default", ...style,
      }}
    >
      <svg aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
        <rect x="1" y="1" rx="11" className="vg-drafting-ants" style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }} />
      </svg>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Loader2 size={16} strokeWidth={1.5} className="vg-spin" color="var(--accent-chat)" style={{ flex: "0 0 auto" }} />
        <span data-working-title className="vg-working-text" style={{ fontFamily: "var(--font-ui)", fontSize: compact ? "var(--fs-12)" : "var(--fs-13)", fontWeight: 600 }}>
          {title}
        </span>
        <span data-working-elapsed style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
          {elapsed(from, now)}
        </span>
      </div>
      {before.map((s, i) => (
        <span key={`${s.at}${i}`} data-working-step-done style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 }}>{s.text}</span>
      ))}
      {current && (
        <span data-working-step style={{ fontFamily: "var(--font-ui)", fontSize: compact ? "var(--fs-11)" : "var(--fs-12)", color: "var(--text-secondary)", lineHeight: 1.5, overflowWrap: "anywhere" }}>
          {current.text}
        </span>
      )}
      {note && !compact && <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-muted)", lineHeight: 1.5 }}>{note}</span>}
    </div>
  );
}
