// M18.1 — presentational parts of <NodeEditorPanel>.
//
// Split out of NodeEditorPanel.tsx purely to keep that file under the
// 500-line budget; these are stateless chrome components (header,
// breadcrumb, mode toggle, body placeholders, dirty-guard prompt,
// footer). The stateful container lives in NodeEditorPanel.tsx.

import React from "react";
import { X, Pencil, Sparkles, FileCode2 } from "lucide-react";

export type Mode = "edit" | "intent";

// ── header + breadcrumb ──────────────────────────────────────────────

export function Header(props: { fileLabel: string | null; fnName: string | null; onClose: () => void }) {
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
        <span style={{ color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {props.fileLabel ?? "—"}
        </span>
        <span>›</span>
        <span
          data-editor-fn-name
          style={{ color: "var(--text-primary)", fontWeight: 700, whiteSpace: "nowrap" }}
        >
          {props.fnName ?? "select a node"}
        </span>
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

// ── mode toggle (Edit | Intent) ──────────────────────────────────────

export function ModeToggle(props: { mode: Mode; onChange: (m: Mode) => void }) {
  const items: Array<{ key: Mode; label: string; Icon: typeof Pencil }> = [
    { key: "edit", label: "Edit", Icon: Pencil },
    { key: "intent", label: "Intent", Icon: Sparkles },
  ];
  return (
    <div
      data-editor-mode-toggle
      style={{
        display: "flex",
        gap: 4,
        padding: 8,
        borderBottom: "1px solid var(--border-edge)",
        background: "var(--bg-node)",
        flexShrink: 0,
      }}
    >
      {items.map(({ key, label, Icon }) => {
        const active = props.mode === key;
        return (
          <button
            key={key}
            data-editor-mode-btn={key}
            data-active={active ? "true" : "false"}
            onClick={() => props.onChange(key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 6,
              border: `1px solid ${active ? "color-mix(in oklab, var(--accent-thread) 60%, transparent)" : "transparent"}`,
              background: active ? "color-mix(in oklab, var(--accent-thread) 18%, transparent)" : "transparent",
              color: active ? "var(--accent-thread)" : "var(--text-muted)",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--fs-12)",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.12s",
            }}
          >
            <Icon size={16} strokeWidth={1.5} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── bodies ───────────────────────────────────────────────────────────

// R-2 — the Intent composer is a BOTTOM bar, not a full-pane body. The
// enclosing-function source (Edit-mode Monaco) stays rendered above it, so
// the code you're describing a change to is visible while you type intent.
// Generate loads the proposal into that same editor and flips to Edit mode.
export function IntentBar(props: {
  onGenerate: (intent: string) => void;
  generating: boolean;
  error: string | null;
  disabled: boolean;
}) {
  const [text, setText] = React.useState("");
  const can = !props.disabled && !props.generating && text.trim().length > 0;
  const submit = () => { if (can) props.onGenerate(text.trim()); };
  return (
    <div
      data-editor-intent
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        borderTop: "1px solid var(--border-edge)",
        background: "var(--bg-node)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-thread)" }}>
        <Sparkles size={16} strokeWidth={1.5} />
        <span style={{ fontSize: "var(--fs-12)", fontWeight: 600 }}>Describe a change</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
          {props.disabled ? "Select a node first." : "⌘/Ctrl + Enter"}
        </span>
      </div>
      <textarea
        data-editor-intent-input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(); }}
        placeholder="e.g. add a gender argument to the create subparser"
        disabled={props.disabled || props.generating}
        rows={2}
        style={{
          resize: "vertical",
          background: "var(--bg-canvas)",
          border: "1px solid var(--border-edge)",
          borderRadius: 6,
          color: "var(--text-primary)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fsm-13)",
          padding: 10,
          outline: "none",
        }}
      />
      {props.error && (
        <div
          data-editor-intent-error
          style={{ fontSize: "var(--fs-12)", color: "var(--accent-error)", fontFamily: "var(--font-mono)", lineHeight: 1.4 }}
        >
          {props.error}
        </div>
      )}
      <button
        data-editor-intent-generate
        onClick={submit}
        disabled={!can}
        style={{
          alignSelf: "flex-end",
          display: "flex", alignItems: "center", gap: 6,
          background: can ? "color-mix(in oklab, var(--accent-thread) 18%, transparent)" : "transparent",
          border: `1px solid color-mix(in oklab, var(--accent-thread) ${can ? 60 : 25}%, transparent)`,
          borderRadius: 6,
          color: "var(--accent-thread)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-12)",
          fontWeight: 600,
          padding: "6px 14px",
          cursor: can ? "pointer" : "not-allowed",
          opacity: can ? 1 : 0.5,
        }}
      >
        <Sparkles size={14} strokeWidth={1.5} />
        {props.generating ? "Generating…" : "Generate"}
      </button>
    </div>
  );
}

export function EmptyState() {
  return (
    <div data-editor-empty style={bodyMsgStyle}>
      <FileCode2 size={20} strokeWidth={1.5} style={{ opacity: 0.5 }} />
      <div style={{ fontSize: "var(--fs-13)", color: "var(--text-secondary)" }}>
        Select a node to edit its function
      </div>
      <div style={{ fontSize: "var(--fs-12)", maxWidth: 300, lineHeight: 1.5 }}>
        Clicking any node in the thread or diagram loads its enclosing
        function here.
      </div>
    </div>
  );
}

const bodyMsgStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: 32,
  textAlign: "center",
  color: "var(--text-muted)",
};

export function CenterMsg(props: { color: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: props.color,
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fsm-13)",
      }}
    >
      {props.children}
    </div>
  );
}

