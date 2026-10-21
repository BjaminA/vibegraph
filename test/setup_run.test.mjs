// The setup's "Run all" (2026-10-21, src/server/setup_run.ts): what Claude can
// run now, in the setup's order, and what waits for a person; a run takes each
// action once, reads the state again after each (a classification brings its
// package's spec into the same run), and stops where a decision is a person's.
// Walked on test/fixtures/setup/setup_demo with the actions faked: the real
// ones are the panels' own functions, each tested where it lives.
//
//   npm run test:setup-run
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvelope } from "../scripts/quality_check.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { setupState } from "../src/server/setup_state.ts";
import { addConstraint } from "../src/server/constraint_store.ts";
import { saveSpec } from "../src/server/software_store.ts";
import { runSetup, setupActions, setupRunSummary } from "../src/server/setup_run.ts";
import { softwareAddRun } from "../src/server/software_add.ts";

delete process.env.CLAUDECODE;
let base, root, stack;
const restack = () => { stack = buildStackIndex(loadEnvelope(root, null, {}, { cache: false }).envelope, root); };
before(() => {
  base = mkdtempSync(join(tmpdir(), "vg-setup-run-"));
  process.env.VG_CACHE_DIR = join(base, "cache");
  root = join(base, "setup_demo");
  cpSync("test/fixtures/setup/setup_demo", root, { recursive: true });
  restack();
});
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

const draft = (tool) => ({ version: "1", tool, role: "platform", definition: `The ${tool} SDK.`, definitionCite: null, status: "draft",
  identity: { packages: [tool], calls: [] }, operations: [], states: [], permissions: [], rules: [], sources: [] });

test("what Claude can run now, in the setup's order, and what waits for a person", () => {
  const p = setupActions(setupState(root, { stack }));
  assert.deepEqual(p.actions.map((a) => a.key), ["classify", "software:firebase", "software:redis", "groups", "rules", "census"]);
  assert.deepEqual(p.actions.filter((a) => !a.spends).map((a) => a.key), ["census"], "the census is the one step with no model call");
  assert.deepEqual(p.actions.find((a) => a.key === "software:firebase").urls, ["https://firebase.google.com/docs/firestore"], "the docs link the setup found, from the project's own README");
  assert.ok(p.waits.some((w) => /The Brief is written once the groups are ratified/.test(w)), p.waits.join("\n"));
  assert.ok(p.waits.some((w) => /init --hooks/.test(w)), "the hooks are a person's step, from a terminal");
});

test("a run takes each action once, reads the state after each, and ends saying what waits", async () => {
  const calls = [];
  const steps = [];
  const r = await runSetup({
    state: () => setupState(root, { stack }),
    classify: async () => {
      calls.push("classify");
      addConstraint(root, { kind: "stack-policy", text: "@acme/ledger-client, classified", scope: { stack: ["@acme/ledger-client"] }, note: "classified by test (agent — NOT human-reviewed)", policy: { tool: "@acme/ledger-client", role: "platform", rule: "describe" } }, "agent");
      return { ok: true, detail: "1 role proposed" };
    },
    software: async (tool) => { calls.push(`software:${tool}`); assert.equal(saveSpec(root, draft(tool)).error, undefined); return { ok: true, detail: `${tool}: a draft spec` }; },
    groups: async () => { calls.push("groups"); return { ok: true, detail: "3 groups proposed" }; },
    brief: async () => { calls.push("brief"); return { ok: true }; },
    rules: async () => { calls.push("rules"); return { ok: false, error: "the model returned nothing" }; },
    census: () => { calls.push("census"); return { ok: true, detail: "2 rule(s) the code follows" }; },
    settle: async () => restack(),
    step: (t) => steps.push(t),
  });
  assert.equal(calls[0], "classify");
  assert.ok(calls.includes("software:acme"), `the classification made @acme/ledger-client a candidate, specified in the same run: ${calls.join(", ")}`);
  assert.equal(new Set(calls).size, calls.length, "no action twice, even one the state still offers (groups stays to do here)");
  assert.ok(!calls.includes("brief"), "the Brief waits for the groups a person ratifies");
  assert.deepEqual(r.failed, [{ label: "Propose rules from the architecture", error: "the model returned nothing" }]);
  assert.equal(r.ran.length, calls.length - 1);
  assert.match(steps[0], /^1\. Classify the 1 package no table knows$/);
  assert.ok(r.waits.some((w) => /Ratify the drafted software spec/.test(w)), "the drafts wait for a person");
  assert.match(setupRunSummary(r), /^\d+ steps run, 1 failed, \d+ wait for you$/);
});

test("one step only, and a run with nothing to take says what waits", async () => {
  const calls = [];
  const fake = { state: () => setupState(root, { stack }), classify: async () => ({ ok: true }), software: async () => ({ ok: true }),
    groups: async () => { calls.push("groups"); return { ok: true }; }, brief: async () => ({ ok: true }), rules: async () => { calls.push("rules"); return { ok: true }; },
    census: () => ({ ok: true }), settle: async () => {}, step: () => {} };
  const r = await runSetup(fake, { only: "groups" });
  assert.deepEqual(calls, ["groups"]);
  assert.equal(r.ran.length, 1);
  const none = await runSetup({ ...fake, state: () => ({ steps: [{ id: "hooks", title: "Hooks", status: "todo", core: true, facts: [], commands: [], now: { text: "", panel: null } }], next: null, after: null, done: 0, of: 1, software: null }) });
  assert.equal(none.ok, false);
  assert.match(none.error, /^nothing for Claude to run now: Install the hooks from a terminal/);
});

test("a spec is drawn only from an http(s) docs link: never a file or another scheme", async () => {
  let asked = false;
  const run = async () => { asked = true; return "{}"; };
  for (const url of ["file:///etc/passwd", "/etc/passwd", "ftp://example.com/x"]) {
    const r = await softwareAddRun(root, "acme", [url], run, "test");
    assert.equal(r.ok, false);
    assert.match(r.error, /not an http\(s\) link/);
  }
  assert.equal(asked, false, "no model call when the docs cannot be read");
});
