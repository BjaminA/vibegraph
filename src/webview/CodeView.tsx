// Read-only code-view panel (M5 wave 2).
//
// Mirrors MonacoOverlay's right-edge layout but renders the full file
// source in read-only mode. Theme is vibegraph-dark (wave 1) so the
// chrome and syntax both derive from tokens.css -- opening it next to
// the diagram view should produce no colour clash.
//
// State flow: App.tsx owns `fileSource` / `fileSourceError`, sets them
// from useWebSocketHandler's `file-source` / `file-source-error`
// messages, and passes them in here as props. CodeView itself is
// stateless past the editor instance ref.

import React, { useRef, useEffect, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { X, Maximize2, Minimize2, WrapText } from "lucide-react";
import { defineVibegraphDark, VIBEGRAPH_DARK } from "./themes/vibegraph-dark";
import type { AstNode } from "./types";

// Dock geometry — App tiles CodeView and NodeEditorPanel side-by-side when
// both are open (read here, edit there). Defaults to the solo full-width
// right dock when no override is passed.
export interface Dock {
  right: number | string;
  width: number | string;
  minWidth: number;
  // M28.3 — bottom inset reserving room for the chat docked beneath the
  // code column. 0 (default) → the panel runs full height.
  bottom?: number;
}
const SOLO_DOCK: Dock = { right: 0, width: "44%", minWidth: 480 };

// Shared chrome for the header icon toggles (wrap / full-screen). `active`
// tints the control with the thread accent so its on-state reads at a
// glance. Mirrors the close button's border/padding.
function headerBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "color-mix(in oklab, var(--accent-thread) 16%, transparent)" : "transparent",
    border: `1px solid ${active ? "color-mix(in oklab, var(--accent-thread) 55%, transparent)" : "var(--border-edge)"}`,
    borderRadius: 4,
    color: active ? "var(--accent-thread)" : "var(--text-secondary)",
    padding: "4px 8px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transition: "color 0.12s, border-color 0.12s, background 0.12s",
  };
}

interface Props {
  filePath: string | null;
  source: string | null;
  error: string | null;
  astNodes: AstNode[];
  selectedNodeId: string | null;
  onClose: () => void;
  dock?: Dock;
}

// Find the smallest AST node whose [line, endLine] span contains the
// given line. Returns null if none qualifies. Used by the cursor->
// selection bridge so clicking inside a function picks the function,
// not the module root.
function nodeAtLine(astNodes: AstNode[], line: number): AstNode | null {
  let best: AstNode | null = null;
  let bestSpan = Infinity;
  for (const n of astNodes) {
    if (n.line == null || n.endLine == null) continue;
    if (n.line > line || n.endLine < line) continue;
    const span = n.endLine - n.line;
    if (span < bestSpan) {
      best = n;
      bestSpan = span;
    }
  }
  return best;
}

