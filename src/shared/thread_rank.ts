// Thread ranks — primary / secondary / tertiary (2026-09-25).
//
// A thread is everything the static walk reached, and on a real codebase most
// of that is not the story: measured on a private production codebase (363 threads, 48,860 nodes)
// half the terminals are local data work and language builtins, a tenth is
// React state, 7% is logging, and 3% are the boundaries the thread exists to
// reach. This module RANKS every node from facts the IR already holds and
// PROJECTS a view: primary alone, + secondary, or everything. Nothing is
// deleted — each visible node carries a REMIT, the hidden nodes it owns, and
// expanding it shows them.
//
// The ranking, in one sentence per rank:
//   1 PRIMARY   — the seed, what leaves the project (a boundary the parser or
//                 a STRONG attribution proved), a runtime dispatch, a hop to
//                 another thread, and every step on the path to one of those.
//   2 SECONDARY — project helpers with no boundary below them, resolution
//                 gaps (never hidden deeper: the honesty split stays one click
//                 away), exits, wiring, a thread's own outputs, and GUARDS.
//   3 TERTIARY  — local data work, the language's runtime, UI state, promise
//                 callbacks, logging, pure path and text helpers.
//
// Pure and deterministic: no model, no IR mutation, one function for every
// reader. The per-node facts are INJECTED (the webview and the server build
// them from different places) so this file never re-implements attribution.

import {
  attributeBoundary, effectFromRole,
  type Attribution, type ImportBinding, type LocalBinding, type StackLike,
} from "./stack_attribution.ts";
import { languageForPath } from "./languages.ts";

export type Rank = 1 | 2 | 3;

export type RankCategory =
  | "seed" | "boundary" | "dispatch" | "hop" | "path"
  | "helper" | "gap" | "wiring" | "exit" | "output" | "guard" | "setup" | "call"
  | "log" | "ui-state" | "data" | "runtime" | "callback" | "return" | "ui-lib" | "text-tool";

export interface RankNode {
  id: string;
  kind: string;
  label: string;
  effectKind?: string;
  containerKind?: string;
  file?: string | null;
  irNodeId?: string | null;
  qualifiedTarget?: string;
}
export interface RankEdge { from: string; to: string; kind?: string; irSource?: string | null }
export interface RankThread { nodes: ReadonlyArray<RankNode>; edges: ReadonlyArray<RankEdge> }

/** What the caller knows about one TERMINAL. Everything here is already on
 *  the thread node, the owning file's IR, or the stack index. */
export interface NodeFacts {
  language: string;
  attribution: Attribution | null;
  /** parse-time effect from the owning file's IR (the thread node's own
   *  `effectKind`, when it carries one, is read first). */
  effectKind: string | null;
  /** a crossing (HTTP / command / tool hop) starts at this call. */
  crossing?: boolean;
}

/** Where the facts come from: the owning file's IR and the stack index. */
export interface FactsContext {
  /** the file the CALL is written in (a terminal's own `file` is null). */
  ownerFile: (n: RankNode) => string | null;
  irNode: (file: string, irNodeId: string) => { effectKind?: unknown } | null | undefined;
  imports: (file: string) => ReadonlyArray<ImportBinding>;
  locals: (file: string) => ReadonlyArray<LocalBinding>;
  stack: StackLike | null;
  crossing?: (n: RankNode) => boolean;
}

/** The ONE way a terminal's facts are built — the same attribution call the
 *  contract and the tooltip make, so a rank never disagrees with them. */
export function factsFrom(ctx: FactsContext): (n: RankNode) => NodeFacts {
  return (n) => {
    const file = ctx.ownerFile(n);
    const language = (file ? languageForPath(file)?.id : null) ?? "";
    const ir = file && n.irNodeId ? ctx.irNode(file, n.irNodeId) : null;
    const effectKind = typeof ir?.effectKind === "string" ? ir.effectKind : null;
    const attribution = n.kind === "external" || n.kind === "dynamic" || n.kind === "unresolved"
      ? attributeBoundary({
        language, label: n.label, kind: n.kind,
        qualifiedTarget: n.qualifiedTarget ?? null,
        effectKind: n.effectKind ?? effectKind,
        file, irNodeId: n.irNodeId ?? null,
        imports: file ? ctx.imports(file) : [],
        locals: file ? ctx.locals(file) : [],
        stack: ctx.stack,
      })
      : null;
    return { language, attribution, effectKind, crossing: ctx.crossing?.(n) ?? false };
  };
}

