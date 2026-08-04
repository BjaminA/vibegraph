// M-SKILL.1 — the remit index: which thread OWNS which code, deterministically.
//
// A thread's remit is provable from the IR — the nodes it walks, the files it
// reaches, the symbols it binds. This module turns latestThreads into that
// index and matches a chat question against it LEXICALLY: only exact,
// code-shaped tokens count, never a semantic guess. Zero matches means the
// caller behaves exactly as if this module did not exist — that no-op
// guarantee is the routing floor.
//
// Pure: no server state, no LLM, no fs. The caller memoizes per latestThreads
// identity (reassigned on boot parse and every M26 refreshDerived).

import { extractNodeIdTokens } from "./citations.ts";

// Minimal structural inputs (ProjectThread.nodes is unknown[] on the wire;
// we read only the fields the remit needs, absent fields simply add nothing).
interface RemitNodeShape {
  id?: unknown;
  label?: unknown;
  irNodeId?: unknown;
  qualifiedTarget?: unknown;
  receiverBoundFrom?: unknown;
}
export interface RemitThreadInput {
  seed: { file: string; qualifiedName: string; irNodeId?: string };
  entryPointId: string | null;
  nodes: unknown[];
  filesReached: string[];
}

export interface ThreadRemit {
  entryPointId: string;
  qualifiedName: string;
  files: Set<string>;
  nodeIds: Set<string>;
  symbols: Set<string>;
  /** Symbols derived from the SEED itself — the thread OWNS these names.
   *  A seed hit outranks a pass-through mention in another thread. */
  seedSymbols: Set<string>;
  /** The seed's own IR node id (owner signal for node-click dispatch). */
  seedNodeId: string | null;
}

export interface RemitMatchToken {
  kind: "node-id" | "file" | "symbol";
  token: string;
}
export interface RemitMatch {
  entryPointId: string;
  qualifiedName: string;
  matchedOn: RemitMatchToken[];
  score: number;
}

// Specificity ranking: a structural node id names ONE construct; a seed
// symbol means the thread OWNS the name; a file names a scope; a plain
// symbol is the loosest (many threads walk the same function).
const KIND_SCORE: Record<RemitMatchToken["kind"], number> = {
  "node-id": 4,
  file: 2,
  symbol: 1,
};
const SEED_SYMBOL_SCORE = 3;

/** "db:query" also enters as "db.query" (the form a human types) plus its
 *  bare segments — which only ever match when the question writes them
 *  code-shaped (backticked / dotted / underscored / called). */
function addSymbolForms(symbols: Set<string>, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  symbols.add(trimmed);
  if (trimmed.includes(":")) symbols.add(trimmed.replace(/:/g, "."));
  for (const seg of trimmed.split(/[.:]/)) if (seg) symbols.add(seg);
}

export function buildRemitIndex(threads: RemitThreadInput[]): ThreadRemit[] {
  const index: ThreadRemit[] = [];
  for (const thread of threads) {
    if (!thread.entryPointId) continue; // skills/agents are keyed by entry point
    const files = new Set<string>([thread.seed.file, ...thread.filesReached]);
    const nodeIds = new Set<string>();
    const symbols = new Set<string>();
    const seedSymbols = new Set<string>();
    addSymbolForms(seedSymbols, thread.seed.qualifiedName);
    for (const s of seedSymbols) symbols.add(s);
    for (const raw of thread.nodes) {
      const n = raw as RemitNodeShape;
      if (typeof n.irNodeId === "string") nodeIds.add(n.irNodeId);
      if (typeof n.id === "string") addSymbolForms(symbols, n.id);
      if (typeof n.label === "string") addSymbolForms(symbols, n.label);
      if (typeof n.qualifiedTarget === "string") addSymbolForms(symbols, n.qualifiedTarget);
      if (typeof n.receiverBoundFrom === "string") addSymbolForms(symbols, n.receiverBoundFrom);
    }
    index.push({
      entryPointId: thread.entryPointId,
      qualifiedName: thread.seed.qualifiedName,
      files,
      nodeIds,
      symbols,
      seedSymbols,
      seedNodeId: typeof thread.seed.irNodeId === "string" ? thread.seed.irNodeId : null,
    });
  }
  return index;
}

// ── question tokenization (false-positive-hostile) ─────────────────────
// A bare English word never matches: a symbol candidate must be backticked,
// dotted, underscored, or written as a call. File tokens must be *.py-shaped.
// Node-id tokens use the pinned grammar from citations.ts.

