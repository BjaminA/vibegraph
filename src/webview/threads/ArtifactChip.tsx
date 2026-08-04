// M-TRAINED.2 — the artifact chip: trained-ness as artifact state, surfaced.
//
// Third chip in the thread cluster (README → Skill → Artifact). Shown when
// the active thread CONSUMES or PRODUCES an artifact (model.pt, *.pkl…):
//   missing  — the artifact doesn't exist; agents/runs will fail honestly
//   stale    — it exists but a producer source file changed since
//   present  — exists and fresh (muted, informational)
// Click → a card naming producers/consumers. The action is honest: "Open
// producer thread" NAVIGATES to the producing thread with the save-site
// selected — the run itself stays behind the tooltip's run button and its
// consent gates (affordance must match operation; nothing trains on a
// chip click). Bound to tokens.css; lucide only.

import React, { useEffect } from "react";
import { Box, PackageX, PackageCheck, AlertTriangle, X, ArrowRight, Crosshair, Sparkles } from "lucide-react";
import type { ArtifactRecordWire } from "../types";
// Pure helper (no fs/spawn — artifact_index.ts has zero top-level imports),
// shared so the "consumed by" dedup has one tested definition.
import { consumerThreadNames } from "../../server/artifact_index";

export type ArtifactChipState = "missing" | "stale" | "present";

export function artifactStateOf(a: ArtifactRecordWire): ArtifactChipState {
  if (!a.exists) return "missing";
  return a.stale ? "stale" : "present";
}

/** Records relevant to one thread (consumer first — that's whose run will
 *  fail; producer-only threads still see their own artifacts). */
export function artifactsForThread(all: ArtifactRecordWire[], entryPointId: string): ArtifactRecordWire[] {
  const consumes = all.filter((a) => a.consumers.some((c) => c.entryPointId === entryPointId));
  const produces = all.filter(
    (a) => !consumes.includes(a) && a.producers.some((p) => p.entryPointId === entryPointId),
  );
  return [...consumes, ...produces];
}

