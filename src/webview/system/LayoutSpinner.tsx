// Shown while a large map layout is computed (useDeferredLayout). Says how
// big the map is, so a wait has a reason on screen.

import React from "react";
import { Loader2 } from "lucide-react";

export function LayoutSpinner({ size }: { size: number }) {
  return (
    <div
      data-arch-laying-out
      role="status"
      aria-live="polite"
      style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 30, pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
          background: "var(--bg-node)", border: "1px solid var(--border-edge)", borderRadius: 8,
          color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)",
        }}
      >
        <Loader2 size={16} strokeWidth={1.5} className="vg-spin" color="var(--accent-thread)" />
        Laying out {size.toLocaleString()} cards and connections…
      </div>
    </div>
  );
}
