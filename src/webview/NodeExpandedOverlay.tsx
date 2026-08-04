import React, { useEffect } from "react";
import type { AstNode } from "./types";

// Phase 2 — expand-in-place as an overlay (NOT layout reflow).
// The expanded node is rendered absolutely on top of the canvas, casts
// --shadow-panel, and reuses .vg-has-selection's attention-fade language
// to dim the rest. No neighbour displacement; spatial memory preserved.
//
// Content is what's already in IR `data` — full text, no truncation. Full
// body source (Monaco-highlighted) lands with M5's code view; this just
// demonstrates the interaction model so we can lock the Gate 2 decision.

interface Props {
  node: AstNode;
  onClose: () => void;
}

export function NodeExpandedOverlay({ node, onClose }: Props) {
  // Esc closes — keyboard parity with other overlays (FiltersPanel etc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Dim scrim catches background clicks. Uses --motion-fade-dur so it
          fades in alongside the attention-fade we trigger on body. */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "color-mix(in oklab, var(--bg-canvas) 60%, transparent)",
          zIndex: 900,
          animation: "vg-view-enter-kf var(--motion-view-dur) var(--motion-view-ease) both",
        }}
      />
      {/* The expanded card itself — centred, max 720px, z above scrim. */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(720px, 80vw)",
          maxHeight: "80vh",
          overflow: "auto",
          background: "var(--bg-node)",
          border: "1px solid var(--border-edge)",
          borderRadius: 10,
          boxShadow: "var(--shadow-panel)",
          padding: "var(--sp-4)",
          zIndex: 920,
          fontFamily: "var(--font-mono)",
          color: "var(--text-primary)",
          animation: "vg-view-enter-kf var(--motion-view-dur) var(--motion-view-ease) both",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: "var(--sp-3)",
          paddingBottom: "var(--sp-2)",
          borderBottom: "1px solid var(--border-edge)",
        }}>
          <span style={{
            fontSize: "var(--fs-11)", color: "var(--text-muted)",
            letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700,
          }}>
            {node.type.replace("_", " ")}
          </span>
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: "var(--fs-14)",
              padding: 0,
            }}
          >
            ✕
          </button>
        </div>
        <ExpandedBody node={node} />
      </div>
    </>
  );
}

function ExpandedBody({ node }: { node: AstNode }) {
  // Per-type rendering of what's already in the IR. Full body source
  // (functions/classes) is deferred to M5's Monaco code view — for now
  // we show every field the IR carries.
  const n = node as any;
  switch (node.type) {
    case "function_def":
      return (
        <div>
          <h3 style={{ margin: 0, fontSize: "var(--fs-16)", color: "var(--accent-thread)" }}>
            def {n.name}({(n.params ?? []).join(", ")})
          </h3>
          {n.docstring && (
            <p style={{
              marginTop: "var(--sp-3)",
              color: "var(--text-secondary)", fontSize: "var(--fs-12)",
              fontStyle: "italic", whiteSpace: "pre-wrap",
            }}>
              {n.docstring}
            </p>
          )}
          <Hint>Full body source arrives with M5's Monaco code view.</Hint>
        </div>
      );
    case "class_def":
      return (
        <div>
          <h3 style={{ margin: 0, fontSize: "var(--fs-16)", color: "var(--accent-thread)" }}>
            class {n.name}{n.bases?.length ? `(${n.bases.join(", ")})` : ""}
          </h3>
          <Hint>Member methods are individual nodes — expand them to see details.</Hint>
        </div>
      );
    case "assignment":
      return (
        <div>
          <KV k="name" v={n.name} />
          <KV k="kind" v={n.valueKind} />
          <KV k="preview" v={n.preview} mono />
          {n.callTarget && <KV k="callTarget" v={n.callTarget} mono />}
        </div>
      );
    case "import":
      return <div><KV k="names" v={(n.names ?? []).join(", ")} mono /></div>;
    case "import_from":
      return (
        <div>
          <KV k="module" v={n.module} mono />
          <KV k="names" v={(n.names ?? []).join(", ")} mono />
        </div>
      );
    case "for_loop":
      return (
        <div>
          <KV k="for" v={n.target} mono />
          <KV k="in" v={n.iterName} mono />
        </div>
      );
    case "if_stmt":
      return (
        <div>
          <KV k="condition" v={n.condition} mono />
          <KV k="hasElse" v={String(n.hasElse)} />
        </div>
      );
    case "return_stmt":
      return <div><KV k="returns" v={n.value ?? "None"} mono /></div>;
    case "raise_stmt":
      return <div><KV k="raises" v={n.exc ?? "(bare)"} mono /></div>;
    case "call":
      return (
        <div>
          <KV k="callee" v={n.funcName} mono />
          <KV k="args" v={(n.args ?? []).join(", ")} mono />
          <KV k="isEffect" v={String(n.isEffect)} />
        </div>
      );
    default:
      return <Hint>No expanded view defined for {node.type}.</Hint>;
  }
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: "var(--sp-3)", marginBottom: "var(--sp-2)", alignItems: "baseline" }}>
      <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-11)", minWidth: 80 }}>{k}</span>
      <span style={{
        color: "var(--text-primary)",
        fontSize: "var(--fs-13)",
        fontFamily: mono ? "var(--font-mono)" : "inherit",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}>
        {v || "—"}
      </span>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      marginTop: "var(--sp-3)",
      color: "var(--text-muted)",
      fontSize: "var(--fs-11)",
      fontStyle: "italic",
    }}>
      {children}
    </p>
  );
}
