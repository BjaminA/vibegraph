// Near-clones (2026-09-29, from the codebase-memory-mcp comparison and a
// census before building): functions of the same SHAPE, so a contract can say
// "a fix here probably applies there". Derived from the IR alone, stated
// precisely, never a model:
//
//   a function's CALL SEQUENCE = every call in its own body (nested named
//   functions belong to themselves), in source order, each callee NORMALISED
//   to its last name segment (`await client.users.get(x)` → `get`);
//   ELIGIBLE = at least 5 calls and at least 4 distinct names (below that,
//   boilerplate matches boilerplate — the census's misses at ≥ 0.9 were all
//   low-variety sequences like `registerTool` ×5 against ×7);
//   two eligible functions are NEAR-CLONES when the Jaccard of their sets of
//   contiguous 3-grams is ≥ 0.7.
//
// Census on a private production codebase (1,811 eligible functions): 303 pairs, 98% judged real
// copy-paste families by reading both bodies (63 of 64); on the fleet
// example: 0 pairs, which is right — it has no copy-paste. Silence means
// "not measured or no match", never "unique": a function too small to be
// eligible gets no line. Named limit: a function that INLINES another's body
// scores low (the extra calls dilute the Jaccard). Kept out of the IR: a
// derived fact, like the thread ranks.

export const NEAR_CLONE_THRESHOLD = 0.7;
const MIN_CALLS = 5;
const MIN_DISTINCT = 4;
/** An optimisation only: a 3-gram held by this many functions is skipped as
 *  a candidate generator (every pair it would propose shares boilerplate). */
const COMMON_SHINGLE = 400;

interface IrNode { id: string; type?: string; parentId?: string | null; name?: string; funcName?: string; callTarget?: string; line?: number; col?: number }

export interface NearClone { file: string; irNodeId: string; name: string; score: number }

/** `await new a.b<T>(x).c?.d(y)` → `d`. */
export function normaliseCallee(raw: string): string {
  let s = raw.trim().replace(/^(await|new)\s+/, "").replace(/\s+/g, "").replace(/\?\./g, ".");
  for (let guard = 0; guard < 20; guard++) {
    const next = s.replace(/\([^()]*\)/g, "").replace(/<[^<>]*>/g, "");
    if (next === s) break;
    s = next;
  }
  s = s.replace(/\[[^\]]*\]/g, "");
  const parts = s.split(/\.|::|->/).filter(Boolean);
  return parts[parts.length - 1] ?? s;
}

/** Each function_def's call sequence, keyed `file::id`. */
function callSequences(files: Record<string, { nodes?: ReadonlyArray<IrNode> }>): Map<string, { file: string; id: string; name: string; seq: string[] }> {
  const out = new Map<string, { file: string; id: string; name: string; seq: string[] }>();
  for (const [file, ir] of Object.entries(files)) {
    const nodes = ir.nodes ?? [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const owner = (n: IrNode): IrNode | null => {
      let p = n.parentId ? byId.get(n.parentId) : undefined;
      while (p && p.type !== "function_def") p = p.parentId ? byId.get(p.parentId) : undefined;
      return p ?? null;
    };
    const calls = new Map<string, Array<{ line: number; col: number; depth: number; name: string }>>();
    for (const n of nodes) {
      const callee = n.type === "call" ? (n.funcName ?? n.callTarget) : n.callTarget;
      if (typeof callee !== "string" || !callee) continue;
      const fn = owner(n);
      if (!fn) continue;
      if (!calls.has(fn.id)) calls.set(fn.id, []);
      calls.get(fn.id)!.push({ line: n.line ?? 0, col: n.col ?? 0, depth: n.id.split("/").length, name: normaliseCallee(callee) });
    }
    for (const n of nodes) {
      if (n.type !== "function_def") continue;
      const c = calls.get(n.id) ?? [];
      c.sort((a, b) => a.line - b.line || a.col - b.col || b.depth - a.depth);
      out.set(`${file}::${n.id}`, { file, id: n.id, name: n.name ?? n.id, seq: c.map((x) => x.name) });
    }
  }
  return out;
}

/** Every eligible function's near-clones, strongest first. Keyed `file::id`. */
export function computeNearClones(files: Record<string, { nodes?: ReadonlyArray<IrNode> }>): Map<string, NearClone[]> {
  const seqs = callSequences(files);
  const shingles = new Map<string, Set<string>>();
  for (const [k, s] of seqs) {
    if (s.seq.length < MIN_CALLS || new Set(s.seq).size < MIN_DISTINCT) continue;
    const set = new Set<string>();
    for (let i = 0; i + 3 <= s.seq.length; i++) set.add(s.seq.slice(i, i + 3).join("\u0000"));
    shingles.set(k, set);
  }
  const index = new Map<string, string[]>();
  for (const [k, set] of shingles) for (const g of set) (index.get(g) ?? index.set(g, []).get(g)!).push(k);
  const out = new Map<string, NearClone[]>();
  const seen = new Set<string>();
  for (const [k, set] of shingles) {
    const candidates = new Set<string>();
    for (const g of set) {
      const holders = index.get(g)!;
      if (holders.length > COMMON_SHINGLE) continue;
      for (const h of holders) if (h !== k) candidates.add(h);
    }
    for (const c of candidates) {
      const pair = k < c ? `${k}\u0001${c}` : `${c}\u0001${k}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      const other = shingles.get(c)!;
      let inter = 0;
      for (const g of set) if (other.has(g)) inter++;
      const score = inter / (set.size + other.size - inter);
      if (score < NEAR_CLONE_THRESHOLD) continue;
      const a = seqs.get(k)!, b = seqs.get(c)!;
      const rounded = Math.round(score * 100) / 100;
      (out.get(k) ?? out.set(k, []).get(k)!).push({ file: b.file, irNodeId: b.id, name: b.name, score: rounded });
      (out.get(c) ?? out.set(c, []).get(c)!).push({ file: a.file, irNodeId: a.id, name: a.name, score: rounded });
    }
  }
  for (const list of out.values()) list.sort((x, y) => y.score - x.score || x.file.localeCompare(y.file));
  return out;
}

/** One contract line for one function, or null when it has no near-clone. */
export function formatNearClones(label: string, list: ReadonlyArray<NearClone> | undefined, cap = 8): string | null {
  if (!list?.length) return null;
  const shown = list.slice(0, cap).map((c) => `${c.file}:${c.name} (${c.score === 1 ? "1.00, identical call sequence" : c.score.toFixed(2)})`);
  const more = list.length > cap ? `; +${list.length - cap} more` : "";
  return `- \`${label}\` is shaped like ${shown.join(", ")}${more}`;
}
