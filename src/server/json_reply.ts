// The JSON value in a model's reply (2026-10-20). Ten parsers each took
// the FIRST ``` fence in a reply — or the span from its first `{` to its last
// `}` — and JSON.parse'd that. A software spec quotes documentation, and
// documentation carries code fences and braces: a fence inside a quoted string
// ended the "JSON" there, and the live setup run's `software add` was refused
// with "Unexpected token '*'" on a reply whose JSON was sound. One reader for
// all of them, string-aware:
//
//   every TOP-LEVEL balanced `{…}` (or `[…]`) span in the text is a candidate
//   — brackets are counted outside JSON strings only, so a fence, a brace or
//   a bracket inside a quote is just text; the LARGEST candidate is the reply
//   (a small example object in the prose before it is not), and if it does not
//   parse, that is the error — never a smaller object found inside it, which
//   would be a fragment accepted as the whole.
//
// A fence around the JSON needs no handling: its backticks sit outside the
// braces. Comments and trailing commas are still refused: the gates downstream
// re-check every item, and a lenient parser would accept what they never saw.

export type JsonKind = "object" | "array";

/** End index (exclusive) of the balanced span opening at `start`, or -1. */
function spanEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") { i++; continue; }
      if (c === "\"") inString = false;
      else if (c === "\n") return -1; // a JSON string never holds a raw newline: this is prose
      continue;
    }
    if (c === "\"") inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth === 0) return i + 1; if (depth < 0) return -1; }
  }
  return -1;
}

function nextOpen(text: string, from: number): number {
  const a = text.indexOf("{", from), b = text.indexOf("[", from);
  return a === -1 ? b : b === -1 ? a : Math.min(a, b);
}

/** The reply's JSON object (or array), or why there is none. Top-level spans
 *  of either kind are found, so an array inside an object is never taken for
 *  an array reply. */
export function jsonInReply(text: string, want: JsonKind = "object"): { value?: any; error?: string } {
  const open = want === "object" ? "{" : "[";
  let best: { from: number; to: number } | null = null;
  for (let i = nextOpen(text, 0); i !== -1; i = nextOpen(text, i)) {
    const end = spanEnd(text, i);
    if (end < 0) { i++; continue; }
    if (text[i] === open && (!best || end - i > best.to - best.from)) best = { from: i, to: end };
    i = end; // what is inside a candidate is part of it, never a candidate of its own
  }
  if (!best) return { error: `the reply holds no JSON ${want}` };
  try {
    const value = JSON.parse(text.slice(best.from, best.to));
    const ok = want === "object" ? value !== null && typeof value === "object" && !Array.isArray(value) : Array.isArray(value);
    return ok ? { value } : { error: `the reply's JSON is not ${want === "object" ? "an object" : "an array"}` };
  } catch (e: any) {
    return { error: `the reply's JSON does not parse: ${e?.message ?? e}` };
  }
}

/** The object, or null — for callers that word their own refusal. */
export function jsonObjectInReply(text: string): Record<string, any> | null {
  return jsonInReply(text, "object").value ?? null;
}

/** The object, or a thrown Error naming why — for a try/catch caller. */
export function replyObject(text: string): Record<string, any> {
  const r = jsonInReply(text, "object");
  if (r.error) throw new Error(r.error);
  return r.value;
}
