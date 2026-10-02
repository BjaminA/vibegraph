// LITERAL TABLES (2026-10-02). On a data platform the architecture is often
// written as DATA: an exported array of object literals lists the resources
// and who writes them, a record of `{yes, no}` objects is a decision tree, a
// record of string → string is a naming table. Calls are what the IR followed,
// so all of that was one assignment node with an 80-character preview.
//
// A module-level constant whose value is a table is now lifted VERBATIM onto
// its assignment node as `table`: rows, their keys, their field names and the
// literal values, identifiers kept as references to other declarations. It is
// not interpreted here — what a table MEANS (a catalogue, a state machine) is
// decided downstream, from its shape, by code that says when it cannot tell.
//
// Shapes:   rows    an array of object literals      [{ path, write }, …]
//           record  an object keyed by name          { Q1: { yes, no }, … } / { a: "x", … }
//           list    an array of plain literals       ["a", "b"]
// Values:   string | number | boolean | null | Value[] | {ref} | {fields} | {fn} | {expr}

const MAX_ROWS = 400;
const MAX_FIELDS = 40;
const MAX_STR = 300;
const MAX_DEPTH = 4;
const MIN_ENTRIES = 2;

const WRAPPERS = new Set(["as_expression", "satisfies_expression", "non_null_expression", "parenthesized_expression", "type_assertion"]);

/** `x as const`, `x satisfies T`, `(x)` — the literal inside. */
export function unwrapLiteral(n) {
  let cur = n;
  while (cur && WRAPPERS.has(cur.type)) cur = cur.namedChildren[0] ?? null;
  return cur;
}

