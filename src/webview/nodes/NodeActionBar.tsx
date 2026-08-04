import React, { useState, useCallback } from "react";
import { bridge, type RunOutput } from "../types";

interface NodeActionBarProps {
  nodeId: string;
  showRun: boolean;
  accentColor: string;
  isRunning?: boolean;
  isModifying?: boolean;
  runOutput?: RunOutput | null;
}

function WandIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M2 14L10 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 6L12 2L14 4L10 6Z" fill={color} />
      <circle cx="6" cy="2" r="1" fill={color} opacity="0.5" />
      <circle cx="14" cy="8" r="1" fill={color} opacity="0.5" />
      <circle cx="4" cy="8" r="0.7" fill={color} opacity="0.4" />
    </svg>
  );
}

function PlayIcon({ color }: { color: string }) {
  return (
    <svg width="12" height="14" viewBox="0 0 12 14" fill={color}>
      <path d="M1 1.5V12.5L11 7L1 1.5Z" />
    </svg>
  );
}

function Spinner({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" style={{ animation: "spin 1s linear infinite" }}>
      <circle cx="8" cy="8" r="6" stroke={color} strokeWidth="2" fill="none" strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

export function NodeActionBar({
  nodeId,
  showRun,
  accentColor,
  isRunning,
  isModifying,
  runOutput,
}: NodeActionBarProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptText, setPromptText] = useState("");

  const handleModifySubmit = useCallback(() => {
    if (promptText.trim()) {
      bridge.postMessage({
        type: "modify-node",
        payload: { nodeId, prompt: promptText.trim() },
      });
      setPromptText("");
      setShowPrompt(false);
    }
  }, [nodeId, promptText]);

  const handleRun = useCallback(() => {
    bridge.postMessage({ type: "run-node", payload: { nodeId } });
    // Notify App to set isRunning optimistically
    window.dispatchEvent(new CustomEvent("vg-run-start", { detail: { nodeId } }));
  }, [nodeId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleModifySubmit();
      if (e.key === "Escape") setShowPrompt(false);
    },
    [handleModifySubmit]
  );

  const successAccent = "var(--accent-thread)";

  return (
    <div style={{ borderTop: "1px solid color-mix(in oklab, var(--text-primary) 8%, transparent)", padding: "var(--node-pad-y) var(--node-pad-x)" }}>
      {/* Button row */}
      <div style={{ display: "flex", gap: "var(--sp-1)" }}>
        {/* Modify button */}
        <button
          onClick={() => setShowPrompt(!showPrompt)}
          disabled={isModifying}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--sp-1)",
            background: isModifying
              ? "color-mix(in oklab, var(--text-primary) 5%, transparent)"
              : "color-mix(in oklab, var(--text-primary) 8%, transparent)",
            border: `1px solid color-mix(in oklab, ${accentColor} 20%, transparent)`,
            borderRadius: 6,
            padding: "var(--sp-1) var(--sp-2)",
            fontSize: 10,
            color: accentColor,
            cursor: isModifying ? "wait" : "pointer",
            transition: "background 0.15s",
          }}
        >
          {isModifying ? <Spinner color={accentColor} /> : <WandIcon color={accentColor} />}
          {isModifying ? "Modifying..." : "Modify"}
        </button>

        {/* Run button */}
        {showRun && (
          <button
            onClick={handleRun}
            disabled={isRunning}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--sp-1)",
              background: isRunning
                ? "color-mix(in oklab, var(--text-primary) 5%, transparent)"
                : "color-mix(in oklab, var(--accent-thread) 12%, transparent)",
              border: "1px solid color-mix(in oklab, var(--accent-thread) 30%, transparent)",
              borderRadius: 6,
              padding: "var(--sp-1) var(--sp-2)",
              fontSize: 10,
              color: successAccent,
              cursor: isRunning ? "wait" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {isRunning ? <Spinner color={successAccent} /> : <PlayIcon color={successAccent} />}
            {isRunning ? "Running..." : "Run"}
          </button>
        )}
      </div>

      {/* Modify prompt input */}
      {showPrompt && !isModifying && (
        <div style={{ marginTop: 6 }}>
          <input
            type="text"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. 'make this faster'"
            autoFocus
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "color-mix(in oklab, var(--bg-canvas) 70%, transparent)",
              border: `1px solid color-mix(in oklab, ${accentColor} 27%, transparent)`,
              borderRadius: 5,
              padding: "5px 8px",
              fontSize: 10,
              color: "var(--text-primary)",
              outline: "none",
            }}
          />
          <div style={{ fontSize: 9, opacity: 0.4, marginTop: 2, textAlign: "center" }}>
            Enter to send to Claude &middot; Esc to cancel
          </div>
        </div>
      )}

      {/* Run output panel */}
      {runOutput && (
        <div
          style={{
            marginTop: 6,
            background: "color-mix(in oklab, var(--bg-canvas) 80%, transparent)",
            borderRadius: 6,
            padding: "6px 8px",
            maxHeight: 120,
            overflowY: "auto",
            fontSize: 10,
            fontFamily: "monospace",
            lineHeight: 1.5,
          }}
        >
          {runOutput.stdout && (
            <pre style={{ margin: 0, color: "var(--accent-thread)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {runOutput.stdout}
            </pre>
          )}
          {runOutput.stderr && (
            <pre style={{ margin: 0, color: "var(--accent-error)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {runOutput.stderr}
            </pre>
          )}
          <div style={{ color: runOutput.exitCode === 0 ? "var(--accent-thread)" : "var(--accent-error)", marginTop: 2, fontSize: 9, opacity: 0.6 }}>
            exit {runOutput.exitCode}
          </div>
        </div>
      )}
    </div>
  );
}
