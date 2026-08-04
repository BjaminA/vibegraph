// M-SKILL.3 — thread-skill badge. The active thread's skill lifecycle state
// as a chip (none / draft / ratified / stale-ratified), sibling to the
// ReadmeBadge cluster. Click opens the ThreadSkillCard — review, ratify,
// re-draft. A draft is a PROPOSAL (--proposed-* family, same meaning the
// changeset gate carries); ratified is authoritative (--accent-thread);
// stale is a genuine treat-with-care signal (--accent-warning).
// Bound to tokens.css; lucide only.

import React from "react";
import { BookCheck, BookDashed, AlertTriangle } from "lucide-react";
import type { ThreadSkillRecord } from "../types";

interface Props {
  record: ThreadSkillRecord | null;
  onOpen: () => void;
}

export type SkillBadgeState = "none" | "draft" | "ratified" | "stale";

export function skillStateOf(record: ThreadSkillRecord | null | undefined): SkillBadgeState {
  if (!record || !record.exists) return "none";
  if (record.status !== "ratified") return "draft";
  return record.stale ? "stale" : "ratified";
}

export function SkillBadge({ record, onOpen }: Props) {
  const state = skillStateOf(record);

  const accent = {
    none: "var(--text-muted)",
    draft: "var(--proposed-border)",
    ratified: "var(--accent-thread)",
    stale: "var(--accent-warning)",
  }[state];

  const label = {
    none: "No skill",
    draft: "Skill · draft",
    ratified: "Skill",
    stale: "Skill · stale",
  }[state];

  const Icon = state === "ratified" ? BookCheck : state === "stale" ? AlertTriangle : BookDashed;

  return (
    <button
      data-skill-badge
      data-skill-state={state}
      onClick={onOpen}
      title={
        state === "none"
          ? "No skill exists for this thread yet — open to draft one"
          : "Review this thread's skill"
      }
      style={{
        // Position + stacking belong to ChipStrip (see ChipStrip.tsx) — this
        // is a flow child of that column, second row.
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "color-mix(in oklab, var(--bg-node) 90%, transparent)",
        border: `1px solid color-mix(in oklab, ${accent} 40%, transparent)`,
        borderRadius: 16,
        padding: "4px 10px",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-11)",
        color: accent,
        cursor: "pointer",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <Icon size={14} strokeWidth={1.5} />
      <span>{label}</span>
    </button>
  );
}