// ── dirty-guard prompt ───────────────────────────────────────────────

export function DirtyPrompt(props: {
  fromName: string | null;
  toName: string;
  onDiscard: () => void;
  onKeep: () => void;
}) {
  return (
    <div
      data-editor-dirty-prompt
      style={{
        position: "absolute",
        inset: 0,
        background: "color-mix(in oklab, var(--bg-canvas) 82%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2,
        padding: 24,
      }}
    >
      <div
        style={{
          background: "var(--bg-node)",
          border: "1px solid var(--border-edge)",
          borderRadius: 12,
          padding: 20,
          maxWidth: 380,
          boxShadow: "var(--shadow-panel)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ fontSize: "var(--fs-14)", fontWeight: 600, color: "var(--text-primary)" }}>
          Unsaved changes
        </div>
        <div style={{ fontSize: "var(--fs-13)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
          You have unsaved edits{props.fromName ? <> in <code style={{ color: "var(--accent-thread)" }}>{props.fromName}</code></> : null}.
          Discard them and switch to <code style={{ color: "var(--accent-thread)" }}>{props.toName}</code>?
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <PromptButton onClick={props.onKeep} accent="var(--text-secondary)">Keep editing</PromptButton>
          <PromptButton onClick={props.onDiscard} accent="var(--accent-error)">Discard &amp; switch</PromptButton>
        </div>
      </div>
    </div>
  );
}

function PromptButton(props: { onClick: () => void; accent: string; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      style={{
        background: `color-mix(in oklab, ${props.accent} 12%, transparent)`,
        border: `1px solid color-mix(in oklab, ${props.accent} 40%, transparent)`,
        borderRadius: 6,
        color: props.accent,
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-12)",
        fontWeight: 600,
        padding: "6px 12px",
        cursor: "pointer",
      }}
    >
      {props.children}
    </button>
  );
}

// ── footer (Save / Cancel) ───────────────────────────────────────────

export function Footer(props: {
  dirty: boolean;
  saving: boolean;
  note: string | null;
  saveError: { message: string; errorKind: string | null } | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { dirty, saving, note, saveError } = props;
  const canSave = dirty && !saving;
  const canCancel = dirty && !saving;
  // M-FS6 — the error strip answers "what went wrong, in my terms" (the
  // m19 evidence-label lesson applied here): the errorKind taxonomy is
  // the right vocabulary for tools, not for the human reading the strip.
  // Raw detail stays in the title tooltip + the tail of the line.
  const ERROR_HEADLINE: Record<string, string> = {
    parse_error: "That edit isn't valid Python — nothing was saved.",
    diff_confinement_failed: "The edit would change lines outside this node — nothing was saved.",
    wrong_node_kind: "This operation doesn't apply to this kind of node.",
    invalid_identifier: "That name isn't a valid Python identifier.",
    target_not_found: "This node has moved or been removed — reopen it and retry.",
    unused_import: "The edit adds an import nothing in the node uses.",
    empty_source: "The replacement is empty — a save would silently delete the node.",
    file_exists: "That file already exists — nothing was overwritten.",
  };
  const headline = saveError?.errorKind ? ERROR_HEADLINE[saveError.errorKind] : undefined;
  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: "1px solid var(--border-edge)",
        background: "var(--bg-node)",
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* Inline error row (§A.1) — single line, truncated, accent-error. */}
      {saveError && (
        <div
          data-editor-save-error
          data-error-kind={saveError.errorKind ?? ""}
          title={saveError.message}
          style={{
            fontSize: "var(--fs-12)",
            fontFamily: "var(--font-mono)",
            color: "var(--accent-error)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {headline ? `${headline} ` : saveError.errorKind ? `[${saveError.errorKind}] ` : ""}
          {headline ? (
            <span style={{ color: "var(--text-muted)" }}>{saveError.message}</span>
          ) : (
            saveError.message
          )}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          data-editor-note
          style={{
            flex: 1,
            fontSize: "var(--fs-11)",
            fontFamily: "var(--font-mono)",
            color: note ? "var(--accent-thread)" : "var(--text-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {note ?? "Edits commit through the CST rewriter — black-formatted, diff-confined."}
        </span>
        <button
          data-editor-cancel
          onClick={props.onCancel}
          disabled={!canCancel}
          style={{
            background: "transparent",
            border: "1px solid var(--border-edge)",
            borderRadius: 6,
            color: canCancel ? "var(--text-secondary)" : "var(--text-muted)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-12)",
            fontWeight: 600,
            padding: "6px 14px",
            cursor: canCancel ? "pointer" : "not-allowed",
            opacity: canCancel ? 1 : 0.5,
          }}
        >
          Cancel
        </button>
        <button
          data-editor-save
          onClick={props.onSave}
          disabled={!canSave}
          style={{
            background: canSave
              ? "color-mix(in oklab, var(--accent-thread) 18%, transparent)"
              : "transparent",
            border: `1px solid color-mix(in oklab, var(--accent-thread) ${canSave ? 60 : 25}%, transparent)`,
            borderRadius: 6,
            color: "var(--accent-thread)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-12)",
            fontWeight: 600,
            padding: "6px 14px",
            cursor: canSave ? "pointer" : "not-allowed",
            opacity: canSave ? 1 : 0.5,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
