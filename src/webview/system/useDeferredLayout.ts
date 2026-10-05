// A map layout too large to compute inside a render (2026-10-05). Below the
// threshold the layout is a plain memo, as before. Above it, the render that
// asks for it returns at once with `pending` (the view shows a spinner over
// the previous layout) and the layout is computed on the next task, so the
// spinner paints before the main thread is busy. The result is kept by the
// identity of its inputs: a re-render with the same inputs costs nothing.
//
// This moves the work off the click, not off the main thread; what keeps a
// big map interactive is drawing less (arch_topology.ts folds the reads).

import { useEffect, useMemo, useState, type DependencyList } from "react";

/** Nodes + edges above which a layout is computed after a paint. */
export const LAYOUT_DEFER_AT = 600;

function threshold(): number {
  // Test-only override: e2e specs set it to exercise the deferred path on a
  // small fixture. Never set by the app.
  const w = typeof window !== "undefined" ? (window as unknown as { __VG_LAYOUT_DEFER_AT?: number }).__VG_LAYOUT_DEFER_AT : undefined;
  return typeof w === "number" ? w : LAYOUT_DEFER_AT;
}

/** `view` — names what is on screen (mode, lens…). While a layout is pending
 *  the previous one stays under the spinner only if it is of the same view; a
 *  different view shows nothing rather than the wrong map. */
export function useDeferredLayout<T>(compute: () => T, deps: DependencyList, size: number, view: string): { value: T | null; pending: boolean } {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const key = useMemo(() => ({}), deps);
  const defer = size > threshold();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => (defer ? null : compute()), [key, defer]);
  const [later, setLater] = useState<{ key: object; view: string; value: T } | null>(null);
  useEffect(() => {
    if (!defer || later?.key === key) return;
    // A frame first, so the spinner paints; then the layout, on its own task.
    let handle = 0;
    const raf = requestAnimationFrame(() => { handle = window.setTimeout(() => setLater({ key, view, value: compute() }), 0); });
    return () => { cancelAnimationFrame(raf); clearTimeout(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, defer]);
  if (!defer) return { value: now, pending: false };
  if (later?.key === key) return { value: later.value, pending: false };
  return { value: later?.view === view ? later.value : null, pending: true };
}
