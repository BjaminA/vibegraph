// The text half of the data-flow pass (moved out of dataflow.ts, 2026-10-17):
// reading code out of an expression's text, whether it names a value, the
// calls written inside it, and the names an assignment binds. Pure.

export type Lang = "python" | "jsts" | "bash" | "other";

/** An expression with its string literals removed — except the interpolated
 *  parts of f-strings, template literals and bash double quotes, which are
 *  code. So `"name"` mentions nothing and `f"{name}"` mentions name. */
export function codeOf(text: string, lang: Lang): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const prev = text[i - 1] ?? "";
    const isF = lang === "python" && /[fF]/.test(prev) && !/[\w]/.test(text[i - 2] ?? "");
    if (c === "'" && lang === "bash") { const j = text.indexOf("'", i + 1); i = j < 0 ? text.length : j + 1; out += " "; continue; }
    if (c === '"' || c === "'" || (c === "`" && lang === "jsts")) {
      let j = i + 1;
      let inner = "";
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\") { j += 2; continue; }
        if (c === "`" && text[j] === "$" && text[j + 1] === "{") { const k = text.indexOf("}", j); inner += ` ${text.slice(j + 2, k < 0 ? text.length : k)} `; j = k < 0 ? text.length : k + 1; continue; }
        if (isF && text[j] === "{") { const k = text.indexOf("}", j); inner += ` ${text.slice(j + 1, k < 0 ? text.length : k)} `; j = k < 0 ? text.length : k + 1; continue; }
        if (lang === "bash" && c === '"' && text[j] === "$") { const m = /^\$\{?[\w@*#?!-]+\}?/.exec(text.slice(j)); if (m) { inner += ` ${m[0]} `; j += m[0].length; continue; } }
        j++;
      }
      out += inner || " ";
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function mentions(code: string, name: string, lang: Lang): boolean {
  if (lang === "bash") return new RegExp(`\\$\\{?${esc(name)}(?![\\w])`).test(code);
  return new RegExp(`(?<![\\w$.])${esc(name)}(?![\\w$])`).test(code);
}

/** Call expressions written inside a piece of source text, with their
 *  top-level arguments: `conn.execute(f"…{name}").fetchall()` holds
 *  `conn.execute` with one argument. The parser keeps a method CHAIN as one
 *  node (its inner call is not a node of its own), and a `return f(x)` keeps
 *  only its text — this reads both. */
export function callsInText(text: string): Array<{ callee: string; args: string[] }> {
  const out: Array<{ callee: string; args: string[] }> = [];
  const re = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 1;
    let j = m.index + m[0].length;
    let quote: string | null = null;
    const start = j;
    const args: string[] = [];
    let argStart = j;
    for (; j < text.length && depth > 0; j++) {
      const c = text[j];
      if (quote) { if (c === "\\") j++; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") { depth--; if (depth === 0) break; }
      else if (c === "," && depth === 1) { args.push(text.slice(argStart, j).trim()); argStart = j + 1; }
    }
    const last = text.slice(argStart, j).trim();
    if (last || args.length) args.push(last);
    out.push({ callee: m[1].replace(/\s+/g, ""), args: j > start || args.length ? args : [] });
  }
  return out;
}

/** The names an assignment binds: one, or each name a destructuring pattern
 *  binds (`[, , cn, fmt]`, `{ a, b: c, ...rest }`, `(x, y)`, `x, y`). */
export function boundNames(target: string): string[] {
  const t = target.trim();
  if (!/^[[{(]|,/.test(t)) return [t];
  const inner = t.replace(/^[[{(]|[\]})]$/g, "");
  return inner.split(",").map((part) => {
    const p = part.trim().replace(/^\.\.\.|^\*/, "");
    if (!p) return "";
    const renamed = /:\s*([A-Za-z_$][\w$]*)/.exec(p);
    const base = (renamed ? renamed[1] : p).split("=")[0].trim();
    return /^[A-Za-z_$][\w$]*$/.test(base) ? base : "";
  }).filter(Boolean);
}
