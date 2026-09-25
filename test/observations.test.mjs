/**
 * PLAN-M-RUNTIME phase 3 — the trace overlay store.
 *
 * The rules under test are honesty rules, not plumbing:
 *   - one site can dispatch to MORE THAN ONE callee in a single run, and
 *     both survive;
 *   - two entry points that disagree about the same site both survive, and
 *     neither is picked as the winner;
 *   - staleness is per FILE and is only claimed when it can be demonstrated;
 *   - the join is (file, line), the only key the tracer and the IR share.
 *
 * Run: npm run test:observations
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  OBSERVATIONS_VERSION, clearTraceRun, hashSource, joinTraceToNodes, markStaleness,
  observationsForNode, readObservations, writeTraceRun,
} from "../src/server/observations.ts";

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vg-obs-store-"));
}

const RUN = {
  entryPointId: "calc.py:dispatch",
  entryFn: "dispatch",
  language: "python",
  at: "2026-09-10T10:00:00.000Z",
  outcome: "ok",
  inputs: "no arguments — the entry point runs on its own",
  observations: {
    "calc.py": {
      "module/dispatch.fn/out.assign": {
        line: 22,
        callees: [{ callee: "calc.Engine.run", count: 1 }],
      },
    },
  },
  sourceHashes: { "calc.py": "aaaa1111" },
};

test("an absent store reads as empty, never as an error", () => {
  const root = tmpRoot();
  const store = readObservations(root);
  assert.equal(store.version, OBSERVATIONS_VERSION);
  assert.deepEqual(store.runs, {});
  // The overlay is optional by design: a project that has never been traced
  // must render exactly as it did before phase 3 existed.
  assert.deepEqual(observationsForNode(store, "calc.py", "module/x.fn"), []);
});

test("a run round-trips, and a re-run REPLACES rather than accumulating", () => {
  const root = tmpRoot();
  writeTraceRun(root, RUN);
  assert.deepEqual(readObservations(root).runs["calc.py:dispatch"], RUN);

  writeTraceRun(root, { ...RUN, at: "2026-09-10T11:00:00.000Z" });
  const runs = Object.values(readObservations(root).runs);
  assert.equal(runs.length, 1, "two samples of the same thing must not become two facts");
  assert.equal(runs[0].at, "2026-09-10T11:00:00.000Z");

  clearTraceRun(root, "calc.py:dispatch");
  assert.deepEqual(readObservations(root).runs, {});
});

test("a store from another version is not misread — it is ignored", () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, ".vibegraph"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".vibegraph", "observations.json"),
    JSON.stringify({ version: 99, runs: { x: { entryPointId: "x" } } }),
  );
  assert.deepEqual(readObservations(root).runs, {}, "unreadable is silent, not guessed");
  // Corrupt JSON is the same class of problem and gets the same answer.
  fs.writeFileSync(path.join(root, ".vibegraph", "observations.json"), "{not json");
  assert.deepEqual(readObservations(root).runs, {});
});

test("staleness is per FILE, decided ONCE by the side that has the files", () => {
  const root = tmpRoot();
  writeTraceRun(root, RUN);
  // The stored form must not carry staleness at all — a persisted flag would
  // go stale itself the moment someone saved.
  const raw = JSON.parse(fs.readFileSync(path.join(root, ".vibegraph", "observations.json"), "utf-8"));
  assert.equal(raw.runs["calc.py:dispatch"].staleFiles, undefined);

  // `sourceHashes` stamped "aaaa1111"; markStaleness compares against now.
  const marked = (source) => {
    const store = markStaleness(readObservations(root), () => source);
    return observationsForNode(store, "calc.py", "module/dispatch.fn/out.assign");
  };
  // hashSource("x") is what the run would have stamped had the file been "x".
  const SAME = "the source as it was";
  const store0 = readObservations(root);
  store0.runs["calc.py:dispatch"].sourceHashes["calc.py"] = hashSource(SAME);
  fs.writeFileSync(path.join(root, ".vibegraph", "observations.json"), JSON.stringify(store0, null, 2));

  assert.equal(marked(SAME)[0].stale, false, "same source — fresh");
  assert.equal(marked("edited since")[0].stale, true, "file changed since the run — stale");
  // A file we cannot read is NOT evidence of staleness. Claiming a staleness
  // we cannot demonstrate is as much an invention as claiming freshness.
  assert.equal(marked(null)[0].stale, false);
  // Stale does not mean hidden: it is still evidence about the code as it
  // was, which is a different thing from no evidence at all.
  assert.equal(marked("edited since")[0].callees[0].callee, "calc.Engine.run");
});

test("two entry points that DISAGREE about a site both survive", () => {
  const root = tmpRoot();
  writeTraceRun(root, RUN);
  writeTraceRun(root, {
    ...RUN,
    entryPointId: "calc.py:other",
    entryFn: "other",
    at: "2026-09-10T12:00:00.000Z",
    observations: {
      "calc.py": {
        "module/dispatch.fn/out.assign": {
          line: 22,
          callees: [{ callee: "calc.Diesel.run", count: 3 }],
        },
      },
    },
  });
  const found = observationsForNode(
    readObservations(root), "calc.py", "module/dispatch.fn/out.assign",
  );
  assert.equal(found.length, 2, "the disagreement IS the finding — never merged, never resolved");
  assert.deepEqual(found.map((f) => f.entryPointId), ["calc.py:other", "calc.py:dispatch"],
    "newest first, so the most recent evidence reads first");
  assert.deepEqual(found.map((f) => f.callees[0].callee).sort(), ["calc.Diesel.run", "calc.Engine.run"]);
});

test("hashSource is stable and discriminating", () => {
  assert.equal(hashSource("a"), hashSource("a"));
  assert.notEqual(hashSource("a"), hashSource("b"));
});

// ── the join: (file, line), the only key the two sides share ──────────

const NODES = {
  "calc.py": [
    { id: "module/dispatch.fn", line: 20, type: "function_def" },
    { id: "module/dispatch.fn/eng.assign", line: 21, type: "assignment" },
    { id: "module/dispatch.fn/out.assign", line: 22, type: "assignment" },
    { id: "module/dispatch.fn/run.call", line: 22, type: "call" },
    { id: "module/dispatch.fn/return@0", line: 23, type: "return" },
  ],
};

test("a traced site joins to EVERY call-ish node written on that line", () => {
  const joined = joinTraceToNodes(
    [{ file: "calc.py", line: 22, callees: [{ callee: "calc.Engine.run", count: 1 }] }],
    NODES,
  );
  // Both the assignment and the call it wraps get it: deciding which one
  // "really" made the call would be a guess, and a consumer keying on either
  // id is entitled to find it.
  assert.deepEqual(Object.keys(joined["calc.py"]).sort(),
    ["module/dispatch.fn/out.assign", "module/dispatch.fn/run.call"]);
  assert.equal(joined["calc.py"]["module/dispatch.fn/run.call"].callees[0].callee, "calc.Engine.run");
});

test("a function_def is never labelled with what its body called", () => {
  const joined = joinTraceToNodes(
    [{ file: "calc.py", line: 20, callees: [{ callee: "calc.dispatch", count: 1 }] }],
    NODES,
  );
  // Line 20 is the `def`. Joining there would say "dispatch calls dispatch".
  assert.deepEqual(joined, {});
});

test("unparsed files and unanchored lines join to nothing, rather than inventing an anchor", () => {
  assert.deepEqual(joinTraceToNodes(
    [{ file: "vendor/thing.py", line: 9, callees: [{ callee: "x.y", count: 1 }] }], NODES,
  ), {});
  assert.deepEqual(joinTraceToNodes(
    [{ file: "calc.py", line: 999, callees: [{ callee: "x.y", count: 1 }] }], NODES,
  ), {});
  // A site the tracer saw but attributed no callee to says nothing.
  assert.deepEqual(joinTraceToNodes([{ file: "calc.py", line: 22, callees: [] }], NODES), {});
});

test("one site dispatching to several callees keeps all of them", () => {
  const joined = joinTraceToNodes([{
    file: "calc.py",
    line: 22,
    callees: [{ callee: "calc.Diesel.run", count: 4 }, { callee: "calc.Engine.run", count: 1 }],
  }], NODES);
  const obs = joined["calc.py"]["module/dispatch.fn/out.assign"];
  assert.equal(obs.callees.length, 2, "a loop over a heterogeneous list is the ordinary case");
  assert.equal(obs.callees[0].count, 4);
});
