// M-AGENT1 (PLAN-M-AGENT.md) — the Agent Manager spine contract:
// draft → ratify → serial dependencies-first advance with the two
// human gates, honest failure cascade, and the restart-comes-back-
// PAUSED rule. Pure module, no server boot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  draftWorkRun, setRunStatus, setPacketStatus,
  nextRunnablePacket, activePacket, runOutcome, runSummary,
  persistWorkRun, loadWorkRun, validateWorkRun, WORK_RUN_FILE, MAX_PACKET_ATTEMPTS,
  editScopeOf, inFlightPackets, startablePackets, MAX_LANES, packetTransitionError,
  warmSessionFor, clearWorkerSessions, MAX_SESSION_PACKETS,
} from "../src/server/work_run.ts";

// A 3-packet plan shaped like plan_work output: p2 depends on p1's
// thread, p3 depends on p2's — build order 1,2,3.
function fakePlan() {
  const packet = (order, ep, dependsOn) => ({
    order, entryPointId: ep, qualifiedName: ep, kind: "cli",
    matchedOn: ["deploy"], score: 3 - order, filesReached: [`${ep}.sh`],
    boundaries: {
      staticallyComplete: true, resolutionGaps: 0, runtimeDispatch: 0,
      uncaptured: 0, dependsOn, outsidePlan: { reaches: [], reachedBy: [] },
    },
    skill: { status: "none", note: "no skill" },
  });
  return {
    task: "harden the deploy pipeline",
    packets: [
      packet(1, "lib.sh:helpers", []),
      packet(2, "deploy.sh:main", ["lib.sh:helpers"]),
      packet(3, "verify.sh:main", ["deploy.sh:main"]),
    ],
    unmatchedTokens: ["rollback_svc"],
    cycles: [],
    planNote: "3 packets",
    verification: [],
  };
}

const EVIDENCE = { summary: "did it", irDelta: null, diffs: [], assertions: null, blindSpots: null };

test("draft: pending packets, plan provenance carried verbatim, validates", () => {
  const run = draftWorkRun(fakePlan(), () => new Date("2026-08-30T00:00:00Z"));
  assert.equal(run.status, "draft");
  assert.equal(run.packets.length, 3);
  assert.ok(run.packets.every((p) => p.status === "pending" && p.attempts === 0));
  assert.deepEqual(run.unmatchedTokens, ["rollback_svc"], "coverage gaps ride to the ratification gate");
  assert.equal(run.packets[1].plan.boundaries.dependsOn[0], "lib.sh:helpers");
  assert.equal(validateWorkRun(run), null);
});

test("gates are transitions: no draft→running, no pending→done", () => {
  const run = draftWorkRun(fakePlan());
  assert.match(setRunStatus(run, "running"), /illegal run transition/,
    "a draft run cannot run — ratification is a human gate");
  assert.match(setPacketStatus(run, "p1", "done"), /illegal packet transition/,
    "a packet cannot be done without passing the review gate");
  assert.equal(setRunStatus(run, "ratified"), null);
  assert.equal(setRunStatus(run, "running"), null);
});

test("serial dependencies-first ordering", () => {
  const run = draftWorkRun(fakePlan());
  setRunStatus(run, "ratified"); setRunStatus(run, "running");
  assert.equal(nextRunnablePacket(run).id, "p1", "the dependency-free packet first");
  setPacketStatus(run, "p1", "running");
  assert.equal(activePacket(run).id, "p1");
  // p2/p3 are NOT runnable while p1 is unfinished
  assert.equal(nextRunnablePacket(run), null);
  setPacketStatus(run, "p1", "awaiting-review", { evidence: EVIDENCE });
  assert.equal(nextRunnablePacket(run), null, "deps satisfied only by DONE, not awaiting-review");
  setPacketStatus(run, "p1", "done");
  assert.equal(nextRunnablePacket(run).id, "p2");
});

test("happy loop to a clean done", () => {
  const run = draftWorkRun(fakePlan());
  setRunStatus(run, "ratified"); setRunStatus(run, "running");
  for (const id of ["p1", "p2", "p3"]) {
    const next = nextRunnablePacket(run);
    assert.equal(next.id, id);
    assert.equal(setPacketStatus(run, id, "running"), null);
    assert.equal(setPacketStatus(run, id, "awaiting-review", { evidence: EVIDENCE }), null);
    assert.equal(setPacketStatus(run, id, "done"), null);
  }
  assert.equal(runOutcome(run), "done");
  assert.equal(run.packets[0].attempts, 1);
});