const FILE_TOKEN_RE = /(?:[A-Za-z0-9_\-.]+\/)*[A-Za-z0-9_\-]+\.py\b/g;
const BACKTICK_RE = /`([^`]+)`/g;
const WORD_TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]*(?:[.:][A-Za-z_][A-Za-z0-9_]*)*(?:\(\))?/g;

interface QuestionTokens {
  nodeIds: Set<string>;
  files: Set<string>;
  symbols: Set<string>;
}

function stripCall(token: string): string {
  return token.endsWith("()") ? token.slice(0, -2) : token;
}

export function tokenizeQuestion(question: string): QuestionTokens {
  const nodeIds = new Set(extractNodeIdTokens(question));
  const files = new Set(question.match(FILE_TOKEN_RE) ?? []);
  const symbols = new Set<string>();
  // Backticked spans: the author marked it as code — accept any single token.
  for (const m of question.matchAll(BACKTICK_RE)) {
    const inner = stripCall(m[1].trim());
    if (inner && !inner.includes(" ") && !nodeIds.has(inner) && !files.has(inner)) {
      symbols.add(inner);
    }
  }
  // Un-backticked: only tokens that are code-shaped on their own.
  for (const m of question.matchAll(WORD_TOKEN_RE)) {
    const raw = m[0];
    const codeShaped = raw.endsWith("()") || raw.includes("_") || raw.includes(".") || raw.includes(":");
    if (!codeShaped) continue;
    const token = stripCall(raw);
    if (token && !nodeIds.has(token) && !files.has(token) && !token.endsWith(".py")) {
      symbols.add(token);
    }
  }
  return { nodeIds, files, symbols };
}

function fileMatches(token: string, files: Set<string>): boolean {
  if (files.has(token)) return true;
  // Bare-basename mention matches iff exactly one remit file carries it.
  if (!token.includes("/")) {
    const hits = [...files].filter((f) => f === token || f.endsWith(`/${token}`));
    return hits.length === 1;
  }
  return false;
}

export interface MatchOptions {
  /** entryPointIds to drop from results (e.g. the already-in-context active thread). */
  exclude?: string[];
  /** Max matches returned (default 3). */
  limit?: number;
}

export function matchQuestion(
  question: string,
  index: ThreadRemit[],
  opts: MatchOptions = {},
): RemitMatch[] {
  const { exclude = [], limit = 3 } = opts;
  const excluded = new Set(exclude);
  const tokens = tokenizeQuestion(question);
  const matches: RemitMatch[] = [];
  for (const remit of index) {
    if (excluded.has(remit.entryPointId)) continue;
    const matchedOn: RemitMatchToken[] = [];
    let score = 0;
    for (const t of tokens.nodeIds) if (remit.nodeIds.has(t)) { matchedOn.push({ kind: "node-id", token: t }); score += KIND_SCORE["node-id"]; }
    for (const t of tokens.files) if (fileMatches(t, remit.files)) { matchedOn.push({ kind: "file", token: t }); score += KIND_SCORE.file; }
    for (const t of tokens.symbols) {
      if (remit.seedSymbols.has(t)) { matchedOn.push({ kind: "symbol", token: t }); score += SEED_SYMBOL_SCORE; }
      else if (remit.symbols.has(t)) { matchedOn.push({ kind: "symbol", token: t }); score += KIND_SCORE.symbol; }
    }
    if (matchedOn.length === 0) continue;
    matches.push({ entryPointId: remit.entryPointId, qualifiedName: remit.qualifiedName, matchedOn, score });
  }
  matches.sort((a, b) => b.score - a.score || (a.entryPointId < b.entryPointId ? -1 : a.entryPointId > b.entryPointId ? 1 : 0));
  return matches.slice(0, limit);
}

// ── M-SKILL.6 — node-click dispatch ────────────────────────────────────
// A question asked FROM a node needs no text matching at all: the node's IR
// id names it, and the remit index knows exactly which threads walk it. The
// thread whose SEED the node is OWNS it and outranks mere walkers. IR node
// ids are file-scoped ("module/query.fn" can exist in several files), so
// when the caller knows the node's file, a thread only matches if its remit
// reaches that file.

const NODE_OWNER_SCORE = 4;
const NODE_WALKER_SCORE = 2;

export function matchNode(
  irNodeId: string,
  file: string | null,
  index: ThreadRemit[],
  opts: MatchOptions = {},
): RemitMatch[] {
  const { exclude = [], limit = 3 } = opts;
  const excluded = new Set(exclude);
  const matches: RemitMatch[] = [];
  for (const remit of index) {
    if (excluded.has(remit.entryPointId)) continue;
    if (file && !remit.files.has(file)) continue;
    const score = remit.seedNodeId === irNodeId
      ? NODE_OWNER_SCORE
      : remit.nodeIds.has(irNodeId) ? NODE_WALKER_SCORE : 0;
    if (score === 0) continue;
    matches.push({
      entryPointId: remit.entryPointId,
      qualifiedName: remit.qualifiedName,
      matchedOn: [{ kind: "node-id", token: irNodeId }],
      score,
    });
  }
  matches.sort((a, b) => b.score - a.score || (a.entryPointId < b.entryPointId ? -1 : a.entryPointId > b.entryPointId ? 1 : 0));
  return matches.slice(0, limit);
}

/** Combine node-dispatch and text matches: a thread hit by BOTH sums its
 *  scores (two independent signals) and unions its matched tokens; the
 *  result re-ranks deterministically under one limit. */
export function mergeMatches(a: RemitMatch[], b: RemitMatch[], limit = 3): RemitMatch[] {
  const byId = new Map<string, RemitMatch>();
  for (const m of [...a, ...b]) {
    const prev = byId.get(m.entryPointId);
    if (!prev) {
      byId.set(m.entryPointId, { ...m, matchedOn: [...m.matchedOn] });
    } else {
      prev.score += m.score;
      for (const t of m.matchedOn) {
        if (!prev.matchedOn.some((p) => p.kind === t.kind && p.token === t.token)) prev.matchedOn.push(t);
      }
    }
  }
  const merged = [...byId.values()];
  merged.sort((x, y) => y.score - x.score || (x.entryPointId < y.entryPointId ? -1 : x.entryPointId > y.entryPointId ? 1 : 0));
  return merged.slice(0, limit);
}

// ── M-SKILL.2 — routing budget + session dedup ─────────────────────────
// What actually rides the prompt for each matched thread. `skill` carries the
// authoritative body ONLY; when a ratified skill exists but is not injected,
// `skillOmitted` names the honest reason (never a silent drop, never a
// mid-body truncation). A match with NO ratified skill at all has skill:null
// and no skillOmitted — the thread is still named so the agent can spawn its
// bounded agent or read the draft itself.

export interface RoutedThreadContext {
  entryPointId: string;
  qualifiedName: string;
  /** Human-readable matched tokens, e.g. "`db.query`", "db.py". */
  matchedOn: string[];
  skill: string | null;
  skillOmitted?: "over-budget" | "already-in-session" | "stale";
  /** Sitting-2 honesty — the thread routed but carries NO injectable skill
   *  because none was ever ratified: "absent" (never drafted) or "draft"
   *  (drafted, awaiting human ratification). Distinct from skillOmitted,
   *  which withholds a skill that IS ratified. */
  skillMissing?: "absent" | "draft";
}

export interface RoutingCandidate extends RemitMatch {
  /** Injectable (ratified + fresh, or auto-reaffirmed w/ caveat) body, or null. */
  skillBody: string | null;
  /** sourceHash of that body (dedup key), or null. */
  sourceHash: string | null;
  /** A ratified skill EXISTS but is stale and not auto-reaffirmed — withheld,
   *  never reported as "no skill exists" (M-SKILL.7 honesty). */
  staleRatified?: boolean;
  /** Sitting-2 — no ratified skill exists for this thread at all. */
  skillState?: "absent" | "draft";
}

function describeToken(t: RemitMatchToken): string {
  return t.kind === "symbol" ? `\`${t.token}\`` : t.token;
}

