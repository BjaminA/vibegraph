// NAME PATTERNS (2026-10-02, module 2). On a data platform resource names are
// built by small pure functions — `topicFor = (env, t) => \`${env}.invoices.${t}\``
// — so no literal names the resource. A function whose WHOLE body returns a
// template literal or a `+` concatenation of its parameters and string
// literals is stamped with the pattern it returns, holes named by parameter:
// `{env}.invoices.{t}`. A parameter passed through a method chain
// (`b.replace(/_/g, "-").toLowerCase()`) is still that hole, marked
// transformed. Anything else — a loop, a lookup, a call on something that is
// not a parameter — is not a pattern, and nothing is stamped.

const STRINGS = new Set(["string", "template_string"]);

function paramNames(fn, text) {
  const ps = fn.childForFieldName("parameters") ?? fn.childForFieldName("parameter");
  if (!ps) return [];
  if (ps.type === "identifier") return [text(ps)];
  return ps.namedChildren.map((p) => {
    const id = p.childForFieldName("pattern") ?? p.childForFieldName("name") ?? p;
    return id.type === "identifier" ? text(id) : null;
  }).filter(Boolean);
}

/** The identifier at the root of a member/call chain, or null. */
function rootIdent(n) {
  let cur = n;
  for (let i = 0; i < 12 && cur; i++) {
    if (cur.type === "identifier") return cur;
    if (cur.type === "call_expression") cur = cur.childForFieldName("function");
    else if (cur.type === "member_expression") cur = cur.childForFieldName("object");
    else if (cur.type === "parenthesized_expression" || cur.type === "non_null_expression") cur = cur.namedChildren[0];
    else return null;
  }
  return null;
}

function piece(n, params, text, transforms) {
  if (!n) return null;
  if (n.type === "parenthesized_expression") return piece(n.namedChildren[0], params, text, transforms);
  if (n.type === "string") return text(n).slice(1, -1).replace(/[{}]/g, "");
  if (n.type === "template_string") {
    let out = "";
    for (const c of n.children) {
      if (c.type === "`") continue;
      if (c.type === "template_substitution") {
        const p = piece(c.namedChildren[0], params, text, transforms);
        if (p === null) return null;
        out += p;
      } else if (c.type === "string_fragment" || c.type === "escape_sequence") out += text(c).replace(/[{}]/g, "");
      else return null;
    }
    return out;
  }
  if (n.type === "identifier") return params.includes(text(n)) ? `{${text(n)}}` : null;
  if (n.type === "binary_expression" && text(n.child(1) ?? n) === "+") {
    const l = piece(n.childForFieldName("left"), params, text, transforms);
    const r = piece(n.childForFieldName("right"), params, text, transforms);
    return l === null || r === null ? null : l + r;
  }
  if (n.type === "call_expression" || n.type === "member_expression") {
    const root = rootIdent(n);
    if (root && params.includes(text(root))) { transforms.set(text(root), text(n).slice(text(root).length)); return `{${text(root)}}`; }
  }
  return null;
}

/** The pattern a function returns, or null. `fn` is the function node (declaration or arrow). */
export function namePattern(fn, text) {
  const params = paramNames(fn, text);
  const body = fn.childForFieldName("body");
  if (!body || !params.length) return null;
  let expr = null;
  if (body.type === "statement_block") {
    const stmts = body.namedChildren.filter((c) => c.type !== "comment");
    if (stmts.length !== 1 || stmts[0].type !== "return_statement") return null;
    expr = stmts[0].namedChildren[0];
  } else expr = body;
  while (expr && (expr.type === "parenthesized_expression" || expr.type === "as_expression")) expr = expr.namedChildren[0];
  if (!expr || !(STRINGS.has(expr.type) || expr.type === "binary_expression")) return null;
  const transforms = new Map();
  const p = piece(expr, params, text, transforms);
  if (p === null || !/\{/.test(p)) return null;
  return { pattern: p, params, ...(transforms.size ? { transformed: [...transforms.keys()], chains: Object.fromEntries(transforms) } : {}) };
}