test("a rejected packet fails and its dependents skip EXPLICITLY", () => {
  const run = draftWorkRun(fakePlan());
  setRunStatus(run, "ratified"); setRunStatus(run, "running");
  setPacketStatus(run, "p1", "running");
  setPacketStatus(run, "p1", "awaiting-review", { evidence: EVIDENCE });
  setPacketStatus(run, "p1", "failed"); // human rejected the evidence
  assert.equal(run.packets[1].status, "skipped", "p2 depends on the failed thread");
  assert.equal(run.packets[2].status, "skipped", "transitively p3 too — a stall is never silent");
  assert.equal(nextRunnablePacket(run), null);
  assert.equal(runOutcome(run), "failed", "an incomplete run never claims success");
});

test("escalation is a first-class outcome the human resolves — and it HOLDS the run open", () => {
  const run = draftWorkRun(fakePlan());
  setRunStatus(run, "ratified"); setRunStatus(run, "running");
  setPacketStatus(run, "p1", "running");
  assert.equal(
    setPacketStatus(run, "p1", "escalated", { escalation: { reason: "needs auth_svc outside the plan" } }),
    null,
  );
  assert.equal(run.packets[0].escalation.reason, "needs auth_svc outside the plan");
  // Real-drive finding (2026-08-30): an OPEN escalation is a gate, not a
  // terminal — the run must NOT resolve to done/failed over the
  // reviewer's head while the card still awaits them.
  setPacketStatus(run, "p2", "skipped");
  assert.equal(runOutcome(run), null, "run stays open while an escalation awaits the human");
  assert.equal(setPacketStatus(run, "p1", "done"), null, "human resolves the escalation either way");
  assert.equal(runOutcome(run), "failed", "…and only THEN does the run terminalize");
});

test("M-AGENT4 bounded retry: awaiting-review → pending once, attempts count the bound", () => {
  const run = draftWorkRun(fakePlan());
  setRunStatus(run, "ratified"); setRunStatus(run, "running");
  setPacketStatus(run, "p1", "running");
  setPacketStatus(run, "p1", "awaiting-review", { evidence: EVIDENCE });
  // First rejection → retry (the review handler picks pending under the bound).
  assert.equal(setPacketStatus(run, "p1", "pending"), null, "the retry transition is legal");
  assert.equal(run.packets[0].attempts, 1);
  assert.ok(run.packets[0].attempts < MAX_PACKET_ATTEMPTS, "one re-draft remains");
  assert.equal(nextRunnablePacket(run).id, "p1", "the retried packet runs again first");
  setPacketStatus(run, "p1", "running");
  assert.equal(run.packets[0].attempts, 2, "the bound is now spent");
  setPacketStatus(run, "p1", "awaiting-review", { evidence: EVIDENCE });
  setPacketStatus(run, "p1", "failed"); // second rejection is final
  assert.equal(run.packets[1].status, "skipped");
});

test("M-AGENT4 same-file guard: overlapping in-flight files block a packet (pinned for future parallelism)", () => {
  const plan = fakePlan();
  // p3 becomes INDEPENDENT of p2 but shares p1's file.
  plan.packets[2].boundaries.dependsOn = [];
  plan.packets[2].filesReached = ["lib.sh:helpers.sh"];
  plan.packets[0].filesReached = ["lib.sh:helpers.sh"];
  const run = draftWorkRun(plan);
  setRunStatus(run, "ratified"); setRunStatus(run, "running");
  setPacketStatus(run, "p1", "running");
  // Under the serial rule callers stop at activePacket(); the guard is
  // what stops a FUTURE parallel scheduler from picking p3 here:
  assert.equal(nextRunnablePacket(run), null, "p3 shares a file with in-flight p1");
  setPacketStatus(run, "p1", "awaiting-review", { evidence: EVIDENCE });
  assert.equal(nextRunnablePacket(run), null, "still held while the gate is open");
  setPacketStatus(run, "p1", "done");
  assert.equal(nextRunnablePacket(run).id, "p2");
});

