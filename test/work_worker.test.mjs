/**
 * M-AGENT3 worker-session contract + M-CONTRACT/M-ORCH additions, pinned
 * as a unit: the packet prompt's load-bearing rules, the contract and
 * constraint sections (order: skill → contract → constraints → blind
 * spots), the reviewer framing, the output-block parser, and the line
 * diff the evidence card renders.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/work_worker.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkerPrompt, buildSystemWorkerPrompt, parsePacketResult, lineDiff, WORKER_TURN_BUDGET } from "../src/server/work_worker.ts";

test("M-ORCH.3: the SYSTEM packet prompt names the remit, the creatable files, the integration contracts, and the constraints", () => {
  const p = buildSystemWorkerPrompt({
    packetId: "x1", title: "migration", rationale: "no thread owns a migration",
    files: ["api/migrations.py", "api/db.py"], existing: ["api/db.py"],
    integrates: ["api/db.py:insert_order"],
    integrationContracts: ["## Thread contract (IR fact — auto-generated, do not edit)\nEnters: readings"],
    constraints: "## Constraints for this thread (STATED — not IR fact; the source of each line is named)\n- [perf-lever · human-stated — authoritative] batches of 500",
    reviewer: "orchestrator",
  }, "OBJECTIVE: o\n\nSYSTEM PACKET x1 — migration\nYOUR TASK: add the column");
  assert.match(p, /ONE SYSTEM PACKET of a confirmed work run: "migration" \(x1\)/);
  assert.match(p, /EDIT only these files: api\/migrations\.py, api\/db\.py/);
  assert.match(p, /api\/migrations\.py do NOT exist yet: create them with mcp__vibegraph__vibegraph_create_file \(Python only/);
  assert.match(p, /NEW files only through vibegraph_create_file/);
  assert.match(p, /3\. The ORCHESTRATOR reviews your work/);
  assert.match(p, /YOUR TASK: add the column/);
  assert.match(p, /Why this is a system packet: no thread owns a migration/);
  assert.match(p, /Integration points \(threads whose contracts you must honour\): api\/db\.py:insert_order/);
  assert.match(p, /## Thread contract[\s\S]*Enters: readings/);
  assert.match(p, /batches of 500/);
  assert.match(p, /```vg-packet-result/);
  // nothing creatable → no create-file instruction
  const none = buildSystemWorkerPrompt({ packetId: "x2", title: "w", rationale: "", files: ["a.py"], existing: ["a.py"], integrates: [], integrationContracts: [], constraints: null }, "t");
  assert.doesNotMatch(none, /do NOT exist yet/);
  assert.match(none, /3\. A HUMAN reviews/);
});

const bundle = {
  entryPointId: "api/app.py:create_order",
  qualifiedName: "api/app:create_order",
  projection: "- seed: create_order `module/create_order.fn`",
  skill: null,
  blindSpots: "## Not statically known (IR fact — auto-generated, do not edit)\n\nThis thread is statically complete.",
  filesReached: ["api/app.py", "api/db.py"],
  outsidePlan: { reaches: ["ops/deploy.sh:main"], reachedBy: [] },
};

test("the M-AGENT3 prompt shape is unchanged when no contract/constraints are supplied", () => {
  const p = buildWorkerPrompt(bundle, "do the thing");
  assert.match(p, /WORKER AGENT executing ONE packet of a human-ratified work run/);
  assert.match(p, /1\. REMIT — .*api\/app\.py, api\/db\.py/);
  assert.match(p, /2\. EDITS go ONLY through mcp__vibegraph__vibegraph_rewrite_node/);
  assert.match(p, /3\. A HUMAN reviews your work at a gate/);
  assert.match(p, /```vg-packet-result/);
  assert.match(p, new RegExp(`at most ${WORKER_TURN_BUDGET} turns`));
  assert.match(p, /YOUR PACKET TASK:\ndo the thing/);
  assert.match(p, /reaches: ops\/deploy\.sh:main/);
  assert.doesNotMatch(p, /Thread contract/);
  assert.doesNotMatch(p, /Constraints for this thread/);
});

test("contract and constraints render between the skill and the blind spots, in that order", () => {
  const p = buildWorkerPrompt({
    ...bundle,
    skill: "## Purpose\nCreates an order.",
    contract: "## Thread contract (IR fact — auto-generated, do not edit)\nEnters: (no parameters)",
    constraints: "## Constraints for this thread (STATED — not IR fact; the source of each line is named)\n- [proxy · human-stated — authoritative] via nginx",
  }, "x");
  const at = (re) => { const m = p.search(re); assert.ok(m >= 0, `missing ${re}`); return m; };
  const skill = at(/Human-ratified thread skill/);
  const contract = at(/## Thread contract/);
  const constraints = at(/## Constraints for this thread/);
  const blind = at(/## Not statically known/);
  assert.ok(skill < contract && contract < constraints && constraints < blind, "section order");
  assert.match(p, /via nginx/);
});

test("M-ORCH.4: an edit scope narrows rule 1 — the rest of the remit is read-only, named, and parallel-aware", () => {
  const p = buildWorkerPrompt({ ...bundle, editScope: ["api/app.py"], reviewer: "orchestrator" }, "x");
  assert.match(p, /1\. REMIT — .*you may EDIT only these files: api\/app\.py\. /);
  assert.match(p, /The other files this thread reaches \(api\/db\.py\) are READ-ONLY context for you: another packet owns changes there and may be making them in parallel with you — the chokepoint refuses an edit outside your scope/);
  assert.match(p, /naming the file and the exact change/);
  // Scope = the whole remit → no read-only sentence (M-AGENT3 wording, one line).
  const whole = buildWorkerPrompt({ ...bundle, editScope: ["api/app.py", "api/db.py"] }, "x");
  assert.doesNotMatch(whole, /READ-ONLY context/);
  assert.match(whole, /EDIT only these files: api\/app\.py, api\/db\.py\. A change needed anywhere else/);
});

test("reviewer framing: orchestrated packets say who reviews and that data shapes must hold", () => {
  const human = buildWorkerPrompt(bundle, "x");
  assert.match(human, /3\. A HUMAN reviews your work/);
  const orch = buildWorkerPrompt({ ...bundle, reviewer: "orchestrator" }, "x");
  assert.match(orch, /3\. The ORCHESTRATOR reviews your work against the objective a human confirmed/);
  assert.match(orch, /Keep every data shape named in the thread contract and constraints below intact/);
  assert.match(orch, /escalations and broken output contracts return to the human/);
  assert.doesNotMatch(orch, /3\. A HUMAN reviews/);
});

test("parsePacketResult takes the LAST block; a broken contract is null, never invented", () => {
  const text = "thinking…\n```vg-packet-result\n{\"outcome\":\"escalate\",\"summary\":\"a\",\"reason\":\"r\"}\n```\nmore\n```vg-packet-result\n{\"outcome\":\"done\",\"summary\":\"b\"}\n```";
  assert.deepEqual(parsePacketResult(text), { outcome: "done", summary: "b" });
  assert.equal(parsePacketResult("no block"), null);
  assert.equal(parsePacketResult("```vg-packet-result\n{\"outcome\":\"maybe\"}\n```"), null);
  assert.equal(parsePacketResult(null), null);
});

test("lineDiff is head/tail anchored and capped", () => {
  assert.equal(lineDiff("a\nb\nc", "a\nB\nc"), "-b\n+B");
  assert.equal(lineDiff("same", "same"), "");
  const many = lineDiff("x", Array.from({ length: 100 }, (_, i) => `l${i}`).join("\n"), 5).split("\n");
  assert.equal(many.length, 5);
});

test("M-STACK.3: the stack section sits between the contract and the constraints, and forbids adding a dependency", () => {
  const p = buildWorkerPrompt({
    entryPointId: "e", qualifiedName: "q", projection: "1. step", skill: "SKILL BODY",
    blindSpots: "## Blind spots", filesReached: ["a.py"], outsidePlan: { reaches: [], reachedBy: [] },
    contract: "## Thread contract (IR fact — auto-generated, do not edit)\nEnters: (no parameters)",
    stack: "## Stack for this thread (IR fact — what its files import/call; a DECISION about a tool is stated separately below)\n- HTTP client: telemetry.http_client (project funnel wrapping requests; 2 site(s) in 1 file(s))",
    constraints: "## Constraints for this thread (STATED — not IR fact; the source of each line is named)\n- [proxy · human-stated — authoritative] via nginx",
  }, "do the thing");
  const at = (re) => p.search(re);
  assert.ok(at(/## Thread contract/) < at(/## Stack for this thread/), "contract before stack: what the code does, then what it is built on");
  assert.ok(at(/## Stack for this thread/) < at(/## Constraints for this thread/), "stack before constraints");
  assert.ok(at(/## Constraints for this thread/) < at(/## Blind spots/));
  assert.match(p, /Use the tools above/);
  assert.match(p, /that is an ESCALATION \(rule 4\)/);
  assert.match(p, /Never add a dependency/);
  // Absent stack ⇒ the M-CONTRACT prompt shape, byte for byte.
  const without = buildWorkerPrompt({
    entryPointId: "e", qualifiedName: "q", projection: "1. step", skill: "SKILL BODY",
    blindSpots: "## Blind spots", filesReached: ["a.py"], outsidePlan: { reaches: [], reachedBy: [] },
    contract: "## Thread contract (IR fact — auto-generated, do not edit)\nEnters: (no parameters)",
    constraints: "## Constraints for this thread (STATED — not IR fact; the source of each line is named)\n- [proxy · human-stated — authoritative] via nginx",
  }, "do the thing");
  assert.doesNotMatch(without, /Stack for this thread/);
  assert.doesNotMatch(without, /Never add a dependency/);
});

test("M-STACK.3: a SYSTEM packet worker gets the PROJECT stack — a new module is built with what exists", () => {
  const p = buildSystemWorkerPrompt({
    packetId: "x1", title: "migration module", rationale: "no thread owns it",
    files: ["telemetry/migrations.py"], existing: [], integrates: [], integrationContracts: [],
    stack: "## Project stack (IR fact — derived from imports, calls, includes and manifests; a DECISION about a tool is stated separately below)\n- database: telemetry.storage (project funnel wrapping sqlite3; 6 site(s) in 6 file(s))",
    constraints: null,
  }, "write the migration");
  assert.match(p, /## Project stack/);
  assert.match(p, /Build with the tools above/);
  assert.match(p, /a second HTTP client or a second database driver is a decision nobody took/);
});

// ── Quality layer: the closing bar rides the worker prompt ──────────────
test("quality layer: the closing bar computed at the objective gate is in the worker prompt, right after the task, and absent when none was computed", () => {
  const bundle = {
    entryPointId: "models.py:list_users", qualifiedName: "list_users", projection: "p", skill: null, blindSpots: "b",
    filesReached: ["models.py"], outsidePlan: { reaches: [], reachedBy: [] },
  };
  const withBar = buildWorkerPrompt({ ...bundle, closingBar: "inside models.py; re-parsed; nothing loosened; 1 advisory check(s) named, never rejecting; evidence derived+stated" }, "do the thing");
  assert.match(withBar, /YOUR PACKET TASK:\ndo the thing\n\nCLOSING BAR \(computed before you started, from the envelope; the review reads the same line\): inside models\.py; re-parsed/);
  const without = buildWorkerPrompt(bundle, "do the thing");
  assert.doesNotMatch(without, /CLOSING BAR/);
  const system = buildSystemWorkerPrompt({
    packetId: "x1", title: "notes", files: ["notes.py"], existing: [], rationale: "r", integrates: [], integrationContracts: [], constraints: null, stack: null, reviewer: "orchestrator",
    closingBar: "creates notes.py only",
  }, "create it");
  assert.match(system, /CLOSING BAR .*: creates notes\.py only/);
});
