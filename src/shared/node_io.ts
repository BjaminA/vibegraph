// IN → PROCESS → OUT for one box on the architecture map (2026-10-06). What
// data reaches the node, what it does, and who takes what it produces — read
// from the facts the model already carries, zero tokens:
//
//   in / out   one row per edge, by the direction the DATA moves, not the
//              arrow: a write or a call carries data to its target; a read or
//              a watch carries it back to the caller. Each row has the keys
//              the code spells at the call site (never values), the stated
//              and planned rules on that edge, and — through a store — the
//              path on: who reads what this node wrote, who wrote what it reads.
//   process    words from ONE vocabulary (src/shared/operations.json, plus a
//              project's own additions): a word is said of a node only when
//              its evidence is on it, and every word cites that evidence.
//   silent     what the IR cannot see, said rather than left blank.
//
// Pure and webview-safe: the inspector, architecture.md and the hooks read
// the same answer.

import type { ArchModelRecord, ArchNodeRecord, ArchEdgeRecord, ArchRef } from "./protocol.ts";
import { effectOf } from "./sdk_verbs.ts";
import core from "./operations.json" with { type: "json" };

export interface OpWord {
  id: string; label: string; definition: string; icon: string; accent: string;
  evidence: { facts?: string[]; roles?: string[]; uses?: string[] };
  /** added by the project (.vibegraph/operations.json) */
  project?: boolean;
}
export interface Vocabulary { version: "1"; words: OpWord[] }
export const CORE_VOCABULARY = core as Vocabulary;

/** A project's additions, validated: new ids only, evidence as strings. */
export function mergeVocabulary(extra: unknown, base: Vocabulary = CORE_VOCABULARY): { vocab: Vocabulary; errors: string[] } {
  const errors: string[] = [];
  const words = [...base.words];
  const list = (extra as { words?: unknown })?.words;
  if (extra === undefined || extra === null) return { vocab: base, errors };
  if (!Array.isArray(list)) return { vocab: base, errors: ["operations.json: `words` must be a list"] };
  const strs = (x: unknown) => x === undefined || (Array.isArray(x) && x.every((y) => typeof y === "string" && y.length <= 80));
  for (const w of list as Array<Record<string, any>>) {
    const id = String(w?.id ?? "");
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(id)) { errors.push(`word "${id}": id must be a short lower-case name`); continue; }
    if (words.some((x) => x.id === id)) { errors.push(`word "${id}": already a word — a project adds words, it never redefines one`); continue; }
    if (typeof w.label !== "string" || typeof w.definition !== "string" || !w.label || !w.definition) { errors.push(`word "${id}": needs label and definition`); continue; }
    const ev = w.evidence ?? {};
    if (!strs(ev.facts) || !strs(ev.roles) || !strs(ev.uses) || !(ev.facts?.length || ev.roles?.length || ev.uses?.length)) { errors.push(`word "${id}": evidence needs facts, roles or uses (lists of names)`); continue; }
    words.push({ id, label: w.label.slice(0, 40), definition: w.definition.slice(0, 200), icon: typeof w.icon === "string" ? w.icon : "Circle",
      accent: typeof w.accent === "string" && /^--[a-z0-9-]+$/.test(w.accent) ? w.accent : "--text-secondary", evidence: { facts: ev.facts, roles: ev.roles, uses: ev.uses }, project: true });
  }
  return { vocab: { version: "1", words }, errors };
}

export type DataOp = "write" | "read" | "watch" | "call" | "admin" | "grant" | "hop" | "enforces" | "scoped";

/** 2026-10-06 — a box SCOPED by a model where the IR is silent (part 3,
 *  src/server/node_scope.ts): the vocabulary's words and the boxes data comes
 *  from / goes to, each with the citations the gate kept (empty = INFERRED).
 *  Only a RATIFIED scope reaches In → Process → Out; a proposed one waits. */
