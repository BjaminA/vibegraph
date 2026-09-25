// One FILE of a big thread, drawn at the overview tier in place of its steps
// (thread_fold.ts). Large in flow units so it stays a readable target at
// z < 0.28; the text scales inversely with zoom like the M-NA7 landmark
// labels. Clicking it zooms into that file's steps.

import React from "react";
import { Handle, Position } from "@xyflow/react";
import { FileCode } from "lucide-react";
import { lodLabelFontSize } from "./lod";
import type { FileCard } from "./thread_fold";

export const FILE_CARD_W = 560;
export const FILE_CARD_H = 150;

export function ThreadFileCard({ data }: { data: { card: FileCard } }) {
  const c = data.card;
  const parts = c.file.split("/");
  const name = parts.pop();
  const accent = c.seed ? "var(--accent-thread)" : "var(--border-edge)";
  return (
    <div
      data-thread-file-card={c.file}
      data-file-card-seed={c.seed ? "true" : undefined}
      aria-label={`${c.file}: ${c.steps} steps${c.boundaries ? `, ${c.boundaries} boundary calls` : ""}`}
      title={`${c.file}\n${c.steps} steps${c.boundaries ? ` · ${c.boundaries} boundary calls` : ""} — click to zoom in`}
      style={{
        width: FILE_CARD_W, height: FILE_CARD_H, boxSizing: "border-box",
        display: "flex", alignItems: "center", gap: 24, padding: "0 32px",
        background: "var(--bg-node)", border: `4px solid ${accent}`, borderRadius: 28,
        color: "var(--text-primary)", cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
      <FileCode size={64} strokeWidth={1.5} color={accent} />
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div data-file-card-name style={{
          fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: lodLabelFontSize(13, 44), // capped so ~20 characters fit the card at z 0.15
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{name}</div>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: lodLabelFontSize(11, 36), color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          {`${c.steps} steps${c.boundaries ? ` · ${c.boundaries} calls out` : ""}`}
        </div>
      </div>
    </div>
  );
}
