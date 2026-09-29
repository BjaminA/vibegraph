// Reachability and tests-per-thread (2026-09-28), from the codegraph /
// a private production codebase comparison: a call index reported "2 callers" for a browser path no
// page renders, and had no notion of which tests exercise which flow.
//
//   src/server/reachability.ts  — the functions no entry point reaches, each
//                                 with WHY (only two reasons suggest dead code);
//   src/shared/test_reach.ts    — the discovered tests that exercise a thread,
//                                 and the tests to run for changed files;
//   and the two fixes the fleet example needed before either could be true:
//   unittest METHODS are test entry points, and `from pkg import module` then
//   `module.fn()` links.
//
//   npm run test:reachability
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { computeReachability, formatReachabilityMd } from "../src/server/reachability.ts";
import { testReach, affectedTests, formatTestedBy } from "../src/shared/test_reach.ts";

let env;
before(() => { env = buildPolyglotEnvelope("examples/fleet-telemetry").envelope; });

const TEST_A = "telemetry/tests/test_alerts.py:test_second_page_inside_the_window_is_suppressed";
const TEST_B = "telemetry/tests/test_alerts.py:test_windows_are_per_device_and_metric";

test("unittest.TestCase methods are discovered as test entry points", () => {
  const tests = env.entryPoints.filter((e) => e.kind === "test" && e.file === "telemetry/tests/test_alerts.py");
  assert.deepEqual(tests.map((e) => e.id).sort(), [TEST_A, TEST_B]);
  assert.ok(tests.every((e) => e.framework === "unittest"));
  assert.ok(!env.entryPoints.some((e) => e.id.endsWith(":setUp")), "setUp is not a test");
});

test("`from telemetry import alerts` then `alerts.should_notify()` links to the function", () => {
  const t = env.threads.find((x) => x.entryPointId === TEST_A);
  const step = t.nodes.find((n) => n.kind === "step" && n.file === "telemetry/alerts.py");
  assert.ok(step, "the test's thread steps into alerts.py");
  assert.equal(step.irNodeId, "module/should_notify.fn");
  assert.ok(!t.nodes.some((n) => n.kind === "external" && n.label === "alerts.should_notify"), "no longer an unlinked external");
});

test("tests per thread: direct when a test reaches the entry point, partial when it reaches steps", () => {
  const tb = testReach(env.threads, env.entryPoints);
  assert.deepEqual(tb.get("telemetry/alerts.py:should_notify").direct, [TEST_A, TEST_B]);
  const ev = tb.get("telemetry/alerts.py:evaluate");
  assert.deepEqual(ev.direct, []);
  assert.deepEqual(ev.partial.map((p) => p.entryPointId), [TEST_A, TEST_B]);
  assert.equal(tb.has(TEST_A), false, "a test thread is not itself keyed");
  assert.match(formatTestedBy(tb.get("gateway/server.ts:getHealth")), /^Tested by: no discovered test reaches this thread\.$/);
  assert.match(formatTestedBy(ev), /reaches \d+ of its steps/);
  assert.equal(formatTestedBy(undefined), null, "no index, no line");
});

test("affected: the tests to run for changed files, and the test file itself counts", () => {
  const a = affectedTests(env.threads, env.entryPoints, ["telemetry/alerts.py"]);
  assert.deepEqual(a.map((x) => x.entryPointId), [TEST_A, TEST_B]);
  assert.deepEqual(a[0].via, ["telemetry/alerts.py"]);
  assert.deepEqual(affectedTests(env.threads, env.entryPoints, ["gateway/cache.ts"]), []);
  const own = affectedTests(env.threads, env.entryPoints, ["telemetry/tests/test_alerts.py"]);
  assert.equal(own.length, 2);
});

test("reachability on the fleet: two never named, one exported and unused, chained calls are gaps not dead", () => {
  const r = computeReachability(env);
  const by = (reason) => r.unreached.filter((u) => u.reason === reason).map((u) => `${u.file}:${u.name}`).sort();
  assert.deepEqual(by("never-named"), ["telemetry/devices.py:register_device", "telemetry/metrics_math.py:zscore"]);
  assert.deepEqual(by("exported-never-named"), ["gateway/cache.ts:invalidate"]);
  assert.ok(by("named-not-linked").includes("telemetry/http_client.py:_session"), "`_session().post` names it: a gap, never dead");
  assert.ok(!r.unreached.some((u) => u.file.includes("/tests/")), "test files are left out");
  assert.equal(r.filesUnreached.length, 0);
  assert.equal(r.defs - r.reached, r.unreached.length + 0 /* nested-in-unreached are folded into their parent */);
  const md = formatReachabilityMd(r);
  assert.match(md, /^# Reachability/);
  assert.match(md, /`telemetry\/devices\.py`: `register_device` \(line \d+\)/);
});

test("reachability: a constructor is reached through its class name; a nested helper of a reached function is a walk gap", () => {
  const files = {
    "a.ts": {
      nodes: [
        { id: "module/main.fn", type: "function_def", name: "main", line: 1, parentId: null },
        { id: "module/main.fn/load.fn", type: "function_def", name: "load", line: 2, parentId: "module/main.fn" },
        { id: "module/main.fn/load.call", type: "call", funcName: "load", parentId: "module/main.fn" },
        { id: "module/main.fn/Svc.call", type: "call", funcName: "Svc", preview: "new Svc()", parentId: "module/main.fn" },
        { id: "module/Svc.class", type: "class_def", name: "Svc", line: 5, parentId: null },
        { id: "module/Svc.class/constructor.fn", type: "function_def", name: "constructor", line: 6, parentId: "module/Svc.class" },
        { id: "module/orphan.fn", type: "function_def", name: "orphan", line: 9, parentId: null },
      ],
      edges: [],
    },
  };
  const env2 = {
    files,
    threads: [{ nodes: [{ kind: "seed", file: "a.ts", irNodeId: "module/main.fn" }] }],
    entryPoints: [{ id: "a.ts:main", file: "a.ts", irNodeId: "module/main.fn", kind: "cli" }],
  };
  const r = computeReachability(env2);
  const reason = (name) => r.unreached.find((u) => u.name === name)?.reason;
  assert.equal(reason("load"), "walk-gap-nested");
  assert.equal(reason("constructor"), "named-not-linked", "`new Svc()` names the class");
  assert.equal(reason("orphan"), "never-named");
});