const unquote = (s) => {
  const q = s[0];
  if ((q === "'" || q === '"' || q === "`") && s.endsWith(q)) {
    const body = s.slice(1, -1);
    return body.replace(/\\(['"`\\])/g, "$1").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }
  return s;
};
const clip = (s) => (s.length > MAX_STR ? `${s.slice(0, MAX_STR - 1)}…` : s);

/** One literal value, bounded. `text(n)` reads source; `line(n)` its 1-based line. */
export function literalValue(n, text, line, depth = 0) {
  n = unwrapLiteral(n);
  if (!n) return null;
  switch (n.type) {
    case "string": return clip(unquote(text(n)));
    case "template_string":
      return n.namedChildren.some((c) => c.type === "template_substitution") ? { expr: clip(text(n)) } : clip(unquote(text(n)));
    case "number": return Number(text(n).replace(/_/g, ""));
    case "true": return true;
    case "false": return false;
    case "null": case "undefined": return null;
    case "unary_expression": {
      const v = Number(text(n).replace(/\s+/g, ""));
      return Number.isFinite(v) ? v : { expr: clip(text(n)) };
    }
    case "identifier": case "member_expression": case "property_identifier":
      return /^[\w$.]+$/.test(text(n)) ? { ref: text(n) } : { expr: clip(text(n)) };
    case "arrow_function": case "function_expression": case "function": case "generator_function":
      return { fn: line(n) };
    case "array":
      if (depth >= MAX_DEPTH) return { expr: clip(text(n)) };
      return n.namedChildren.filter((c) => c.type !== "comment").slice(0, MAX_ROWS).map((c) => (c.type === "spread_element" ? { spread: text(c.namedChildren[0] ?? c) } : literalValue(c, text, line, depth + 1)));
    case "object":
      if (depth >= MAX_DEPTH) return { expr: clip(text(n)) };
      return { fields: objectFields(n, text, line, depth + 1) };
    default:
      return { expr: clip(text(n)) };
  }
}

function keyOf(k, text) {
  if (!k) return null;
  if (k.type === "property_identifier" || k.type === "number" || k.type === "private_property_identifier") return text(k);
  if (k.type === "string") return unquote(text(k));
  return `[${text(k)}]`;
}

/** The fields of one object literal: name → value, spreads as `...X`. */
export function objectFields(obj, text, line, depth = 1) {
  const out = {};
  let n = 0;
  for (const p of obj.namedChildren) {
    if (n >= MAX_FIELDS) break;
    if (p.type === "pair") {
      const k = keyOf(p.childForFieldName("key"), text);
      if (k !== null) { out[k] = literalValue(p.childForFieldName("value"), text, line, depth); n++; }
    } else if (p.type === "shorthand_property_identifier") {
      out[text(p)] = { ref: text(p) }; n++;
    } else if (p.type === "spread_element") {
      out[`...${text(p.namedChildren[0] ?? p)}`] = { spread: true }; n++;
    } else if (p.type === "method_definition") {
      const k = keyOf(p.childForFieldName("name"), text);
      if (k !== null) { out[k] = { fn: line(p) }; n++; }
    }
  }
  return out;
}

const isScalar = (n) => ["string", "number", "true", "false", "null", "undefined"].includes(n.type)
  || (n.type === "template_string" && !n.namedChildren.some((c) => c.type === "template_substitution"));

/**
 * The table a module-level constant holds, or null when its value is not one.
 * `value` is the initializer node.
 */
export function literalTable(value, text, line) {
  const v = unwrapLiteral(value);
  if (!v) return null;
  if (v.type === "array") {
    const els = v.namedChildren.filter((c) => c.type !== "comment").map(unwrapLiteral);
    if (els.length < MIN_ENTRIES) return null;
    if (els.every((e) => e?.type === "object")) {
      const rows = els.slice(0, MAX_ROWS).map((o) => ({ line: line(o), fields: objectFields(o, text, line) }));
      return { shape: "rows", rows, ...(els.length > MAX_ROWS ? { truncated: els.length } : {}) };
    }
    if (els.every((e) => e && isScalar(e))) {
      return { shape: "list", values: els.slice(0, MAX_ROWS).map((e) => literalValue(e, text, line)) };
    }
    return null;
  }
  if (v.type === "object") {
    const pairs = v.namedChildren.filter((p) => p.type === "pair" || p.type === "method_definition");
    if (pairs.length < MIN_ENTRIES || pairs.length !== v.namedChildren.filter((p) => p.type !== "comment").length) return null;
    const rows = [];
    for (const p of pairs.slice(0, MAX_ROWS)) {
      const key = keyOf(p.childForFieldName(p.type === "pair" ? "key" : "name"), text);
      if (key === null) return null;
      const val = p.type === "pair" ? unwrapLiteral(p.childForFieldName("value")) : null;
      if (val?.type === "object") rows.push({ key, line: line(p), fields: objectFields(val, text, line) });
      else rows.push({ key, line: line(p), value: p.type === "pair" ? literalValue(val, text, line) : { fn: line(p) } });
    }
    return { shape: "record", rows, ...(pairs.length > MAX_ROWS ? { truncated: pairs.length } : {}) };
  }
  return null;
}

/**
 * The KEYS of an object literal, for injected capabilities (module 4): which
 * members an object a function returns (or a typed constant holds) provides.
 * A function-valued member is marked; any other value is kept as short source
 * (`o.readRecords` — forwarded from elsewhere). Keys and shapes, never data.
 */
export function objectProps(obj, text, line) {
  const v = unwrapLiteral(obj);
  if (!v || v.type !== "object") return null;
  const out = [];
  for (const p of v.namedChildren) {
    if (out.length >= MAX_FIELDS) break;
    if (p.type === "pair") {
      const key = keyOf(p.childForFieldName("key"), text);
      const val = unwrapLiteral(p.childForFieldName("value"));
      if (key === null) continue;
      const fn = !!val && ["arrow_function", "function_expression", "function", "generator_function"].includes(val.type);
      out.push({ key, line: line(p), ...(fn ? { fn: true } : { value: clip(text(val ?? p)).slice(0, 80) }) });
    } else if (p.type === "method_definition") {
      const key = keyOf(p.childForFieldName("name"), text);
      if (key !== null) out.push({ key, line: line(p), fn: true });
    } else if (p.type === "shorthand_property_identifier") {
      out.push({ key: text(p), line: line(p), value: text(p) });
    } else if (p.type === "spread_element") {
      // `...(cond ? { a } : {})` / `...(cond && { a })`: members present on a condition
      const inner = unwrapLiteral(p.namedChildren[0]);
      const branches = inner?.type === "ternary_expression" ? [inner.childForFieldName("consequence"), inner.childForFieldName("alternative")]
        : inner?.type === "binary_expression" ? [inner.childForFieldName("right")] : [];
      const objs = branches.map(unwrapLiteral).filter((b) => b?.type === "object");
      if (objs.length) for (const o of objs) for (const q of objectProps(o, text, line) ?? []) out.push({ ...q, conditional: true });
      else out.push({ key: `...${text(p.namedChildren[0] ?? p)}`, line: line(p), spread: true });
    }
  }
  return out.length ? out : null;
}

/** `x satisfies T` → "T" (the type an object literal declares it meets). */
export function satisfiedType(value, text) {
  let cur = value;
  while (cur && WRAPPERS.has(cur.type)) {
    if (cur.type === "satisfies_expression") return text(cur.namedChildren[1] ?? cur).trim();
    cur = cur.namedChildren[0] ?? null;
  }
  return null;
}
