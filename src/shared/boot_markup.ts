// The boot screen. The server paints it in the page shell BESIDE #root, so it
// is on screen before the bundle loads and React never re-renders it (a
// re-render would restart the animation mid-cycle); the webview ticks its
// elapsed line and fades it out when the first parse lands
// (src/webview/boot.ts).
//
// The motif is a thread in miniature: a seed card branching to a logic step
// and an I/O step, converging on a write, with a current running along the
// edges (styles in motion.css, .vg-boot-*). The loop is bounded by real
// pipeline activity — the screen unmounts when the parse lands — the same
// exception the re-link dot takes to "no infinite loops".

const EDGES: [string, "logic" | "io", number][] = [
  ["M46 48 C73 48 73 22 100 22", "logic", 0],
  ["M46 48 C73 48 73 74 100 74", "io", 0],
  ["M136 22 C163 22 163 48 190 48", "logic", 900],
  ["M136 74 C163 74 163 48 190 48", "io", 900],
];
const NODES: [number, number, string, number][] = [
  [10, 38, "logic", 0],
  [100, 12, "logic", 700],
  [100, 64, "io", 700],
  [190, 38, "write", 1500],
];

export function bootMarkup(): string {
  const base = EDGES.map(([d]) => `<path class="vg-boot-edge" d="${d}"/>`).join("");
  const pulses = EDGES.map(([d, k, delay]) =>
    `<path class="vg-boot-pulse ${k}" pathLength="100" style="animation-delay:${delay}ms" d="${d}"/>`).join("");
  const nodes = NODES.map(([x, y, k, delay]) =>
    `<rect class="vg-boot-node ${k}" x="${x}" y="${y}" width="36" height="20" rx="6" style="animation-delay:${delay}ms"/>`).join("");
  return `<div class="vg-boot" data-boot-screen role="status" aria-live="polite">`
    + `<svg class="vg-boot-mark" viewBox="0 0 236 96" width="236" height="96" aria-hidden="true">${base}${pulses}${nodes}</svg>`
    + `<div class="vg-boot-word">VibeGraph</div>`
    + `<div class="vg-boot-status">Reading the project: parsing, linking, tracing threads</div>`
    + `<div class="vg-boot-elapsed" data-boot-elapsed></div>`
    + `</div>`;
}
