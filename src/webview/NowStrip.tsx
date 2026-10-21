// The "Now" block (2026-10-16): where the project stands and the one next
// step — the objective, what waits for you, stale Brief lines, open
// questions, the stated rules and the project's direction, each a click away
// from the panel that acts on it. Deterministic (src/server/now_state.ts);
// nothing here is a model's summary. It sits at the foot of the side panel:
// floated over the canvas it covered the controls every view keeps on its own
// bottom edge (the map's "start here" story, the topology trace, the zoom).

import React from "react";
import { Target, Inbox, FileWarning, CircleHelp, Scale, Compass, ArrowRight } from "lucide-react";
import type { NowPanel, NowState } from "../shared/now_wire";

const chip = (accent: string | null): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap",
  border: `1px solid ${accent ? `color-mix(in oklab, ${accent} 45%, transparent)` : "var(--border-edge)"}`,
  background: accent ? `color-mix(in oklab, ${accent} 12%, transparent)` : "transparent",
  color: accent ?? "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)",
});
const ico = { size: 16, strokeWidth: 1.5 } as const;

export function NowStrip({ now, onOpen }: { now: NowState; onOpen: (p: NowPanel) => void }) {
  const item = (key: string, show: boolean, accent: string | null, icon: React.ReactNode, text: string, panel: NowPanel | null) => show ? (
    <button key={key} data-now-item={key} style={chip(accent)} onClick={() => panel && onOpen(panel)} disabled={!panel} title={panel ? `Open the ${panel} panel` : "On the map: the Brief card"}>
      {icon}{text}
    </button>
  ) : null;
  return (
    <section data-now-strip aria-label="Where the project stands" className="vg-msg-enter" style={{
      borderTop: "1px solid var(--border-edge)", padding: 12, display: "flex", flexDirection: "column", gap: 8,
      background: "color-mix(in oklab, var(--bg-node) 60%, var(--bg-canvas))", fontFamily: "var(--font-ui)",
    }}>
      <div data-now-objective title={now.objective ?? "No objective stated"} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: "var(--fs-12)", color: now.objective ? "var(--text-primary)" : "var(--text-muted)" }}>
        <Target {...ico} style={{ flexShrink: 0 }} />
        <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{now.objective ?? "No objective stated yet"}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {item("waiting", now.waiting > 0, "var(--accent-warning)", <Inbox {...ico} />, `${now.waiting} waiting for you`, "inbox")}
        {item("brief", now.briefStale > 0, "var(--accent-warning)", <FileWarning {...ico} />, `${now.briefStale} stale Brief line${now.briefStale === 1 ? "" : "s"}`, null)}
        {item("questions", now.openQuestions > 0, null, <CircleHelp {...ico} />, `${now.openQuestions} open question${now.openQuestions === 1 ? "" : "s"}`, "plan")}
        {item("rules", true, null, <Scale {...ico} />, `${now.rules} rule${now.rules === 1 ? "" : "s"}`, "rules")}
        {item("direction", true, null, <Compass {...ico} />, now.direction.agreed || now.direction.proposed ? `direction ${now.direction.agreed}${now.direction.proposed ? ` · ${now.direction.proposed} proposed` : ""}` : "no direction yet", "direction")}
      </div>
      {/* 2026-10-20 — the setup's progress; `vibegraph-knowledge setup` lists every step */}
      {now.setup && now.setup.done < now.setup.of && (
        <span data-now-setup title="vibegraph-knowledge setup lists every step and its commands" style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
          setup: {now.setup.done} of {now.setup.of} steps done
        </span>
      )}
      <button data-now-next onClick={() => now.next.panel && onOpen(now.next.panel)} disabled={!now.next.panel}
        style={{ ...chip("var(--accent-thread)"), borderRadius: 8, justifyContent: "space-between", whiteSpace: "normal", textAlign: "left", fontWeight: 600, padding: "8px 12px", cursor: now.next.panel ? "pointer" : "default" }}>
        <span>Next: {now.next.text}</span><ArrowRight {...ico} style={{ flexShrink: 0 }} />
      </button>
    </section>
  );
}
