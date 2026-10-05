// The thread cards' MEASURED sizes (2026-10-05). Container boxes were sized
// from an approximate 200×75 card, but a card is 120–250 wide and up to ~120
// tall with its preview, so a card stuck out of its own `if` box (57 cards on
// one 276-card thread). Mounted inside <ReactFlow>, where its store is.
//
// A big thread renders only what is on screen, so "every node measured"
// never happens there: the sizes are re-read whenever any measured size
// changes (a cheap sum per store update), and a card not measured yet keeps
// the approximation.

import { useEffect } from "react";
import { useReactFlow, useStore } from "@xyflow/react";

export type CardSizes = Map<string, { w: number; h: number }>;

export function MeasuredCards({ onSizes }: { onSizes: (m: CardSizes) => void }) {
  // A fingerprint of every measured size: a card that grows after it was
  // first measured (its preview filling in) re-reads them too.
  const measured = useStore((s) => {
    let t = 0;
    for (const x of s.nodeLookup.values()) if (x.measured?.width) t += Math.round(x.measured.width) * 4099 + Math.round(x.measured.height ?? 0) + 1;
    return t;
  });
  const rf = useReactFlow();
  useEffect(() => {
    if (!measured) return;
    const m: CardSizes = new Map();
    // The flow is uncontrolled: getNodes() returns the prop objects, the
    // measurements live on the INTERNAL nodes (ThreadView's fit does the same).
    for (const p of rf.getNodes()) {
      if (p.type !== "threadNode") continue;
      const n = rf.getInternalNode(p.id);
      if (!n?.measured?.width || !n.measured.height) continue;
      m.set(p.id, { w: Math.round(n.measured.width), h: Math.round(n.measured.height) });
    }
    onSizes(m);
  }, [measured, rf, onSizes]);
  return null;
}

/** Same sizes (to the pixel) as before: keep the old map, so nothing re-lays out. */
export function sameSizes(a: CardSizes, b: CardSizes): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) { const o = b.get(k); if (!o || o.w !== v.w || o.h !== v.h) return false; }
  return true;
}
