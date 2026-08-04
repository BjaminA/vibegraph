// The top-left chip strip — ONE owner for the thread-chrome column
// (README → Skill → Artifact) and the publisher of `--vg-chipstrip-h`.
//
// Why this exists: each chip used to position itself `fixed` at its own
// hardcoded offset (README +8, skill +40, artifact +68) while ThreadView's
// layout / nests toggles picked their own offsets in the SAME column
// (+72, +104). The artifact chip (M-TRAINED.2, later) landed 4px above the
// layout toggle and — being the higher z-index — swallowed its clicks: on
// any thread with an artifact the "switch layout" button was dead, not
// merely ugly. Two owners of one column cannot stay consistent, so the
// strip stacks its chips itself and publishes its MEASURED height for the
// chrome below it. Height, not bottom edge: the strip's top rides
// `--vg-toolbar-bottom` (the toolbar wraps at narrow widths), and a
// published bottom would go stale on a move that doesn't resize.
//
// Chips render as ordinary flow children — they carry no position/top/left
// of their own.

import React, { useEffect, useRef } from "react";

/** Fallback height: README + gap + skill, the pre-artifact stack. Keeps the
 *  chrome below the strip in its historical place when no strip is mounted. */
export const CHIP_STRIP_FALLBACK_H = 56;

/** Top of the strip, and the base every consumer measures down from. */
export const CHIP_STRIP_TOP = "calc(var(--vg-toolbar-bottom, 43px) + 8px)";

/** Top offset for the Nth row of canvas chrome sitting UNDER the strip
 *  (0-based, 32px rows — a 24px chip plus the 8px column gap). */
export function belowChipStrip(row: number): string {
  return `calc(${CHIP_STRIP_TOP} + var(--vg-chipstrip-h, ${CHIP_STRIP_FALLBACK_H}px) + ${8 + row * 32}px)`;
}

export function ChipStrip({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () => {
      document.documentElement.style.setProperty(
        "--vg-chipstrip-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--vg-chipstrip-h");
    };
  }, []);

  return (
    <div
      ref={ref}
      data-chip-strip
      style={{
        position: "fixed",
        top: CHIP_STRIP_TOP,
        left: "var(--vg-readme-left, 298px)",
        zIndex: 860,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 8,
        // The strip is a layout shell: only the chips themselves take
        // pointer events, so the empty column doesn't eat canvas hovers.
        pointerEvents: "none",
      }}
    >
      {children}
    </div>
  );
}
