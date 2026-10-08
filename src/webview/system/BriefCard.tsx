// THE BRIEF on the map (2026-10-08): a card pinned top-left at every zoom —
// what the system is for (Function), how it holds together (Method) and its
// key features — each line lighting the boxes it names. Ratified lines are
// solid; a STALE line (code it cites changed) says so; a PROPOSED brief is
// ghosted, with Ratify / Reject per section (a person's step). "Brief this
// codebase" asks for the estimate first, then spends the one call
// (src/server/brief_server.ts). Folded by default: it sits over the canvas.

import React, { useEffect, useState } from "react";
import { ScrollText, Sparkles, Check, X, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { bridge, type ExtensionMessage } from "../types";
import type { BriefLine } from "../../shared/brief_types";

interface Section { section: string; summary: string }
interface BriefStatePayload {
  available: boolean; claude?: boolean; reason?: string;
  ratified: null | { at: string; by: string; model: string; spec?: { function: BriefLine[]; method: BriefLine[]; feature: BriefLine[] } };
  proposed: null | { model: string; at: string; spec: { function: BriefLine[]; method: BriefLine[]; feature: BriefLine[] }; refused: number; omitted: string[]; sections: Section[] };
}

const quiet: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-muted)" };
const btn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--border-edge)", borderRadius: 4, padding: "4px 8px",
  background: "transparent", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", cursor: "pointer",
};
const PARTS: Array<[string, "function" | "method" | "feature"]> = [["Function", "function"], ["Method", "method"], ["Key features", "feature"]];

