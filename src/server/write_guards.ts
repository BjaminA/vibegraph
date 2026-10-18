// WHAT A STATEMENT RUNS BEHIND (2026-10-14, the brief-intent drill —
// reviews/brief-intent/BASELINE.md). A field Brief never said its decisions
// are verified, and the drill found why: the facts carried every WRITE SITE and
// never the check a write sits behind (`if (!verify(d)) continue;` right before
// the write), so a model that may only claim what an [enforce] item shows left
// verification out, three times in three.
//
// From the IR alone, inside the statement's own function:
//   - an if-arm around it: it runs only when the test holds (then) or fails (else);
//   - an earlier if in one of its blocks whose then-arm always leaves (`exits`,
//     stamped by the parsers) and has no else: it runs only when that test fails.
// Kept only when the test CALLS something — a check (`verify(d)`, `hasRole(u)`);
// a plain null test is not a mechanism. A leading `!` / `not` on one call is
// read as "fails". Named limits: a guard in a CALLER is not followed; a flattened
// callback's exit is ignored for code outside that callback (an exit there leaves
// the callback, not the function); bash, C++ and Rust stamp no `exits` yet.

export interface IrNodeLike {
  id: string; type: string; parentId?: string | null; line?: number; endLine?: number;
  condition?: string; hasElse?: boolean; elseLine?: number; exits?: string; name?: string;
}
export interface Guard { check: string; when: "holds" | "fails"; line: number }

const STOP = new Set(["function_def", "class_def"]);
const CALLS = /[A-Za-z_$][\w$.]*\s*\(/;

/** The index of the bracket that closes the one opening at `open`, or -1. */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** One call (`a.b(x)`) or one bracketed group spanning the whole text. */
function single(s: string): boolean {
  const open = s.startsWith("(") ? 0 : /^[\w$.]+\s*\(/.test(s) ? s.indexOf("(") : -1;
  return open >= 0 && closing(s, open) === s.length - 1;
}

/** `!verify(d)` / `not verify(d)` read as verify(d) failing; anything else as written. */
export function readGuard(condition: string, when: Guard["when"]): { check: string; when: Guard["when"] } {
  const c = condition.trim().replace(/\s+/g, " ");
  const neg = /^(?:!|not\s+)(.+)$/.exec(c);
  if (neg && single(neg[1].trim())) return { check: neg[1].trim(), when: when === "holds" ? "fails" : "holds" };
  return { check: c, when };
}

/** The checks the node with `id` runs behind, innermost first. */
export function guardsOf(nodes: IrNodeLike[], id: string): Guard[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, IrNodeLike[]>();
  for (const n of nodes) if (n.parentId) (kids.get(n.parentId) ?? kids.set(n.parentId, []).get(n.parentId)!).push(n);
  const out: Guard[] = [];
  const add = (condition: string | undefined, when: Guard["when"], line: number) => {
    if (!condition || condition.startsWith("switch ") || !CALLS.test(condition)) return;
    const g = readGuard(condition, when);
    if (!out.some((x) => x.check === g.check && x.when === g.when)) out.push({ ...g, line });
  };
  let cur = byId.get(id);
  while (cur?.parentId) {
    const p = byId.get(cur.parentId);
    if (!p) break;
    const arm = (n: IrNodeLike) => (p.type === "if_stmt" && p.hasElse && p.elseLine && (n.line ?? 0) >= p.elseLine ? "else" : "then");
    const siblings = kids.get(p.id) ?? [];
    // a call spanning lines holds a flattened callback: an exit inside it
    // leaves the callback, so it guards only what is in the same callback
    const spans = siblings.filter((s) => s.type === "call" && (s.endLine ?? 0) > (s.line ?? 0));
    const within = (n: IrNodeLike, s: IrNodeLike) => (s.line ?? 0) <= (n.line ?? 0) && (n.endLine ?? n.line ?? 0) <= (s.endLine ?? 0);
    for (const s of siblings) {
      if (s.type !== "if_stmt" || !s.exits || s.hasElse || s.id === cur.id) continue;
      if ((s.endLine ?? s.line ?? 0) >= (cur.line ?? 0)) continue; // not before it
      if (p.type === "if_stmt" && arm(s) !== arm(cur)) continue; // the other arm
      if (spans.some((c) => within(s, c) && !within(cur!, c))) continue;
      add(s.condition, "fails", s.line ?? 0);
    }
    if (p.type === "if_stmt") add(p.condition, arm(cur) === "then" ? "holds" : "fails", p.line ?? 0);
    if (STOP.has(p.type)) break;
    cur = p;
  }
  return out;
}

export interface GuardedWrite { file: string; line: number; box: string; zone: string; fn: string | null; guards: Guard[] }

/** Every write to a zone (the map's zone edges, each site by its IR node)
 *  that runs behind a check. One entry per site and zone. */
export function guardedWrites(model: { edges: Array<{ from: string; to: string; protocol: string; refs?: Array<{ file: string; nodeId?: string }> }> },
  files: Record<string, { nodes?: IrNodeLike[] }>): GuardedWrite[] {
  const out: GuardedWrite[] = [];
  const seen = new Set<string>();
  for (const e of model.edges) {
    if (!e.to.startsWith("zone:") || e.protocol !== "write") continue;
    for (const r of e.refs ?? []) {
      const nodes = files[r.file]?.nodes;
      const node = r.nodeId && nodes ? nodes.find((n) => n.id === r.nodeId) : undefined;
      if (!node || !nodes) continue;
      const key = `${r.file}:${node.line}:${e.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const guards = guardsOf(nodes, node.id);
      if (guards.length) out.push({ file: r.file, line: node.line ?? 0, box: e.from, zone: e.to, fn: enclosingFunction(nodes, node.id), guards });
    }
  }
  return out;
}

/** "only when verify(d) holds and hasRole(u) fails" */
export const guardText = (gs: Guard[]) => `only when ${gs.map((g) => `${g.check} ${g.when}`).join(" and ")}`;

/** The name of the function the node sits in, or null at module level. */
export function enclosingFunction(nodes: IrNodeLike[], id: string): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (let n = byId.get(id); n; n = n.parentId ? byId.get(n.parentId) : undefined) if (n.type === "function_def") return n.name ?? null;
  return null;
}
