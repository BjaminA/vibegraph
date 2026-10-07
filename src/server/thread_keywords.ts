// Keyword routing (2026-09-29) — the fallback for a prompt that names no code.
//
// The remit matcher (thread_remit.ts) routes on CODE-SHAPED tokens only — a
// file, a node id, a backticked or dotted symbol — by design: it never
// guesses. So "make the csv export include the device's region" routes
// nowhere, and a plain-English prompt got only the project-wide rules (the
// gap the crystal drill named). OpenViking fills the same gap with embedding
// search; this fills it with words the CODE already uses, so it stays
// deterministic and spends nothing:
//
//   each thread's document = its seed's name and file path, the names of the
//   functions it steps through, and the seed's docstring;
//   a prompt's words are matched against them, ranked by BM25;
//   a thread qualifies only with TWO distinct matched words (or one that is
//   the seed function's own name), and the caller labels every result as a
//   guess from words — never as a routing fact.
//
// Named limit: words are not meaning. "Tell the operators" does not reach a
// function called `notify`; a prompt in the code's own vocabulary does.
//
// 2026-10-07 (field report: most prompts arrived with one or two unrelated
// test-thread contracts, matched on "line", "keep", "bits", "date", "left",
// "problem", "place"). One word of a multi-word seed name used to qualify a
// thread on its own — `keep` named `test_keep_line`. Now:
//   - a seed name counts only when ALL its words are in the prompt;
//   - the two-word floor counts DISTINCTIVE words only (in under a third of
//     the threads);
//   - everyday words are stop words;
//   - a test thread is left out unless the prompt is about tests.
// Nothing is sent when nothing clears that.

export interface KeywordThread {
  entryPointId?: string | null;
  seed: { file: string; qualifiedName: string; irNodeId?: string };
  nodes: Array<{ kind?: string; label?: string; file?: string | null }>;
}

export interface KeywordMatch {
  entryPointId: string;
  qualifiedName: string;
  /** The prompt's words that matched, strongest first. */
  terms: string[];
  score: number;
}

interface Doc { entryPointId: string; qualifiedName: string; tf: Map<string, number>; len: number; seedName: string; isTest: boolean }

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "when", "then", "than", "them", "they", "their",
  "have", "has", "had", "was", "were", "are", "is", "be", "been", "being", "will", "would", "should", "could",
  "can", "not", "but", "all", "any", "each", "every", "some", "our", "your", "you", "its", "also", "just",
  "make", "made", "add", "adds", "added", "use", "used", "using", "get", "set", "new", "now", "only", "about",
  "what", "which", "who", "how", "why", "where", "there", "here", "does", "did", "done", "want", "need", "needs",
  "please", "let", "lets", "know", "sure", "like", "more", "less", "code", "file", "files", "function", "change",
  "changes", "fix", "bug", "update", "include", "includes", "show", "shows",
  // everyday words that also name things in code (field report, 2026-10-07)
  "line", "lines", "keep", "bit", "bits", "date", "left", "right", "problem", "place", "time", "thing", "way",
  "work", "first", "last", "next", "good", "well", "one", "two", "still", "see", "look", "think", "try",
  "part", "case", "point", "start", "end", "back", "take", "give", "same", "other", "again", "already",
  "better", "instead", "maybe", "might", "must", "really", "right", "think", "thing", "while", "after", "before",
  "because", "around", "over", "under", "out", "off", "down", "up", "too", "very", "much", "many",
  "few", "lot", "able", "bit", "issue", "issues", "test", "tests", "testing", "working",
]);

const TESTISH = /(^|[\/_.-])(tests?|spec|__tests__)([\/_.-]|$)|(^|[:/])test_|\.(test|spec)\.[a-z]+$/i;
const PROMPT_ABOUT_TESTS = /\b(tests?|testing|spec|specs|pytest|unittest|vitest|jest|coverage|fixture)\b/i;

