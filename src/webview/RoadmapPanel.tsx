// PLAN-v7 Stage 5 — the ROADMAP: the build plan in both its lifetimes.
//
// Proposed: the ordered capability list with per-item grounding, gated
// behind "Ratify roadmap" / Reject (a roadmap is a LABELLED PLAN like the
// architecture — ratification is a judgment, so the evidence is on every
// row). Ratified: live per-item status (the envelope rebroadcasts on every
// transition — this IS the run progress), the run dial (Run/Pause/Stop),
// and failure triage (Retry with an optionally edited capability / Skip —
// dependents blocked honestly / the run stays paused).
//
// The panel renders whenever a ratified architecture plan exists — the
// roadmap is the natural next step after ratifying an architecture, and
// "Draft roadmap" (5b) lives here rather than crowding the toolbar.

import React, { useState } from "react";
import {
  Check, X, Play, Pause, Square, RotateCcw, SkipForward,
  CircleDashed, Loader2, PenLine, Maximize2, MessageSquare,
  ListTodo, Quote, TriangleAlert, ChevronDown, ChevronRight,
} from "lucide-react";
import { bridge, type BuildPlan, type BuildRunState } from "./types";
import { StatusGlyph } from "./StatusGlyph";
import { RoadmapOverviewDialog } from "./RoadmapOverviewDialog";
import { GateButton } from "./controls/GateButton";

const mono = "var(--font-mono)";