export function CodeView({
  filePath, source, error, astNodes, selectedNodeId, onClose, dock = SOLO_DOCK,
}: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  // Saved on mount so the pulse decoration can construct a monaco.Range.
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  // Suppresses the cursor->selection emit when the cursor moves because
  // _we_ just scrolled it in response to an external selection. Without
  // this the editor enters a feedback loop with the diagram view.
  const ignoreNextCursorRef = useRef(false);
  // IDs of the currently-applied pulse decorations so we can clear
  // them on the next selection change.
  const pulseDecorationsRef = useRef<string[]>([]);
  // M-FV.1 (W4) — full-screen breaks the panel out of its right-edge dock
  // to cover the viewport; wrap defaults ON so a long source line is never
  // silently clipped behind the right edge (the brief's complaint). The
  // wrap toggle drops back to horizontal scroll (with a visible scrollbar)
  // for readers who prefer one-line-per-statement.
  const [fullscreen, setFullscreen] = useState(false);
  const [wrap, setWrap] = useState(true);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.onDidChangeCursorPosition((e) => {
      if (ignoreNextCursorRef.current) {
        ignoreNextCursorRef.current = false;
        return;
      }
      if (!filePath) return;
      const node = nodeAtLine(astNodes, e.position.lineNumber);
      if (!node) return;
      document.dispatchEvent(new CustomEvent("vg-selection", {
        detail: { filePath, irNodeId: node.id, source: "code" },
      }));
    });
  };

  // Escape always closes. Mirrors MonacoOverlay/NodeExpandedOverlay --
  // the file panel covers 44% of the viewport, so a keyboard-only
  // dismiss path matters when the X button is off-screen on narrow
  // displays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc steps out of full-screen first, then closes on a second press.
      if (fullscreen) { setFullscreen(false); return; }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, fullscreen]);

  // External selection -> scroll Monaco + pulse-highlight the range.
  // The smallest enclosing function tends to be the most useful focus
  // target, so we reveal [line, endLine] centered, drop the cursor on
  // the first line, then add a 600ms whole-line decoration that fades
  // via vg-pulse-kf. Decorations from a prior selection are cleared
  // first so two rapid clicks don't stack glow.
  useEffect(() => {
    if (!selectedNodeId || !editorRef.current || !monacoRef.current) return;
    const node = astNodes.find((n) => n.id === selectedNodeId);
    if (!node || node.line == null || node.endLine == null) return;
    ignoreNextCursorRef.current = true;
    editorRef.current.revealLinesInCenter(node.line, node.endLine);
    editorRef.current.setPosition({ lineNumber: node.line, column: 1 });

    const monaco = monacoRef.current;
    const newDecorations = editorRef.current.deltaDecorations(
      pulseDecorationsRef.current,
      [{
        range: new monaco.Range(node.line, 1, node.endLine, 1),
        options: {
          isWholeLine: true,
          className: "vg-pulse-line",
        },
      }],
    );
    pulseDecorationsRef.current = newDecorations;
    // Clear after the animation so the className doesn't linger on
    // the line and re-trigger if Monaco rebuilds the row.
    const t = setTimeout(() => {
      if (!editorRef.current) return;
      pulseDecorationsRef.current = editorRef.current.deltaDecorations(
        pulseDecorationsRef.current,
        [],
      );
    }, 650);
    return () => clearTimeout(t);
  }, [selectedNodeId, astNodes]);

  // Header label: just the basename so a long absolute path doesn't
  // dominate the bar. Full path lives in the title= tooltip.
  const fileLabel = filePath ? filePath.split("/").pop() ?? filePath : "(no file)";

  return (
    <div
      data-code-view
      data-fullscreen={fullscreen ? "true" : "false"}
      style={{
        position: "fixed",
        // Full-screen breaks out of the right-edge dock to cover the
        // viewport; otherwise it tiles into the dock geometry App passes.
        ...(fullscreen
          ? { top: 0, right: 0, bottom: 0, left: 0, width: "100%", minWidth: 0 }
          : { top: 0, bottom: dock.bottom ?? 0, right: dock.right, width: dock.width, minWidth: dock.minWidth }),
        // The TopToolbar (z 1010) floats above this dock; reserve its band
        // so the header row clears it instead of rendering behind it
        // (same pattern as NodeEditorPanel).
        paddingTop: 48,
        background: "var(--bg-canvas)",
        borderLeft: "2px solid color-mix(in oklab, var(--accent-thread) 27%, transparent)",
        display: "flex",
        flexDirection: "column",
        zIndex: 990, // below MonacoOverlay (1000) so edit overlay can stack
        boxShadow: "-8px 0 40px hsl(0 0% 0% / 0.6)",
      }}
    >
      {/* ── header ── */}
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
        {/* Close on the LEFT so the top-right TopToolbar (z-index 1010)
            can't intercept its clicks. See the post-M7 close-affordance
            fix in MonacoOverlay for the matching rationale. */}
        <button
          data-code-view-close
          onClick={onClose}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "color-mix(in oklab, var(--accent-error) 14%, transparent)";
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "color-mix(in oklab, var(--accent-error) 60%, transparent)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--accent-error)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-edge)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
          }}
          title="Close code view (Esc)"
          aria-label="Close code view"
          style={{
            background: "transparent",
            border: "1px solid var(--border-edge)",
            borderRadius: 4,
            color: "var(--text-secondary)",
            padding: "4px 10px",
            fontSize: "var(--fs-11)",
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "color 0.12s, border-color 0.12s, background 0.12s",
          }}
        >
          <X size={16} strokeWidth={1.75} />
        </button>
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
          CODE
        </span>
        <span
          title={filePath ?? ""}
          style={{
            color: "var(--text-primary)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fsm-13)",
            fontWeight: 700,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {fileLabel}
        </span>
      </div>

      {/* ── editor area ── */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {error ? (
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              height: "100%", color: "var(--accent-error)",
              fontSize: "var(--fsm-13)", fontFamily: "var(--font-mono)", padding: 20,
            }}
          >
            {error}
          </div>
        ) : source === null ? (
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              height: "100%", color: "var(--text-muted)",
              fontSize: "var(--fsm-13)", fontFamily: "var(--font-mono)",
            }}
          >
            Loading…
          </div>
        ) : (
          <Editor
            height="100%"
            language="python"
            value={source}
            beforeMount={defineVibegraphDark}
            onMount={handleMount}
            theme={VIBEGRAPH_DARK}
            options={{
              readOnly: true,
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              // M-FV.1 — wrap state, and re-measure on container resize so
              // full-screen / dock-width / window changes never leave Monaco
              // sized to a stale width (it has no ResizeObserver of its own).
              wordWrap: wrap ? "on" : "off",
              automaticLayout: true,
              renderLineHighlight: "all",
              padding: { top: 12, bottom: 12 },
              glyphMargin: false,
              folding: false,
              lineDecorationsWidth: 8,
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              // Visible (not 6px hair-thin) scrollbar so no-wrap mode's
              // horizontal scroll is discoverable, not silent truncation.
              scrollbar: {
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
              },
              domReadOnly: true,
            }}
          />
        )}
      </div>

      {/* M-FV.1 — wrap + full-screen toggles float at the panel's
          bottom-right, clear of the TopToolbar (z 1010, top-right) which
          would intercept clicks anywhere in the header's top band. The
          bottom corner is collision-free in both docked and full-screen
          modes. */}
      <div
        style={{
          position: "absolute",
          bottom: 12,
          right: 12,
          display: "flex",
          gap: 6,
          zIndex: 1,
        }}
      >
        <button
          data-code-view-wrap
          onClick={() => setWrap((w) => !w)}
          title={wrap ? "Wrap long lines: on (click for horizontal scroll)" : "Wrap long lines: off (click to wrap)"}
          aria-label="Toggle line wrap"
          style={headerBtnStyle(wrap)}
        >
          <WrapText size={16} strokeWidth={1.75} />
        </button>
        <button
          data-code-view-fullscreen
          onClick={() => setFullscreen((f) => !f)}
          title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
          aria-label="Toggle full screen"
          style={headerBtnStyle(fullscreen)}
        >
          {fullscreen ? <Minimize2 size={16} strokeWidth={1.75} /> : <Maximize2 size={16} strokeWidth={1.75} />}
        </button>
      </div>
    </div>
  );
}