function ago(mtimeMs: number | null): string {
  if (mtimeMs === null) return "";
  const mins = Math.max(0, Math.round((Date.now() - mtimeMs) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (60 * 24))}d ago`;
}

const ACCENT: Record<ArtifactChipState, string> = {
  missing: "var(--accent-warning)",
  stale: "var(--accent-warning)",
  present: "var(--text-muted)",
};

export function ArtifactChip({ records, onOpen }: { records: ArtifactRecordWire[]; onOpen: () => void }) {
  if (records.length === 0) return null;
  // Worst state wins the chip face.
  const state: ArtifactChipState = records.some((r) => !r.exists)
    ? "missing"
    : records.some((r) => r.stale) ? "stale" : "present";
  const first = records.find((r) => artifactStateOf(r) === state) ?? records[0];
  const label =
    state === "missing" ? `${first.path} · missing`
    : state === "stale" ? `${first.path} · stale`
    : `${first.path} · ${ago(first.mtimeMs)}`;
  const Icon = state === "missing" ? PackageX : state === "stale" ? AlertTriangle : PackageCheck;
  return (
    <button
      data-artifact-chip
      data-artifact-state={state}
      onClick={onOpen}
      title="Artifact state for this thread (model files this code produces or loads)"
      style={{
        // Position + stacking belong to ChipStrip (see ChipStrip.tsx) — this
        // is a flow child of that column, third row. It used to place itself
        // at +68, four pixels above ThreadView's layout toggle, and (being
        // z-860 against the toggle's z-30) ate its clicks.
        pointerEvents: "auto",
        display: "flex", alignItems: "center", gap: 8,
        background: "color-mix(in oklab, var(--bg-node) 90%, transparent)",
        border: `1px solid color-mix(in oklab, ${ACCENT[state]} 40%, transparent)`,
        borderRadius: 16, padding: "4px 10px",
        fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)",
        color: ACCENT[state], cursor: "pointer",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <Icon size={14} strokeWidth={1.5} />
      <span>{label}</span>
    </button>
  );
}

interface CardProps {
  records: ArtifactRecordWire[];
  /** The thread the card is being read FROM. A producer that IS this thread
   *  gets no "Open producer thread" button: navigating to where you already
   *  stand is a dead click (found 2026-07-30 reading the card from the
   *  training thread itself). It gets the save site instead. */
  activeEntryPointId: string;
  onOpenThread: (entryPointId: string) => void;
  onClose: () => void;
}

export function ArtifactCard({ records, activeEntryPointId, onOpenThread, onClose }: CardProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-artifact-card
      style={{
        position: "fixed", top: "calc(var(--vg-toolbar-bottom, 43px) + 12px)", left: "50%",
        transform: "translateX(-50%)", zIndex: 1015, width: 520, maxHeight: "70vh", overflowY: "auto",
        background: "color-mix(in oklab, var(--bg-node) 94%, transparent)",
        border: "1px solid var(--border-edge)", borderRadius: 8, padding: 16,
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", flexDirection: "column", gap: 12, fontFamily: "var(--font-mono)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Box size={16} strokeWidth={1.5} style={{ color: "var(--text-secondary)" }} />
        <span style={{ fontSize: "var(--fs-12)", color: "var(--text-primary)", fontWeight: 700 }}>
          Artifacts
        </span>
        <button
          data-artifact-card-close
          onClick={onClose}
          title="Close (Esc)"
          style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2, display: "flex" }}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      {records.map((a) => {
        const state = artifactStateOf(a);
        const producers = a.producers.filter((p) => p.entryPointId);
        return (
          <div key={a.path} data-artifact-entry={a.path} style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--fs-12)", lineHeight: 1.5 }}>
            <div style={{ color: ACCENT[state], fontWeight: 700 }}>
              {a.path}
              {state === "missing" && " — missing (not yet produced)"}
              {state === "stale" && ` — stale: ${a.staleReason}`}
              {state === "present" && ` — present · produced ${ago(a.mtimeMs)}`}
            </div>
            {producers.length > 0 ? (
              producers.map((p) => {
                const here = p.entryPointId === activeEntryPointId;
                return (
                <div key={p.entryPointId + p.nodeId} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "var(--text-secondary)" }}>
                  <span>produced by {p.qualifiedName} ({p.call} · {p.file}:{p.line})</span>
                  {here ? (
                    // You're standing on the producer. Navigating here again
                    // does nothing, so the useful move is the save SITE — the
                    // node whose run button (with its consent gates) is how
                    // this artifact actually gets produced.
                    <>
                      <span data-artifact-producer-is-here style={{ color: "var(--text-muted)", fontSize: "var(--fs-11)", fontFamily: "var(--font-ui)" }}>
                        this thread
                      </span>
                      <button
                        data-artifact-show-save-site={p.nodeId}
                        onClick={() => document.dispatchEvent(new CustomEvent("vg-selection", {
                          detail: { filePath: p.file, irNodeId: p.nodeId, source: "artifact-card" },
                        }))}
                        title={`Select the save site — ${p.call} at ${p.file}:${p.line}, opened in the editor`}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          background: "color-mix(in oklab, var(--accent-thread) 14%, transparent)",
                          border: "1px solid color-mix(in oklab, var(--accent-thread) 40%, transparent)",
                          borderRadius: 4, color: "var(--accent-thread)", padding: "2px 8px",
                          cursor: "pointer", fontSize: "var(--fs-11)", fontFamily: "var(--font-ui)",
                        }}
                      >
                        <Crosshair size={12} strokeWidth={1.5} /> Show the save site
                      </button>
                    </>
                  ) : (
                    <button
                      data-artifact-open-producer={p.entryPointId}
                      onClick={() => onOpenThread(p.entryPointId)}
                      title="Open the producing thread — run it from its save-site node (the run button carries the usual consent gates)"
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        background: "color-mix(in oklab, var(--accent-thread) 14%, transparent)",
                        border: "1px solid color-mix(in oklab, var(--accent-thread) 40%, transparent)",
                        borderRadius: 4, color: "var(--accent-thread)", padding: "2px 8px",
                        cursor: "pointer", fontSize: "var(--fs-11)", fontFamily: "var(--font-ui)",
                      }}
                    >
                      Open producer thread <ArrowRight size={12} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
                );
              })
            ) : (
              <div style={{ color: "var(--text-muted)" }}>
                no producer found in this project — this file must come from elsewhere
              </div>
            )}
            {/* An artifact that doesn't exist (or is out of date) needs
                PRODUCING, and the honest way to offer that is the chat: its
                session already runs in the analyzed project, so Claude
                resolves the interpreter / env / arguments itself instead of
                us printing a shell line we can't verify. Prefill only — the
                human reads it and presses send, so nothing trains on a
                click (same contract as the chip itself). */}
            {(state === "missing" || state === "stale") && producers.length > 0 && (
              <button
                data-artifact-ask-run={a.path}
                onClick={() => document.dispatchEvent(new CustomEvent("vg-chat-prefill", {
                  detail: {
                    text: `Run ${producers[0].file} in this project to produce ${a.path}`
                      + ` (${producers[0].qualifiedName} writes it via ${producers[0].call}),`
                      + ` then tell me what it reported.`,
                  },
                }))}
                title="Draft this as a chat message — the chat runs in this project. You review and send it; nothing runs on this click."
                style={{
                  alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6,
                  background: "none", border: "1px solid var(--border-edge)",
                  borderRadius: 4, color: "var(--text-secondary)", padding: "2px 8px",
                  cursor: "pointer", fontSize: "var(--fs-11)", fontFamily: "var(--font-ui)",
                }}
              >
                <Sparkles size={12} strokeWidth={1.5} /> Ask the chat to produce it
              </button>
            )}
            {(() => {
              // One line per consuming THREAD, not per consumer SITE (a thread
              // can consume the same artifact at two sites). See
              // consumerThreadNames.
              const names = consumerThreadNames(a.consumers);
              return names.length > 0 && (
                <div style={{ color: "var(--text-muted)" }}>
                  consumed by {names.join(", ")}
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
