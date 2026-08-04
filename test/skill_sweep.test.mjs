/**
 * M-SKILL.4 — sweep selection + failure honesty (pure, injected generator).
 *
 * Pinned: planSweep targets exactly the non-authoritative skills (missing /
 * draft / stale) and skips authoritative ones; runSweep is serial and ordered,
 * reports every failure with its reason, and a failed item never aborts the
 * remainder.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/skill_sweep.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSweep, runSweep } from "../src/server/skill_sweep.ts";

const R = {
  missing: { exists: false, key: "k", entryPointId: "x" },
  draft: { exists: true, stale: false, status: "draft", key: "k", entryPointId: "x", body: "b", sourceHash: "h", generatedAt: "t" },
  staleRatified: { exists: true, stale: true, status: "ratified", key: "k", entryPointId: "x", body: "b", sourceHash: "h", generatedAt: "t" },
  authoritative: { exists: true, stale: false, status: "ratified", key: "k", entryPointId: "x", body: "b", sourceHash: "h", generatedAt: "t" },
};

test("planSweep: missing/draft/stale are targets with the right reason; authoritative is skipped", () => {
  const skills = { a: R.missing, b: R.draft, c: R.staleRatified, d: R.authoritative };
  const { targets, skipped } = planSweep(["a", "b", "c", "d"], (id) => skills[id]);
  assert.deepEqual(targets, [
    { entryPointId: "a", reason: "missing" },
    { entryPointId: "b", reason: "draft" },
    { entryPointId: "c", reason: "stale" },
  ]);
  assert.deepEqual(skipped, ["d"]);
});

test("runSweep: serial + ordered; a mid-sweep failure is reported and the rest still runs", async () => {
  const calls = [];
  const progress = [];
  const summary = await runSweep(
    [{ entryPointId: "a", reason: "missing" }, { entryPointId: "b", reason: "missing" }, { entryPointId: "c", reason: "missing" }],
    ["d"],
    async (id) => {
      calls.push(id);
      return id === "b" ? { ok: false, error: "generation not grounded — refused" } : { ok: true };
    },
    (done, total, item) => progress.push([done, total, item.entryPointId, item.ok]),
  );
  assert.deepEqual(calls, ["a", "b", "c"], "third target ran despite the second failing");
  assert.deepEqual(progress, [[1, 3, "a", true], [2, 3, "b", false], [3, 3, "c", true]]);
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.drafted.map((i) => i.entryPointId), ["a", "c"]);
  assert.deepEqual(summary.failed, [{ entryPointId: "b", ok: false, error: "generation not grounded — refused" }]);
  assert.deepEqual(summary.skipped, ["d"]);
});

test("runSweep: a THROWING generator is captured as a failure, not a crash", async () => {
  const summary = await runSweep(
    [{ entryPointId: "a", reason: "missing" }],
    [],
    async () => { throw new Error("spawn exploded"); },
    () => {},
  );
  assert.deepEqual(summary.failed, [{ entryPointId: "a", ok: false, error: "spawn exploded" }]);
});

test("runSweep: empty target list → clean empty summary", async () => {
  const summary = await runSweep([], ["a", "b"], async () => ({ ok: true }), () => {
    throw new Error("no progress expected");
  });
  assert.deepEqual(summary, { total: 0, drafted: [], failed: [], skipped: ["a", "b"] });
});
