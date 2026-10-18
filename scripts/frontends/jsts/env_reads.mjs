// 2026-09-28 — the environment variables a JS/TS file reads BY NAME. A member
// access is not a call, so no IR node carries `process.env.OPENAI_API_KEY`;
// the reads ride the IR root as `envReads: [{ name, line, form }]`, the same
// shape parse_cst.py emits for Python. Forms:
//
//   member       process.env.X · import.meta.env.X
//   index        process.env["X"]  (a computed key is not a name: skipped)
//   destructure  const { A, B: b } = process.env
//
// 2026-10-17 — and what an UNSET value does there, from a field run whose
// outage was `(process.env.X || "").split(",")` feeding a filter: unset, the
// list was empty and every user was silently denied. Two optional fields,
// read off the expression around the read and emitted only when known:
//
//   fallback  value   `?? "x"` / `|| x` — a non-empty default
//             empty   `?? ""` / `|| ""` / `?.` — unset becomes empty or undefined, quietly
//             throws  a method called on the bare read (`process.env.X.split`) — a TypeError
//   use       split        the value is split into a list
//             exit-silent  `if (!process.env.X) return` (or continue / break)
//             exit-loud    `if (!process.env.X) throw …` (or process.exit)
//
// Walked once over the tree-sitter tree; nothing here resolves or guesses.

const ENV_OBJECTS = new Set(["process.env", "import.meta.env"]);

function text(n) { return n?.text ?? ""; }
// web-tree-sitter hands out fresh wrappers: compare positions, never identity
const same = (a, b) => !!a && !!b && a.startIndex === b.startIndex && a.endIndex === b.endIndex && a.type === b.type;

function stringValue(n) {
  if (!n || n.type !== "string") return null;
  const frag = n.namedChildren.find((c) => c.type === "string_fragment");
  return frag ? frag.text : null;
}

const isEmptyLiteral = (n) => !!n && ((n.type === "string" && !n.namedChildren.length) || (n.type === "template_string" && n.text === "``"));
const LEAVES_SILENT = new Set(["return_statement", "continue_statement", "break_statement"]);

/** What an unset value does at this read: { fallback?, use? }. */
export function readShape(read) {
  const out = {};
  let expr = read;
  let p = read.parent;
  if (p?.type === "binary_expression" && same(p.childForFieldName("left"), expr)) {
    const op = text(p.childForFieldName("operator"));
    if (op === "??" || op === "||") { out.fallback = isEmptyLiteral(p.childForFieldName("right")) ? "empty" : "value"; expr = p; p = p.parent; }
  }
  while (p?.type === "parenthesized_expression" && p.parent?.type !== "if_statement") { expr = p; p = p.parent; }
  // a method called on the value
  if (p?.type === "member_expression" && same(p.childForFieldName("object"), expr) && p.parent?.type === "call_expression" && same(p.parent.childForFieldName("function"), p)) {
    const optional = p.children.some((c) => c.type === "optional_chain");
    if (optional && !out.fallback) out.fallback = "empty";
    if (!out.fallback) out.fallback = "throws";
    else if (text(p.childForFieldName("property")) === "split") out.use = "split";
    return out;
  }
  // a NEGATED read in an if's condition whose consequence leaves
  if (p?.type !== "unary_expression" || text(p.childForFieldName("operator")) !== "!") return out;
  let cond = p;
  let up = p.parent;
  while (up && (up.type === "binary_expression" || (up.type === "parenthesized_expression" && up.parent?.type !== "if_statement"))) { cond = up; up = up.parent; }
  if (up?.type !== "parenthesized_expression" || up.parent?.type !== "if_statement") return out;
  const body = up.parent.childForFieldName("consequence");
  const stmts = body?.type === "statement_block" ? body.namedChildren.slice(0, 3) : body ? [body] : [];
  for (const s of stmts) {
    if (s.type === "throw_statement" || (s.type === "expression_statement" && /^process\.exit\s*\(/.test(s.text))) { out.use = "exit-loud"; break; }
    if (LEAVES_SILENT.has(s.type)) { out.use = "exit-silent"; break; }
  }
  return out;
}

/** [{ name, line, form, fallback?, use? }] in source order. */
export function collectEnvReads(root) {
  const out = [];
  const add = (name, node, form, shape = {}) => { if (name) out.push({ name, line: node.startPosition.row + 1, form, ...shape }); };
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.type === "member_expression") {
      const obj = n.childForFieldName("object");
      const prop = n.childForFieldName("property");
      if (obj && ENV_OBJECTS.has(text(obj).replace(/\s+/g, "")) && prop?.type === "property_identifier") add(prop.text, n, "member", readShape(n));
    } else if (n.type === "subscript_expression") {
      const obj = n.childForFieldName("object");
      const idx = n.childForFieldName("index");
      if (obj && ENV_OBJECTS.has(text(obj).replace(/\s+/g, ""))) add(stringValue(idx), n, "index", readShape(n));
    } else if (n.type === "variable_declarator") {
      const value = n.childForFieldName("value");
      const name = n.childForFieldName("name");
      if (value && name?.type === "object_pattern" && ENV_OBJECTS.has(text(value).replace(/\s+/g, ""))) {
        for (const c of name.namedChildren) {
          if (c.type === "shorthand_property_identifier_pattern") add(c.text, c, "destructure");
          else if (c.type === "pair_pattern") add(text(c.childForFieldName("key")).replace(/^["']|["']$/g, ""), c, "destructure");
          // `const { X = "d" } = process.env` — a destructuring default
          else if (c.type === "object_assignment_pattern") add(text(c.childForFieldName("left")), c, "destructure", { fallback: isEmptyLiteral(c.childForFieldName("right")) ? "empty" : "value" });
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i));
  }
  out.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return out;
}