function Lines({ spec, ghost, onLight }: { spec: NonNullable<BriefStatePayload["ratified"]>["spec"]; ghost?: boolean; onLight: (boxes: string[] | null) => void }) {
  if (!spec) return null;
  return (
    <>
      {PARTS.map(([title, part]) => spec[part].length ? (
        <div key={part} data-brief-part={part} style={{ marginTop: 8 }}>
          <div style={{ ...quiet, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{title}</div>
          {spec[part].map((l, i) => (
            <button key={i} data-brief-line={part} data-brief-stale={l.stale?.length ? "true" : undefined} data-brief-inferred={l.cites.length ? undefined : "true"}
              onClick={() => onLight(l.boxes?.length ? l.boxes : null)}
              title={`${l.words.join(", ")}\n${l.cites.length ? `cites ${l.cites.join(", ")}` : "INFERRED — no citation"}${l.stale?.length ? `\nSTALE: ${l.stale.join(", ")} changed` : ""}`}
              style={{
                display: "block", width: "100%", textAlign: "left", background: "transparent", cursor: l.boxes?.length ? "pointer" : "default",
                border: ghost ? "1px dashed var(--proposed-border)" : "1px solid transparent", borderRadius: 4, padding: "4px 4px", marginTop: 4,
                color: "var(--text-primary)", opacity: l.cites.length ? (ghost ? 0.8 : 1) : 0.55, fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", lineHeight: 1.4,
              }}>
              {l.stale?.length ? <AlertTriangle size={16} strokeWidth={1.5} style={{ color: "var(--accent-warning)", verticalAlign: "middle", marginRight: 4 }} /> : null}
              {l.text}
            </button>
          ))}
        </div>
      ) : null)}
    </>
  );
}

export function BriefCard({ onLight }: { onLight: (boxes: string[] | null) => void }) {
  const [state, setState] = useState<BriefStatePayload | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<{ calls: number; tokens: number; silent: number } | null>(null);
  useEffect(() => {
    const h = (m: ExtensionMessage) => {
      const x = m as unknown as { type: string; payload?: any };
      if (x.type === "brief-state") setState(x.payload as BriefStatePayload);
      if (x.type !== "brief-result") return;
      const p = x.payload ?? {};
      setBusy(null);
      if (!p.ok) { setError(p.error ?? "failed"); return; }
      setError(null);
      if (p.action === "estimate") setEstimate({ calls: p.calls, tokens: p.tokens, silent: p.silent });
      if (p.action === "run") setEstimate(null);
    };
    bridge.onMessage(h);
    bridge.postMessage({ type: "brief-get" } as never);
    return () => bridge.removeListener(h);
  }, []);
  if (!state?.available) return null;
  const send = (type: string, payload: Record<string, unknown> = {}) => { setBusy(type); setError(null); bridge.postMessage({ type, payload } as never); };
  const r = state.ratified, p = state.proposed;
  const staleCount = r?.spec ? [...r.spec.function, ...r.spec.method, ...r.spec.feature].filter((l) => l.stale?.length).length : 0;
  const status = p ? "proposed" : r?.spec ? (staleCount ? `${staleCount} stale` : "ratified") : "none";
  return (
    <div data-brief-card data-brief-state={p ? "proposed" : r?.spec ? "ratified" : "none"} style={{
      position: "absolute", top: "calc(var(--vg-lens-bar-bottom, 120px) + 8px)", left: 16, zIndex: 33, width: open ? 360 : "auto", maxHeight: "60vh", overflowY: open ? "auto" : "visible",
      background: "color-mix(in oklab, var(--bg-node) 94%, transparent)", border: `1px ${p ? "dashed var(--proposed-border)" : "solid var(--border-edge)"}`,
      borderRadius: 8, padding: "8px 12px", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-secondary)", pointerEvents: "auto",
    }}>
      <button data-brief-toggle aria-expanded={open} onClick={() => { setOpen((o) => !o); onLight(null); }} style={{ display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)" }}>
        <ScrollText size={16} strokeWidth={1.5} /> Brief
        <span style={{ ...quiet, color: staleCount ? "var(--accent-warning)" : p ? "var(--proposed-border)" : "var(--text-muted)" }}>· {status}</span>
        {open ? <ChevronDown size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
      </button>
      {open && (
        <div>
          {r?.spec && <div style={{ ...quiet, marginTop: 4 }}>{`ratified ${r.at.slice(0, 10)} by ${r.by} · written by ${r.model} · click a line to light its boxes`}</div>}
          {r?.spec && <Lines spec={r.spec} onLight={onLight} />}
          {p && (
            <div data-brief-proposal style={{ marginTop: 12, paddingTop: 8, borderTop: "1px dashed var(--proposed-border)" }}>
              <div style={{ ...quiet, color: "var(--proposed-border)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{`Proposed · ${p.model}`}</div>
              <Lines spec={p.spec} ghost onLight={onLight} />
              {p.sections.map((s) => (
                <div key={s.section} data-brief-section={s.section} style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                  <span style={{ flex: "1 1 160px" }}>{s.section}: {s.summary}</span>
                  <button data-brief-ratify={s.section} disabled={!!busy} onClick={() => send("brief-decide", { section: s.section, decision: "ratify" })} style={btn}><Check size={16} strokeWidth={1.5} />Ratify</button>
                  <button data-brief-reject={s.section} disabled={!!busy} onClick={() => send("brief-decide", { section: s.section, decision: "reject" })} style={btn}><X size={16} strokeWidth={1.5} />Reject</button>
                </div>
              ))}
              {(p.refused > 0 || p.omitted.length > 0) && <div style={{ ...quiet, marginTop: 4 }} title={p.omitted.join("\n")}>{`${p.refused} item(s) refused by the checks · ${p.omitted.length} left out`}</div>}
            </div>
          )}
          <div style={{ display: "flex", gap: 4, marginTop: 12, flexWrap: "wrap" }}>
            {staleCount > 0 && !p && <button data-brief-restate disabled={!!busy || !state.claude} onClick={() => send("brief-run", { stale: true })} style={btn}><Sparkles size={16} strokeWidth={1.5} />{busy === "brief-run" ? "Re-briefing…" : `Re-brief ${staleCount} stale line${staleCount === 1 ? "" : "s"}`}</button>}
            {!p && !estimate && <button data-brief-ask disabled={!!busy || !state.claude} onClick={() => send("brief-estimate")} style={btn}><Sparkles size={16} strokeWidth={1.5} />{r?.spec ? "Brief again" : "Brief this codebase"}</button>}
            {!p && estimate && (
              <>
                <span data-brief-estimate style={{ ...quiet, alignSelf: "center" }}>{`≈ ${estimate.calls} call${estimate.calls === 1 ? "" : "s"}, ~${Math.round(estimate.tokens / 1000)}k tokens`}</span>
                <button data-brief-run disabled={!!busy} onClick={() => send("brief-run")} style={btn}>{busy === "brief-run" ? "Briefing… (a minute or two)" : "Draft it"}</button>
                <button disabled={!!busy} onClick={() => setEstimate(null)} style={btn}>Cancel</button>
              </>
            )}
          </div>
          {!state.claude && <div style={{ ...quiet, marginTop: 4 }}>the claude CLI is not available here — `vibegraph-knowledge brief codebase` with a saved reply works from the command line</div>}
          {error && <div data-brief-error style={{ ...quiet, color: "var(--accent-error)", marginTop: 4 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
