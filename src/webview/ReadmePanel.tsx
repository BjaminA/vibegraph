// README viewer (2026-08-04).
//
// Generated READMEs were reachable only as `title={status.body}` on the chip
// — a native browser tooltip. It truncates, it cannot be scrolled, selected
// or copied, and it vanishes when the pointer moves. So the feature existed
// and its output was, in practice, unreadable.
//
// This renders the body as markdown in a panel you can read, scroll and copy
// from, alongside its provenance (when it was generated, whether the code has
// moved since). Regeneration stays on request — nothing here re-runs a model
// on its own.

import React from "react";
import { X, BookText, AlertTriangle, RotateCw, Check, Copy } from "lucide-react";
import { Markdown } from "./util/Markdown";

export interface ReadmeView {
  exists: boolean;
  stale?: boolean;
  body?: string;
  generatedAt?: string;
  error?: string;
  generating?: boolean;
}

interface Props {
  /** "This project" for the VibeReadme, else the thread/file it describes. */
  title: string;
  status: ReadmeView | null;
  onRefresh: () => void;
  onClose: () => void;
}

export function ReadmePanel({ title, status, onRefresh, onClose }: Props) {
  const [copied, setCopied] = React.useState(false);
  if (!status) return null;

  const body = status.body?.trim() ?? "";
  const stale = !!status.stale;

  return (
    <div
      data-readme-panel
      data-readme-stale={stale ? "true" : "false"}
      style={{
        position: "fixed",
        top: "calc(var(--vg-toolbar-bottom, 43px) + 16px)",
        right: 18,
        width: 520,
        maxHeight: "calc(100vh - var(--vg-toolbar-bottom, 43px) - 48px)",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-node)",
        border: "1px solid var(--border-edge)",
        borderRadius: 8,
        boxShadow: "var(--shadow-panel)",
        zIndex: 880,
        fontFamily: "var(--font-ui)",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 12px", borderBottom: "1px solid var(--border-edge)",
      }}>
        <BookText size={16} strokeWidth={1.5} style={{ color: "var(--accent-thread)", flexShrink: 0 }} />
        <span style={{
          flex: 1, minWidth: 0, color: "var(--text-primary)", fontSize: "var(--fs-12)",
          fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{title}</span>

        {body && (
          <button
            data-readme-copy
            title="Copy markdown"
            onClick={() => {
              navigator.clipboard?.writeText(body).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              }).catch(() => { /* clipboard blocked — the text is selectable anyway */ });
            }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: copied ? "var(--accent-thread)" : "var(--text-muted)",
              display: "flex", alignItems: "center", padding: 2,
            }}
          >
            {copied ? <Check size={14} strokeWidth={1.5} /> : <Copy size={14} strokeWidth={1.5} />}
          </button>
        )}
        <button
          data-readme-refresh
          title={status.exists ? "Regenerate from the current code" : "Generate"}
          onClick={onRefresh}
          disabled={status.generating}
          style={{
            background: "none", border: "none",
            cursor: status.generating ? "progress" : "pointer",
            color: "var(--text-muted)", display: "flex", alignItems: "center", padding: 2,
          }}
        >
          <RotateCw size={14} strokeWidth={1.5} />
        </button>
        <button
          data-readme-close
          title="Close"
          onClick={onClose}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-muted)", display: "flex", alignItems: "center", padding: 2,
          }}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* Provenance rides ABOVE the body, not in a footer: a stale document
          must be qualified before it is read, not after. */}
      {(stale || status.generatedAt) && (
        <div data-readme-provenance style={{
          padding: "6px 12px",
          borderBottom: "1px solid var(--border-edge)",
          color: stale ? "var(--accent-warning)" : "var(--text-muted)",
          fontSize: "var(--fs-11)",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          {stale && <AlertTriangle size={13} strokeWidth={1.5} style={{ flexShrink: 0 }} />}
          <span>
            {stale
              ? "The code has changed since this was written — regenerate before relying on it."
              : `Generated ${status.generatedAt ? new Date(status.generatedAt).toLocaleString() : "—"}`}
          </span>
        </div>
      )}

      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "12px 14px" }}>
        {status.generating ? (
          <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-12)" }}>Generating…</div>
        ) : status.error ? (
          <div style={{ color: "var(--accent-error)", fontSize: "var(--fs-12)" }}>{status.error}</div>
        ) : body ? (
          <div className="vg-md" style={{ color: "var(--text-primary)", fontSize: "var(--fs-12)", lineHeight: 1.6 }}>
            <Markdown text={body} />
          </div>
        ) : (
          <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-12)", lineHeight: 1.6 }}>
            No VibeReadme yet — VibeGraph can write one from the code: what this
            application is, how it is organised, where execution starts, what it
            touches, and what it cannot tell you statically.
            <div style={{ marginTop: 4, color: "var(--border-edge)", fontSize: "var(--fs-11)" }}>
              Separate from the repo's own README.md, which is never touched.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
