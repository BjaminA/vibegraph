import React, { useState, useEffect } from "react";
import { Search, X, AlertCircle } from "lucide-react";
import { bridge, type ExtensionMessage } from "./types";

interface Props {
  activeFilePath: string | null;
  onClose: () => void;
}

type State =
  | { kind: "loading" }
  | { kind: "loaded"; summary: string; filePath: string }
  | { kind: "error"; message: string };

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

export function AnalysisCard({ activeFilePath, onClose }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const trigger = () => {
    setState({ kind: "loading" });
    bridge.postMessage({
      type: "analyze-file",
      payload: { filePath: activeFilePath ?? undefined },
    });
  };

  // Auto-trigger on mount
  useEffect(() => { trigger(); /* eslint-disable-line */ }, []);

  // Listen for results
  useEffect(() => {
    const handler = (msg: ExtensionMessage) => {
      if (msg.type === "analyze-result") {
        setState({ kind: "loaded", summary: msg.payload.summary, filePath: msg.payload.filePath });
      } else if (msg.type === "analyze-error") {
        setState({ kind: "error", message: msg.payload.message });
      }
    };
    bridge.onMessage(handler);
    return () => bridge.removeListener(handler);
  }, []);

  const fileName = state.kind === "loaded" ? basename(state.filePath) : (activeFilePath ? basename(activeFilePath) : "");

  return (
    <div
      style={{
        position: "fixed",
        top: 56,
        right: 18,
        width: 320,
        background: "var(--bg-node)",
        border: "1px solid var(--border-edge)",
        borderRadius: 10,
        zIndex: 870,
        fontFamily: "monospace",
        boxShadow: "var(--shadow-panel)",
        overflow: "hidden",
        animation: "vg-card-in 0.18s ease-out",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 12px",
          background: "var(--bg-node)",
          borderBottom: "1px solid var(--border-edge)",
        }}
      >
        <span style={{ color: "var(--accent-chat)", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Search size={16} strokeWidth={1.5} />
          Script Vibe
        </span>
        {fileName && (
          <span style={{ color: "var(--text-muted)", fontSize: 10, marginLeft: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {fileName}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Close"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      <div style={{ padding: "12px 14px", minHeight: 60 }}>
        {state.kind === "loading" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-secondary)", fontSize: 12 }}>
            <Spinner />
            <span>Analyzing…</span>
          </div>
        )}
        {state.kind === "loaded" && (
          <div style={{ color: "var(--text-primary)", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {state.summary}
          </div>
        )}
        {state.kind === "error" && (
          <div style={{ color: "var(--accent-error)", fontSize: 11, lineHeight: 1.5, display: "flex", alignItems: "center", gap: 6 }}>
            <AlertCircle size={16} strokeWidth={1.5} />
            {state.message}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "8px 12px",
          borderTop: "1px solid var(--border-edge)",
          background: "var(--bg-canvas)",
        }}
      >
        <button
          onClick={trigger}
          disabled={state.kind === "loading"}
          style={{
            flex: 1,
            background: state.kind === "loading" ? "var(--border-edge)" : "color-mix(in oklab, var(--accent-chat) 12%, transparent)",
            border: `1px solid ${state.kind === "loading" ? "var(--border-edge)" : "color-mix(in oklab, var(--accent-chat) 40%, transparent)"}`,
            borderRadius: 5,
            color: state.kind === "loading" ? "var(--text-muted)" : "var(--accent-chat)",
            fontSize: 10,
            fontWeight: 700,
            padding: "5px 0",
            cursor: state.kind === "loading" ? "not-allowed" : "pointer",
            fontFamily: "monospace",
          }}
        >
          ↻ Re-analyze
        </button>
      </div>

      <style>{`
        @keyframes vg-card-in {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes vg-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" style={{ animation: "vg-spin 0.9s linear infinite" }}>
      <circle cx="8" cy="8" r="6" stroke="var(--accent-chat)" strokeWidth="2" fill="none" strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round" />
    </svg>
  );
}
