// The editor panel's header (split from parts.tsx, 2026-10-20, to keep both
// under the 500-line budget): close, EDIT, and the breadcrumb — the file's
// place in the hierarchy, project › file › Class › function, where the file
// opens whole and the function returns to its own lines (fileView.ts: one
// file, several views).

import React from "react";
import { X } from "lucide-react";

// ── header + breadcrumb ──────────────────────────────────────────────

/** A breadcrumb segment that opens a view (2026-10-20: the file opens whole,
 *  the function returns to it). The current view is bold, the other a link. */
function Crumb(props: { label: string; current: boolean; onOpen?: () => void; title: string; attr: string }) {
  const style: React.CSSProperties = {
    color: props.current ? "var(--text-primary)" : "var(--text-secondary)",
    fontWeight: props.current ? 700 : 400,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    fontFamily: "inherit", fontSize: "inherit", background: "transparent", border: "none", padding: 0,
  };
  const dataAttr = { [props.attr]: "", "data-current": props.current ? "true" : "false" };
  if (props.current || !props.onOpen) return <span {...dataAttr} style={style}>{props.label}</span>;
  return (
    <button {...dataAttr} type="button" onClick={props.onOpen} title={props.title}
      style={{ ...style, cursor: "pointer", textDecoration: "underline", textDecorationColor: "var(--border-edge)", textUnderlineOffset: 3 }}>
      {props.label}
    </button>
  );
}

export function Header(props: {
  fileLabel: string | null; fnName: string | null; onClose: () => void;
  /** the class a method sits in */
  className?: string | null;
  /** which view of the file is shown: the selected function's lines, or all of it */
  view?: "function" | "file";
  onOpenFile?: () => void;
  onOpenFunction?: () => void;
}) {
  const view = props.view ?? "function";
  const hasFunction = !!props.fnName && props.fnName !== "(module)" && props.fnName !== "select a node";
  return (
    <div
      style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--border-edge)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "var(--bg-node)",
        flexShrink: 0,
      }}
    >
      {/* Close on the LEFT — the top-right TopToolbar (z 1010) would
          otherwise intercept its clicks. Same fix as CodeView. */}
      <CloseButton onClose={props.onClose} />
      <span
        style={{
          color: "var(--accent-thread)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-11)",
          fontWeight: 700,
          letterSpacing: "0.08em",
          opacity: 0.8,
          textTransform: "uppercase",
        }}
      >
        EDIT
      </span>
      {/* Breadcrumb: project › file › function. */}
      <div
        data-editor-breadcrumb
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-11)",
          color: "var(--text-muted)",
          overflow: "hidden",
          flex: 1,
        }}
      >
        <span>project</span>
        <span>›</span>
        {props.fileLabel ? (
          <Crumb attr="data-editor-crumb-file" label={props.fileLabel}
            current={view === "file" || !hasFunction}
            onOpen={props.onOpenFile} title={`Open the whole of ${props.fileLabel}`} />
        ) : <span style={{ color: "var(--text-secondary)" }}>—</span>}
        {props.className && hasFunction && (
          <>
            <span>›</span>
            <span data-editor-crumb-class style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{props.className}</span>
          </>
        )}
        {(hasFunction || view === "function") && (
          <>
            <span>›</span>
            {hasFunction ? (
              <Crumb attr="data-editor-fn-name" label={props.fnName!}
                current={view === "function"}
                onOpen={props.onOpenFunction} title={`Back to ${props.fnName}`} />
            ) : (
              <span data-editor-fn-name style={{ color: "var(--text-primary)", fontWeight: 700, whiteSpace: "nowrap" }}>
                {props.fnName ?? "select a node"}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CloseButton(props: { onClose: () => void }) {
  return (
    <button
      data-node-editor-close
      onClick={props.onClose}
      title="Close editor (Esc)"
      aria-label="Close editor"
      onMouseEnter={(e) => {
        const b = e.currentTarget;
        b.style.background = "color-mix(in oklab, var(--accent-error) 14%, transparent)";
        b.style.borderColor = "color-mix(in oklab, var(--accent-error) 60%, transparent)";
        b.style.color = "var(--accent-error)";
      }}
      onMouseLeave={(e) => {
        const b = e.currentTarget;
        b.style.background = "transparent";
        b.style.borderColor = "var(--border-edge)";
        b.style.color = "var(--text-secondary)";
      }}
      style={{
        background: "transparent",
        border: "1px solid var(--border-edge)",
        borderRadius: 4,
        color: "var(--text-secondary)",
        padding: "4px 10px",
        fontSize: "var(--fs-11)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        transition: "color 0.12s, border-color 0.12s, background 0.12s",
      }}
    >
      <X size={16} strokeWidth={1.75} />
    </button>
  );
}
