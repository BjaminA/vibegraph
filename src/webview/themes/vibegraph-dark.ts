// Monaco theme `vibegraph-dark` (M5 wave 1).
//
// Every colour derives from tokens.css at theme-construction time.
// Monaco wants concrete hex (or hex+alpha) values per spec, so we
// resolve the CSS variable (which is `hsl(...)` source-of-truth) by
// painting it onto a hidden DOM node and reading back the browser's
// computed `rgb(...)` -- then convert to hex. One-shot, no perf cost
// past mount.
//
// TextMate scope -> token mapping and editor-chrome mapping per
// PLAN.md S1.5 M5. Register via `defineVibegraphDark(monaco)` from any
// editor's `beforeMount` callback; the call is idempotent.
//
// Why not register via `loader.init()` at module load: that races
// with the first <Editor/> mount in some build configurations.
// `beforeMount` runs synchronously just before the editor needs the
// theme, so the registration is guaranteed to land first.

import type { Monaco } from "@monaco-editor/react";

export const VIBEGRAPH_DARK = "vibegraph-dark";

// ─────────────────────────────────────────── colour helpers ──────────

function cssToHex(cssColor: string, alpha?: number): string {
  // Paint the value onto a throwaway element and let the browser
  // resolve hsl() / hsla() / oklch() / etc. into rgb(). Robust against
  // colour-syntax churn (we don't have to track which formats Monaco
  // accepts; we only emit hex).
  if (!cssColor) return "#000000";
  const el = document.createElement("div");
  el.style.display = "none";
  el.style.color = cssColor;
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  document.body.removeChild(el);
  const m = computed.match(/(\d+(?:\.\d+)?)/g);
  if (!m || m.length < 3) return "#000000";
  const r = Math.round(parseFloat(m[0])).toString(16).padStart(2, "0");
  const g = Math.round(parseFloat(m[1])).toString(16).padStart(2, "0");
  const b = Math.round(parseFloat(m[2])).toString(16).padStart(2, "0");
  if (alpha !== undefined) {
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
      .toString(16).padStart(2, "0");
    return `#${r}${g}${b}${a}`;
  }
  return `#${r}${g}${b}`;
}

function tokenHex(varName: string, alpha?: number): string {
  const cssVal = getComputedStyle(document.documentElement)
    .getPropertyValue(varName).trim();
  return cssToHex(cssVal, alpha);
}

// ─────────────────────────────────────────── theme ───────────────────