/** Words of an identifier, a path or a sentence: camelCase and snake_case
 *  split, lower-cased, a plural `s` folded, stop words and short words out. */
export function keywordTerms(text: string): string[] {
  const out: string[] = [];
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  for (const raw of spaced.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || /^\d+$/.test(raw)) continue;
    const w = raw.length > 4 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw;
    if (!STOP.has(w) && !STOP.has(raw)) out.push(w);
  }
  return out;
}

const seedFunctionName = (qualifiedName: string) => qualifiedName.split(/[:.]/).pop() ?? qualifiedName;

/** One document per thread. `docstringOf` returns the seed's docstring when
 *  the IR has one. */
export function buildKeywordIndex(
  threads: KeywordThread[],
  docstringOf: (file: string, irNodeId: string | undefined) => string | null,
): Doc[] {
  const docs: Doc[] = [];
  for (const t of threads) {
    if (!t.entryPointId) continue;
    const words = [
      ...keywordTerms(t.seed.qualifiedName), ...keywordTerms(t.seed.qualifiedName), // the seed's name counts twice
      ...keywordTerms(t.seed.file),
      ...t.nodes.filter((n) => n.kind === "step" || n.kind === "seed").flatMap((n) => keywordTerms(n.label ?? "")),
      ...keywordTerms(docstringOf(t.seed.file, t.seed.irNodeId) ?? ""),
    ];
    const tf = new Map<string, number>();
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    docs.push({
      entryPointId: t.entryPointId, qualifiedName: t.seed.qualifiedName, tf, len: words.length,
      seedName: keywordTerms(seedFunctionName(t.seed.qualifiedName)).join(" "),
      isTest: TESTISH.test(t.seed.file) || TESTISH.test(t.seed.qualifiedName),
    });
  }
  return docs;
}

/** BM25 over the thread documents; at most `limit` results, each carrying the
 *  words it matched. Empty when nothing clears the two-word floor. */
export function matchKeywords(prompt: string, docs: Doc[], { limit = 2 }: { limit?: number } = {}): KeywordMatch[] {
  const q = [...new Set(keywordTerms(prompt))];
  if (!q.length || !docs.length) return [];
  if (!PROMPT_ABOUT_TESTS.test(prompt)) docs = docs.filter((d) => !d.isTest);
  if (!docs.length) return [];
  const N = docs.length;
  const avg = docs.reduce((s, d) => s + d.len, 0) / N || 1;
  const df = new Map<string, number>();
  for (const w of q) df.set(w, docs.filter((d) => d.tf.has(w)).length);
  const k1 = 1.2, b = 0.75;
  const scored: KeywordMatch[] = [];
  for (const d of docs) {
    let score = 0;
    const hits: Array<[string, number]> = [];
    for (const w of q) {
      const f = d.tf.get(w);
      if (!f) continue;
      const n = df.get(w) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const s = idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avg));
      score += s;
      hits.push([w, s]);
    }
    // the WHOLE seed name, not one word of it; and two DISTINCTIVE words
    const seedWords = d.seedName.split(" ").filter(Boolean);
    const namesSeed = seedWords.length > 0 && seedWords.every((w) => q.includes(w));
    const distinctive = hits.filter(([w]) => (df.get(w) ?? 0) <= Math.max(1, Math.floor(N / 3)));
    if (distinctive.length < 2 && !namesSeed) continue;
    hits.sort((a, b2) => b2[1] - a[1]);
    scored.push({ entryPointId: d.entryPointId, qualifiedName: d.qualifiedName, terms: hits.map(([w]) => w), score });
  }
  scored.sort((a, b2) => b2.score - a.score || (a.entryPointId < b2.entryPointId ? -1 : 1));
  const best = scored[0]?.score ?? 0;
  // Only matches near the best: a long tail of one-shared-word threads is noise.
  return scored.filter((m) => m.score >= best * 0.6).slice(0, limit);
}
