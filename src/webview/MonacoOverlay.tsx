import React, { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import { CODE_WRAP_OPTIONS } from "./monaco_options";
import { X, Check, AlertCircle } from "lucide-react";
import { bridge, type ExtensionMessage } from "./types";
import { defineVibegraphDark, VIBEGRAPH_DARK } from "./themes/vibegraph-dark";

interface Props {
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  // U1.1 — passing the active file lets the server resolve the node in
  // directory mode without falling back to resolvedPyFile (which is
  // the project root directory there, not a .py file → EISDIR crash).
  filePath?: string | null;
  onClose: () => void;
}

// Match the per-type accent each node component uses on the canvas, so the
// editor overlay reads as "the same node, zoomed in".
const TYPE_COLOR: Record<string, string> = {
  function_def: "var(--accent-thread)",
  class_def:    "var(--accent-thread)",
  assignment:   "var(--accent-warning)",
  for_loop:     "var(--text-secondary)",
  if_stmt:      "var(--text-secondary)",
  import:       "var(--accent-thread)",
  import_from:  "var(--accent-thread)",
  return_stmt:  "var(--text-secondary)",
  raise_stmt:   "var(--accent-error)",
  call:         "var(--type-call)",
};

export function MonacoOverlay({ nodeId, nodeType, nodeLabel, filePath, onClose }: Props) {
  const [source, setSource] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg?: string } | null>(null);

  useEffect(() => {
    bridge.postMessage({
      type: "edit-node-open",
      payload: { nodeId, ...(filePath ? { filePath } : {}) },
    });

    const handler = (msg: ExtensionMessage) => {
      if (msg.type === "edit-node-source" && msg.payload.nodeId === nodeId) {
        if (msg.payload.error) {
          setSaveResult({ ok: false, msg: msg.payload.error });
        } else {
          setSource(msg.payload.source);
          setValue(msg.payload.source);
        }
      } else if (msg.type === "edit-node-saved" && msg.payload.nodeId === nodeId) {
        setSaving(false);
        if (msg.payload.success) {
          setSaveResult({ ok: true });
          setTimeout(onClose, 700);
        } else {
          setSaveResult({ ok: false, msg: msg.payload.error ?? "Unknown error" });
        }
      }
    };

    bridge.onMessage(handler);
    return () => bridge.removeListener(handler);
  }, [nodeId]);

  // Escape always closes. Mirrors NodeExpandedOverlay's pattern -- a
  // keyboard escape hatch matters more here than for the canvas because
  // the overlay covers 44% of the viewport, and the X button alone was
  // easy to miss (see bug #1 in the M7 cleanup pass).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = () => {
    setSaving(true);
    setSaveResult(null);
    bridge.postMessage({ type: "edit-node-save", payload: { nodeId, newSource: value } });
  };

  const accent = TYPE_COLOR[nodeType] ?? "var(--text-primary)";

  return (
    <div
      data-monaco-overlay
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: "44%",
        minWidth: 480,
        height: "100%",
        // The TopToolbar (z 1010) floats above this overlay; reserve its
        // band so the header row (incl. the close X) clears it instead of
        // rendering behind it (same pattern as CodeView/NodeEditorPanel).
        paddingTop: 48,
        background: "var(--bg-node)",
        borderLeft: `2px solid color-mix(in oklab, ${accent} 27%, transparent)`,
        display: "flex",
        flexDirection: "column",
        zIndex: 1000,
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
        {/* Close lives on the LEFT so it's clear of the top-right
            TopToolbar (z-index 1010 vs panel 1000) — without this the
            toolbar's button cluster intercepts the X click. See the
            post-M7 close-affordance fix. */}
        <button
          data-monaco-overlay-close
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
          style={{
            background: "transparent",
            border: "1px solid var(--border-edge)",
            borderRadius: 4,
            color: "var(--text-secondary)",
            padding: "4px 10px",
            fontSize: 11,
            cursor: "pointer",
            fontFamily: "monospace",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "color 0.12s, border-color 0.12s, background 0.12s",
          }}
          title="Close editor (Esc)"
          aria-label="Close editor"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
        <span
          style={{
            color: accent,
            fontFamily: "monospace",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            opacity: 0.8,
            textTransform: "uppercase",
          }}
        >
          {nodeType.replace("_", " ")}
        </span>
        <span
          style={{
            color: "var(--text-primary)",
            fontFamily: "monospace",
            fontSize: 13,
            fontWeight: 700,
            maxWidth: 200,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {nodeLabel}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleSave}
          disabled={saving || source === null}
          style={{
            background: saving ? "var(--border-edge)" : `color-mix(in oklab, ${accent} 13%, transparent)`,
            color: saving ? "var(--text-muted)" : accent,
            border: `1px solid ${saving ? "var(--border-edge)" : `color-mix(in oklab, ${accent} 40%, transparent)`}`,
            borderRadius: 4,
            padding: "4px 14px",
            fontSize: 11,
            fontWeight: 700,
            cursor: saving || source === null ? "not-allowed" : "pointer",
            fontFamily: "monospace",
            letterSpacing: "0.05em",
            transition: "all 0.12s",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* ── status bar ── */}
      {saveResult && (
        <div
          style={{
            padding: "5px 14px",
            background: saveResult.ok
              ? "color-mix(in oklab, var(--accent-thread) 8%, transparent)"
              : "color-mix(in oklab, var(--accent-error) 8%, transparent)",
            color: saveResult.ok ? "var(--accent-thread)" : "var(--accent-error)",
            fontSize: 11,
            fontFamily: "monospace",
            borderBottom: "1px solid var(--border-edge)",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {saveResult.ok ? (
            <>
              <Check size={16} strokeWidth={1.5} />
              Saved
            </>
          ) : (
            <>
              <AlertCircle size={16} strokeWidth={1.5} />
              {saveResult.msg}
            </>
          )}
        </div>
      )}

      {/* ── editor area ── */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {source === null ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--text-muted)",
              fontSize: 13,
              fontFamily: "monospace",
            }}
          >
            Loading…
          </div>
        ) : (
          <Editor
            height="100%"
            language="python"
            value={value}
            onChange={(v) => setValue(v ?? "")}
            beforeMount={defineVibegraphDark}
            theme={VIBEGRAPH_DARK}
            options={{
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              ...CODE_WRAP_OPTIONS,
              renderLineHighlight: "all",
              padding: { top: 12, bottom: 12 },
              glyphMargin: false,
              folding: false,
              lineDecorationsWidth: 8,
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              scrollbar: {
                verticalScrollbarSize: 6,
                horizontalScrollbarSize: 6,
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
