// ONE PATTERN TYPE FOR COMPUTED NAMES (2026-10-02, "the location split", M1).
// Catalogue paths (`/entities/{EntityID}/status`), names builders return
// (`/entities/{e}/status`), alias builders (`{base}-{boundary}`), zone names
// with a hole (`record_{Type}`) and plan globs (`request_*`) are all the same
// thing: a string with holes. Every consumer compares them through here —
// never by literal equality — so `record_{Type}` covers `record_CandidateTarget`
// and a plan's `request_*` covers `request_{Role}__{Person}`. Webview-safe.

const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
const SPLIT = /(\{[^}]*\}|\*)/;

/** Holes and wildcards normalised away: two patterns that differ only in hole names are equal. */
export const shapeOf = (p: string) => p.replace(/\{[^}]*\}/g, "{}").replace(/\*/g, "{}");

/** A regex matching every name `general` stands for — a hole or `*` matches a literal run or another hole. */
function regexOf(general: string): RegExp {
  // a hole stands for one run (or one hole); a `*` glob for anything, holes included
  return new RegExp("^" + general.split(SPLIT).map((part) => (part === "*" ? ".*" : /^\{[^}]*\}$/.test(part) ? "(?:\\{[^}]*\\}|[^/{}]+?)" : esc(part))).join("") + "$");
}

/** Does `general` cover `specific` (every name `specific` stands for is one of `general`'s)? */
export function covers(general: string, specific: string): boolean {
  if (general === specific || shapeOf(general) === shapeOf(specific)) return true;
  if (!/[{*]/.test(general)) return false;
  return regexOf(general).test(specific);
}

/** Can the two name one resource (either covers the other)? */
export const unifies = (a: string, b: string) => covers(a, b) || covers(b, a);

/** The literal each hole of `general` takes in `specific`: `record_{Type}` ⊇ `record_X` → {Type: "X"}. */
export function holeValues(general: string, specific: string): Record<string, string> | null {
  const names: string[] = [];
  const re = new RegExp("^" + general.split(/(\{[^}]*\})/).map((part) => {
    const m = /^\{([^}]*)\}$/.exec(part);
    if (m) { names.push(m[1]); return "(\\{[^}]*\\}|[^/{}]+?)"; }
    return esc(part);
  }).join("") + "$");
  const m = re.exec(specific);
  return m ? Object.fromEntries(names.map((n, i) => [n, m[i + 1]])) : null;
}

/** Fill holes by name; a hole with no value stays a hole. */
export const fill = (pattern: string, values: Record<string, string>) =>
  pattern.replace(/\{([^}=]*)(=[^}]*)?\}/g, (whole, h) => (values[h] !== undefined ? values[h] : whole));

/** The string transforms a name builder applies to a hole (`b.replace(/_/g, "-").toLowerCase()`). */
export type NameTransform = "lower" | "upper" | "underscore-to-dash" | "dash-to-underscore";

export function applyTransforms(value: string, ts: readonly NameTransform[]): string {
  // a hole stays a hole (its NAME is not data): transform the literal runs only
  return value.split(/(\{[^}]*\})/).map((part) => {
    if (/^\{[^}]*\}$/.test(part)) return part;
    let v = part;
    for (const t of ts) {
      if (t === "lower") v = v.toLowerCase();
      else if (t === "upper") v = v.toUpperCase();
      else if (t === "underscore-to-dash") v = v.replace(/_/g, "-");
      else if (t === "dash-to-underscore") v = v.replace(/-/g, "_");
    }
    return v;
  }).join("");
}

/** The transforms a chain of string calls spells, in order (`.replace(/_/g, "-").toLowerCase()`). */
export function transformsOf(chainText: string): NameTransform[] {
  const out: NameTransform[] = [];
  const re = /\.(toLowerCase|toUpperCase|lower|upper|replace(?:All)?)\s*\(([^)]*)\)/g;
  for (let m = re.exec(chainText); m; m = re.exec(chainText)) {
    if (m[1] === "toLowerCase" || m[1] === "lower") out.push("lower");
    else if (m[1] === "toUpperCase" || m[1] === "upper") out.push("upper");
    else if (/^\s*(\/_\/g|["']_["'])\s*,\s*["']-["']/.test(m[2])) out.push("underscore-to-dash");
    else if (/^\s*(\/-\/g|["']-["'])\s*,\s*["']_["']/.test(m[2])) out.push("dash-to-underscore");
  }
  return out;
}
