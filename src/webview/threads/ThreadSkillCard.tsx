// M-SKILL.3 — the thread-skill card: the ratification gate leaves the file
// editor. A review SURFACE (not a consent gate — Escape/× just close, nothing
// is pending): full body incl. the deterministic blind-spot block, lifecycle
// badge, staleness callout, and the two actions — Ratify (drafts only; the
// human decision the whole floor hinges on) and Re-draft (delegates to the
// grounding-gated generator; output is always a fresh draft).
//
// Gate-style panel following ChangesetGate: fixed top-center, 560px,
// --proposed-* family while the content is a draft/proposal.

import React, { useEffect, useState } from "react";
import { BookCheck, BookDashed, Check, RefreshCw, X, AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { bridge, type ThreadSkillRecord, type ThreadSkillDiff, type ExtensionMessage } from "../types";
import { skillStateOf } from "./SkillBadge";
import { Markdown } from "../util/Markdown";

interface Props {
  entryPointId: string;
  qualifiedName: string;
  record: ThreadSkillRecord | null;
  onClose: () => void;
}

export function ThreadSkillCard({ entryPointId, qualifiedName, record, onClose }: Props) {
  const state = skillStateOf(record);
  // In-flight re-draft: cleared whenever a fresh record (or refusal) arrives.
  const [redrafting, setRedrafting] = useState(false);
  useEffect(() => { setRedrafting(false); }, [record]);

  // M-SKILL.7 — when stale, fetch what changed since the stamp so the
  // re-affirm decision is informed, not blind.
  const [diff, setDiff] = useState<ThreadSkillDiff | "unavailable" | null>(null);
  useEffect(() => {
    if (state !== "stale") { setDiff(null); return; }
    const handler = (msg: ExtensionMessage) => {
      if (msg.type === "thread-skill-diff" && msg.payload.entryPointId === entryPointId) {
        setDiff(msg.payload.diff ?? "unavailable");
      }
    };
    bridge.onMessage(handler);
    bridge.postMessage({ type: "get-thread-skill-diff", payload: { entryPointId } });
    return () => bridge.removeListener(handler);
  }, [state, entryPointId, record]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ratify = () => bridge.postMessage({ type: "ratify-thread-skill", payload: { entryPointId } });
  const reaffirm = () => bridge.postMessage({ type: "reaffirm-thread-skill", payload: { entryPointId } });
  const setAuto = (value: boolean) =>
    bridge.postMessage({ type: "set-skill-auto-reaffirm", payload: { entryPointId, value } });
  const redraft = () => {
    if (redrafting) return;
    setRedrafting(true);
    bridge.postMessage({ type: "redraft-thread-skill", payload: { entryPointId } });
  };

  const accent = {
    none: "var(--text-muted)",
    draft: "var(--proposed-border)",
    ratified: "var(--accent-thread)",
    stale: "var(--accent-warning)",
  }[state];

  const badgeLabel = {
    none: "Not drafted",
    draft: "Draft — not yet ratified",
    ratified: "Ratified",
    stale: "Ratified · stale",
  }[state];

  const StateIcon = state === "ratified" ? BookCheck : BookDashed;

  return (
    <div
      data-thread-skill-card
      style={{
        position: "fixed", top: "calc(var(--vg-toolbar-bottom, 43px) + 12px)", left: "50%", transform: "translateX(-50%)",
        zIndex: 1015, width: 560, maxHeight: "70vh",
        background: "color-mix(in oklab, var(--bg-node) 94%, transparent)",
        border: `1px solid ${state === "ratified" ? "color-mix(in oklab, var(--accent-thread) 40%, transparent)" : "var(--proposed-border)"}`,
        borderRadius: 8,
        padding: 16, boxShadow: state === "ratified" ? "none" : "0 0 14px var(--proposed-glow)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", flexDirection: "column", gap: 12,
        fontFamily: "var(--font-mono)",
      }}
    >
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-flex", color: accent }}>
          <StateIcon size={16} strokeWidth={1.5} />
        </span>
        <span style={{ fontSize: "var(--fs-12)", color: "var(--text-primary)", fontWeight: 700 }}>
          {qualifiedName}
        </span>
        <span
          data-skill-card-badge
          style={{
            fontSize: "var(--fs-11)", color: accent, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.08em", marginLeft: "auto",
          }}
        >
          {badgeLabel}
        </span>
        <button
          data-skill-card-close
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

      {/* refusal from the server (boundary validation / grounding gate) */}
      {record?.error && (
        <div
          data-skill-card-error
          style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            fontSize: "var(--fs-12)", color: "var(--accent-warning)", lineHeight: 1.5,
          }}
        >
          <AlertTriangle size={16} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{record.error}</span>
        </div>
      )}

      {/* staleness callout + what changed (M-SKILL.7) */}
      {state === "stale" && (
        <div
          data-skill-card-stale
          style={{
            display: "flex", flexDirection: "column", gap: 8,
            fontSize: "var(--fs-12)", lineHeight: 1.5,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, color: "var(--accent-warning)" }}>
            <AlertTriangle size={16} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Ratified against an older version of this thread.{" "}
              {record?.autoReaffirm
                ? "Auto re-affirm is ON — agents still receive it, with a stated caveat."
                : "Agents no longer receive it automatically. If the guidance still holds, Re-affirm; if the change matters, Re-draft."}
            </span>
          </div>
          {/* the informed part: what actually changed since the stamp */}
          <div data-skill-card-diff style={{ paddingLeft: 24, color: "var(--text-secondary)" }}>
            {diff === null ? (
              <span>Comparing against the ratified snapshot…</span>
            ) : diff === "unavailable" ? (
              <span>No step snapshot on this skill (pre-dates diffs) — re-draft once to enable them.</span>
            ) : diff.added.length === 0 && diff.removed.length === 0 && diff.relabeled.length === 0 ? (
              <span>No steps added, removed, or renamed — the change is inside existing steps' code.</span>
            ) : (
              <>
                {diff.added.map((s) => (
                  <div key={`a-${s.id}`} style={{ color: "var(--accent-thread)" }}>
                    + {s.label} [{s.kind}]{s.file ? ` (${s.file})` : ""}
                  </div>
                ))}
                {diff.removed.map((s) => (
                  <div key={`r-${s.id}`} style={{ color: "var(--accent-error)" }}>
                    − {s.label} [{s.kind}]{s.file ? ` (${s.file})` : ""}
                  </div>
                ))}
                {diff.relabeled.map((s) => (
                  <div key={`c-${s.id}`}>~ {s.from} → {s.to}</div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* body */}
      {state === "none" ? (
        <div style={{ fontSize: "var(--fs-12)", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          No skill exists for this thread yet. Draft one — Claude writes grounded,
          citation-checked guidance from the thread's IR; it stays a draft until
          you ratify it.
        </div>
      ) : (
        <div
          data-skill-card-body
          style={{
            overflowY: "auto", minHeight: 0,
            fontSize: "var(--fs-12)", color: "var(--text-primary)",
            lineHeight: 1.6, wordBreak: "break-word",
            border: "1px solid var(--border-edge)", borderRadius: 6, padding: 12,
          }}
        >
          {/* M-CHAT-POLISH.3 — skill.md renders as markdown (## headings,
              bullets, `node-id` chips) instead of raw pre-wrap text. */}
          <Markdown text={record?.body ?? ""} />
        </div>
      )}

      {/* M-SKILL.7 — the "unless told otherwise" dial: ratified skills only */}
      {(state === "ratified" || state === "stale") && (
        <label
          data-skill-auto-reaffirm
          style={{
            display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
            fontSize: "var(--fs-12)", color: "var(--text-secondary)", fontFamily: "var(--font-ui)",
          }}
        >
          <input
            type="checkbox"
            checked={record?.autoReaffirm ?? false}
            onChange={(e) => setAuto(e.target.checked)}
            style={{ accentColor: "var(--accent-thread)" }}
          />
          Keep trusted across code changes — while stale it injects with a
          stated caveat instead of going dark
        </label>
      )}

      {/* footer */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
        {record?.generatedAt && (
          <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", marginRight: "auto" }}>
            drafted {record.generatedAt.slice(0, 10)}
          </span>
        )}
        <button
          data-skill-redraft
          onClick={redraft}
          disabled={redrafting}
          title="Ask Claude to draft this skill afresh from the current thread IR (stays a draft until you ratify)"
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "none", border: "1px solid var(--border-edge)", borderRadius: 6,
            padding: "6px 12px", cursor: redrafting ? "not-allowed" : "pointer",
            color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)",
          }}
        >
          {redrafting
            ? <Loader2 size={14} strokeWidth={1.5} className="vg-spin" />
            : <RefreshCw size={14} strokeWidth={1.5} />}
          {redrafting ? "Drafting…" : state === "none" ? "Draft skill" : "Re-draft"}
        </button>
        {state === "stale" && (
          <button
            data-skill-reaffirm
            onClick={reaffirm}
            title="Still accurate — re-stamp this exact text against the CURRENT thread (no regeneration)"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "color-mix(in oklab, var(--accent-thread) 18%, transparent)",
              border: "1px solid var(--accent-thread)", borderRadius: 6,
              padding: "6px 12px", cursor: "pointer",
              color: "var(--accent-thread)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)",
            }}
          >
            <ShieldCheck size={14} strokeWidth={1.5} />
            Still accurate — Re-affirm
          </button>
        )}
        {state === "draft" && (
          <button
            data-skill-ratify
            onClick={ratify}
            title="Ratify — this exact text becomes authoritative context for every agent on this thread"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "color-mix(in oklab, var(--accent-thread) 18%, transparent)",
              border: "1px solid var(--accent-thread)", borderRadius: 6,
              padding: "6px 12px", cursor: "pointer",
              color: "var(--accent-thread)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)",
            }}
          >
            <Check size={14} strokeWidth={1.5} />
            Ratify
          </button>
        )}
      </div>
    </div>
  );
}
