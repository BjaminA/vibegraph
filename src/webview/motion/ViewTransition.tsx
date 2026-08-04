import React, { useEffect, useRef, useState } from "react";

// 280ms wrapper for panel open/close. Holds children in DOM during exit so
// the keyframe in motion.css can run. Spec: PLAN.md Aesthetic Appendix.
//
// Usage:
//   <ViewTransition show={filtersOpen}>
//     <FiltersPanel ... />
//   </ViewTransition>

const EXIT_MS = 280;
// Matches --motion-view-dur. After the enter keyframe finishes we DROP the
// animation class, because `animation: ... both` leaves `transform:
// translateY(0)` on the wrapper forever — and ANY transform, identity
// included, makes an element the containing block for `position: fixed`
// descendants. All three panels wrapped here (ComposePalette, FiltersPanel,
// AnalysisCard) are position:fixed, so their `top`/`right` were resolving
// against this wrapper instead of the viewport. FiltersPanel's `top: 56`
// landed it at y≈1056 — below a 1000px window, invisible — and made the
// shell 484px scrollable, so clicking a toggle scrolled the whole canvas
// up by that much. Same family as the filter-stacking-context trap: an
// animation property silently changing layout semantics.
const ENTER_MS = 280;

export function ViewTransition({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(show);
  const [phase, setPhase] = useState<"enter" | "exit">(show ? "enter" : "exit");
  // Enter animation finished → stop applying the class, so no transform
  // remains to trap fixed-position children.
  const [settled, setSettled] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (show) {
      if (exitTimer.current) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
      setMounted(true);
      setPhase("enter");
      setSettled(false);
      // Timer as well as onAnimationEnd: under `prefers-reduced-motion` the
      // keyframe is short-circuited and animationend may never fire, which
      // would leave the transform — and the bug — in place permanently.
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => setSettled(true), ENTER_MS + 40);
      return;
    }
    if (!mounted) return;
    setPhase("exit");
    exitTimer.current = setTimeout(() => {
      setMounted(false);
      exitTimer.current = null;
    }, EXIT_MS);
    return () => {
      if (exitTimer.current) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
    };
  }, [show, mounted]);

  if (!mounted) return null;

  const cls = phase === "exit" ? "vg-view-exit" : settled ? undefined : "vg-view-enter";
  return (
    <div
      className={cls}
      data-view-transition={phase === "exit" ? "exit" : settled ? "settled" : "enter"}
      onAnimationEnd={() => { if (phase === "enter") setSettled(true); }}
    >
      {children}
    </div>
  );
}