export interface ScopeBody {
  at: string;
  model: string;
  summary: string;
  words: Array<{ word: string; evidence: string[] }>;
  in: Array<{ node: string; what: string; evidence: string[] }>;
  out: Array<{ node: string; what: string; evidence: string[] }>;
  refused: Array<{ item: string; reason: string }>;
  ratifiedAt?: string;
  /** a hash of what the model was shown about the box (its code lines,
   *  edges and spec lines — node_scope.ts scopeBasis) */
  basis?: string;
  /** TRANSPORT ONLY: the box's code / edges / spec changed since — worked
   *  out where scopes are read (withScopeStaleness), never stored */
  stale?: boolean;
}
export interface NodeScopeRecord { node: string; ratified?: ScopeBody; proposed?: ScopeBody }
export interface IoRow {
  edge: string;
  node: string;
  label: string;
  /** the protocol, as the edge says it */
  via: string;
  /** what moves: write / read / watch / call / a hop between processes */
  op: DataOp;
  keys: string[];
  /** where the keys came from: the code, the plan, or neither */
  keysFrom: "code" | "plan" | "none";
  rules: string[];
  /** the call text at the first site, when the code spells one */
  text?: string;
  ref?: ArchRef;
  /** through a store: who takes it next (out) / who put it there (in) */
  path?: Array<{ node: string; label: string; ops: DataOp[] }>;
}

/** `reads`, `writes`, `watches` — an op as a third-person verb. */
export const verbOf = (op: DataOp) => (op === "watch" ? "watches" : op === "hop" ? "hops" : op === "enforces" ? "enforces" : `${op}s`);
export interface ProcessOp { word: string; label: string; definition: string; icon: string; accent: string; evidence: string[]; refs: ArchRef[]; project?: boolean; scoped?: boolean; inferred?: boolean }
export interface NodeIO { node: string; in: IoRow[]; process: ProcessOp[]; out: IoRow[]; silent: string[]; scope?: NodeScopeRecord }

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const isStoreLike = (n: ArchNodeRecord | undefined) => !!n && (!!n.zoneOf || !!n.storeOf || n.id.startsWith("store:") || n.id.startsWith("zone:"));

