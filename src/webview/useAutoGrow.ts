// Auto-growing textarea for the top-bar dialogs (Draft / Describe / Build).
//
// 2026-08-04: all three clipped their input vertically in different ways —
// Describe was a fixed `rows={3}` textarea that scrolled internally once the
// text passed three lines, and Draft/Build were single-line <input>s that did
// not wrap at all. The Describe brief for a greenfield build is a dozen lines
// long, so the field you paste it into showed three of them.
//
// The textarea grows with its content and the dialog grows with the textarea
// (they are flex columns). Growth is CAPPED so the action row can never be
// pushed off-screen; past the cap the textarea scrolls, which is the honest
// fallback — a bounded box that scrolls beats an unbounded one whose Submit
// button is somewhere below the fold.

import { useLayoutEffect, useRef } from "react";

/** Hard ceiling as a fraction of viewport height — keeps a tall paste from
 *  pushing the dialog's buttons past the bottom edge on a short window. */
const VIEWPORT_FRACTION = 0.4;

/**
 * Ref for a <textarea> that resizes to fit `value`.
 *
 * `open` is a dependency because the dialogs mount conditionally: opening one
 * with unchanged text (e.g. re-opening Describe) must still measure, and the
 * ref is null until the element exists.
 */
export function useAutoGrow(value: string, open: boolean, maxPx: number) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    const cap = Math.min(maxPx, Math.round(window.innerHeight * VIEWPORT_FRACTION));
    // Reset first: scrollHeight only shrinks back if the element is not already
    // holding the taller height from the previous measurement.
    el.style.height = "auto";
    const needed = el.scrollHeight;
    el.style.height = `${Math.min(needed, cap)}px`;
    el.style.overflowY = needed > cap ? "auto" : "hidden";
  }, [value, open, maxPx]);

  return ref;
}
