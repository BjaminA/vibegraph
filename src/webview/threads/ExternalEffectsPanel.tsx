// M9.4 — external-effects summary panel for the thread view
// (PLAN-v2.md §2.3).
//
// Right-side collapsible panel. Two visual states:
//
//   - **List mode (default).** Vertical scroll list of every thread
//     node carrying an IR effectKind, in DFS pre-order from the seed.
//     Each row: kind-coloured icon + function name (JetBrains Mono
//     13) + truncated arg summary (Inter 12, --text-muted). Click
//     publishes vg-selection so the canvas + code view jump to the
//     node.
//
//   - **Edit-context mode.** When a ThreadNodeTooltip pins itself
//     open on an editable node, the panel swaps the list for a
//     read-only Monaco showing the full file content for that node,
//     scrolled to and pulse-highlighting the node's structural span.
//     Closing / unpinning the tooltip restores list mode. The thread
//     canvas stays mounted underneath the whole time — the panel is
//     overlay chrome, not a route change.
//
// Width: 280px expanded, 32px collapsed rail (vertical "External
// effects (N)" label). Toggle via the header chevron or the global
// `E` shortcut (handled in ThreadView).

import React, { useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { CODE_WRAP_OPTIONS } from "../monaco_options";
import { ChevronsRight, ChevronsLeft, Inbox, FileCode2 } from "lucide-react";
import type { Thread } from "./types";
import type { ProjectFileData } from "../../shared/protocol";
import { buildEffectRows, type EffectRow } from "./externalEffects";
import { bridge, type ExtensionMessage } from "../types";
import { defineVibegraphDark, VIBEGRAPH_DARK } from "../themes/vibegraph-dark";

export const PANEL_W_EXPANDED = 280;
export const PANEL_W_COLLAPSED = 32;

export interface EditContext {
  // The thread node currently being edited inline. Drives the split-
  // view file content + highlight in the panel. Span is resolved at
  // the ThreadView level (where projectIR is in scope), passed in
  // pre-computed so the panel doesn't race the WS roundtrip.
  nodeId: string;
  irNodeId: string;
  file: string;
  span: { line: number; endLine: number } | null;
}

export interface ExternalEffectsPanelProps {
  thread: Thread;
  projectIR: Record<string, ProjectFileData> | null;
  open: boolean;
  onToggle: () => void;
  editContext: EditContext | null;
}

export function ExternalEffectsPanel(props: ExternalEffectsPanelProps) {
  const { thread, projectIR, open, onToggle, editContext } = props;
  const rows = useMemo(
    () => buildEffectRows(thread, projectIR),
    [thread, projectIR],
  );

  return (
    <aside
      data-effects-panel
      data-open={open ? "true" : "false"}
      data-mode={editContext ? "edit" : "list"}
      style={{
        position: "absolute",
        // Clear the fixed TopToolbar's REAL bottom (it wraps at narrow
        // widths — --vg-toolbar-bottom is published by the toolbar itself).
        // Without this the panel's collapse button sits directly under the
        // toolbar's chips and pointer events go to them instead.
        top: "calc(var(--vg-toolbar-bottom, 43px) + 16px)",
        right: 0,
        bottom: 0,
        width: open ? PANEL_W_EXPANDED : PANEL_W_COLLAPSED,
        background: "var(--bg-node)",
        borderLeft: "1px solid var(--border-edge)",
        borderTop: "1px solid var(--border-edge)",
        borderTopLeftRadius: 8,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 5,
        transition: "width var(--motion-view-dur) var(--motion-view-ease)",
        fontFamily: "var(--font-ui)",
      }}
    >
      {open ? (
        <ExpandedHeader count={rows.length} onToggle={onToggle} mode={editContext ? "edit" : "list"} />
      ) : (
        <CollapsedRail count={rows.length} onToggle={onToggle} />
      )}
      {open && (editContext
        ? <EditContextBody editContext={editContext} />
        : <ListBody rows={rows} />)}
    </aside>
  );
}

// ── Headers ──────────────────────────────────────────────────────────────────

function ExpandedHeader(props: { count: number; onToggle: () => void; mode: "list" | "edit" }) {
  return (
    <header
      style={{
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        borderBottom: "1px solid var(--border-edge)",
        flexShrink: 0,
      }}
    >
      {props.mode === "edit"
        ? <FileCode2 size={14} strokeWidth={1.5} style={{ color: "var(--accent-thread)" }} />
        : <Inbox size={14} strokeWidth={1.5} style={{ color: "var(--accent-io)" }} />}
      <span
        style={{
          color: "var(--text-primary)",
          fontSize: "var(--fs-13)",
          fontWeight: 600,
          letterSpacing: "0.02em",
        }}
      >
        {props.mode === "edit" ? "Edit context" : `External effects (${props.count})`}
      </span>
      <div style={{ flex: 1 }} />
      <button
        data-effects-toggle
        onClick={props.onToggle}
        title="Collapse (E)"
        aria-label="Collapse effects panel"
        style={{
          background: "transparent",
          border: "1px solid var(--border-edge)",
          borderRadius: 4,
          color: "var(--text-secondary)",
          padding: "3px 6px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
        }}
      >
        <ChevronsRight size={13} strokeWidth={1.75} />
      </button>
    </header>
  );
}

function CollapsedRail(props: { count: number; onToggle: () => void }) {
  return (
    <button
      data-effects-toggle
      onClick={props.onToggle}
      title="Expand effects panel (E)"
      aria-label={`Expand effects panel (${props.count} effects)`}
      style={{
        flex: 1,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 0,
        color: "var(--text-secondary)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        height: "100%",
      }}
    >
      <span style={{ padding: "8px 0" }}>
        <ChevronsLeft size={14} strokeWidth={1.75} />
      </span>
      <span
        style={{
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
          fontSize: "var(--fs-11)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          whiteSpace: "nowrap",
        }}
      >
        External effects ({props.count})
      </span>
      <span style={{ padding: "8px 0" }} />
    </button>
  );
}

// ── List body ────────────────────────────────────────────────────────────────

function ListBody(props: { rows: EffectRow[] }) {
  if (props.rows.length === 0) {
    return (
      <div
        data-effects-empty
        style={{
          flex: 1,
          padding: "24px 16px",
          color: "var(--text-muted)",
          fontSize: "var(--fs-12)",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Inbox size={20} strokeWidth={1.5} style={{ opacity: 0.5 }} />
        No external effects in this thread.
      </div>
    );
  }
  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "4px 0",
      }}
    >
      {props.rows.map((row) => <Row key={row.nodeId} row={row} />)}
    </div>
  );
}

