import React, { useEffect, useRef, useState } from "react";

// 280ms wrapper for panel open/close. Holds children in DOM during exit so
// the keyframe in motion.css can run. Spec: PLAN.md Aesthetic Appendix.
//
// Usage:
//   <ViewTransition show={filtersOpen}>
//     <FiltersPanel ... />
//   </ViewTransition>

const EXIT_MS = 280;

export function ViewTransition({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(show);
  const [phase, setPhase] = useState<"enter" | "exit">(show ? "enter" : "exit");
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (show) {
      if (exitTimer.current) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
      setMounted(true);
      setPhase("enter");
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
    };
  }, [show, mounted]);

  if (!mounted) return null;

  return (
    <div className={phase === "enter" ? "vg-view-enter" : "vg-view-exit"}>
      {children}
    </div>
  );
}
