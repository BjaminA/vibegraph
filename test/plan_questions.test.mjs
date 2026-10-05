// A plan's open questions are closed or dropped by a PERSON, kept on the
// record with when, who and why, and reopenable (2026-10-05). A dropped
// question used to be deleted; only open ones count against the cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyPlanOps } from "../src/server/plan_ops.ts";
import { validatePlan } from "../src/server/plan_store.ts";
import { looksAnswered } from "../src/shared/plan_types.ts";

const FIX = resolve("test/fixtures/plan/questions_demo");
const plan = () => JSON.parse(readFileSync(join(FIX, ".vibegraph", "plan.json"), "utf-8"));
const NOW = new Date("2026-10-05T10:00:00.000Z");

test("close and drop keep the question on the record, with rev, who, when and the note; reopen brings it back", () => {
  const r = applyPlanOps(plan(), [{ op: "close-question", id: "q2", note: "the provider API, confirmed by ops" }, { op: "drop", section: "open", id: "q9" }], "human", NOW);
  assert.equal(r.error, undefined, r.error);
  assert.deepEqual(r.plan.open.map((q) => q.id), ["q1", "q3", "q4", "q5", "q7", "q8", "q10"]);
  assert.deepEqual(r.plan.resolved.map((q) => [q.id, q.state, q.rev, q.by, q.note ?? null]), [
    ["q2", "closed", 7, "human", "the provider API, confirmed by ops"],
    ["q9", "dropped", 7, "human", null],
  ]);
  assert.deepEqual(r.plan.changelog.slice(-2).map((c) => c.change), ["close open q2 — the provider API, confirmed by ops", "drop open q9"]);
  const back = applyPlanOps(r.plan, [{ op: "reopen-question", id: "q9" }], "human", NOW);
  assert.ok(back.plan.open.some((q) => q.id === "q9" && !("state" in q)));
  assert.deepEqual(back.plan.resolved.map((q) => q.id), ["q2"]);
});

test("closing, dropping and reopening a question is a person's step", () => {
  for (const op of [{ op: "close-question", id: "q2" }, { op: "drop-question", id: "q2" }, { op: "drop", section: "open", id: "q2" }]) {
    assert.match(applyPlanOps(plan(), [op], "agent", NOW).error, /only a person closes or drops a question/);
  }
  const closed = applyPlanOps(plan(), [{ op: "close-question", id: "q2" }], "human", NOW).plan;
  assert.match(applyPlanOps(closed, [{ op: "reopen-question", id: "q2" }], "agent", NOW).error, /only a person reopens/);
  assert.match(applyPlanOps(closed, [{ op: "close-question", id: "q2" }], "human", NOW).error, /already closed or dropped/);
});

test("only OPEN questions count against the cap; a new question never reuses a closed one's id", () => {
  const p = plan();
  const ten = applyPlanOps(p, [{ op: "add", section: "open", item: { text: "One more?" } }], "human", NOW).plan;
  assert.equal(ten.open.length, 10);
  assert.match(applyPlanOps(ten, [{ op: "add", section: "open", item: { text: "An eleventh?" } }], "human", NOW).error, /over the cap of 10/);
  const freed = applyPlanOps(ten, [{ op: "close-question", id: "q2" }, { op: "add", section: "open", item: { text: "An eleventh?" } }], "human", NOW).plan;
  assert.equal(freed.open.length, 10);
  assert.equal(freed.resolved.length, 1);
  assert.ok(!freed.open.some((q) => q.id === "q2"), "q2 stays the closed one's id");
  assert.match(applyPlanOps(freed, [{ op: "reopen-question", id: "q2" }], "human", NOW).error, /over the cap of 10/, "reopening is capped too");
  assert.equal(validatePlan(freed), null);
});

test("a question may carry its answer: up to 1,200 characters; 'ANSWERED …' is read as a passive tag", () => {
  const p = plan();
  assert.equal(validatePlan({ ...p, open: [{ id: "q1", text: "x".repeat(1200) }] }), null);
  assert.match(validatePlan({ ...p, open: [{ id: "q1", text: "x".repeat(1201) }] }), /at most 1200 characters/);
  assert.equal(looksAnswered({ text: "ANSWERED (2026-10-01): yes" }), "answered");
  assert.equal(looksAnswered({ text: "  PARTLY ANSWERED: some" }), "partly");
  assert.equal(looksAnswered({ text: "Is it answered?" }), null);
});

test("the CLI: plan close / drop / reopen open qN with --note; refused from Claude Code; plan show lists them", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-q-"));
  try {
    cpSync(FIX, dir, { recursive: true });
    const cli = (args, env = {}) => {
      try { return { code: 0, out: execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", resolve("scripts/cli/main.mjs"), ...args], { cwd: dir, encoding: "utf-8", env: { ...process.env, CLAUDECODE: "", ...env }, stdio: ["ignore", "pipe", "pipe"] }) }; }
      catch (e) { return { code: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
    };
    assert.equal(cli(["plan", "close", "open", "q5", "--note", "UUIDv7, per the API owner"]).code, 0);
    assert.equal(cli(["plan", "drop", "open", "q10"]).code, 0);
    const refused = cli(["plan", "drop", "open", "q3"], { CLAUDECODE: "1" });
    assert.equal(refused.code, 1);
    assert.match(refused.out, /refused: `plan drop open`/);
    const saved = JSON.parse(readFileSync(join(dir, ".vibegraph", "plan.json"), "utf-8"));
    assert.deepEqual(saved.resolved.map((q) => [q.id, q.state, q.note ?? null]), [["q5", "closed", "UUIDv7, per the API owner"], ["q10", "dropped", null]]);
    const shown = cli(["plan", "show"]).out;
    assert.match(shown, /## Closed and dropped questions/);
    assert.match(shown, /\*\*q10\*\* dropped at rev 8 by human/);
    assert.equal(cli(["plan", "reopen", "open", "q10"]).code, 0);
    assert.ok(JSON.parse(readFileSync(join(dir, ".vibegraph", "plan.json"), "utf-8")).open.some((q) => q.id === "q10"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