/** The data operations one edge carries, in the order the code spells them. */
export function edgeOps(e: ArchEdgeRecord, to?: ArchNodeRecord): DataOp[] {
  if (e.kind !== "uses") return ["hop"];
  if (e.protocol === "enforces") return ["enforces"];
  const p = e.protocol.toLowerCase();
  const named = (["write", "read", "watch"] as const).filter((op) => new RegExp(`\\b${op}`).test(p));
  if (named.length && isStoreLike(to)) return [...named];
  // the verb of a METHOD on a receiver (`doc.getMap(…)` reads); a bare call
  // (`fetch(…)`) is a request, its verb the tool's own name
  const fromCalls = (e.payloads ?? []).filter((x) => x.side === "caller").map((x) => /\.([A-Za-z_$][\w$]*)\s*\(/.exec(x.text.replace(/^new\s+[\w.$]+/, ""))?.[1]).filter((m): m is string => !!m)
    .map((m) => effectOf(m));
  const ops = uniq([...named, ...fromCalls]) as DataOp[];
  return ops.length ? ops : ["call"];
}
/** Does the data move from the edge's `from` to its `to`? */
const forward = (op: DataOp) => op !== "read" && op !== "watch";

function keysOf(e: ArchEdgeRecord): { keys: string[]; from: IoRow["keysFrom"] } {
  const code = uniq((e.payloads ?? []).filter((p) => p.side === "caller" || p.side === "callee").flatMap((p) => p.keys ?? []));
  if (code.length) return { keys: code, from: "code" };
  if (e.planCarries?.length) return { keys: [...e.planCarries], from: "plan" };
  return { keys: [], from: "none" };
}

export function nodeIO(model: ArchModelRecord, nodeId: string, vocab: Vocabulary = CORE_VOCABULARY, scopes: Record<string, NodeScopeRecord> | undefined = model.scopes): NodeIO {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const n = byId.get(nodeId);
  const out: NodeIO = { node: nodeId, in: [], process: [], out: [], silent: [] };
  if (!n) return out;
  const label = (id: string) => byId.get(id)?.label ?? id;
  const facts = new Map<string, { text: string; refs: ArchRef[] }>();
  const fact = (k: string, text: string, refs: ArchRef[] = []) => {
    const f = facts.get(k) ?? { text: "", refs: [] };
    if (!f.text) f.text = text; else if (!f.text.includes(text)) f.text = `${f.text}; ${text}`;
    f.refs.push(...refs);
    facts.set(k, f);
  };
  const uses = new Map<string, string>(); // role or tool name → what it is

  // ── rows, by the direction the data moves ──
  // A store card speaks for the zones and SDKs folded into it (arch_real.ts).
  const members = new Set(model.nodes.filter((m) => m.storeOf === nodeId).map((m) => m.id));
  const mineEnd = (id: string) => id === nodeId || members.has(id);
  const touching = model.edges.filter((e) => mineEnd(e.from) !== mineEnd(e.to));
  for (const e of touching) {
    const other = mineEnd(e.from) ? e.to : e.from;
    const inner = mineEnd(e.from) ? e.from : e.to;
    const ops = edgeOps(e, byId.get(e.to));
    const { keys, from } = keysOf(e);
    const rules = uniq([...(e.payloads ?? []).filter((p) => p.side === "stated").map((p) => p.text), ...(e.planRules ?? [])]);
    const caller = (e.payloads ?? []).find((p) => p.side === "caller");
    for (const op of ops) {
      const row: IoRow = { edge: e.id, node: other, label: label(other), via: inner === nodeId ? e.protocol : `${label(inner)} · ${e.protocol}`, op, keys, keysFrom: from, rules,
        ...(caller?.text ? { text: caller.text } : {}), ...(caller?.where ?? e.refs[0] ? { ref: caller?.where ?? e.refs[0] } : {}) };
      const intoMe = mineEnd(e.to) === forward(op);
      (intoMe ? out.in : out.out).push(row);
    }
    // facts for the process words
    const mine = mineEnd(e.from);
    for (const op of ops) {
      if (op === "hop") { if (mine) fact(`hop:${e.kind}`, `to ${label(other)} (${e.protocol})`, e.refs.slice(0, 2)); }
      else if (op === "enforces") fact(mine ? "enforces" : "decision", `${mine ? "evaluates" : "evaluated by"} ${label(other)}`);
      else if (mine && isStoreLike(byId.get(other)) && (op === "write" || op === "read" || op === "watch")) fact(`zone:${op}`, `${op}s ${label(other)}`, e.refs.slice(0, 2));
      else if (mine) fact(`effect:${op}`, `${op} on ${label(other)}${caller?.text ? ` (${caller.text})` : ""}`, e.refs.slice(0, 2));
    }
    if (mine) { const t = byId.get(other); if (t?.role) uses.set(t.role, t.label); if (t?.tool) uses.set(t.tool, t.label); }
  }
  // ── what the node itself says ──
  if (n.serves) fact("serves", `${n.serves.how === "routes" ? "routes" : ".listen()"} in ${n.serves.files.join(", ")}`, n.serves.files.map((f) => ({ file: f, text: "serves" })) as ArchRef[]);
  if (n.family === "web") fact("family:web", "a web app (pages and components)");
  if (n.dispatches?.length) fact("dispatches", `${n.dispatches.reduce((k, g) => k + g.scripts.length, 0)} scripts`);
  if (n.zoneOf) fact("zone", `holds ${n.zoneOf.holds.join(", ")}`);
  if (n.id.startsWith("store:")) fact("store", n.sublabel);
  if (n.decision) fact("decision", `${n.decision.kind} ${n.decision.id}`);

  for (const w of vocab.words) {
    const ev: string[] = []; const refs: ArchRef[] = [];
    for (const f of w.evidence.facts ?? []) { const got = facts.get(f); if (got) { ev.push(got.text); refs.push(...got.refs); } }
    if (n.role && (w.evidence.roles ?? []).includes(n.role)) ev.push(`its role is ${n.role}`);
    for (const u of w.evidence.uses ?? []) if (uses.has(u)) ev.push(`calls ${uses.get(u)} (${u})`);
    if (ev.length) out.process.push({ word: w.id, label: w.label, definition: w.definition, icon: w.icon, accent: w.accent, evidence: uniq(ev), refs: refs.slice(0, 4), ...(w.project ? { project: true } : {}) });
  }

  // ── the path on, through a store ──
  const throughStore = (row: IoRow, wantOps: DataOp[], dir: "next" | "prev") => {
    if (!isStoreLike(byId.get(row.node))) return;
    const by = new Map<string, DataOp[]>();
    for (const e of model.edges) {
      if (e.to !== row.node || mineEnd(e.from)) continue;
      for (const op of edgeOps(e, byId.get(e.to))) if (wantOps.includes(op)) by.set(e.from, uniq([...(by.get(e.from) ?? []), op]));
    }
    if (by.size) row.path = [...by].map(([node, ops]) => ({ node, label: label(node), ops }));
    void dir;
  };
  for (const r of out.out) throughStore(r, ["read", "watch"], "next");
  for (const r of out.in) throughStore(r, ["write"], "prev");

  const merge = (rows: IoRow[]): IoRow[] => {
    const m = new Map<string, IoRow>();
    for (const r of rows) {
      const k = `${r.node}|${r.op}`;
      const cur = m.get(k);
      if (!cur) { m.set(k, { ...r }); continue; }
      cur.keys = uniq([...cur.keys, ...r.keys]);
      if (cur.keysFrom === "none") cur.keysFrom = r.keysFrom;
      cur.rules = uniq([...cur.rules, ...r.rules]);
      if (!cur.via.split(", ").includes(r.via)) cur.via = `${cur.via}, ${r.via}`;
    }
    return [...m.values()];
  };
  out.in = merge(out.in); out.out = merge(out.out);
  const order = (a: IoRow, b: IoRow) => b.keys.length - a.keys.length || a.label.localeCompare(b.label);
  out.in.sort(order); out.out.sort(order);
  // ── a RATIFIED scope fills what the code did not say (never replaces it) ──
  const scope = scopes?.[nodeId];
  if (scope) out.scope = scope;
  const sc = scope?.ratified;
  if (sc) {
    for (const w of sc.words) {
      const def = vocab.words.find((x) => x.id === w.word);
      if (!def) continue;
      const tag = sc.stale ? "ratified, STALE — the code under it changed since; re-scope" : "ratified";
      const cited = w.evidence.length ? `scoped (${tag}): ${w.evidence.join(", ")}` : `scoped (${tag}), INFERRED — no citation`;
      const have = out.process.find((p) => p.word === w.word);
      if (have) { have.evidence.push(cited); continue; }
      out.process.push({ word: def.id, label: def.label, definition: def.definition, icon: def.icon, accent: def.accent, evidence: [cited], refs: [], scoped: true, ...(w.evidence.length ? {} : { inferred: true }), ...(def.project ? { project: true } : {}) });
    }
    const add = (rows: IoRow[], list: ScopeBody["in"]) => {
      for (const r of list) if (byId.has(r.node) && !rows.some((x) => x.node === r.node)) {
        rows.push({ edge: `scope:${nodeId}:${r.node}`, node: r.node, label: label(r.node), via: `scoped${sc.stale ? ", STALE" : ""}${r.evidence.length ? "" : ", INFERRED"}`, op: "scoped", keys: [], keysFrom: "none", rules: [], text: r.what });
      }
    };
    add(out.in, sc.in); add(out.out, sc.out);
  }
  if (!out.in.length) out.silent.push(n.kind === "actor" ? "an outside caller: what it sends is not in the code" : "nothing in the code is seen sending data in");
  if (!out.out.length) out.silent.push(isStoreLike(n) || n.kind === "tool" ? "no reader of this is seen in the code" : "nothing it produces is seen leaving it");
  if (![...out.in, ...out.out].some((r) => r.keys.length)) out.silent.push("no payload keys: the code passes no object literal or keyword arguments here (a value built elsewhere is not followed)");
  if (!out.process.length) out.silent.push(scope?.proposed ? "no operation word has evidence on this box — a scope is waiting for a decision" : "no operation word has evidence on this box — Scope it to ask");
  return out;
}

/** One line per side, for prose (architecture.md, a hook). */
export function ioLines(io: NodeIO): { in: string; process: string; out: string } {
  const row = (r: IoRow) => `${r.label} (${r.op === "hop" ? r.via : r.op}${r.keys.length ? `: ${r.keys.slice(0, 6).join(", ")}${r.keys.length > 6 ? ", …" : ""}` : ""})${r.path?.length ? ` → ${r.path.map((p) => `${p.label} ${p.ops.map(verbOf).join("/")}`).join(", ")}` : ""}`;
  return {
    in: io.in.length ? io.in.slice(0, 6).map(row).join("; ") + (io.in.length > 6 ? `; +${io.in.length - 6} more` : "") : "—",
    process: io.process.length ? io.process.map((p) => `${p.label} (${p.evidence.slice(0, 2).join("; ")})`).join(" · ") : "—",
    out: io.out.length ? io.out.slice(0, 6).map(row).join("; ") + (io.out.length > 6 ? `; +${io.out.length - 6} more` : "") : "—",
  };
}
