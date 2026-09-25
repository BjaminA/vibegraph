// Route, reach and the start-here story on the GUI map (arch_trace.ts does
// the graph work; this holds the state and the story bar). A trace lights
// what it includes and dims everything else; Escape or the bar's × clears it.

import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Pause, X } from "lucide-react";
import type { Node, Edge } from "@xyflow/react";
import type { ArchModelRecord, ArchNodeRecord } from "../../shared/protocol";
import { reach, route, storyBeats, toDrawn, type Trace, type StoryBeat, type TraceEdge } from "./arch_trace";

export type TraceMode =
  | { kind: "reach"; dir: "down" | "up"; from: string; trace: Trace }
  | { kind: "route-pick"; from: string }
  | { kind: "route"; from: string; to: string; trace: Trace | null }
  | { kind: "story"; beat: number }
  | null;

export function useArchTrace(model: ArchModelRecord | null, layout: { nodes: Node[]; edges: Edge[] }) {
  const [mode, setMode] = useState<TraceMode>(null);
  const drawn: TraceEdge[] = useMemo(() => layout.edges.map((e) => ({
    id: e.id, from: e.source, to: e.target, members: (e.data as { edge?: { members?: string[] } } | undefined)?.edge?.members,
  })), [layout.edges]);
  const nodeInto = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of layout.nodes) for (const id of ((n.data as { node?: ArchNodeRecord }).node?.members ?? [])) m.set(id, n.id);
    return (id: string) => m.get(id) ?? id;
  }, [layout.nodes]);
  const beats: StoryBeat[] = useMemo(() => {
    if (!model?.primaryPath?.entryPoints.length) return [];
    return storyBeats(model.nodes, model.edges, model.primaryPath.entryPoints)
      .map((b) => ({ ...b, ...toDrawn(b, drawn, nodeInto) }));
  }, [model, drawn, nodeInto]);

  useEffect(() => { setMode(null); }, [layout]);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") setMode(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active: Trace | null =
    mode?.kind === "reach" ? mode.trace
      : mode?.kind === "route" ? mode.trace
        : mode?.kind === "story" ? beats[mode.beat] ?? null
          : mode?.kind === "route-pick" ? { nodes: [mode.from], edges: [] }
            : null;

  const actions = {
    reach: (from: string, dir: "down" | "up") => setMode({ kind: "reach", dir, from, trace: reach(drawn, from, dir) }),
    routeFrom: (from: string) => setMode({ kind: "route-pick", from }),
    /** a node click while picking a route's end. Returns true when it consumed the click. */
    pick: (to: string) => {
      if (mode?.kind !== "route-pick") return false;
      setMode({ kind: "route", from: mode.from, to, trace: route(drawn, mode.from, to) });
      return true;
    },
    story: () => beats.length && setMode({ kind: "story", beat: 0 }),
    step: (d: number) => setMode((m) => m?.kind === "story" ? { kind: "story", beat: Math.min(beats.length - 1, Math.max(0, m.beat + d)) } : m),
    clear: () => setMode(null),
  };

  const decorate = (nodes: Node[], edges: Edge[]) => {
    if (!active) return { nodes, edges };
    const ln = new Set(active.nodes), le = new Set(active.edges);
    return {
      nodes: nodes.map((n) => n.type === "archNode" ? { ...n, data: { ...n.data, lit: ln.has(n.id), dim: !ln.has(n.id) } } : n),
      edges: edges.map((e) => ({ ...e, data: { ...e.data, lit: le.has(e.id), dim: !le.has(e.id) } })),
    };
  };
  return { mode, beats, actions, decorate };
}

const bar: React.CSSProperties = {
  // bottom-RIGHT: the legend holds the bottom-left, the chat button the corner.
  position: "absolute", right: 80, bottom: 16, zIndex: 32,
  display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", maxWidth: 640,
  background: "color-mix(in oklab, var(--bg-node) 94%, transparent)", border: "1px solid var(--border-edge)",
  borderRadius: 8, fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", color: "var(--text-secondary)",
};
const iconBtn: React.CSSProperties = { background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", display: "flex", padding: 4 };

/** The bar that says what the current trace is, and steps / plays a story. */
export function ArchTraceBar({ mode, beats, labelOf, actions }: {
  mode: TraceMode; beats: StoryBeat[]; labelOf: (id: string) => string;
  actions: ReturnType<typeof useArchTrace>["actions"];
}) {
  const [playing, setPlaying] = useState(false);
  const beat = mode?.kind === "story" ? mode.beat : -1;
  useEffect(() => {
    if (!playing || mode?.kind !== "story") return;
    if (beat >= beats.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => actions.step(1), 2400);
    return () => clearTimeout(t);
  }, [playing, beat, beats.length, mode, actions]);
  if (!mode) return null;
  let text = "";
  if (mode.kind === "reach") text = `${mode.dir === "down" ? "Downstream" : "Upstream"} of ${labelOf(mode.from)}: ${mode.trace.nodes.length - 1} boxes, ${mode.trace.edges.length} edges`;
  if (mode.kind === "route-pick") text = `Route from ${labelOf(mode.from)}: click the box to route to`;
  if (mode.kind === "route") text = mode.trace
    ? `Route ${labelOf(mode.from)} → ${labelOf(mode.to)}: ${mode.trace.edges.length} hop${mode.trace.edges.length === 1 ? "" : "s"}`
    : `No directed route from ${labelOf(mode.from)} to ${labelOf(mode.to)} in this lens`;
  const b = mode.kind === "story" ? beats[mode.beat] : null;
  return (
    <div data-arch-trace={mode.kind} role="status" style={bar}>
      {b ? (
        <>
          <button aria-label="Previous beat" data-arch-story-prev style={iconBtn} disabled={beat <= 0} onClick={() => actions.step(-1)}><ChevronLeft size={16} strokeWidth={1.5} /></button>
          <button aria-label={playing ? "Pause story" : "Play story"} data-arch-story-play style={iconBtn} onClick={() => setPlaying((p) => !p)}>
            {playing ? <Pause size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} />}
          </button>
          <button aria-label="Next beat" data-arch-story-next style={iconBtn} disabled={beat >= beats.length - 1} onClick={() => actions.step(1)}><ChevronRight size={16} strokeWidth={1.5} /></button>
          <div style={{ minWidth: 0 }}>
            <div data-arch-story-title style={{ color: "var(--text-primary)", fontWeight: 600 }}>{`${beat + 1}/${beats.length} · ${b.title}`}</div>
            <div data-arch-story-caption style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", overflowWrap: "anywhere" }}>{b.caption}</div>
          </div>
        </>
      ) : <span data-arch-trace-text>{text}</span>}
      <button aria-label="Clear trace" data-arch-trace-clear style={iconBtn} onClick={() => { setPlaying(false); actions.clear(); }}><X size={16} strokeWidth={1.5} /></button>
    </div>
  );
}
