// 2026-09-28 — the environment variables a JS/TS file reads BY NAME. A member
// access is not a call, so no IR node carries `process.env.OPENAI_API_KEY`;
// the reads ride the IR root as `envReads: [{ name, line, form }]`, the same
// shape parse_cst.py emits for Python. Forms:
//
//   member       process.env.X · import.meta.env.X
//   index        process.env["X"]  (a computed key is not a name: skipped)
//   destructure  const { A, B: b } = process.env
//
// Walked once over the tree-sitter tree; nothing here resolves or guesses.

const ENV_OBJECTS = new Set(["process.env", "import.meta.env"]);

function text(n) { return n?.text ?? ""; }

function stringValue(n) {
  if (!n || n.type !== "string") return null;
  const frag = n.namedChildren.find((c) => c.type === "string_fragment");
  return frag ? frag.text : null;
}

/** [{ name, line, form }] in source order. */
export function collectEnvReads(root) {
  const out = [];
  const add = (name, node, form) => { if (name) out.push({ name, line: node.startPosition.row + 1, form }); };
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.type === "member_expression") {
      const obj = n.childForFieldName("object");
      const prop = n.childForFieldName("property");
      if (obj && ENV_OBJECTS.has(text(obj).replace(/\s+/g, "")) && prop?.type === "property_identifier") add(prop.text, n, "member");
    } else if (n.type === "subscript_expression") {
      const obj = n.childForFieldName("object");
      const idx = n.childForFieldName("index");
      if (obj && ENV_OBJECTS.has(text(obj).replace(/\s+/g, ""))) add(stringValue(idx), n, "index");
    } else if (n.type === "variable_declarator") {
      const value = n.childForFieldName("value");
      const name = n.childForFieldName("name");
      if (value && name?.type === "object_pattern" && ENV_OBJECTS.has(text(value).replace(/\s+/g, ""))) {
        for (const c of name.namedChildren) {
          if (c.type === "shorthand_property_identifier_pattern") add(c.text, c, "destructure");
          else if (c.type === "pair_pattern") add(text(c.childForFieldName("key")).replace(/^["']|["']$/g, ""), c, "destructure");
          else if (c.type === "object_assignment_pattern") add(text(c.childForFieldName("left")), c, "destructure");
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i));
  }
  out.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return out;
}
