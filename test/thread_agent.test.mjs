/**
 * D1 (PLAN-v6) — thread-agent prompt assembly + escalation detection.
 *
 * The anti-drift contract, pinned: the prompt bounds the agent to one thread
 * (projection + skill + blind-spots + adjacency) and carries the escalation
 * rule; isEscalation recognises an honest refusal.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/thread_agent.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildThreadAgentPrompt, isEscalation, ESCALATE_PREFIX, renderAgentProjection, PROJECTION_MAX } from "../src/server/thread_agent.ts";

const bundle = {
  entryPointId: "app.py:create_user_route",
  qualifiedName: "app:create_user_route",
  projection: "- seed: create_user_route `module/create_user_route.fn`",
  skill: null,
  blindSpots: "## Not statically known\nresolutionGaps: User",
  filesReached: ["app.py", "models.py"],
  reaches: ["models.py:create_user"],
  reachedBy: [],
};

test("the prompt bounds the agent to its thread and carries the escalation rule", () => {
  const p = buildThreadAgentPrompt(bundle, "explain what this route does");
  assert.match(p, /scoped to ONE code thread/);
  assert.match(p, /app:create_user_route/);
  assert.match(p, /DELIBERATELY BOUNDED/);
  assert.match(p, /create_user_route\.fn/);          // projection
  assert.match(p, /Not statically known/);            // blind spots
  assert.match(p, /reaches: models\.py:create_user/); // adjacency
  assert.match(p, new RegExp(ESCALATE_PREFIX));
  assert.match(p, /Task:\nexplain what this route does/);
});

test("a ratified skill is injected when present; omitted when null", () => {
  const withSkill = buildThreadAgentPrompt({ ...bundle, skill: "## Purpose\nCreates a user." }, "x");
  assert.match(withSkill, /Human-ratified thread skill/);
  assert.match(withSkill, /Creates a user\./);
  const noSkill = buildThreadAgentPrompt(bundle, "x");
  assert.ok(!/Human-ratified thread skill/.test(noSkill));
});

// 2026-07-30 sitting: an agent reported synthetic runs, a real training run
// and a caller grep — none of which happened (the artifact the run would have
// written was still an hour old). The prompt had never told it that it cannot
// execute, and the blind-spots heading said "read source / run / ask".
test("the prompt forbids executing AND forbids claiming execution", () => {
  const p = buildThreadAgentPrompt(bundle, "add early stopping");
  assert.match(p, /cannot run code, execute tests, read files, or search the project/);
  assert.match(p, /Never claim, or imply, that you ran, tested, executed, benchmarked, or grepped/);
  // The unverified-but-labelled answer is the sanctioned output.
  assert.match(p, /state it as an expectation and name the check a human should run/);
  // The blind-spots block must not invite the three things it cannot do.
  assert.ok(
    !/read source \/ run \/ ask/.test(p),
    "the blind-spots heading must not offer running as an option",
  );
  assert.match(p, /You cannot resolve these yourself/);
});

test("isEscalation recognises an honest boundary refusal", () => {
  assert.equal(isEscalation(`${ESCALATE_PREFIX} needs thread db.py:query`), true);
  assert.equal(isEscalation(`\n  ${ESCALATE_PREFIX} needs file x.py`), true, "leading whitespace ok");
  assert.equal(isEscalation("Here is the answer: it creates a user."), false);
  assert.equal(isEscalation(null), false);
});

// ── projection rendering (2026-08-04 sitting) ─────────────────────────
//
// A `train:train` agent was handed `[+6 nested]` for the model's layer stack
// and invented its decomposition ("3 Linear + 3 activations" — it is 3 Linear
// + 2 ReLU + 1 Dropout), while separately calling "which activations" an
// unresolvable blind spot. Both labels were in the IR. A count is not a fact
// an agent can reason from.

const nested = (labels) => ({
  kind: "step", label: "WineQualityRegressor", irNodeId: "module/WineQualityRegressor.class",
  file: "model.py", nestedCollapsed: labels.length, nestedLabels: labels,
});

test("collapsed nests are NAMED, not just counted", () => {
  const out = renderAgentProjection([
    nested(["nn.Linear", "nn.ReLU", "nn.Linear", "nn.ReLU", "nn.Linear", "nn.Dropout"]),
  ]);
  assert.match(out, /nn\.Linear ×3/, "repeated layers report their occurrence count");
  assert.match(out, /nn\.ReLU ×2/);
  assert.match(out, /nn\.Dropout/, "the dropout must be visible — it was read as a third activation");
  assert.doesNotMatch(out, /\[\+6 nested\]/, "the bare count must not survive");
});

test("a nest with no resolvable labels says so instead of implying names", () => {
  const out = renderAgentProjection([
    { kind: "step", label: "opaque", irNodeId: "module/opaque.fn", nestedCollapsed: 4, nestedLabels: [] },
  ]);
  assert.match(out, /4 unnamed/, "an unresolvable nest is honestly unnamed, never silently empty");
});

test("uncaptured and nested stay DISTINCT axes on one node", () => {
  const out = renderAgentProjection([
    { kind: "step", label: "both", nestedCollapsed: 1, nestedLabels: ["f"], uncaptured: true },
  ]);
  assert.match(out, /\[nests: f\]/);
  assert.match(out, /\[hides calls not in IR\]/);
});

test("truncation is ANNOUNCED, never silent", () => {
  // train:train sits at exactly 40 eligible nodes — one step from a silent cut.
  const many = Array.from({ length: 46 }, (_, i) => ({ kind: "external", label: `call${i}` }));
  const out = renderAgentProjection(many);
  const shown = out.split("\n").filter((l) => /^- external:/.test(l));
  assert.equal(shown.length, PROJECTION_MAX, "the cap still bounds the prompt");
  assert.match(out, /TRUNCATED: 6 more steps of 46 are NOT shown/,
    "the cut must state how much is missing and out of how many");
  assert.match(out, /INCOMPLETE/, "and warn against reasoning from the absence of later steps");
});

test("a projection at exactly the cap is NOT marked truncated", () => {
  const exact = Array.from({ length: PROJECTION_MAX }, (_, i) => ({ kind: "external", label: `c${i}` }));
  assert.doesNotMatch(renderAgentProjection(exact), /TRUNCATED/, "off-by-one: 40 of 40 is complete");
});
