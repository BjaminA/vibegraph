// TOOL CLASSIFICATIONS ARE NOT RULES (2026-10-17, from a field run): a
// `describe` policy — what `classify` writes — files a tool and decides
// nothing. A project with 22 of them had every hooked session told "Stated
// rules (22) — from the people who run this code", constraints.md full of
// "clsx is classified as frontend", and the Inbox one decision per tool. Each
// rule surface is pinned here: the prompt block, the session orientation, the
// Inbox, the rule count, the skill rules block, and constraints.md's own
// section for them.
//
//   npm run test:rule-surfaces
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatConstraintsBlock, formatClassificationsBlock, isClassification, statedRules } from "../src/server/constraint_store.ts";
import { buildInbox } from "../src/server/inbox.ts";
import { framingFacts } from "../src/server/hooked_framing.ts";
import { skillRulesBlock } from "../src/server/thread_skill_stamp.ts";
import { orientation } from "../scripts/cli/orientation.mjs";

const filed = (id, tool, role, source = "agent") => ({ id, kind: "stack-policy", text: `${tool} is classified as ${role}`, scope: { stack: [tool] }, source, createdAt: "2026-10-17T00:00:00.000Z", policy: { tool, rule: "describe", role } });
const rule = { id: "c1", kind: "invariant", text: "the credits database has no user grants at all", scope: { all: true }, source: "human", createdAt: "2026-10-17T00:00:00.000Z" };
const list = [rule, filed("c2", "clsx", "utility"), filed("c3", "zip", "utility"), filed("c4", "bc", "utility", "human")];

let root;
before(() => {
  root = mkdtempSync(join(tmpdir(), "vg-surfaces-"));
  mkdirSync(join(root, ".vibegraph"));
  writeFileSync(join(root, ".vibegraph", "constraints.json"), JSON.stringify({ version: "1", constraints: list }, null, 2));
});
after(() => rmSync(root, { recursive: true, force: true }));

test("the predicate and the filter", () => {
  assert.equal(isClassification(list[1]), true);
  assert.equal(isClassification(rule), false);
  assert.equal(isClassification({ policy: { rule: "forbid" } }), false);
  assert.deepEqual(statedRules(list).map((c) => c.id), ["c1"]);
});

test("a prompt's rule block carries rules only; classifications alone make no block", () => {
  const block = formatConstraintsBlock(list);
  assert.match(block, /no user grants/);
  assert.doesNotMatch(block, /classified as/);
  assert.equal(formatConstraintsBlock(list.slice(1)), null);
  assert.doesNotMatch(skillRulesBlock(list), /classified as/);
  assert.equal(skillRulesBlock(list.slice(1)), "", "a thread with only classifications routed stamps as if no rules routed");
});

test("constraints.md lists them apart, one line each, saying who filed them", () => {
  const md = formatClassificationsBlock(list);
  assert.match(md, /^## Tool classifications \(3\) — not rules/);
  assert.match(md, /`clsx` — .*\(c2, agent-stated, not reviewed\)/);
  assert.match(md, /`bc` — .*\(c4, human-stated\)/);
  assert.equal(formatClassificationsBlock([rule]), null);
});

test("the session orientation counts and lists rules only", () => {
  const text = orientation(root, { envelope: { files: {}, entryPoints: [], threads: [] } }, list);
  assert.match(text, /Stated rules \(1\)/);
  assert.match(text, /no user grants/);
  assert.doesNotMatch(text, /classified as/);
});

test("the Inbox: one line for the agent's classifications, not a decision each; the rule count ignores them", () => {
  const inbox = buildInbox(root);
  const lines = inbox.filter((i) => i.id === "classifications");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].decidable, false);
  assert.match(lines[0].title, /^2 tool classifications by an agent/);
  assert.ok(!inbox.some((i) => i.id === "rule:c2" || i.id === "rule:c3"));
  assert.equal(framingFacts(root).rules, 1);
});
