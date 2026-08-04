// M-GF3.6 — the roadmap OVERVIEW: the whole plan, big and readable at once.
//
// Ben's sitting on M-GF3.3's per-stage popup: the 520px card felt truncated
// and nothing said "clicking a row opens an editable dialogue". So the
// roadmap itself now pops up large — every stage a full card (whole
// capability, whole grounding quote, needs/unlocks chips), with an explicit
// "Discuss / modify" button per card. Focusing a card (row click, chip
// click, or that button) opens the M-GF3.4 scoped dialogue inline under it:
// a turn ending in a ```vg-revise-stage block renders as a validated
// before/after revision card; Apply routes through the event bus (pending
// plan → local; ratified → server persist + rebroadcast). Focus moves →
// the previous stage's scoped session is disposed.
//
// Shell: fixed large card + blurred backdrop; header × / Escape /
// backdrop-click all close.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Quote, TriangleAlert, ListTodo, Send, Check, MessageSquare, RotateCcw, Play } from "lucide-react";
import { bridge, type BuildPlan, type BuildPlanItem, type BuildRunState, type ExtensionMessage } from "./types";
import { StatusGlyph } from "./StatusGlyph";
import { ToolCard } from "./chat/ToolCard";

const mono = "var(--font-mono)";

interface Turn {
  id: number;
  kind: "user" | "assistant" | "tool" | "error" | "note";
  text: string;
  streaming?: boolean;
  // M-CHAT-POLISH.4 — tool turns keep the full input + the correlation
  // id so the stage dialogue renders the same resolving ToolCard as the
  // main chat (it used to discard toolInput and never resolve).
  toolUseId?: string;
  input?: Record<string, unknown>;
  success?: boolean;
  message?: string;
}

const SECTION_LABEL: React.CSSProperties = {
  fontSize: "var(--fs-11)", color: "var(--text-muted)", fontWeight: 700,
  textTransform: "uppercase", letterSpacing: "0.08em",
};

function StageChip({
  item,
  index,
  testId,
  onClick,
}: {
  item: BuildPlanItem;
  index: number;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      {...{ [testId]: item.id }}
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "flex-start", gap: 6, maxWidth: "100%",
        background: "color-mix(in oklab, var(--accent-thread) 10%, transparent)",
        border: "1px solid color-mix(in oklab, var(--accent-thread) 30%, transparent)",
        borderRadius: 6, padding: "3px 10px", cursor: "pointer",
        color: "var(--text-primary)", fontFamily: mono, fontSize: "var(--fs-11)",
        textAlign: "left", lineHeight: 1.4,
      }}
    >
      <span style={{ flexShrink: 0, display: "flex", marginTop: 1 }}>
        <StatusGlyph status={item.status} size={14} />
      </span>
      <span>{index + 1}. {item.capability}</span>
    </button>
  );
}