function Row(props: { row: EffectRow }) {
  const { row } = props;
  const Icon = row.icon.Icon;
  const handleClick = () => {
    // For terminals, selectIr/selectFile point at the calling
    // function so the panel still drives the canvas + code view.
    if (!row.selectIr || !row.selectFile) return;
    document.dispatchEvent(new CustomEvent("vg-selection", {
      detail: {
        filePath: row.selectFile,
        irNodeId: row.selectIr,
        source: "effects-panel",
      },
    }));
  };
  return (
    <button
      data-effect-row
      data-node-id={row.nodeId}
      data-kind-label={row.kindLabel}
      onClick={handleClick}
      style={{
        width: "100%",
        background: "transparent",
        border: "none",
        borderLeft: `2px solid transparent`,
        textAlign: "left",
        padding: "6px 12px 6px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        cursor: "pointer",
        transition: "background var(--motion-hover-dur) var(--motion-hover-ease), border-color var(--motion-hover-dur) var(--motion-hover-ease)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-node-hover)";
        e.currentTarget.style.borderLeftColor = `var(${row.accentVar})`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderLeftColor = "transparent";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon
          size={14}
          strokeWidth={1.5}
          style={{ color: `var(${row.accentVar})`, flexShrink: 0 }}
        />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fsm-13)",
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: 1,
          }}
          title={row.label}
        >
          {row.label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: `var(${row.accentVar})`,
            opacity: 0.85,
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          {row.kindLabel}
        </span>
      </div>
      {row.argSummary && (
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-12)",
            color: "var(--text-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            paddingLeft: 22,
          }}
          title={row.argSummary}
        >
          {row.argSummary}
        </span>
      )}
    </button>
  );
}

// ── Edit-context body ────────────────────────────────────────────────────────
//
// Fetches the full file source via the existing get-file-source WS
// flow (server.ts:1308-1336), scrolls to the edited node's span, and
// applies a whole-line decoration. Read-only — saves still go through
// ThreadNodeTooltip's editor; the panel is context, not a second
// editor.

function EditContextBody(props: { editContext: EditContext }) {
  const { editContext } = props;
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const decorationsRef = useRef<string[]>([]);

  useEffect(() => {
    setSource(null);
    setError(null);
    bridge.postMessage({
      type: "get-file-source",
      payload: { filePath: editContext.file },
    });
    const handler = (msg: ExtensionMessage) => {
      if (msg.type === "file-source" && msg.payload.filePath === editContext.file) {
        setSource(msg.payload.source);
      } else if (msg.type === "file-source-error" && msg.payload.filePath === editContext.file) {
        setError(msg.payload.message ?? "Failed to load file.");
      }
    };
    bridge.onMessage(handler);
    return () => bridge.removeListener(handler);
  }, [editContext.file]);
  const span = editContext.span;

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  // When the source + span are both available, scroll + highlight.
  useEffect(() => {
    const ed = editorRef.current;
    const mon = monacoRef.current;
    if (!ed || !mon || !span || source == null) return;
    ed.revealLinesInCenter(span.line, span.endLine);
    decorationsRef.current = ed.deltaDecorations(decorationsRef.current, [
      {
        range: new mon.Range(span.line, 1, span.endLine, 1),
        options: {
          isWholeLine: true,
          className: "vg-effects-panel-highlight",
        },
      },
    ]);
    return () => {
      if (editorRef.current) {
        decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, []);
      }
    };
  }, [source, span]);

  return (
    <div
      data-effects-edit-body
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "6px 12px",
          fontSize: "var(--fs-12)",
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
          borderBottom: "1px solid var(--border-edge)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={editContext.file}
      >
        {editContext.file}
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {error ? (
          <div style={{
            padding: "16px 18px",
            color: "var(--accent-error)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}>{error}</div>
        ) : source === null ? (
          <div style={{
            padding: "16px 18px",
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}>Loading…</div>
        ) : (
          <Editor
            height="100%"
            language="python"
            value={source}
            beforeMount={defineVibegraphDark}
            theme={VIBEGRAPH_DARK}
            onMount={handleMount}
            options={{
              readOnly: true,
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              ...CODE_WRAP_OPTIONS,
              padding: { top: 8, bottom: 8 },
              glyphMargin: false,
              folding: false,
              lineDecorationsWidth: 6,
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
            }}
          />
        )}
      </div>
    </div>
  );
}
