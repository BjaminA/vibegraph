// The trace overlay's controls (2026-10-02): pick a saved run, step through it
// (or play it — one step per 800 ms, a bounded loop that stops at the end; it
// does not autoplay under prefers-reduced-motion), each event said in words
// with what it breaks in the declaration.

import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Pause } from "lucide-react";
import type { TraceStep } from "../../shared/topology_analysis";

const btn: React.CSSProperties = { background: "transparent", border: "1px solid var(--border-edge)", color: "var(--text-secondary)", borderRadius: 6, padding: 4, cursor: "pointer", display: "inline-flex" };

export function TopologyTraceBar({ traces, index, onIndex, trace, onTrace }: {
  traces: Array<{ name: string; steps: TraceStep[] }>; index: number; onIndex: (i: number) => void; trace: string; onTrace: (name: string) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const steps = traces.find((t) => t.name === trace)?.steps ?? [];
  useEffect(() => {
    if (!playing) return;
    if (index >= steps.length - 1) { setPlaying(false); return; }
    const h = setTimeout(() => onIndex(index + 1), 800);
    return () => clearTimeout(h);
  }, [playing, index, steps.length, onIndex]);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const s = steps[index];
  return (
    <div data-topology-trace style={{ position: "absolute", left: 16, bottom: 16, zIndex: 5, display: "flex", alignItems: "center", gap: 8, padding: 8, borderRadius: 8, background: "color-mix(in oklab, var(--bg-node) 92%, transparent)", border: "1px solid var(--border-edge)", fontSize: "var(--fs-12)", color: "var(--text-secondary)", maxWidth: 640 }}>
      <select value={trace} onChange={(e) => { onTrace(e.target.value); onIndex(0); }} style={{ background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border-edge)", borderRadius: 6 }}>
        <option value="">trace: off</option>
        {traces.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.steps.length})</option>)}
      </select>
      {trace && steps.length > 0 && (
        <>
          <button style={btn} aria-label="previous event" onClick={() => onIndex(Math.max(0, index - 1))}><ChevronLeft size={16} strokeWidth={1.5} /></button>
          {!reduced && <button style={btn} aria-label={playing ? "pause" : "play"} onClick={() => setPlaying((p) => !p)}>{playing ? <Pause size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} />}</button>}
          <button style={btn} aria-label="next event" onClick={() => onIndex(Math.min(steps.length - 1, index + 1))}><ChevronRight size={16} strokeWidth={1.5} /></button>
          <span data-topology-trace-step={index + 1} style={{ color: s?.flags.length ? "var(--accent-error)" : "var(--text-primary)" }}>
            {index + 1}/{steps.length} · {s?.event.actor} {s?.event.action}{s?.event.zone ? ` ${s.event.zone}` : ""}{s?.event.decision ? ` [${s.event.decision}]` : ""}
            {s?.flags.length ? ` — ${s.flags.join("; ")}` : ""}
          </span>
        </>
      )}
    </div>
  );
}