export function RoadmapOverviewDialog({
  plan,
  run,
  focusItemId,
  onClose,
  onFocus,
}: {
  plan: BuildPlan;
  /** Run state for the RATIFIED roadmap; null for a pending proposal (no
      run controls exist before ratification). */
  run: BuildRunState | null;
  /** The stage whose dialogue is open inline, or null (overview only). */
  focusItemId: string | null;
  onClose: () => void;
  onFocus: (itemId: string | null) => void;
}) {
  const built = plan.items.filter((i) => i.status === "built").length;

  // ── M-GF3.4 — dialogue state, keyed to the focused stage ─────────────
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [revision, setRevision] = useState<{ capability: string; needs: string[] } | null>(null);
  const idRef = useRef(0);
  const nextId = () => ++idRef.current;
  const scope = focusItemId ? `stage:${focusItemId}` : null;

  // The stage prompt box grows with its content (max 120px, then scrolls) —
  // a fixed one-row textarea hid every line after the first while typing.
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  // Focus moved (or cleared) → the old stage's scoped session goes, and the
  // local transcript resets; the new card scrolls into view.
  const prevFocusRef = useRef<string | null>(focusItemId);
  useEffect(() => {
    if (prevFocusRef.current !== focusItemId) {
      if (prevFocusRef.current) {
        bridge.postMessage({ type: "stage-chat-close", payload: { itemId: prevFocusRef.current } });
      }
      prevFocusRef.current = focusItemId;
      setTurns([]);
      setBusy(false);
      setRevision(null);
      setInput("");
    }
    if (focusItemId) {
      document
        .querySelector(`[data-stage-card="${focusItemId}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusItemId]);
  // Dialog closed → any open scoped session goes too.
  useEffect(
    () => () => {
      if (prevFocusRef.current) {
        bridge.postMessage({ type: "stage-chat-close", payload: { itemId: prevFocusRef.current } });
      }
    },
    [],
  );

  useEffect(() => {
    const handler = (msg: ExtensionMessage) => {
      if (!scope || !focusItemId) return;
      if (msg.type === "chat-chunk" && msg.payload.scope === scope) {
        setTurns((prev) => {
          const last = prev[prev.length - 1];
          if (last?.kind === "assistant" && last.streaming) {
            return [...prev.slice(0, -1), { ...last, text: last.text + msg.payload.text }];
          }
          return [...prev, { id: nextId(), kind: "assistant", text: msg.payload.text, streaming: true }];
        });
      } else if (msg.type === "chat-tool-use" && msg.payload.scope === scope) {
        setTurns((prev) => [
          ...prev.map((t) => (t.kind === "assistant" && t.streaming ? { ...t, streaming: false } : t)),
          {
            id: nextId(),
            kind: "tool",
            text: msg.payload.toolName,
            toolUseId: msg.payload.toolUseId,
            input: msg.payload.toolInput,
          },
        ]);
      } else if (msg.type === "chat-tool-result" && msg.payload.scope === scope) {
        setTurns((prev) => {
          const idx = [...prev].reverse().findIndex(
            (t) =>
              t.kind === "tool" &&
              t.success === undefined &&
              (msg.payload.toolUseId ? t.toolUseId === msg.payload.toolUseId : true)
          );
          if (idx === -1) return prev;
          const realIdx = prev.length - 1 - idx;
          return [
            ...prev.slice(0, realIdx),
            { ...prev[realIdx], success: msg.payload.success, message: msg.payload.message },
            ...prev.slice(realIdx + 1),
          ];
        });
      } else if (msg.type === "chat-done" && msg.payload.scope === scope) {
        setTurns((prev) => prev.map((t) => (t.kind === "assistant" && t.streaming ? { ...t, streaming: false } : t)));
        setBusy(false);
      } else if (msg.type === "chat-error" && msg.payload.scope === scope) {
        setTurns((prev) => [
          ...prev.map((t) => (t.kind === "assistant" && t.streaming ? { ...t, streaming: false } : t)),
          { id: nextId(), kind: "error", text: msg.payload.message },
        ]);
        setBusy(false);
      } else if (msg.type === "build-plan-item-revision" && msg.payload.itemId === focusItemId) {
        const p = msg.payload;
        if (p.ok) {
          setRevision(p.revised);
        } else {
          setTurns((prev) => [...prev, { id: nextId(), kind: "error", text: `Revision refused: ${p.error}` }]);
        }
      } else if (msg.type === "build-plan-item-modified" && msg.payload.itemId === focusItemId) {
        setTurns((prev) => [
          ...prev,
          msg.payload.ok
            ? { id: nextId(), kind: "note", text: "Revision applied to the approved roadmap." }
            : { id: nextId(), kind: "error", text: `Apply failed: ${msg.payload.error}` },
        ]);
      }
    };
    bridge.onMessage(handler);
    return () => bridge.removeListener(handler);
  }, [scope, focusItemId]);

  const send = () => {
    const text = input.trim();
    if (!text || busy || !focusItemId) return;
    setTurns((prev) => [...prev, { id: nextId(), kind: "user", text }]);
    setBusy(true);
    setInput("");
    bridge.postMessage({ type: "stage-chat-send", payload: { itemId: focusItemId, text, plan } });
  };

  const applyRevision = () => {
    if (!revision || !focusItemId) return;
    document.dispatchEvent(
      new CustomEvent("vg-stage-revision-apply", { detail: { itemId: focusItemId, revised: revision } }),
    );
    setRevision(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const unlocksOf = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const it of plan.items) m.set(it.id, []);
    plan.items.forEach((it, i) => it.needs.forEach((n) => m.get(n)?.push(i)));
    return m;
  }, [plan]);

  // PORTAL to <body>: the owning RoadmapPanel carries backdrop-filter, which
  // makes it the CONTAINING BLOCK for fixed descendants — rendered in place,
  // this overlay would center on the little panel (and lose the hit-test to
  // the canvas), not on the viewport.
  return createPortal(
    <>
      {/* Backdrop — click closes (the implicit "not now"). */}
      <div
        data-roadmap-overview-backdrop
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 1149,
          background: "color-mix(in oklab, var(--bg-canvas) 35%, transparent)",
          backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
        }}
      />
      <div
        role="dialog"
        aria-label="Roadmap overview"
        data-roadmap-overview
        data-focused-stage={focusItemId ?? ""}
        style={{
          position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
          width: "min(880px, 92vw)", maxHeight: "86vh", zIndex: 1150,
          background: "var(--bg-node)", border: "1px solid var(--proposed-border)",
          borderRadius: 12, boxShadow: "var(--shadow-panel)",
          display: "flex", flexDirection: "column", overflow: "hidden",
          fontFamily: mono, color: "var(--text-primary)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 20px", borderBottom: "1px solid var(--border-edge)",
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <ListTodo size={16} strokeWidth={1.5} color="var(--proposed-accent)" />
          <span style={{ fontSize: "var(--fs-13)", fontWeight: 700 }}>Roadmap</span>
          <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
            {plan.items.length} stages · {built} built
          </span>
          <span style={{ marginLeft: "auto", fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
            click a stage to discuss or change it
          </span>
          <button
            data-roadmap-overview-close
            onClick={onClose}
            title="Close (Esc)"
            style={{
              background: "none", border: "none", color: "var(--text-muted)",
              cursor: "pointer", padding: 2, display: "flex", alignItems: "center",
            }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body — one full card per stage */}
        <div style={{ padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {plan.items.map((item, idx) => {
            const isFocused = item.id === focusItemId;
            const needs = item.needs
              .map((id) => plan.items.findIndex((i) => i.id === id))
              .filter((i) => i >= 0);
            const unlocks = unlocksOf.get(item.id) ?? [];
            return (
              <div
                key={item.id}
                data-stage-card={item.id}
                onClick={() => { if (!isFocused) onFocus(item.id); }}
                style={{
                  display: "flex", flexDirection: "column", gap: 10,
                  border: `1px solid ${isFocused ? "var(--proposed-border)" : "var(--border-edge)"}`,
                  borderRadius: 10, padding: "12px 16px",
                  boxShadow: isFocused ? "0 0 14px var(--proposed-glow)" : "none",
                  cursor: isFocused ? "default" : "pointer",
                }}
              >
                {/* Card header */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StatusGlyph status={item.status} />
                  <span style={{ fontSize: "var(--fs-12)", fontWeight: 700 }}>Stage {idx + 1}</span>
                  <span data-stage-status style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
                    {item.status}
                  </span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    {/* Re-run from the discussion view — the triage loop the
                        sitting exposed: fail → discuss → revise → RE-RUN,
                        without hunting for the little panel behind the
                        dialog. Failed/skipped stages re-queue via the same
                        build-run-retry the panel's triage row uses; a
                        focused pending stage (e.g. just re-queued by an
                        applied revision) resumes the run the same way.
                        Hidden while the run is active or pre-ratification. */}
                    {run && !run.active
                      && (item.status === "failed" || item.status === "skipped"
                        || (isFocused && item.status === "pending")) && (
                      <button
                        data-stage-rerun={item.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          bridge.postMessage({ type: "build-run-retry", payload: { itemId: item.id } });
                        }}
                        title={item.status === "pending"
                          ? "Resume the run — builds the next ready stage (dependencies first)"
                          : "Re-queue this stage and resume the run"}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          background: "color-mix(in oklab, var(--accent-thread) 14%, transparent)",
                          border: "1px solid color-mix(in oklab, var(--accent-thread) 40%, transparent)",
                          borderRadius: 5, color: "var(--accent-thread)", fontSize: "var(--fs-11)",
                          fontWeight: 700, padding: "3px 10px", cursor: "pointer", fontFamily: mono,
                        }}
                      >
                        {item.status === "pending"
                          ? <><Play size={14} strokeWidth={1.5} /> Resume run</>
                          : <><RotateCcw size={14} strokeWidth={1.5} /> Re-run stage</>}
                      </button>
                    )}
                    {!isFocused && (
                      <button
                        data-stage-discuss={item.id}
                        onClick={(e) => { e.stopPropagation(); onFocus(item.id); }}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          background: "color-mix(in oklab, var(--accent-chat) 12%, transparent)",
                          border: "1px solid color-mix(in oklab, var(--accent-chat) 35%, transparent)",
                          borderRadius: 5, color: "var(--accent-chat)", fontSize: "var(--fs-11)",
                          fontWeight: 700, padding: "3px 10px", cursor: "pointer", fontFamily: mono,
                        }}
                      >
                        <MessageSquare size={14} strokeWidth={1.5} /> Discuss / modify
                      </button>
                    )}
                  </div>
                </div>

                {/* Full capability — never clipped. */}
                <div
                  data-stage-capability
                  style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-13)", lineHeight: 1.5 }}
                >
                  {item.capability}
                </div>

                {/* Grounding evidence, in full. */}
                {item.groundedIn == null ? (
                  <div
                    data-stage-inferred
                    style={{
                      display: "flex", alignItems: "flex-start", gap: 6,
                      fontSize: "var(--fsm-12)", color: "var(--accent-warning)",
                      background: "color-mix(in oklab, var(--accent-warning) 10%, transparent)",
                      borderRadius: 6, padding: "6px 10px", lineHeight: 1.45,
                    }}
                  >
                    <TriangleAlert size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
                    <span>INFERRED — Claude proposed this stage; it is not in your description.</span>
                  </div>
                ) : (
                  <div
                    data-stage-grounded
                    style={{
                      display: "flex", alignItems: "flex-start", gap: 6,
                      fontSize: "var(--fsm-12)", color: "var(--proposed-accent)",
                      background: "color-mix(in oklab, var(--proposed-accent) 8%, transparent)",
                      borderRadius: 6, padding: "6px 10px", lineHeight: 1.45,
                    }}
                  >
                    <Quote size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
                    <span>From your description: “{item.groundedIn}”</span>
                  </div>
                )}

                {item.status === "failed" && item.failReason && (
                  <div data-stage-fail-reason style={{ fontSize: "var(--fs-11)", color: "var(--accent-error)", lineHeight: 1.45 }}>
                    {item.failReason}
                  </div>
                )}

                {/* Dependencies, both directions — chips wrap in full. */}
                {(needs.length > 0 || unlocks.length > 0) && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={SECTION_LABEL}>Needs</span>
                      {needs.length === 0 ? (
                        <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
                          nothing — a foundation stage
                        </span>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {needs.map((i) => (
                            <StageChip
                              key={plan.items[i].id}
                              item={plan.items[i]}
                              index={i}
                              testId="data-stage-needs-chip"
                              onClick={() => onFocus(plan.items[i].id)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    {unlocks.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={SECTION_LABEL}>Unlocks</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {unlocks.map((i) => (
                            <StageChip
                              key={plan.items[i].id}
                              item={plan.items[i]}
                              index={i}
                              testId="data-stage-unlocks-chip"
                              onClick={() => onFocus(plan.items[i].id)}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── the inline dialogue, on the focused card only ────── */}
                {isFocused && (
                  <div
                    data-stage-chat
                    style={{
                      display: "flex", flexDirection: "column", gap: 8,
                      borderTop: "1px solid var(--border-edge)", paddingTop: 12,
                    }}
                  >
                    <span style={{ ...SECTION_LABEL, display: "flex", alignItems: "center", gap: 6 }}>
                      <MessageSquare size={14} strokeWidth={1.5} color="var(--accent-chat)" />
                      Discuss this stage
                    </span>
                    {turns.map((t) => (
                      <div
                        key={t.id}
                        data-stage-turn={t.kind}
                        style={{
                          fontSize: "var(--fs-12)", lineHeight: 1.5, fontFamily: "var(--font-ui)",
                          whiteSpace: "pre-wrap",
                          color:
                            t.kind === "error" ? "var(--accent-error)"
                            : t.kind === "user" ? "var(--text-secondary)"
                            : t.kind === "note" ? "var(--accent-thread)"
                            : t.kind === "tool" ? "var(--text-muted)"
                            : "var(--text-primary)",
                        }}
                      >
                        {t.kind === "user" ? (
                          <>› {t.text}</>
                        ) : t.kind === "tool" ? (
                          <ToolCard
                            seg={{
                              kind: "tool",
                              id: String(t.id),
                              toolUseId: t.toolUseId ?? "",
                              name: t.text,
                              input: t.input ?? {},
                              success: t.success,
                              message: t.message,
                            }}
                          />
                        ) : (
                          t.text.replace(/```vg-revise-stage[\s\S]*?(```|$)/g, "").trimEnd() || (t.streaming ? "…" : "")
                        )}
                      </div>
                    ))}

                    {revision && (
                      <div
                        data-stage-revision
                        style={{
                          display: "flex", flexDirection: "column", gap: 8,
                          border: "1px dashed var(--proposed-border)", borderRadius: 8,
                          padding: "8px 10px",
                          background: "color-mix(in oklab, var(--proposed-accent) 6%, transparent)",
                        }}
                      >
                        <span style={SECTION_LABEL}>Proposed revision</span>
                        <div style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", fontFamily: "var(--font-ui)", lineHeight: 1.45, textDecoration: "line-through" }}>
                          {item.capability}
                        </div>
                        <div data-stage-revision-capability style={{ fontSize: "var(--fs-12)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>
                          {revision.capability}
                        </div>
                        {revision.needs.join(",") !== item.needs.join(",") && (
                          <div style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
                            needs: {revision.needs.length ? revision.needs.join(", ") : "nothing"}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button
                            data-stage-revision-apply
                            onClick={applyRevision}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              background: "color-mix(in oklab, var(--accent-thread) 16%, transparent)",
                              border: "1px solid color-mix(in oklab, var(--accent-thread) 45%, transparent)",
                              borderRadius: 5, color: "var(--accent-thread)", fontSize: "var(--fs-11)",
                              fontWeight: 700, padding: "4px 10px", cursor: "pointer", fontFamily: mono,
                            }}
                          >
                            <Check size={14} strokeWidth={1.5} /> Apply
                          </button>
                          <button
                            data-stage-revision-dismiss
                            onClick={() => setRevision(null)}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              background: "none", border: "1px solid var(--border-edge)",
                              borderRadius: 5, color: "var(--text-muted)", fontSize: "var(--fs-11)",
                              fontWeight: 700, padding: "4px 10px", cursor: "pointer", fontFamily: mono,
                            }}
                          >
                            <X size={14} strokeWidth={1.5} /> Dismiss
                          </button>
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 6 }}>
                      <textarea
                        data-stage-chat-input
                        ref={inputRef}
                        rows={1}
                        autoFocus
                        value={input}
                        disabled={busy}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            send();
                          }
                        }}
                        placeholder={busy ? "thinking…" : "ask about this stage, or ask for a change…"}
                        style={{
                          flex: 1, resize: "none", background: "var(--bg-canvas)",
                          border: "1px solid var(--border-edge)", borderRadius: 6,
                          padding: "6px 8px", color: "var(--text-primary)",
                          fontSize: "var(--fs-12)", fontFamily: "var(--font-ui)", outline: "none",
                          lineHeight: 1.4, maxHeight: 120, overflowY: "auto",
                        }}
                      />
                      <button
                        data-stage-chat-send
                        onClick={send}
                        disabled={busy || !input.trim()}
                        title="Send"
                        style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          background: "color-mix(in oklab, var(--accent-chat) 14%, transparent)",
                          border: "1px solid color-mix(in oklab, var(--accent-chat) 40%, transparent)",
                          borderRadius: 6, color: "var(--accent-chat)", padding: "0 10px",
                          cursor: busy || !input.trim() ? "not-allowed" : "pointer",
                          opacity: busy || !input.trim() ? 0.5 : 1,
                        }}
                      >
                        <Send size={14} strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>,
    document.body,
  );
}
