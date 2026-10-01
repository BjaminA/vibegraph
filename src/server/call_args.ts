// Reading a CALL node the way the store and authority checks need it
// (2026-10-01): its literal arguments, its callee against a list of names, and
// the function it is written in. Dependency-free on purpose — the constraint
// grammar imports it, and the grammar's import closure is type-checked as a
// unit (test:quality-schemas).

const LITERAL = /^(["'`])([\s\S]*)\1$/;

/** A literal argument's text, or null when the argument is computed. */
export function literalOf(arg: string): string | null {
  const m = LITERAL.exec(String(arg).trim());
  if (!m || (m[1] === "`" && m[2].includes("${"))) return null;
  return m[2];
}

/** `orders/*`, `order-*`: a family pattern against a literal. */
export function familyMatches(pattern: string, value: string): boolean {
  if (!pattern.includes("*")) return pattern === value;
  const re = new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(value);
}

/** Does a call's callee name one of these functions? A plan name matches the
 *  callee or its last segment(s): `writeDoc` ↔ `client.writeDoc`,
 *  `Store.write` ↔ `Store.write`. */
export function calleeIs(callee: string, names: readonly string[]): boolean {
  const c = callee.replace(/\(.*$/, "");
  return names.some((n) => c === n || c.endsWith(`.${n}`));
}

/** The enclosing function of a node id, `Class.method` when in a class. */
export function enclosingName(nodeId: string): string {
  const segs = nodeId.split("/").filter((s) => s.endsWith(".fn") || s.endsWith(".class"));
  const last = segs.length - 1 - [...segs].reverse().findIndex((s) => s.endsWith(".fn"));
  if (last >= segs.length) return "module";
  const fn = segs[last].slice(0, -3);
  const owner = segs[last - 1];
  return owner?.endsWith(".class") ? `${owner.slice(0, -6)}.${fn}` : fn;
}
