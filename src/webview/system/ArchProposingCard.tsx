// The architecture PROPOSAL's working state (2026-09-25, Ben: "an animation
// while proposing groups, removed once it has been proposed"). A proposal is
// one thinking-tier spawn that took 78 s on a private production codebase; before this the only
// sign of it was the button reading "Proposing…".
//
// Two carriers, both mounted only while a model is drafting and gone the
// moment the reply (or an error) arrives — the M-GF3.2 working-state
// exception to "no infinite loops", bounded by the real round trip:
//   * this card, under the proposal bar, in the drafting ghost language
//     (marching dashes on its border, the glow breathe), saying what the
//     model is reading and counting the seconds;
//   * the map's process cards breathe in the proposed accent, staggered, so
//     the reader sees WHAT is being grouped (motion.css, vg-arch-proposing).
// Nothing drawn here is a group: the model has not answered yet, and a
// placeholder box would be a claim.

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ArchModelRecord } from "../../shared/protocol";

export function ArchProposingCard({ working, model }: { working: "propose" | "revise"; model: ArchModelRecord | null }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const processes = model?.nodes.filter((n) => n.kind === "cluster" || n.kind === "hub").length ?? 0;
  const tools = model?.nodes.filter((n) => n.kind === "tool").length ?? 0;
  return (
    <div
      data-arch-proposing-card={working}
      className="vg-drafting-card"
      role="status"
      aria-live="polite"
      style={{
        position: "absolute", top: "max(176px, calc(var(--vg-toolbar-bottom, 43px) + 100px))", left: 250, zIndex: 30,
        width: 360, background: "var(--bg-node)", borderRadius: 12, padding: "12px 16px",
        display: "flex", flexDirection: "column", gap: 4, pointerEvents: "none",
      }}
    >
      <svg aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
        <rect x="1" y="1" rx="11" className="vg-drafting-ants" style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }} />
      </svg>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Loader2 size={16} strokeWidth={1.5} className="vg-spin" color="var(--accent-thread)" />
        <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text-primary)" }}>
          {working === "revise" ? "Revising the proposal…" : "Proposing groups…"}
        </span>
        <span data-arch-proposing-elapsed style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
          {seconds} s
        </span>
      </div>
      <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
        {`A model is reading ${processes} processes and ${tools} tools, the deployment manifests and the docs. Every group must cite a line it was shown.`}
      </span>
      <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
        Nothing applies until you ratify.
      </span>
    </div>
  );
}