// Monaco's IStandaloneThemeData type is stable across versions; we
// rebuild the object on demand to pick up any tokens.css change made
// by HMR. Idempotent: same vars in, same theme out.
function buildTheme(): Parameters<Monaco["editor"]["defineTheme"]>[1] {
  // TextMate scope -> token colour (PLAN.md S1.5 M5).
  const rules = [
    // keyword family — control-flow (if/for/while/return), def/class,
    // import/from, and the boolean-operator keywords (and/or/not/in/is).
    // Monaco's Python monarch tags ALL of these as `keyword`, so the two
    // rules below cover control-flow + import scopes in one stroke.
    // --accent-io blue is the keyword-blue reading convention: keywords
    // now separate from --text-primary identifiers and bold function
    // names below. (Symbol operators stay muted via keyword.operator.)
    { token: "keyword",                 foreground: tokenHex("--accent-io").slice(1) },
    { token: "keyword.python",          foreground: tokenHex("--accent-io").slice(1) },

    // strings
    { token: "string",                  foreground: tokenHex("--accent-thread").slice(1) },
    { token: "string.python",           foreground: tokenHex("--accent-thread").slice(1) },
    { token: "string.quoted",           foreground: tokenHex("--accent-thread").slice(1) },
    { token: "string.escape",           foreground: tokenHex("--accent-thread").slice(1) },

    // comments
    { token: "comment",                 foreground: tokenHex("--text-muted").slice(1),
      fontStyle: "italic" },

    // numbers
    { token: "number",                  foreground: tokenHex("--accent-warning").slice(1) },
    { token: "constant.numeric",        foreground: tokenHex("--accent-warning").slice(1) },

    // identifiers / variables — the bulk of any file's text. --text-primary,
    // not the old --text-secondary grey: body code must read effortlessly;
    // keywords (blue) and bold function names still separate cleanly.
    { token: "identifier",              foreground: tokenHex("--text-primary").slice(1) },
    { token: "variable",                foreground: tokenHex("--text-primary").slice(1) },
    { token: "variable.parameter",      foreground: tokenHex("--text-primary").slice(1) },

    // types
    { token: "entity.name.type",        foreground: tokenHex("--accent-thread").slice(1) },
    { token: "entity.name.class",       foreground: tokenHex("--accent-thread").slice(1) },
    { token: "support.type",            foreground: tokenHex("--accent-thread").slice(1) },
    { token: "type",                    foreground: tokenHex("--accent-thread").slice(1) },
    { token: "type.identifier",         foreground: tokenHex("--accent-thread").slice(1) },

    // functions
    { token: "entity.name.function",    foreground: tokenHex("--text-primary").slice(1),
      fontStyle: "bold" },
    { token: "support.function",        foreground: tokenHex("--text-primary").slice(1),
      fontStyle: "bold" },

    // decorators (Python @foo)
    { token: "meta.decorator",          foreground: tokenHex("--accent-warning").slice(1) },
    { token: "entity.name.decorator",   foreground: tokenHex("--accent-warning").slice(1) },
    { token: "decorator",               foreground: tokenHex("--accent-warning").slice(1) },

    // operators / punctuation
    { token: "keyword.operator",        foreground: tokenHex("--text-muted").slice(1) },
    { token: "operator",                foreground: tokenHex("--text-muted").slice(1) },
    { token: "delimiter",               foreground: tokenHex("--text-muted").slice(1) },
    { token: "punctuation",             foreground: tokenHex("--text-muted").slice(1) },

    // errors
    { token: "invalid",                 foreground: tokenHex("--accent-error").slice(1) },
    { token: "error",                   foreground: tokenHex("--accent-error").slice(1) },
  ];

  // Editor chrome (PLAN.md S1.5 M5).
  const colors: Record<string, string> = {
    "editor.background":                       tokenHex("--bg-canvas"),
    "editor.foreground":                       tokenHex("--text-primary"),
    "editor.lineHighlightBackground":          tokenHex("--bg-node"),
    "editor.lineHighlightBorder":              tokenHex("--bg-node"),
    "editor.selectionBackground":              tokenHex("--bg-node-hover"),
    "editor.findMatchHighlightBackground":     tokenHex("--accent-thread", 0.2),
    "editor.findMatchBackground":              tokenHex("--accent-thread", 0.3),
    "editor.wordHighlightBackground":          tokenHex("--accent-thread", 0.15),
    "editorGutter.background":                 tokenHex("--bg-canvas"),
    "editorLineNumber.foreground":             tokenHex("--text-muted"),
    "editorLineNumber.activeForeground":       tokenHex("--text-secondary"),
    "editorWidget.background":                 tokenHex("--bg-node"),
    "editorWidget.border":                     tokenHex("--border-edge"),
    "editorCursor.foreground":                 tokenHex("--accent-thread"),
    "editorIndentGuide.background":            tokenHex("--bg-node"),
    "editorIndentGuide.activeBackground":      tokenHex("--border-edge"),
    "editorBracketMatch.background":           tokenHex("--bg-node-hover"),
    "editorBracketMatch.border":               tokenHex("--accent-thread", 0.4),
    "scrollbarSlider.background":              tokenHex("--bg-node-hover"),
    "scrollbarSlider.hoverBackground":         tokenHex("--border-edge"),
    "scrollbarSlider.activeBackground":        tokenHex("--text-muted"),
  };

  return {
    base: "vs-dark",
    inherit: true,
    rules,
    colors,
  };
}

// ─────────────────────────────────────────── register API ────────────

// Module-scoped flag: even if many editors mount and each calls
// defineVibegraphDark, Monaco's defineTheme is itself idempotent, but
// we still skip the work after the first successful registration.
let registered = false;

export function defineVibegraphDark(monaco: Monaco): void {
  if (registered) return;
  monaco.editor.defineTheme(VIBEGRAPH_DARK, buildTheme());
  registered = true;
}

// Test-only: force a rebuild on the next register call. Used by unit
// tests that swap CSS variables to verify the theme picks them up.
export function _resetForTests(): void {
  registered = false;
}