export interface Guard {
  container: string;
  /** the outcome member that stands for the whole guard when folded. */
  outcome: string;
  members: string[];
  label: string;
}

export interface Ranked {
  rank: Map<string, Rank>;
  category: Map<string, RankCategory>;
  guards: Guard[];
  /** a node's CALLER — the step whose body holds it (call edges only). */
  callParent: Map<string, string>;
  /** a container's transitive non-container members. */
  members: Map<string, string[]>;
}

// ── the tables ────────────────────────────────────────────────────────
// Names, not effects: a table here only ever LOWERS a rank, and only for a
// call nothing stronger claimed (the boundary test runs before the data and
// runtime tables). The two that run BEFORE it are the ones whose parse-time
// effect is a known over-reach: `os.path.join` is stamped fs by parse_cst's
// prefix table, and every bash word is stamped subprocess by the linker's
// honest default. The run floor keeps those effects; the VIEW ranks them.

const LOG = /^(console\.(log|error|warn|debug|info|trace)|echo|printf|print|logger\.\w+|logging\.\w+|log\.(debug|info|warn|warning|error|exception|critical)|debugLog|eprintln!?|println!?|eprint!?|print!?|process\.(stdout|stderr)\.write)$/;

const PURE_PATH = /^(os\.path\.(join|basename|dirname|splitext|split|normpath|relpath|abspath|expanduser|isabs|commonpath)|path\.(join|resolve|dirname|basename|extname|relative|normalize|isAbsolute|sep|parse|format)|posixpath\.\w+|PurePath)$/;

const BASH_TEXT_TOOLS = new Set([
  "basename", "dirname", "pwd", "date", "tr", "cut", "head", "tail", "wc",
  "sort", "uniq", "seq", "sleep", "grep", "sed", "awk", "jq", "tee", "xargs",
  "true", "false", "test", "expr", "printf", "realpath", "readlink", "mktemp",
]);

const EXIT = /^(process\.exit|exit|sys\.exit|os\._exit|std::process::exit|std::exit)$/;

const OUTCOME = /^(return|Response\.json|NextResponse\.json|NextResponse\.redirect|res\.(json|send|status|end|redirect)|reply\.(send|code)|abort|jsonify|process\.exit|exit|sys\.exit|throw)$/;

const UI_STATE = /^(use[A-Z]\w*(\.getState)?|set[A-Z]\w*)$/;

const PROMISE_CB = /^(resolve|reject)$/;

const WIRING = /\.(on|once|off|addEventListener|removeEventListener|addListener|removeListener|subscribe|emit)$/;

const RUNTIME_API = /^(Date|Error|TypeError|RangeError|String|Number|Boolean|Symbol|BigInt|Set|Map|WeakMap|WeakSet|Array|Object|Promise|RegExp|URL|URLSearchParams|TextDecoder|TextEncoder|AbortController|Intl\.\w+|Buffer\.\w+|Math\.\w+|JSON\.\w+|Reflect\.\w+|Date\.\w+|Number\.\w+|Object\.\w+|Array\.\w+|Promise\.\w+|clearTimeout|setTimeout|setInterval|clearInterval|queueMicrotask|structuredClone|encodeURIComponent|decodeURIComponent|parseInt|parseFloat|isNaN|CustomEvent|performance\.now|(window|document)\.(add|remove)EventListener|len|str|int|float|bool|list|dict|set|tuple|range|enumerate|zip|sorted|min|max|sum|any|all|isinstance|getattr|hasattr|format)$/;

