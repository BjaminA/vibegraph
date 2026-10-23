// The inline <script> blocks of an HTML page (2026-10-22, the root-cause
// handoff RC2: a page whose whole app is one inline script was never read).
// Shared by the TypeScript frontend, which parses a page as a module made of
// its inline scripts, and by the walk's admission check, which reads a page
// only when it has one.
//
// The LINE MAP is the identity: every character outside a script becomes a
// space and every line break is kept, so a node's line and column in the
// parsed text are its line and column in the page. Several inline scripts
// share one module scope, as classic scripts share the page's global scope.
// Named limits: a `<script>` inside an HTML comment is read as a script; a
// script loaded by `src` is the file it names, not this page.

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
/** the `type` values a browser runs as JavaScript (an absent type is JavaScript);
 *  `text/babel` and `text/jsx` are in-browser JSX (the tsx grammar reads them) */
const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module", "text/babel", "text/jsx", "jsx"]);

export const HTML_EXTENSIONS = [".html", ".htm"];
export const isHtmlPath = (p) => HTML_EXTENSIONS.some((e) => String(p ?? "").toLowerCase().endsWith(e));

const lineAt = (text, offset) => { let n = 1; for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++; return n; };

/** Every inline script that runs: [{ start, end, line, endLine, type }] (offsets of the script's text). */
export function inlineScripts(html) {
  const out = [];
  SCRIPT.lastIndex = 0;
  let m;
  while ((m = SCRIPT.exec(html)) !== null) {
    const attrs = m[1] ?? "";
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] ?? "").toLowerCase();
    if (!JS_TYPES.has(type)) continue;
    if (!m[2].trim()) continue;
    const start = m.index + m[0].indexOf(">") + 1;
    const end = start + m[2].length;
    out.push({ start, end, line: lineAt(html, start), endLine: lineAt(html, end), type: type || "text/javascript" });
  }
  return out;
}

/** The page with everything outside its inline scripts blanked: same length, same lines. */
export function pageScriptSource(html, scripts = inlineScripts(html)) {
  const chars = html.split("");
  let at = 0;
  const blank = (from, to) => { for (let i = from; i < to; i++) if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " "; };
  for (const s of scripts) { blank(at, s.start); at = s.end; }
  blank(at, chars.length);
  return chars.join("");
}