// Sitting-2 — was 6000, which a single REAL drafted skill exceeds (the
// live pump-lab train skill is ~6.9k chars), silently starving the very
// first injection. The budget exists to stop PILES of skills riding one
// turn, not the top match; 12000 fits one large skill + a small second.
// Exported (skill-contract) so the draft-time body ceiling and this
// routing budget can never drift apart: a skill the gate persists is a
// skill the router can actually inject.
export const SKILL_INJECTION_BUDGET_CHARS = 12000;

/** Applies the injection budget (chars of skill text a single turn may carry)
 *  and the per-session dedup (an identical skill already sent this session
 *  re-routes as a reference, not a re-paste). Mutates nothing; returns the
 *  routed contexts plus the (entryPointId → sourceHash) pairs the caller
 *  should record as injected AFTER the turn is actually sent. */
export function applyRoutingBudget(
  candidates: RoutingCandidate[],
  alreadyInjected: ReadonlyMap<string, string>,
  budgetChars = SKILL_INJECTION_BUDGET_CHARS,
): { routed: RoutedThreadContext[]; injected: Array<[string, string]> } {
  const routed: RoutedThreadContext[] = [];
  const injected: Array<[string, string]> = [];
  let remaining = budgetChars;
  for (const c of candidates) {
    const base = {
      entryPointId: c.entryPointId,
      qualifiedName: c.qualifiedName,
      matchedOn: c.matchedOn.map(describeToken),
    };
    if (!c.skillBody || !c.sourceHash) {
      routed.push({
        ...base, skill: null,
        ...(c.staleRatified ? { skillOmitted: "stale" as const } : {}),
        ...(!c.staleRatified && c.skillState ? { skillMissing: c.skillState } : {}),
      });
    } else if (alreadyInjected.get(c.entryPointId) === c.sourceHash) {
      routed.push({ ...base, skill: null, skillOmitted: "already-in-session" });
    } else if (c.skillBody.length > remaining) {
      routed.push({ ...base, skill: null, skillOmitted: "over-budget" });
    } else {
      remaining -= c.skillBody.length;
      routed.push({ ...base, skill: c.skillBody });
      injected.push([c.entryPointId, c.sourceHash]);
    }
  }
  return { routed, injected };
}
