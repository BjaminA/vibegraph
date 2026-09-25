// M-CRYSTAL.2 — src/server/thread_skill_stamp.ts, the ONE thread-skill
// stamp as a pure function. Pins: a thread with no routed rules stamps
// exactly sourceHashOf(ir) (additive — nothing stales for a feature a
// project does not use); routed rules give a composite that moves when a
// rule's text moves and when the thread moves; the rules block is
// byte-for-byte the text server.ts stamped before the module existed, so
// every skill ratified before M-CRYSTAL reads as it did.
//
//   npm run test:skill-stamp
import { test } from "node:test";
import assert from "node:assert/strict";
import { skillRulesBlock, threadSkillStamp } from "../src/server/thread_skill_stamp.ts";
import { sourceHashOf } from "../src/server/readme_store.ts";

const ir = { entryPointId: "telemetry/alerts.py:evaluate", seed: { file: "telemetry/alerts.py" }, nodes: [{ id: "module/evaluate.fn", kind: "seed" }], edges: [] };
const c3 = {
  id: "c3", kind: "invariant", source: "human", createdAt: "2026-09-07T09:00:00.000Z", scope: { files: ["telemetry/"] },
  text: "Operators are paged ONLY through alerts.notify, and only after alerts.should_notify has applied its 5-minute dedup.",
  check: { rule: "calls-through", target: "notify", through: "should_notify" },
};

test("no routed rules: the block is empty and the stamp is the bare IR hash (additive)", () => {
  assert.equal(skillRulesBlock([]), "");
  assert.equal(threadSkillStamp(ir, ""), sourceHashOf(ir));
  assert.equal(threadSkillStamp(null, "anything"), "", "a missing thread stamps nothing");
});

test("the rules block is the exact pre-module server text, with the checkable half described", () => {
  const block = skillRulesBlock([c3]);
  const lines = block.split("\n");
  assert.equal(lines[0], "");
  assert.equal(lines[1], "STATED RULES that govern this thread (human/orchestrator decisions, NOT read from the code —");
  assert.equal(lines[2], "the code cannot say why they exist, which is exactly why they must survive in this skill):");
  assert.ok(lines[3].startsWith("- [c3, human-stated, invariant] Operators are paged ONLY through alerts.notify"));
  assert.match(lines[4], /^ {2}\(machine-checkable: .*should_notify.*\)$/);
});

test("routed rules give a composite stamp that moves with the rule and with the thread", () => {
  const block = skillRulesBlock([c3]);
  const stamp = threadSkillStamp(ir, block);
  assert.equal(stamp, `${sourceHashOf(ir)}|${sourceHashOf({ rules: block })}`);
  const reworded = skillRulesBlock([{ ...c3, text: c3.text + " (amended)" }]);
  assert.notEqual(threadSkillStamp(ir, reworded), stamp, "a changed rule stales the skill");
  const moved = { ...ir, nodes: [...ir.nodes, { id: "module/evaluate.fn/notify.call", kind: "step" }] };
  assert.notEqual(threadSkillStamp(moved, block), stamp, "a changed thread stales the skill");
  assert.equal(threadSkillStamp(ir, skillRulesBlock([c3])), stamp, "and the same inputs stamp the same, every time");
});

test("a Run 1 verb in the checkable half is described too, never left as an unknown shape", () => {
  const block = skillRulesBlock([{ ...c3, check: { rule: "guards", target: "notify", guard: "should_notify" } }]);
  assert.match(block, /\(machine-checkable: (?!unknown check shape)/);
});
