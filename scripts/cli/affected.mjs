// `vibegraph-knowledge affected` (2026-09-28) — which discovered tests to run
// for a set of changed files, and which threads the change touches. The same
// intersection the contracts' "Tested by" line uses (src/shared/test_reach.ts),
// read the other way: from the files that changed to the tests that reach them.
//
// Zero tokens, nothing run. A changed file no discovered test reaches is named
// as such, never read as safe — discovery may not see every test runner.

import { relative, resolve, isAbsolute } from "node:path";
import { loadEnvelope } from "../quality_check.mjs";
import { affectedTests } from "../../src/shared/test_reach.ts";
import { workingTreeDelta } from "./check.mjs";

export const AFFECTED_USAGE = `affected [<root>] [<file>...] [options]   which discovered tests reach the changed files, and which threads they touch
      --uncommitted        the working tree's changes against HEAD are the changed files
      --json               the raw result instead of the report
      exit 0 always (a report, not a gate) · 2 bad arguments or no files named`;

export function runAffected({ root, files = [], uncommitted = false, envelope, pipeline, cache = false }) {
  const absRoot = resolve(root);
  let changed = files.map((f) => {
    const abs = isAbsolute(f) ? f : resolve(process.cwd(), f);
    return relative(absRoot, abs).split("\\").join("/");
  });
  const notes = [];
  if (uncommitted) {
    try { changed.push(...workingTreeDelta(absRoot).entries.map((e) => e.file)); }
    catch { notes.push("--uncommitted: this is not a git repository, so there are no uncommitted changes to read"); }
  }
  changed = [...new Set(changed)].sort();
  const { envelope: env } = loadEnvelope(absRoot, envelope, pipeline ?? {}, { cache });
  const parsed = new Set(Object.keys(env.files));
  const tests = affectedTests(env.threads, env.entryPoints, changed);
  const testIds = new Set(env.entryPoints.filter((e) => e.kind === "test").map((e) => e.id));
  const threads = env.threads
    .filter((t) => t.entryPointId && !testIds.has(t.entryPointId))
    .map((t) => ({ entryPointId: t.entryPointId, via: changed.filter((f) => (t.filesReached ?? []).includes(f) || t.nodes.some((n) => n.file === f)) }))
    .filter((t) => t.via.length)
    .sort((a, b) => a.entryPointId.localeCompare(b.entryPointId));
  const reachedByTest = new Set(tests.flatMap((t) => t.via));
  const untested = changed.filter((f) => parsed.has(f) && !reachedByTest.has(f));
  const notParsed = changed.filter((f) => !parsed.has(f));
  return { changed, tests, threads, untested, notParsed, notes };
}

export function formatAffected(r) {
  const lines = [];
  if (!r.changed.length) return "No changed files.\n";
  lines.push(`${r.changed.length} changed file(s).`, "");
  lines.push(r.tests.length ? `Tests to run (${r.tests.length}):` : "No discovered test reaches these files.");
  for (const t of r.tests) lines.push(`  ${t.entryPointId}   reaches ${t.via.join(", ")}`);
  lines.push("", r.threads.length ? `Threads the change touches (${r.threads.length}):` : "No thread reaches these files.");
  for (const t of r.threads) lines.push(`  ${t.entryPointId}   via ${t.via.join(", ")}`);
  if (r.untested.length) lines.push("", `Changed, and no discovered test reaches it: ${r.untested.join(", ")}`);
  if (r.notParsed.length) lines.push("", `Not parsed (no IR, so nothing is known about them): ${r.notParsed.join(", ")}`);
  for (const n of r.notes) lines.push("", n);
  return lines.join("\n") + "\n";
}