export function RoadmapPanel({
  plan,
  pending,
  run,
  drafting,
  lift,
  onDraft,
}: {
  /** The ratified roadmap (envelope sibling), when one exists. */
  plan: BuildPlan | null;
  /** The proposed (pre-ratification) roadmap, when one is pending. */
  pending: BuildPlan | null;
  run: BuildRunState;
  /** True while the roadmap draft round-trip is in flight (5b). */
  drafting: boolean;
  /** Sitting-2 — the full-width bottom chat bar is open: lift clear of it
      (the same shift the chat toggle and compose affordances make). */
  lift?: boolean;
  /** Owner-provided draft trigger (posts the intent + tracks the flag).
      M-GF3.5: with `guidance` it revises the pending proposal instead. */
  onDraft: (guidance?: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  // M-GF3.6 — the big roadmap overview: open/closed + which stage's
  // dialogue is focused inside it (null = overview only).
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [focusStage, setFocusStage] = useState<string | null>(null);
  // M-GF3.5 — the roadmap-level Modify instruction row (proposal state).
  const [modifyOpen, setModifyOpen] = useState(false);
  const [modifyText, setModifyText] = useState("");

  const shown = pending ?? plan;

  // M-GF3.2 — fourth state: the roadmap draft round-trip is in flight. The
  // panel itself works: spinner header + pulsing skeleton rows where the
  // increments will land. Every animation carrier unmounts when the proposal
  // (or error) releases `drafting` — bounded by the round-trip (the
  // motion.css tokenised exception).
  if (drafting) {
    return (
      <div
        data-roadmap-panel
        data-roadmap-state="drafting"
        style={{
          position: "fixed", bottom: lift ? "calc(var(--vg-chat-height, 320px) + 12px)" : 12, left: 298, zIndex: 990, width: 360,
          transition: "bottom 0.18s ease",
          // Sitting-2 — never reach the bottom-right chat toggle's footprint
          // at narrow viewport widths (42px toggle + 20px inset + 12px gap).
          maxWidth: "calc(100vw - 298px - 74px)",
          background: "color-mix(in oklab, var(--bg-node) 94%, transparent)",
          border: "1px solid var(--proposed-border)", borderRadius: 8, padding: 12,
          boxShadow: "0 0 14px var(--proposed-glow)",
          backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
          display: "flex", flexDirection: "column", gap: 8, fontFamily: mono,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 size={16} strokeWidth={1.5} color="var(--accent-chat)" className="vg-spin" />
          <span style={{ fontSize: "var(--fs-12)", fontWeight: 700, color: "var(--text-primary)" }}>
            Drafting roadmap…
          </span>
        </div>
        {[82, 64, 74].map((w, i) => (
          <div
            key={i}
            data-roadmap-skeleton
            className="vg-skeleton-pulse"
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 4px", animationDelay: `${i * 200}ms` }}
          >
            <CircleDashed size={16} strokeWidth={1.5} color="var(--text-muted)" />
            <div
              style={{
                width: `${w}%`, height: 10, borderRadius: 5,
                background: "color-mix(in oklab, var(--text-muted) 24%, transparent)",
              }}
            />
          </div>
        ))}
      </div>
    );
  }

  // Third state: architecture ratified, no roadmap yet — the draft CTA.
  if (!shown) {
    return (
      <div
        data-roadmap-panel
        data-roadmap-state="empty"
        style={{
          position: "fixed", bottom: lift ? "calc(var(--vg-chat-height, 320px) + 12px)" : 12, left: 298, zIndex: 990, width: 360,
          transition: "bottom 0.18s ease",
          // Sitting-2 — never reach the bottom-right chat toggle's footprint
          // at narrow viewport widths (42px toggle + 20px inset + 12px gap).
          maxWidth: "calc(100vw - 298px - 74px)",
          background: "color-mix(in oklab, var(--bg-node) 94%, transparent)",
          border: "1px solid var(--border-edge)", borderRadius: 8, padding: 12,
          boxShadow: "var(--shadow-control)",
          backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
          display: "flex", alignItems: "center", gap: 8, fontFamily: mono,
        }}
      >
        <ListTodo size={16} strokeWidth={1.5} color="var(--proposed-accent)" />
        <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", flex: 1 }}>
          Architecture approved — no roadmap yet.
        </span>
        <GateButton
          data-roadmap-draft
          accent="chat" filled
          pending={drafting} pendingLabel="Drafting…"
          // Explicit thunk: onDraft takes optional guidance (M-GF3.5) — the
          // click event must never ride in as it.
          onClick={() => onDraft()}
        >
          <ListTodo size={14} strokeWidth={1.5} /> Draft roadmap
        </GateButton>
      </div>
    );
  }
  const isProposal = pending != null;
  const built = shown.items.filter((i) => i.status === "built").length;
  const inferred = shown.items.filter((i) => i.groundedIn == null).length;

  const post = (type: any, payload: any = {}) => bridge.postMessage({ type, payload });

  return (
    <div
      data-roadmap-panel
      data-roadmap-state={isProposal ? "proposed" : "ratified"}
      style={{
        position: "fixed", bottom: lift ? "calc(var(--vg-chat-height, 320px) + 12px)" : 12, left: 298, zIndex: 990, width: 360,
        transition: "bottom 0.18s ease",
        // Sitting-2 — never reach the bottom-right chat toggle's footprint
        // at narrow viewport widths (42px toggle + 20px inset + 12px gap).
        maxWidth: "calc(100vw - 298px - 74px)",
        // Lifted: fit between the toolbar band and the chat bar, never under either.
        maxHeight: lift ? "calc(100vh - var(--vg-chat-height, 320px) - 68px)" : "60vh",
        overflowY: "auto",
        background: "color-mix(in oklab, var(--bg-node) 94%, transparent)",
        border: `1px solid ${isProposal ? "var(--proposed-border)" : "var(--border-edge)"}`,
        borderRadius: 8, padding: 12,
        boxShadow: isProposal ? "0 0 14px var(--proposed-glow)" : "var(--shadow-control)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", flexDirection: "column", gap: 8, fontFamily: mono,
      }}
    >
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={() => setCollapsed((v) => !v)}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-muted)", display: "flex" }}
        >
          {collapsed ? <ChevronRight size={16} strokeWidth={1.5} /> : <ChevronDown size={16} strokeWidth={1.5} />}
        </button>
        <ListTodo size={16} strokeWidth={1.5} color="var(--proposed-accent)" />
        <span style={{ fontSize: "var(--fs-12)", fontWeight: 700, color: "var(--text-primary)" }}>
          Roadmap
        </span>
        {/* M-GF3.6 — the explicit expand affordance: the whole roadmap,
            big, with per-stage discussion. */}
        <button
          data-roadmap-expand
          onClick={() => { setFocusStage(null); setOverviewOpen(true); }}
          title="Expand the roadmap — read, discuss, and change stages"
          style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--text-muted)", display: "flex" }}
        >
          <Maximize2 size={14} strokeWidth={1.5} />
        </button>
        <span data-roadmap-progress style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", marginLeft: "auto" }}>
          {isProposal
            ? `proposed · ${shown.items.length} increments${inferred ? ` · ${inferred} inferred` : ""}`
            : `${built}/${shown.items.length} built`}
        </span>
        {/* M-GF3.5 — on a proposal, the × IS the reject (implicit decline). */}
        {isProposal && (
          <button
            data-roadmap-reject
            onClick={() => document.dispatchEvent(new CustomEvent("vg-build-plan-reject"))}
            title="Dismiss — rejects this proposed roadmap"
            style={{
              background: "none", border: "none", color: "var(--text-muted)",
              cursor: "pointer", padding: 2, display: "flex", alignItems: "center",
            }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* run note — the server's honest one-liner about the run state */}
      {!isProposal && run.note && (
        <div data-run-note style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
          {run.active ? "▸ " : "⏸ "}{run.note}
        </div>
      )}

      {!collapsed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {shown.items.map((it, idx) => (
            <div key={it.id} data-roadmap-item={it.id} data-item-status={it.status}>
              {/* M-GF3.6 — the row opens the BIG roadmap overview focused on
                  this stage (hover wash + chevron say "clickable"). Failure
                  triage below keeps its own buttons (outside this row). */}
              <div
                data-item-row
                className="vg-roadmap-row"
                onClick={() => { setFocusStage(it.id); setOverviewOpen(true); }}
                title="Open the roadmap — discuss or change this stage"
                style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "3px 4px", cursor: "pointer", borderRadius: 6 }}
              >
                <StatusGlyph status={it.status} />
                <span data-item-capability style={{ fontSize: "var(--fsm-12)", color: "var(--text-primary)", flex: 1, minWidth: 0, lineHeight: 1.45 }}>
                  {idx + 1}. {it.capability}
                </span>
                {it.groundedIn == null ? (
                  <TriangleAlert size={16} strokeWidth={1.5} color="var(--accent-warning)" />
                ) : (
                  <span title={`From your description: “${it.groundedIn}”`} style={{ display: "flex", color: "var(--proposed-accent)" }}>
                    <Quote size={16} strokeWidth={1.5} />
                  </span>
                )}
                <span className="vg-roadmap-row-chevron" style={{ display: "flex", color: "var(--text-muted)" }}>
                  <ChevronRight size={14} strokeWidth={1.5} />
                </span>
              </div>
              {it.needs.length > 0 && (
                <div style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", padding: "0 4px 0 28px" }}>
                  needs {it.needs.join(", ")}
                </div>
              )}
              {it.status === "failed" && (
                <div data-item-failure style={{ padding: "2px 4px 4px 28px", display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: "var(--fs-11)", color: "var(--accent-error)" }}>{it.failReason}</span>
                  {/* The check's own output — the assertion or traceback that
                      says WHY. "check failed (exit 1)" alone gives a human
                      nothing to act on, and this is the difference between
                      triaging the failure and re-running it blind. */}
                  {it.failOutput && (
                    <pre
                      data-item-fail-output
                      style={{
                        margin: 0, maxHeight: 140, overflow: "auto",
                        background: "var(--bg-canvas)", border: "1px solid var(--border-edge)",
                        borderRadius: 4, padding: "4px 6px",
                        fontSize: "var(--fs-11)", fontFamily: mono,
                        color: "var(--text-muted)", whiteSpace: "pre-wrap",
                      }}
                    >
                      {it.failOutput.trim().slice(-1200)}
                    </pre>
                  )}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {/* Retry means RETRY: re-run the same stage as-is. It
                          used to open a prefilled capability box, so the one
                          action whose whole point is "just run it again"
                          demanded you re-approve the prompt first. Revising
                          the capability is what Discuss is for. */}
                      <button data-item-retry className="vg-gate-btn"
                        onClick={() => post("build-run-retry", { itemId: it.id })}
                        title="Re-run this stage unchanged"
                        style={failBtn("var(--accent-thread)")}>
                        <RotateCcw size={14} strokeWidth={1.5} /> Retry
                      </button>
                      <button data-item-skip className="vg-gate-btn" onClick={() => post("build-run-skip", { itemId: it.id })}
                        style={failBtn("var(--accent-warning)")}>
                        <SkipForward size={14} strokeWidth={1.5} /> Skip
                      </button>
                      {/* Failure triage is cramped in this little panel — hand
                          the conversation to the big overview dialog, focused
                          on this stage (its inline Claude dialogue + Re-run). */}
                      <button data-item-discuss className="vg-gate-btn"
                        onClick={() => { setFocusStage(it.id); setOverviewOpen(true); }}
                        title="Open the roadmap overview — discuss this failure with Claude and revise the stage"
                        style={failBtn("var(--accent-chat)")}>
                        <MessageSquare size={14} strokeWidth={1.5} /> Discuss
                      </button>
                    </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* M-GF3.6 — the big roadmap overview (focus guarded: the focused
          stage may vanish on a plan update mid-open; the overview stays). */}
      {overviewOpen && (
        <RoadmapOverviewDialog
          plan={shown}
          run={isProposal ? null : run}
          focusItemId={focusStage && shown.items.some((i) => i.id === focusStage) ? focusStage : null}
          onClose={() => { setOverviewOpen(false); setFocusStage(null); }}
          onFocus={setFocusStage}
        />
      )}

      {/* the dial — M-GF3.5: Ratify / Modify (reject is the header ×). */}
      {isProposal ? (
        <>
          {modifyOpen && (
            <div data-roadmap-modify-row style={{ display: "flex", gap: 6 }}>
              <input
                data-roadmap-modify-input
                autoFocus
                value={modifyText}
                onChange={(e) => setModifyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && modifyText.trim()) {
                    onDraft(modifyText.trim());
                    setModifyOpen(false);
                    setModifyText("");
                  } else if (e.key === "Escape") {
                    setModifyOpen(false);
                    setModifyText("");
                  }
                }}
                placeholder="what should change? (Enter to re-draft)"
                style={{
                  flex: 1, background: "var(--bg-canvas)", border: "1px solid var(--border-edge)",
                  borderRadius: 5, padding: "5px 8px", color: "var(--text-primary)",
                  fontSize: "var(--fs-11)", fontFamily: mono, outline: "none",
                }}
              />
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <GateButton
              data-roadmap-ratify
              accent="thread" filled armOnClick resetKey={pending}
              pendingLabel="Approving…"
              onClick={() => document.dispatchEvent(new CustomEvent("vg-build-plan-accept"))}
            >
              <Check size={14} strokeWidth={1.5} /> Approve roadmap
            </GateButton>
            <GateButton
              data-roadmap-modify
              accent="chat"
              onClick={() => setModifyOpen((v) => !v)}
              style={{ borderColor: "var(--border-edge)" }}
            >
              <PenLine size={14} strokeWidth={1.5} /> Modify
            </GateButton>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {run.active ? (
            <GateButton data-run-pause accent="warning" filled armOnClick resetKey={run} pendingLabel="Pausing…" onClick={() => post("build-run-pause")}>
              <Pause size={14} strokeWidth={1.5} /> Pause run
            </GateButton>
          ) : (
            built < shown.items.length && (
              <GateButton data-run-start accent="thread" filled armOnClick resetKey={run} pendingLabel="Starting…" onClick={() => post("build-run-start")}>
                <Play size={14} strokeWidth={1.5} /> {built > 0 ? "Resume run" : "Run roadmap"}
              </GateButton>
            )
          )}
          {(run.active || run.runItemId) && (
            <GateButton data-run-stop accent="neutral" armOnClick resetKey={run} pendingLabel="Stopping…" onClick={() => post("build-run-stop")}>
              <Square size={14} strokeWidth={1.5} /> Stop
            </GateButton>
          )}
        </div>
      )}
    </div>
  );
}

// (dialBtn retired — the shared GateButton owns the gate/dial buttons now.)

function failBtn(accent: string): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 4,
    background: `color-mix(in oklab, ${accent} 12%, transparent)`,
    border: `1px solid color-mix(in oklab, ${accent} 35%, transparent)`,
    borderRadius: 4, color: accent, fontSize: "var(--fs-11)", fontWeight: 700,
    padding: "2px 8px", cursor: "pointer", fontFamily: mono,
  };
}
