// The app's theme (2026-10-05, GUI brief M1): dark (the default, today's
// look), light, or system (no attribute; the OS preference decides through
// the media queries in tokens.css and kinds.css). Remembered per browser.

export type ThemeChoice = "dark" | "light" | "system";
const KEY = "vg-theme";
export const THEMES: readonly ThemeChoice[] = ["dark", "light", "system"];

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "system" || v === "dark") return v;
  } catch { /* storage blocked: the default */ }
  return "dark";
}

export function applyTheme(t: ThemeChoice): void {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}

export function saveTheme(t: ThemeChoice): void {
  applyTheme(t);
  try { localStorage.setItem(KEY, t); } catch { /* not remembered */ }
}
