// Route, reach and the start-here story over the architecture map — the
// three Archify interactions reviews/m-arch/COMPARE.md named as worth taking.
// All three read the DRAWN graph of the current lens (what the reader sees),
// never infer anything, and return ids to highlight. Pure; the GUI calls it
// directly, and architecture.html embeds the story beats it computes.

export interface TraceEdge { id: string; from: string; to: string; members?: string[] }
export interface Trace { nodes: string[]; edges: string[] }

/** Everything downstream (following arrows) or upstream (against them) of `start`. */
export function reach(edges: TraceEdge[], start: string, dir: "down" | "up"): Trace {
  const nodes = new Set([start]);
  const hit = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of edges) {
      const [here, there] = dir === "down" ? [e.from, e.to] : [e.to, e.from];
      if (here !== cur) continue;
      hit.add(e.id);
      if (!nodes.has(there)) { nodes.add(there); queue.push(there); }
    }
  }
  return { nodes: [...nodes].sort(), edges: [...hit].sort() };
}

/** The shortest DIRECTED route from `a` to `b` (fewest edges), or null. */
export function route(edges: TraceEdge[], a: string, b: string): Trace | null {
  const prev = new Map<string, TraceEdge>();
  const seen = new Set([a]);
  const queue = [a];
  const sorted = [...edges].sort((x, y) => x.id.localeCompare(y.id));
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === b) break;
    for (const e of sorted) {
      if (e.from !== cur || seen.has(e.to)) continue;
      seen.add(e.to);
      prev.set(e.to, e);
      queue.push(e.to);
    }
  }
  if (!seen.has(b)) return null;
  const nodes = [b];
  const hit: string[] = [];
  for (let n = b; n !== a; ) { const e = prev.get(n)!; hit.push(e.id); n = e.from; nodes.push(n); }
  return { nodes: nodes.reverse(), edges: hit.reverse() };
}

export interface StoryBeat { title: string; caption: string; nodes: string[]; edges: string[] }
interface StoryNode { id: string; label: string; entryPoints?: string[] }
interface StoryEdge extends TraceEdge { protocol: string; protocolBasis: string; threads: string[] }

/**
 * The start-here path as a story: for each entry point on the stated or
 * proposed `primaryPath`, a beat for the cluster that owns it, then one beat
 * per edge that entry point's thread takes, breadth-first from that cluster.
 * A beat names the protocol and the fact it was read from. An edge the
 * thread does not take is never in its story.
 */
export function storyBeats(nodes: StoryNode[], edges: StoryEdge[], primary: string[], maxPerEntry = 10): StoryBeat[] {
  const label = new Map(nodes.map((n) => [n.id, n.label]));
  const beats: StoryBeat[] = [];
  for (const ep of primary) {
    const owner = nodes.find((n) => n.entryPoints?.includes(ep));
    if (!owner) continue;
    beats.push({ title: `Start: ${ep}`, caption: `${ep} is an entry point of ${owner.label}.`, nodes: [owner.id], edges: [] });
    const seen = new Set([owner.id]);
    const queue = [owner.id];
    let n = 0;
    while (queue.length && n < maxPerEntry) {
      const cur = queue.shift()!;
      for (const e of [...edges].sort((x, y) => x.id.localeCompare(y.id))) {
        if (e.from !== cur || !e.threads.includes(ep) || n >= maxPerEntry) continue;
        n++;
        beats.push({
          title: `${label.get(e.from) ?? e.from} → ${label.get(e.to) ?? e.to}`,
          caption: `${e.protocol} — ${e.protocolBasis}`,
          nodes: [e.from, e.to], edges: [e.id],
        });
        if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
      }
    }
  }
  return beats;
}

/** Map model-level ids onto what a lens draws (a collapsed edge carries its members). */
export function toDrawn(t: Trace, drawn: TraceEdge[], nodeInto: (id: string) => string): Trace {
  const edges = new Set<string>();
  for (const id of t.edges) {
    const d = drawn.find((e) => e.id === id || e.members?.includes(id));
    if (d) edges.add(d.id);
  }
  return { nodes: [...new Set(t.nodes.map(nodeInto))].sort(), edges: [...edges].sort() };
}