/** A method whose work is on the VALUE it is called on, never the world. */
const DATA_METHOD = /\.(push|pop|shift|unshift|map|filter|reduce|forEach|some|every|find|findIndex|includes|indexOf|lastIndexOf|slice|splice|concat|join|split|trim|trimStart|trimEnd|toUpperCase|toLowerCase|upper|lower|strip|lstrip|rstrip|startsWith|endsWith|startswith|endswith|replace|replaceAll|match|padStart|padEnd|toString|toFixed|keys|values|entries|items|has|add|delete|sort|reverse|flat|flatMap|at|charAt|charCodeAt|repeat|localeCompare|normalize|getTime|toISOString|append|extend|update|get|setdefault|copy|format|getUTC\w+|get[A-Z]\w*)$/;

const DISPATCH = /^("?\$|eval\b|import$|require$|getattr$|__import__$|importlib\.import_module$)/;

/** `await foo(x)`, `new Date(n).getTime` → `foo`, `Date.getTime`: the name
 *  the tables key on. Arguments inside a chain are dropped. */
export function callName(label: string): string {
  let s = label.trim().replace(/^(await|yield|return)\s+/, "").replace(/^new\s+/, "");
  // drop every balanced (...) and [...] segment, innermost first
  for (let i = 0; i < 8 && /[([]/.test(s); i++) s = s.replace(/\([^()]*\)|\[[^[\]]*\]/g, "");
  return s.replace(/\?\./g, ".").replace(/\s+/g, "");
}

function rankTerminal(n: RankNode, f: NodeFacts): [Rank, RankCategory] {
  const name = callName(n.label);
  const a = f.attribution;
  if (LOG.test(name) || (n.effectKind ?? f.effectKind) === "log") return [3, "log"];
  if (PURE_PATH.test(name)) return [3, "data"];
  if (f.language === "bash" && BASH_TEXT_TOOLS.has(name)) return [3, "text-tool"];
  const effect = n.effectKind ?? f.effectKind ?? effectFromRole(a);
  // Building a client (`new OpenAI()`, `requests.Session()`) is set-up: the
  // round trips are its METHOD calls, which rank as boundaries on their own
  // (the `client-instance` attribution). Only when the parser proved no
  // effect of its own — a constructor that connects says so at parse time.
  if (effect && !n.effectKind && !f.effectKind && a && /^[A-Z][A-Za-z0-9_]*$/.test(name.split(".").pop() ?? "")) {
    return [2, "setup"];
  }
  if (effect) return [1, "boundary"];
  if (n.kind === "dynamic" && DISPATCH.test(n.label.trim())) return [1, "dispatch"];
  if (f.crossing) return [1, "hop"];
  if (EXIT.test(name)) return [2, "exit"];
  if (OUTCOME.test(name)) return [2, "output"];
  if (n.label.trim().startsWith("/")) return [3, "data"]; // a regex literal's .test / .exec
  if (f.language === "jsts" && UI_STATE.test(name)) return [3, "ui-state"];
  if (f.language === "jsts" && PROMISE_CB.test(name)) return [3, "callback"];
  if (WIRING.test(name)) return [2, "wiring"];
  if (a && (a.how === "builtin" || a.how === "local-literal")) return [3, "data"];
  if (a && (a.how === "runtime" || a.how === "global")) return [3, "runtime"];
  if (RUNTIME_API.test(name)) return [3, "runtime"];
  if (DATA_METHOD.test(name)) return [3, "data"];
  if (a && a.how === "local-binding") return [3, "data"];
  if (a && /^[A-Z]/.test(name) && (a.role === "frontend" || a.role === "ui" || a.role === "utility")) return [3, "ui-lib"];
  if (n.kind === "unresolved") return [2, "gap"];
  if (!name) return [3, "data"];
  return [2, "call"];
}

const CALL_EDGE = (k?: string) => k !== "contains" && k !== "flow";

/**
 * Rank every node of one thread. `facts` is asked about terminals only.
 */
export function rankThread(thread: RankThread, facts: (n: RankNode) => NodeFacts): Ranked {
  const byId = new Map(thread.nodes.map((n) => [n.id, n]));
  const rank = new Map<string, Rank>();
  const category = new Map<string, RankCategory>();
  const kids = new Map<string, string[]>();
  const contains = new Map<string, string[]>();
  const callParent = new Map<string, string>();
  for (const e of thread.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    if (e.kind === "contains") {
      (contains.get(e.from) ?? contains.set(e.from, []).get(e.from)!).push(e.to);
    } else if (CALL_EDGE(e.kind) && byId.get(e.from)!.kind !== "container") {
      (kids.get(e.from) ?? kids.set(e.from, []).get(e.from)!).push(e.to);
      if (!callParent.has(e.to)) callParent.set(e.to, e.from);
    }
  }
  const seed = thread.nodes.find((n) => n.kind === "seed");

  for (const n of thread.nodes) {
    if (n.kind === "seed") { rank.set(n.id, 1); category.set(n.id, "seed"); continue; }
    if (n.kind === "step" || n.kind === "container") continue;
    if (n.kind === "return") {
      const own = callParent.get(n.id) === seed?.id;
      rank.set(n.id, own ? 2 : 3); category.set(n.id, own ? "output" : "return");
      continue;
    }
    const [r, c] = rankTerminal(n, facts(n));
    rank.set(n.id, r); category.set(n.id, c);
  }

  // A step is primary when a primary node sits anywhere below it.
  const reaches = new Map<string, boolean>();
  const walk = (id: string, seen: Set<string>): boolean => {
    const memo = reaches.get(id);
    if (memo !== undefined) return memo;
    if (seen.has(id)) return false;
    seen.add(id);
    let r = false;
    for (const k of kids.get(id) ?? []) {
      const kn = byId.get(k)!;
      if ((kn.kind !== "step" && rank.get(k) === 1) || (kn.kind === "step" && walk(k, seen))) r = true;
    }
    reaches.set(id, r);
    return r;
  };
  for (const n of thread.nodes) {
    if (n.kind !== "step") continue;
    const p = walk(n.id, new Set());
    rank.set(n.id, p ? 1 : 2); category.set(n.id, p ? "path" : "helper");
  }

  // Containers: their transitive members, and the best rank among them.
  const members = new Map<string, string[]>();
  const collect = (id: string, seen: Set<string>): string[] => {
    const out: string[] = [];
    for (const k of contains.get(id) ?? []) {
      if (seen.has(k)) continue;
      seen.add(k);
      if (byId.get(k)?.kind === "container") out.push(...collect(k, seen));
      else out.push(k);
    }
    return out;
  };
  for (const n of thread.nodes) {
    if (n.kind !== "container") continue;
    const m = collect(n.id, new Set());
    members.set(n.id, m);
    rank.set(n.id, (m.length ? Math.min(...m.map((x) => rank.get(x) ?? 2)) : 3) as Rank);
  }

  // Guards: an if-arm that only logs, tidies up and LEAVES (return / exit /
  // respond / throw). Folded, it reads as one line — `exits if !doRun`.
  const guards: Guard[] = [];
  for (const n of thread.nodes) {
    if (n.kind !== "container" || !/^if_/.test(n.containerKind ?? "")) continue;
    const m = members.get(n.id) ?? [];
    if (!m.length) continue;
    let outcome: string | null = null;
    let ok = true;
    for (const id of m) {
      const mn = byId.get(id)!;
      const isOutcome = mn.kind === "return" || OUTCOME.test(callName(mn.label));
      if (isOutcome) { outcome ??= id; continue; }
      if (mn.kind === "step" || (rank.get(id) ?? 2) < 3) { ok = false; break; }
    }
    if (!ok || !outcome) continue;
    const out = byId.get(outcome)!;
    const cond = n.containerKind === "if_else"
      ? "otherwise"
      : `if ${n.label.replace(/^(if|elif|else if)\s+/i, "").trim()}`;
    const oname = callName(out.label);
    const verb = /exit/.test(oname) ? "exits" : /^throw/.test(oname) ? "throws" : "returns";
    guards.push({ container: n.id, outcome, members: m, label: `${verb} ${cond}` });
    rank.set(outcome, 2); category.set(outcome, "guard");
  }

  return { rank, category, guards, callParent, members };
}

// ── the projection ────────────────────────────────────────────────────

export interface RemitSummary {
  count: number;
  /** by category, largest first. */
  parts: Array<[RankCategory, number]>;
}

export interface RankProjection {
  /** non-container nodes to draw. */
  visible: Set<string>;
  /** containers to draw (at least one visible member, not a folded guard). */
  containers: Set<string>;
  /** a folded guard's outcome node reads as the guard. */
  relabel: Map<string, string>;
  /** a kept terminal standing for N identical calls from the same caller. */
  repeat: Map<string, number>;
  /** what each visible node is hiding. */
  remit: Map<string, RemitSummary>;
  /** call edges to add where a visible node's caller is hidden. */
  extraEdges: Array<{ from: string; to: string }>;
}

/**
 * Project a ranked thread at `level` (1 = primary, 2 = + secondary,
 * 3 = everything). `expanded` holds nodes whose remit the user opened.
 * Level 3 is the raw thread: no folds, no remits.
 */
export function projectRanks(
  thread: RankThread, ranked: Ranked, level: Rank, expanded: ReadonlySet<string> = new Set(),
): RankProjection {
  const plain = thread.nodes.filter((n) => n.kind !== "container");
  const empty = (): RankProjection => ({
    visible: new Set(plain.map((n) => n.id)),
    containers: new Set(thread.nodes.filter((n) => n.kind === "container").map((n) => n.id)),
    relabel: new Map(), repeat: new Map(), remit: new Map(), extraEdges: [],
  });
  if (level >= 3) return empty();

  const visible = new Set(plain.filter((n) => (ranked.rank.get(n.id) ?? 2) <= level).map((n) => n.id));

  // The owner of a hidden node: its nearest VISIBLE caller.
  const seed = plain.find((n) => n.kind === "seed")?.id;
  const ownerOf = (id: string): string | undefined => {
    let cur = ranked.callParent.get(id);
    const seen = new Set<string>();
    while (cur && !visible.has(cur) && !seen.has(cur)) { seen.add(cur); cur = ranked.callParent.get(cur); }
    return cur && visible.has(cur) ? cur : seed;
  };
  // Opening a remit shows everything it holds.
  if (expanded.size) {
    for (const n of plain) {
      if (visible.has(n.id)) continue;
      const o = ownerOf(n.id);
      if (o && expanded.has(o)) visible.add(n.id);
    }
  }

  // A guard whose outcome is drawn reads as ONE line; hidden, it counts as
  // one guard in its owner's remit. Either way its other members are what
  // the guard already says, so they are never counted on their own.
  const relabel = new Map<string, string>();
  const folded = new Set<string>();
  const inGuard = new Set<string>();
  for (const g of ranked.guards) {
    for (const m of g.members) if (m !== g.outcome) { inGuard.add(m); visible.delete(m); }
    if (!visible.has(g.outcome)) continue;
    relabel.set(g.outcome, g.label);
    folded.add(g.container);
  }

  // Identical calls from one caller fold into the first (`×N`).
  const repeat = new Map<string, number>();
  const repeated = new Set<string>();
  const firstOf = new Map<string, string>();
  for (const n of plain) {
    if (!visible.has(n.id) || n.kind === "seed" || n.kind === "step" || relabel.has(n.id)) continue;
    const key = `${ranked.callParent.get(n.id) ?? ""}|${n.kind}|${n.label}`;
    const first = firstOf.get(key);
    if (!first) { firstOf.set(key, n.id); continue; }
    visible.delete(n.id);
    repeated.add(n.id);
    repeat.set(first, (repeat.get(first) ?? 1) + 1);
  }

  const counts = new Map<string, Map<RankCategory, number>>();
  for (const n of plain) {
    if (visible.has(n.id) || repeated.has(n.id) || inGuard.has(n.id)) continue;
    const o = ownerOf(n.id);
    if (!o) continue;
    const m = counts.get(o) ?? counts.set(o, new Map()).get(o)!;
    const c = ranked.category.get(n.id) ?? "call";
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  const remit = new Map<string, RemitSummary>();
  for (const [o, m] of counts) {
    const parts = [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    remit.set(o, { count: parts.reduce((s, [, v]) => s + v, 0), parts });
  }

  const extraEdges: Array<{ from: string; to: string }> = [];
  for (const id of visible) {
    const p = ranked.callParent.get(id);
    if (!p || visible.has(p)) continue;
    const o = ownerOf(id);
    if (o && o !== id) extraEdges.push({ from: o, to: id });
  }

  const containers = new Set<string>();
  for (const n of thread.nodes) {
    if (n.kind !== "container" || folded.has(n.id)) continue;
    if ((ranked.members.get(n.id) ?? []).some((m) => visible.has(m))) containers.add(n.id);
  }
  return { visible, containers, relabel, repeat, remit, extraEdges };
}

// ── ranks by code location (the code view) ─────────────────────────────

export interface LocationRank {
  rank: Rank;
  category: RankCategory;
  /** how many threads reach this location. */
  threads: number;
}

/**
 * The best rank each CODE LOCATION earns across every thread that reaches it,
 * keyed `${file}|${irNodeId}` (structural ids repeat across files). A call is
 * located where it is WRITTEN — a terminal inside its caller's file, a step at
 * its call site (the edge's `irSource`) — and a step's function definition
 * carries the step's rank too. A location no thread reaches has no rank: the
 * code view says nothing rather than guess.
 */
export function rankByLocation(
  threads: ReadonlyArray<RankThread & { nodes: ReadonlyArray<RankNode> }>,
  factsFor: (t: RankThread) => (n: RankNode) => NodeFacts,
): Map<string, LocationRank> {
  const out = new Map<string, LocationRank & { seen: Set<number> }>();
  const put = (key: string, rank: Rank, category: RankCategory, ti: number) => {
    const cur = out.get(key);
    if (!cur) { out.set(key, { rank, category, threads: 1, seen: new Set([ti]) }); return; }
    if (!cur.seen.has(ti)) { cur.seen.add(ti); cur.threads++; }
    if (rank < cur.rank) { cur.rank = rank; cur.category = category; }
  };
  threads.forEach((t, ti) => {
    const r = rankThread(t, factsFor(t));
    const byId = new Map(t.nodes.map((n) => [n.id, n]));
    const site = new Map<string, string>();
    for (const e of t.edges) if (e.irSource && e.kind !== "contains" && e.kind !== "flow") site.set(`${e.from}>${e.to}`, e.irSource);
    for (const n of t.nodes) {
      if (n.kind === "container") continue;
      const rank = r.rank.get(n.id);
      const category = r.category.get(n.id);
      if (!rank || !category) continue;
      if ((n.kind === "seed" || n.kind === "step") && n.file && n.irNodeId) put(`${n.file}|${n.irNodeId}`, rank, category, ti);
      const parent = r.callParent.get(n.id);
      const pf = parent ? byId.get(parent)?.file : null;
      if (!parent || !pf) continue;
      const at = n.kind === "step" ? site.get(`${parent}>${n.id}`) : n.irNodeId;
      if (at) put(`${pf}|${at}`, rank, category, ti);
    }
  });
  const clean = new Map<string, LocationRank>();
  for (const [k, v] of out) clean.set(k, { rank: v.rank, category: v.category, threads: v.threads });
  return clean;
}

/** `boundary`, `UI state`, … — a category as a reader says it. */
export function categoryWord(c: RankCategory): string {
  return CATEGORY_WORD[c];
}

const CATEGORY_WORD: Record<RankCategory, string> = {
  seed: "seed", boundary: "boundary", dispatch: "dispatch", hop: "hop", path: "step",
  helper: "helper", gap: "unresolved", wiring: "listener", exit: "exit", output: "output",
  guard: "guard", setup: "setup", call: "call", log: "log", "ui-state": "UI state", data: "local op",
  runtime: "runtime", callback: "callback", return: "return", "ui-lib": "UI element",
  "text-tool": "text tool",
};

/** `12 hidden: 5 local ops, 4 logs, 3 UI state` — the remit, said. */
export function remitText(r: RemitSummary, max = 3): string {
  const said = r.parts.slice(0, max).map(([c, v]) => {
    const w = CATEGORY_WORD[c];
    return `${v} ${v === 1 || /state$/.test(w) ? w : `${w}s`}`;
  });
  const rest = r.parts.slice(max).reduce((s, [, v]) => s + v, 0);
  return `${r.count} hidden: ${said.join(", ")}${rest ? `, ${rest} more` : ""}`;
}
