// Moved out of SystemView.tsx (2026-10-05) to keep it under the 500-line rule.

import { useEffect, useRef } from "react";
import { useStore, useReactFlow, type FitViewOptions } from "@xyflow/react";

/** Reports the subsystem cards' MEASURED heights (inside the canvas, where
 *  react-flow's store is), so the layout can stack them by their real size;
 *  fits the view once, when the first real heights arrive. */
export function MeasuredHeights({ onHeights, padding }: { onHeights: (m: Map<string, number>) => void; padding: FitViewOptions["padding"] }) {
  const key = useStore((st) => [...st.nodeLookup.values()]
    .filter((n) => n.type === "subsystem" || n.type === "plannedSubsystem")
    .map((n) => `${n.id}=${Math.round(n.measured?.height ?? 0)}`).join("|"));
  const rf = useReactFlow();
  const fitted = useRef(false);
  useEffect(() => {
    const m = new Map<string, number>();
    for (const part of key ? key.split("|") : []) {
      const i = part.lastIndexOf("=");
      const h = Number(part.slice(i + 1));
      if (h > 0) m.set(part.slice(0, i), h);
    }
    if (!m.size) return;
    onHeights(m);
    if (!fitted.current) { fitted.current = true; window.setTimeout(() => rf.fitView({ padding }), 50); }
  }, [key, onHeights, rf, padding]);
  return null;
}
