// M-GF3.4 — the stage-revision contract.
//
// parseReviseStageBlock: extracts the LAST ```vg-revise-stage fenced JSON
//   block from a dialogue turn; malformed JSON / wrong shapes / empty
//   revisions parse to null (never a throw, never a partial).
// applyItemRevision: immutable apply through the validateBuildPlan boundary —
//   foundation-first needs stay structural (a revision can't need a LATER
//   stage), built/drafting/gated stages refuse honestly, groundedIn rides
//   through unchanged, and a revised failed/skipped stage RE-QUEUES
//   (pending, failReason cleared) so Resume run picks it up again.
//
// Run: npm run test:build-plan-modify

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReviseStageBlock, applyItemRevision } from "../src/server/build_plan_modify.ts";

const plan = () => ({
  version: "1",
  description: "a CNN classifier over CSV signal windows",
  items: [
    { id: "parsing", capability: "pure CSV parsing", needs: [], groundedIn: "CSV signal windows", status: "pending" },
    { id: "model", capability: "two-Conv1d CNN", needs: [], groundedIn: null, status: "pending" },
    { id: "training", capability: "minibatch training loop", needs: ["parsing", "model"], groundedIn: "a CNN classifier", status: "pending" },
  ],
  drafted: true,
  ratifiedAt: "2026-07-17T00:00:00.000Z",
});

// ── parseReviseStageBlock ───────────────────────────────────────────────

test("parses a fenced revise block (capability only)", () => {
  const text = 'Sure.\n```vg-revise-stage\n{"capability": "three-Conv1d CNN"}\n```\n';
  assert.deepEqual(parseReviseStageBlock(text), { capability: "three-Conv1d CNN" });
});

test("parses needs; dedupes; takes the LAST block when several appear", () => {
  const text = [
    "First thought:",
    '```vg-revise-stage\n{"capability": "old"}\n```',
    "Actually, better:",
    '```vg-revise-stage\n{"capability": "new", "needs": ["parsing", "parsing", "model"]}\n```',
  ].join("\n");
  assert.deepEqual(parseReviseStageBlock(text), { capability: "new", needs: ["parsing", "model"] });
});

test("prose without a block, malformed JSON, wrong shapes, empty revisions → null", () => {
  assert.equal(parseReviseStageBlock("just discussion, no block"), null);
  assert.equal(parseReviseStageBlock("```vg-revise-stage\nnot json\n```"), null);
  assert.equal(parseReviseStageBlock("```vg-revise-stage\n[1,2]\n```"), null);
  assert.equal(parseReviseStageBlock('```vg-revise-stage\n{"capability": ""}\n```'), null);
  assert.equal(parseReviseStageBlock('```vg-revise-stage\n{"needs": [1]}\n```'), null);
  assert.equal(parseReviseStageBlock("```vg-revise-stage\n{}\n```"), null);
});

// ── applyItemRevision ───────────────────────────────────────────────────

test("applies a capability revision immutably; groundedIn/status ride through", () => {
  const p = plan();
  const res = applyItemRevision(p, "model", { capability: "three-Conv1d CNN" });
  assert.equal(res.ok, true);
  assert.equal(res.item.capability, "three-Conv1d CNN");
  assert.equal(res.item.groundedIn, null);
  assert.equal(res.item.status, "pending");
  assert.equal(p.items[1].capability, "two-Conv1d CNN"); // original untouched
  assert.equal(res.plan.items[1].capability, "three-Conv1d CNN");
});

test("a revision may drop needs (empty array)", () => {
  const res = applyItemRevision(plan(), "training", { needs: [] });
  assert.equal(res.ok, true);
  assert.deepEqual(res.item.needs, []);
});

test("foundation-first stays structural: needing a LATER stage refuses", () => {
  const res = applyItemRevision(plan(), "model", { needs: ["training"] });
  assert.equal(res.ok, false);
  assert.match(res.error, /earlier|later|before|declared/i);
});

test("unknown stage and unknown need ids refuse", () => {
  assert.equal(applyItemRevision(plan(), "nope", { capability: "x" }).ok, false);
  assert.equal(applyItemRevision(plan(), "model", { needs: ["nope"] }).ok, false);
});

test("built / drafting / gated stages refuse honestly; failed and skipped revise", () => {
  for (const [status, ok] of [["built", false], ["drafting", false], ["gated", false], ["failed", true], ["skipped", true]]) {
    const p = plan();
    p.items[1].status = status;
    const res = applyItemRevision(p, "model", { capability: "revised" });
    assert.equal(res.ok, ok, `status=${status}`);
    if (!ok) assert.match(res.error, new RegExp(status === "built" ? "built" : status));
  }
});

test("revising a failed stage re-queues it: pending, failReason cleared", () => {
  const p = plan();
  p.items[1].status = "failed";
  p.items[1].failReason = 'drafted changeset failed validation: files[1]: duplicate path "data.py"';
  const res = applyItemRevision(p, "model", { capability: "one data.py holding load AND target_stats" });
  assert.equal(res.ok, true);
  assert.equal(res.item.status, "pending");
  assert.equal(res.item.failReason, undefined);
  // Skipped stages re-queue the same way — the revision is an explicit re-aim.
  const p2 = plan();
  p2.items[1].status = "skipped";
  const res2 = applyItemRevision(p2, "model", { needs: ["parsing"] });
  assert.equal(res2.ok, true);
  assert.equal(res2.item.status, "pending");
});