test("M-AGENT4 runSummary: honest notes for clean and unclean terminals", () => {
  const run = draftWorkRun(fakePlan());
  setRunStatus(run, "ratified"); setRunStatus(run, "running");
  const ev = (files) => ({ ...EVIDENCE, diffs: files.map((f) => ({ file: f, nodeId: null, diff: "+x" })) });
  setPacketStatus(run, "p1", "running");
  setPacketStatus(run, "p1", "awaiting-review", { evidence: ev(["lib.sh"]) });
  setPacketStatus(run, "p1", "done");
  setPacketStatus(run, "p2", "running");
  setPacketStatus(run, "p2", "awaiting-review", { evidence: ev(["deploy.sh"]) });
  setPacketStatus(run, "p2", "failed");
  const s = runSummary(run);
  assert.equal(s.done, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.skipped, 1, "p3 cascaded");
  assert.deepEqual(s.filesChanged, ["lib.sh"], "REJECTED work's files are not listed — they were restored");
  assert.match(s.note, /failed \(deploy.sh:main\).*restored/);
  assert.match(s.note, /1 skipped because a dependency failed/);
});

test("persistence: a mid-flight run restarts PAUSED, its running packet back to pending", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-workrun-"));
  try {
    const run = draftWorkRun(fakePlan());
    setRunStatus(run, "ratified"); setRunStatus(run, "running");
    setPacketStatus(run, "p1", "running");
    persistWorkRun(dir, run);
    assert.ok(readFileSync(join(dir, WORK_RUN_FILE), "utf-8").includes('"task"'));

    const back = loadWorkRun(dir);
    assert.equal(back.status, "paused", "never auto-resumes into spawning unattended");
    assert.equal(back.packets[0].status, "pending", "an interrupted worker is honestly unfinished");
    assert.equal(back.packets[0].attempts, 1, "the attempt still counts");
    assert.equal(setRunStatus(back, "running"), null, "human resumes");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("M-ORCH: mode is optional but never unknown; an orchestrator review may escalate from the gate; the summary names who reviewed", () => {
  const run = draftWorkRun(fakePlan());
  assert.equal(validateWorkRun(run), null, "no mode = gated (pre-M-ORCH runs)");
  run.mode = "orchestrated";
  assert.equal(validateWorkRun(run), null);
  assert.match(validateWorkRun({ ...run, mode: "autopilot" }), /bad mode/);

  setRunStatus(run, "ratified"); setRunStatus(run, "running");
  setPacketStatus(run, "p1", "running");
  setPacketStatus(run, "p1", "awaiting-review");
  assert.equal(setPacketStatus(run, "p1", "escalated", { escalation: { reason: "contract conflict" } }), null,
    "the orchestrator hands a reviewed packet to the human");
  assert.equal(run.packets[0].status, "escalated");
  run.packets[0].review = { by: "orchestrator", verdict: "escalate", reason: "contract conflict", at: "" };
  // resolve the escalation as done, approve the rest with orchestrator reviews
  setPacketStatus(run, "p1", "done");
  for (const id of ["p2", "p3"]) {
    setPacketStatus(run, id, "running"); setPacketStatus(run, id, "awaiting-review"); setPacketStatus(run, id, "done");
    run.packets.find((p) => p.id === id).review = { by: "orchestrator", verdict: "approve", reason: "ok", at: "" };
  }
  const s = runSummary(run);
  assert.equal(s.done, 3);
  assert.match(s.note, /Reviews: 3 by the orchestrator, 0 by a human/);
  assert.match(s.note, /not conformance to external reality/);
  const gated = draftWorkRun(fakePlan());
  assert.doesNotMatch(runSummary(gated).note, /Reviews:/, "gated runs keep the M-AGENT4 note");
});

test("M-ORCH.2: a no-change packet is a clean terminal — satisfies dependents, never spawns, counted apart from done", () => {
  const run = draftWorkRun(fakePlan());
  run.mode = "orchestrated";
  setRunStatus(run, "ratified"); setRunStatus(run, "running");
  // Only pending → no-change is legal (settled at the objective gate).
  assert.equal(setPacketStatus(run, "p1", "no-change"), null);
  assert.match(setPacketStatus(run, "p1", "running"), /illegal packet transition no-change → running/);
  assert.equal(validateWorkRun(run), null, "no-change is a known status on load");
  // p2 depends on p1's thread: a no-change p1 unblocks it exactly like done.
  assert.equal(nextRunnablePacket(run)?.id, "p2");
  setPacketStatus(run, "p2", "running"); setPacketStatus(run, "p2", "awaiting-review"); setPacketStatus(run, "p2", "done");
  setPacketStatus(run, "p3", "running"); setPacketStatus(run, "p3", "awaiting-review"); setPacketStatus(run, "p3", "done");
  assert.equal(runOutcome(run), "done", "no-change is CLEAN — unlike skipped");
  const s = runSummary(run);
  assert.equal(s.done, 2);
  assert.match(s.note, /1 packet\(s\) needed no change per the confirmed brief \(no worker spawned\)/);
  // skipped still fails the run — the two statuses must not blur.
  const other = draftWorkRun(fakePlan());
  setRunStatus(other, "ratified"); setRunStatus(other, "running");
  setPacketStatus(other, "p1", "running"); setPacketStatus(other, "p1", "failed");
  assert.equal(other.packets[1].status, "skipped");
  assert.equal(runOutcome(other), "failed");
});

// M-ORCH.4 — LANES. Three independent packets that all REACH one shared
// file (the fleet-telemetry shape: every python thread reaches storage.py)
// but whose brief-declared EDIT SCOPES are disjoint.
function lanesRun(parallel, scopes, reads = {}) {
  const plan = fakePlan();
  const ids = ["p1", "p2", "p3"];
  for (const [i, p] of plan.packets.entries()) { p.boundaries.dependsOn = []; p.filesReached = reads[ids[i]] ?? [`${p.entryPointId}.sh`, "shared.sh"]; }
  const run = draftWorkRun(plan);
  run.mode = "orchestrated";
  run.parallel = parallel;
  run.orchestration = {
    status: "ready", objective: "o", globalConstraints: [], storedConstraintIds: [], note: "",
    packetTasks: Object.fromEntries(run.packets.map((p) => [p.id, { task: "t", handoff: [], ...(scopes[p.id] ? { files: scopes[p.id] } : {}) }])),
  };
  setRunStatus(run, "ratified"); setRunStatus(run, "running");
  return run;
}

test("M-ORCH.4 editScopeOf: the brief's declared files, else the thread's files; scopes drive the same-file guard", () => {
  const run = lanesRun(3, { p1: ["lib.sh:helpers.sh"], p2: ["deploy.sh:main.sh"] });
  assert.deepEqual(editScopeOf(run, run.packets[0]), ["lib.sh:helpers.sh"]);
  assert.deepEqual(editScopeOf(run, run.packets[2]), ["verify.sh:main.sh", "shared.sh"], "no declaration → the whole remit");
  // p1 and p2 both REACH shared.sh but neither CHANGES it — compatible. p3's
  // undeclared scope (verify + shared) would CHANGE shared.sh, which p1 and
  // p2 read → p3 waits.
  assert.deepEqual(startablePackets(run).map((p) => p.id), ["p1", "p2"]);
  // Once p3 holds shared.sh, an undeclared p1 (whole remit) would be blocked.
  const flipped = lanesRun(3, { p3: ["shared.sh"] });
  setPacketStatus(flipped, "p3", "running");
  assert.deepEqual(startablePackets(flipped), [], "p1 and p2 reach shared.sh, held by p3");
});

test("M-ORCH.4 read-after-write guard: a packet never shares the lanes with one changing a file it reads (or reading a file it changes)", () => {
  // p2 CHANGES b.sh; p1 READS b.sh → incompatible (p1 would read a moving target).
  const readerFirst = lanesRun(3, { p1: ["a.sh"], p2: ["b.sh"], p3: ["c.sh"] }, { p1: ["a.sh", "b.sh"], p2: ["b.sh"], p3: ["c.sh"] });
  assert.deepEqual(startablePackets(readerFirst).map((p) => p.id), ["p1", "p3"], "p2 waits for the reader p1");
  setPacketStatus(readerFirst, "p1", "running"); setPacketStatus(readerFirst, "p3", "running");
  assert.deepEqual(startablePackets(readerFirst), []);
  setPacketStatus(readerFirst, "p1", "awaiting-review", { evidence: EVIDENCE }); setPacketStatus(readerFirst, "p1", "done");
  assert.deepEqual(startablePackets(readerFirst).map((p) => p.id), ["p2"]);
  // Symmetric: p1 CHANGES a.sh; p2 READS a.sh → p2 waits while p1 is in flight.
  const writerFirst = lanesRun(3, { p1: ["a.sh"], p2: ["b.sh"], p3: ["c.sh"] }, { p1: ["a.sh"], p2: ["a.sh", "b.sh"], p3: ["c.sh"] });
  assert.deepEqual(startablePackets(writerFirst).map((p) => p.id), ["p1", "p3"]);
  // Two packets that merely READ the same file are fine.
  const readers = lanesRun(3, { p1: ["a.sh"], p2: ["b.sh"], p3: ["c.sh"] }, { p1: ["a.sh", "lib.sh"], p2: ["b.sh", "lib.sh"], p3: ["c.sh", "lib.sh"] });
  assert.deepEqual(startablePackets(readers).map((p) => p.id), ["p1", "p2", "p3"]);
});

test("M-ORCH.4 startablePackets fills the lanes with disjoint scopes only, and never past the cap", () => {
  // Undeclared scopes = whole remits, all sharing shared.sh → strictly serial even with 3 lanes.
  const serial = lanesRun(3, {});
  assert.deepEqual(startablePackets(serial).map((p) => p.id), ["p1"]);
  setPacketStatus(serial, "p1", "running");
  assert.deepEqual(startablePackets(serial), [], "shared.sh is held by p1");
  // Disjoint declared scopes → all three at once with 3 lanes, two with 2 lanes.
  const three = lanesRun(3, { p1: ["lib.sh:helpers.sh"], p2: ["deploy.sh:main.sh"], p3: ["verify.sh:main.sh"] });
  assert.deepEqual(startablePackets(three).map((p) => p.id), ["p1", "p2", "p3"], "all three READ shared.sh, none changes it");
  const two = lanesRun(2, { p1: ["lib.sh:helpers.sh"], p2: ["deploy.sh:main.sh"], p3: ["verify.sh:main.sh"] });
  assert.deepEqual(startablePackets(two).map((p) => p.id), ["p1", "p2"]);
  setPacketStatus(two, "p1", "running"); setPacketStatus(two, "p2", "running");
  assert.equal(inFlightPackets(two).length, 2);
  assert.deepEqual(startablePackets(two), [], "cap reached");
  setPacketStatus(two, "p1", "awaiting-review", { evidence: EVIDENCE });
  assert.deepEqual(startablePackets(two), [], "awaiting-review still holds a lane (and its scope)");
  setPacketStatus(two, "p1", "done");
  assert.deepEqual(startablePackets(two).map((p) => p.id), ["p3"]);
  // parallel absent = 1 = the M-AGENT serial rule, byte-for-byte.
  const legacy = lanesRun(undefined, { p1: ["a"], p2: ["b"], p3: ["c"] });
  assert.deepEqual(startablePackets(legacy).map((p) => p.id), ["p1"]);
  // Overlapping declared scopes serialise even with free lanes (p3 neither
  // reads nor changes shared.sh here, so it rides along with p1).
  const overlap = lanesRun(3, { p1: ["shared.sh"], p2: ["shared.sh"], p3: ["verify.sh:main.sh"] },
    { p1: ["lib.sh:helpers.sh", "shared.sh"], p2: ["deploy.sh:main.sh", "shared.sh"], p3: ["verify.sh:main.sh"] });
  assert.deepEqual(startablePackets(overlap).map((p) => p.id), ["p1", "p3"]);
  // Dependencies still order packets regardless of lanes.
  const dep = lanesRun(3, { p1: ["a"], p2: ["b"], p3: ["c"] }, { p1: ["a"], p2: ["b"], p3: ["c"] });
  dep.packets[1].plan.boundaries.dependsOn = ["lib.sh:helpers"];
  assert.deepEqual(startablePackets(dep).map((p) => p.id), ["p1", "p3"]);
  // startedAt is stamped on every start (lanes make order a fact worth keeping).
  setPacketStatus(dep, "p1", "running");
  assert.match(dep.packets[0].startedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("M-ORCH.4 runSummary counts pre-check approvals apart; validation bounds parallel and review", () => {
  const run = lanesRun(2, { p1: ["a"], p2: ["b"], p3: ["c"] });
  for (const id of ["p1", "p2", "p3"]) { setPacketStatus(run, id, "running"); setPacketStatus(run, id, "awaiting-review", { evidence: EVIDENCE }); }
  setPacketStatus(run, "p1", "done"); run.packets[0].review = { by: "pre-checks", verdict: "approve", reason: "pre-checks passed", at: "t" };
  setPacketStatus(run, "p2", "done"); run.packets[1].review = { by: "orchestrator", verdict: "approve", reason: "ok", at: "t" };
  setPacketStatus(run, "p3", "done"); run.packets[2].review = { by: "pre-checks", verdict: "approve", reason: "pre-checks passed", at: "t" };
  const s = runSummary(run);
  assert.match(s.note, /Reviews: 1 by the orchestrator, 0 by a human/);
  assert.match(s.note, /2 approved on pre-checks alone \(deterministic: edit scope, parse, entry-point signature, resolution gaps — no model read those diffs\)/);
  assert.equal(validateWorkRun({ ...run, parallel: 0 }), "bad parallel 0");
  assert.equal(validateWorkRun({ ...run, parallel: MAX_LANES + 1 }), `bad parallel ${MAX_LANES + 1}`);
  assert.equal(validateWorkRun({ ...run, parallel: 2.5 }), "bad parallel 2.5");
  assert.equal(validateWorkRun({ ...run, review: "sometimes" }), "bad review policy sometimes");
  assert.equal(validateWorkRun({ ...run, parallel: 4, review: "full" }), null);
  // Restart with two packets mid-flight: both back to pending, run paused.
  const dir = mkdtempSync(join(tmpdir(), "vg-workrun-lanes-"));
  try {
    const mid = lanesRun(2, { p1: ["a"], p2: ["b"], p3: ["c"] });
    setPacketStatus(mid, "p1", "running"); setPacketStatus(mid, "p2", "running");
    persistWorkRun(dir, mid);
    const back = loadWorkRun(dir);
    assert.equal(back.status, "paused");
    assert.deepEqual(back.packets.map((p) => p.status), ["pending", "pending", "pending"]);
    assert.equal(back.parallel, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("corrupt or foreign run files are ignored, never trusted", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-workrun-bad-"));
  try {
    persistWorkRun(dir, draftWorkRun(fakePlan()));
    const file = join(dir, WORK_RUN_FILE);
    writeFileSync(file, JSON.stringify({ version: "1", task: "x", status: "running", packets: [] }));
    assert.equal(loadWorkRun(dir), null, "no-packet runs fail validation");
    writeFileSync(file, "{nope");
    assert.equal(loadWorkRun(dir), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("packetTransitionError is the pure twin of setPacketStatus — a reviewer can undo BEFORE it transitions", () => {
  const run = draftWorkRun(fakePlan());
  setRunStatus(run, "ratified"); setRunStatus(run, "running");
  assert.match(packetTransitionError(run, "p1", "done"), /illegal packet transition pending → done/);
  assert.equal(packetTransitionError(run, "nope", "done"), "no packet nope");
  setPacketStatus(run, "p1", "running"); setPacketStatus(run, "p1", "awaiting-review", { evidence: EVIDENCE });
  assert.equal(packetTransitionError(run, "p1", "failed"), null);
  assert.equal(packetTransitionError(run, "p1", "pending"), null);
  assert.equal(run.packets[0].status, "awaiting-review", "the check never mutates");
});

// ── M-BATCH — warm worker sessions ───────────────────────────────────
//
// The head-to-head cost was ~13 COLD spawns run mostly in sequence, each
// rediscovering files the previous worker had just edited — and two of the
// lane drill's escalations came from that same ignorance rather than from
// any parallelism bug. A packet may now resume the session of a packet that
// just touched what it is about to touch.
//
// What these pin is not the speed. It is every case where resuming would be
// WRONG.

const wsRun = (packets, extra = {}) => ({
  version: "1", task: "t", createdAt: "2026-09-10T00:00:00Z", status: "running",
  unmatchedTokens: [], cycles: [], planNote: "", packets, ...extra,
});
const wsPacket = (id, over = {}) => ({
  id, status: "pending", attempts: 1, evidence: null, escalation: null,
  plan: {
    entryPointId: `${id}.py:fn`, qualifiedName: `${id}:fn`, order: 1,
    filesReached: over.reads ?? [`${id}.py`],
    boundaries: { dependsOn: [], escalate: [] },
    ...(over.plan ?? {}),
  },
  ...over,
});

test("M-BATCH: a packet resumes the session of the packet that just touched its files", () => {
  const run = wsRun([
    wsPacket("p1", { status: "done", sessionId: "s-1", sessionPackets: 1, startedAt: "2026-09-10T00:00:01Z",
      reads: ["storage.py"] }),
    wsPacket("p2", { reads: ["storage.py", "devices.py"] }),
  ]);
  const warm = warmSessionFor(run, run.packets[1]);
  assert.equal(warm?.sessionId, "s-1");
  assert.equal(warm?.from, "p1");
  assert.equal(warm?.carried, 1);
});

test("M-BATCH: a packet that shares NO file gets a cold spawn", () => {
  // A stranger's context is a cost, not a gift.
  const run = wsRun([
    wsPacket("p1", { status: "done", sessionId: "s-1", startedAt: "2026-09-10T00:00:01Z", reads: ["gateway.ts"] }),
    wsPacket("p2", { reads: ["export.py"] }),
  ]);
  assert.equal(warmSessionFor(run, run.packets[1]), null);
});

test("M-BATCH: a REJECTED packet's session is never resumed — a restore makes it wrong", () => {
  // Reject puts the snapshot back, so the session's belief about the tree is
  // stale. A worker that believes a stale tree is worse than one that knows
  // nothing at all.
  for (const status of ["rejected", "escalated", "failed", "running", "awaiting-review"]) {
    const run = wsRun([
      wsPacket("p1", { status, sessionId: "s-1", startedAt: "2026-09-10T00:00:01Z", reads: ["storage.py"] }),
      wsPacket("p2", { reads: ["storage.py"] }),
    ]);
    assert.equal(warmSessionFor(run, run.packets[1]), null, `must not resume a ${status} packet`);
  }
});

test("M-BATCH: clearWorkerSessions wipes every session — a restore invalidates all of them", () => {
  const run = wsRun([
    wsPacket("p1", { status: "done", sessionId: "s-1", sessionPackets: 2, reads: ["storage.py"] }),
    wsPacket("p2", { status: "done", sessionId: "s-2", sessionPackets: 1, reads: ["storage.py"] }),
  ]);
  clearWorkerSessions(run);
  assert.equal(run.packets[0].sessionId, undefined);
  assert.equal(run.packets[0].sessionPackets, undefined);
  assert.equal(run.packets[1].sessionId, undefined);
  assert.equal(warmSessionFor(run, wsPacket("p3", { reads: ["storage.py"] })), null);
});

test("M-BATCH: a session is recycled after MAX_SESSION_PACKETS — the cap is a cap, not a hope", () => {
  const full = wsRun([
    wsPacket("p1", { status: "done", sessionId: "s-1", sessionPackets: MAX_SESSION_PACKETS,
      startedAt: "2026-09-10T00:00:01Z", reads: ["storage.py"] }),
    wsPacket("p2", { reads: ["storage.py"] }),
  ]);
  assert.equal(warmSessionFor(full, full.packets[1]), null,
    "context is exactly the thing multi-agent exists to bound");
  const room = wsRun([
    wsPacket("p1", { status: "done", sessionId: "s-1", sessionPackets: MAX_SESSION_PACKETS - 1,
      startedAt: "2026-09-10T00:00:01Z", reads: ["storage.py"] }),
    wsPacket("p2", { reads: ["storage.py"] }),
  ]);
  assert.equal(warmSessionFor(room, room.packets[1])?.sessionId, "s-1");
});

test("M-BATCH: the LATEST qualifying session wins — the most recent edit is the one worth knowing", () => {
  const run = wsRun([
    wsPacket("p1", { status: "done", sessionId: "s-old", startedAt: "2026-09-10T00:00:01Z", reads: ["storage.py"] }),
    wsPacket("p2", { status: "done", sessionId: "s-new", startedAt: "2026-09-10T00:00:09Z", reads: ["storage.py"] }),
    wsPacket("p3", { reads: ["storage.py"] }),
  ]);
  assert.equal(warmSessionFor(run, run.packets[2])?.sessionId, "s-new");
});

test("M-BATCH: warmSessions:false restores the pre-M-BATCH behaviour verbatim", () => {
  const run = wsRun([
    wsPacket("p1", { status: "done", sessionId: "s-1", startedAt: "2026-09-10T00:00:01Z", reads: ["storage.py"] }),
    wsPacket("p2", { reads: ["storage.py"] }),
  ], { warmSessions: false });
  assert.equal(warmSessionFor(run, run.packets[1]), null);
});

test("M-BATCH: a packet never resumes ITS OWN session on a retry", () => {
  // A rejected attempt's session is precisely the context that produced the
  // rejected work; carrying it into the retry carries the mistake too.
  const run = wsRun([
    wsPacket("p1", { status: "done", sessionId: "s-1", startedAt: "2026-09-10T00:00:01Z", reads: ["storage.py"] }),
  ]);
  const retry = { ...run.packets[0], status: "pending", attempts: 2 };
  run.packets = [retry];
  assert.equal(warmSessionFor(run, retry), null);
});

// ── M-SWEEP W5 — the guard the review-overlap depends on ─────────────
//
// runOnePacket now fills a freed lane BEFORE awaiting the verdict, so a
// packet can start while another sits at awaiting-review. That is safe for
// exactly one reason: inFlightPackets INCLUDES awaiting-review, so
// startablePackets still refuses anything that reads what the packet under
// review changed — and a rejection restores only that packet's files, which
// laneCompatible has already proven disjoint from whatever started.
//
// If someone ever narrows inFlightPackets to `running`, the overlap becomes
// a race that restores files out from under a live worker. This test is
// what fails first.

test("M-BATCH/W5: a packet AWAITING REVIEW still blocks a reader of what it changed", () => {
  const run = wsRun([
    wsPacket("p1", {
      status: "awaiting-review",
      reads: ["storage.py", "shared.py"],
      plan: { entryPointId: "p1.py:fn", qualifiedName: "p1:fn", order: 1,
              filesReached: ["storage.py", "shared.py"],
              boundaries: { dependsOn: [], escalate: [] } },
    }),
    // p2 READS storage.py, which p1 changed. It must not start while the
    // verdict is outstanding: a reject would rewind that file underneath it.
    wsPacket("p2", { reads: ["storage.py"] }),
    // p3 shares nothing with p1 — it is exactly what W5 exists to let run.
    wsPacket("p3", { reads: ["export.py"] }),
  ], { parallel: 3 });

  assert.ok(inFlightPackets(run).some((p) => p.id === "p1"),
    "awaiting-review counts as in flight — the whole safety argument");

  const startable = startablePackets(run).map((p) => p.id);
  assert.ok(!startable.includes("p2"),
    "a reader of the file under review must WAIT for the verdict");
  assert.ok(startable.includes("p3"),
    "an unrelated packet fills the freed lane instead of idling");
});

// ── AUTONOMY (ruling:2026-09-12:human-out-of-the-loop) ──────────────────
import { AUTONOMY_RULING, resolveEscalationAutonomously } from "../src/server/work_run.ts";

test("AUTONOMY: an escalation is resolved as FAILED with its reason kept, dependents skip, the summary says who confirmed; refused elsewhere", () => {
  const run = draftWorkRun(fakePlan());
  run.mode = "orchestrated";
  // Not autonomous: the escalation stays for a human.
  assert.match(resolveEscalationAutonomously(run, "p1", "needs the billing service"), /not an autonomous run/);
  run.autonomy = { mode: "autonomous", ruling: AUTONOMY_RULING, ratifiedBy: "orchestrator", escalationsResolved: 0 };
  assert.equal(validateWorkRun(run), null);
  assert.equal(setRunStatus(run, "ratified"), null);
  assert.equal(setRunStatus(run, "running"), null);
  assert.equal(setPacketStatus(run, "p1", "running"), null);
  assert.match(resolveEscalationAutonomously(run, "p1", "x"), /is running, not escalated/);
  assert.equal(setPacketStatus(run, "p1", "escalated", { escalation: { reason: "needs the billing service" } }), null);
  assert.equal(resolveEscalationAutonomously(run, "p1", "needs the billing service"), null);
  const p1 = run.packets[0];
  assert.equal(p1.status, "failed");
  assert.equal(p1.review.by, "orchestrator");
  assert.equal(p1.review.verdict, "escalate");
  assert.match(p1.review.reason, /ruling:2026-09-12:human-out-of-the-loop/);
  assert.match(p1.review.reason, /resolved as FAILED, no human gate/);
  assert.equal(p1.escalation.reason, "needs the billing service", "the worker's reason is KEPT");
  assert.equal(run.packets[1].status, "skipped", "dependents cascade exactly as after any failure");
  assert.equal(run.packets[2].status, "skipped");
  assert.equal(run.autonomy.escalationsResolved, 1);
  assert.equal(runOutcome(run), "failed", "an autonomous run with a failed packet is FAILED, never done");
  const s = runSummary(run);
  assert.match(s.note, /1 escalation\(s\) resolved as FAILED under autonomy \(ruling:2026-09-12:human-out-of-the-loop\), reasons kept: lib\.sh:helpers: needs the billing service/);
  assert.match(s.note, /AUTONOMOUS run: the objective was confirmed by the orchestrator under ruling:2026-09-12:human-out-of-the-loop, not by a human; 1 escalation\(s\) were resolved as failed/);
  // The shape is validated: a look-alike is refused, and autonomy on a gated run is refused.
  assert.match(validateWorkRun({ ...run, autonomy: { mode: "manual" } }), /bad autonomy/);
  assert.match(validateWorkRun({ ...run, mode: "gated" }), /autonomy on a gated run/);
});
