// Tests per thread (2026-09-28) — which discovered tests exercise a thread,
// and which tests to run for a set of changed files. Both read the threads
// the envelope already carries: a test IS an entry point (kind "test"), so its
// thread is everything the test can reach, and the question "does this test
// exercise that code" is a set intersection, not a guess.
//
//   direct   the test's thread reaches the thread's ENTRY POINT itself;
//   partial  it reaches some of the thread's steps but not its entry point
//            (it exercises a helper the thread also uses).
//
// Only DISCOVERED tests count. A project whose tests discovery cannot see (an
// unusual runner, tests generated at runtime) reads as untested here, and the
// line says "no discovered test", never "untested".

interface NodeLike { kind?: string; file?: string | null; irNodeId?: string | null }
interface ThreadLike {
  entryPointId?: string | null;
  seed?: { file?: string; irNodeId?: string } | null;
  nodes: ReadonlyArray<NodeLike>;
  filesReached?: ReadonlyArray<string>;
}
interface EntryLike { id: string; kind?: string; file?: string; metadata?: { mocks?: ReadonlyArray<string> } | null }

export interface TestedBy {
  direct: string[];
  partial: Array<{ entryPointId: string; steps: number }>;
}

const key = (n: NodeLike) => (n.file && n.irNodeId ? `${n.file}::${n.irNodeId}` : null);

function testThreads(threads: ReadonlyArray<ThreadLike>, entryPoints: ReadonlyArray<EntryLike>): ThreadLike[] {
  const tests = new Set(entryPoints.filter((e) => e.kind === "test").map((e) => e.id));
  return threads.filter((t) => t.entryPointId && tests.has(t.entryPointId));
}

/** entry point id → the tests that exercise its thread. Test threads are not keyed. */
export function testReach(threads: ReadonlyArray<ThreadLike>, entryPoints: ReadonlyArray<EntryLike>): Map<string, TestedBy> {
  // A module the test replaces with a mock (vi.mock / jest.mock) is not
  // exercised by it, whatever the static walk reaches there (2026-09-29).
  const mocksOf = new Map(entryPoints.map((e) => [e.id, new Set(e.metadata?.mocks ?? [])]));
  const tests = testThreads(threads, entryPoints).map((t) => {
    const mocked = mocksOf.get(t.entryPointId!) ?? new Set<string>();
    return {
      id: t.entryPointId!,
      reaches: new Set(t.nodes
        .filter((n) => (n.kind === "step" || n.kind === "seed") && !(n.file && mocked.has(n.file)))
        .map(key).filter((k): k is string => !!k)),
    };
  });
  const testIds = new Set(tests.map((t) => t.id));
  const out = new Map<string, TestedBy>();
  for (const t of threads) {
    const ep = t.entryPointId;
    if (!ep || testIds.has(ep)) continue;
    const seedKey = t.seed?.file && t.seed?.irNodeId ? `${t.seed.file}::${t.seed.irNodeId}` : null;
    const steps = new Set(t.nodes.filter((n) => n.kind === "step").map(key).filter((k): k is string => !!k));
    const tb: TestedBy = { direct: [], partial: [] };
    for (const test of tests) {
      if (seedKey && test.reaches.has(seedKey)) { tb.direct.push(test.id); continue; }
      let hit = 0;
      for (const s of steps) if (test.reaches.has(s)) hit++;
      if (hit) tb.partial.push({ entryPointId: test.id, steps: hit });
    }
    tb.direct.sort();
    tb.partial.sort((a, b) => b.steps - a.steps || a.entryPointId.localeCompare(b.entryPointId));
    out.set(ep, tb);
  }
  return out;
}

/** The discovered tests whose threads touch any of `files` — what to run for
 *  a change — each with the changed files it reaches. */
export function affectedTests(
  threads: ReadonlyArray<ThreadLike>, entryPoints: ReadonlyArray<EntryLike>, files: ReadonlyArray<string>,
): Array<{ entryPointId: string; file: string | null; via: string[] }> {
  const wanted = new Set(files);
  const fileOf = new Map(entryPoints.map((e) => [e.id, e.file ?? null]));
  const out: Array<{ entryPointId: string; file: string | null; via: string[] }> = [];
  for (const t of testThreads(threads, entryPoints)) {
    const touched = new Set<string>();
    for (const f of t.filesReached ?? []) if (wanted.has(f)) touched.add(f);
    for (const n of t.nodes) if (n.file && wanted.has(n.file)) touched.add(n.file);
    // the test file itself changed: it is affected too
    const own = fileOf.get(t.entryPointId!) ?? null;
    if (own && wanted.has(own)) touched.add(own);
    if (touched.size) out.push({ entryPointId: t.entryPointId!, file: own, via: [...touched].sort() });
  }
  return out.sort((a, b) => a.entryPointId.localeCompare(b.entryPointId));
}

/** One contract line. `undefined` input (no test index) → no line at all. */
export function formatTestedBy(tb: TestedBy | undefined): string | null {
  if (!tb) return null;
  if (!tb.direct.length && !tb.partial.length) return "Tested by: no discovered test reaches this thread.";
  const parts = [
    ...tb.direct.map((t) => `\`${t}\` (reaches the entry point)`),
    ...tb.partial.slice(0, 6).map((p) => `\`${p.entryPointId}\` (reaches ${p.steps} of its steps)`),
  ];
  const more = tb.partial.length > 6 ? `; ${tb.partial.length - 6} more reach some of its steps` : "";
  return `Tested by: ${parts.join("; ")}${more}.`;
}
