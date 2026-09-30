// Software specs, second pass (2026-09-30, from a real spec's hand edit):
// core rules (what a session is always told) vs the rest; unknowns (what the
// docs do not say); sequence vs choice; checks that must aim at the tool;
// `software edit` / `rule` / `unknown` with provenance; a changed spec rule
// reaching the plan; and the CLAUDECODE guard on a person's steps.
//
//   npm run test:software-edit
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runSoftware } from "../scripts/cli/software.mjs";
import { runPlan } from "../scripts/cli/plan.mjs";
import { runHook } from "../scripts/cli/hooks.mjs";
import { loadSpec, specFile } from "../src/server/software_store.ts";
import { formatSpecMd } from "../src/server/software_apply.ts";
import { loadPlan } from "../src/server/plan_store.ts";
// These tests act as a PERSON unless they set CLAUDECODE themselves.
delete process.env.CLAUDECODE;

const FIXTURE = "test/fixtures/software/sw_demo";
const CLI = resolve("scripts/cli/main.mjs");
let tmp, cache;
before(() => { tmp = mkdtempSync(join(tmpdir(), "vg-swe-")); cache = mkdtempSync(join(tmpdir(), "vg-swe-cache-")); process.env.VG_CACHE_DIR = cache; });
after(() => { rmSync(tmp, { recursive: true, force: true }); rmSync(cache, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

const sw = (root, ...args) => runSoftware([...args, "--root", root]);
/** A copy of the fixture with a spec drafted from `reply` (default: the fixture's). */
async function withSpec(name, reply) {
  const root = join(tmp, name);
  cpSync(FIXTURE, root, { recursive: true });
  let file = join(root, "docs/reply.json");
  if (reply) { file = join(root, "docs/reply2.json"); writeFileSync(file, JSON.stringify(reply)); }
  const r = await sw(root, "add", "ledgerbox", "--from", join(root, "docs/ledgerbox.md"), "--reply", file);
  assert.equal(r.exitCode, 0, r.text);
  return { root, text: r.text };
}
const base = JSON.parse(readFileSync(join(FIXTURE, "docs/reply.json"), "utf-8").replace(/^[^`]*```json\s*|```\s*$/g, ""));

test("drafting: core rules capped at 8, unknowns kept, choices said apart, a check aimed off the tool dropped", async () => {
  const reply = structuredClone(base);
  reply.states.push({ of: "root type", kind: "choice", values: ["map", "array", "text", "blob"], cite: "Use put_blob to store a binary payload under a key" });
  reply.rules = [
    { text: "Call wait_ready before get_blob", why: `a blob is readable only once it is READY${".".repeat(300)}`.slice(0, 300), core: true, cite: "Always call wait_ready before calling get_blob",
      check: { rule: "calls-through", target: "*.get_blob", through: "{wait_ready}" } },
    { text: "Deploy with the ledgerbox CLI", why: "the CLI sets up permissions", cite: "and ledger:write to write", check: { rule: "callers-only", target: "ledgerbox-cli", files: ["deploy/"] } },
    ...Array.from({ length: 9 }, (_, i) => ({ text: `Rule ${i}`, why: "because", core: true, cite: "Empty payloads are never written to the store", check: null })),
  ];
  reply.unknowns = [{ question: "Which JSON Schema version does a document schema follow?", mattersFor: "validating documents" }];
  const { root, text } = await withSpec("draft", reply);
  const spec = loadSpec(root, "ledgerbox");
  assert.equal(spec.rules[0].why.length, 300, "a longer why is kept");
  assert.deepEqual(spec.rules[1].check, null);
  assert.match(text, /dropped: the check on rule s2 — its target "ledgerbox-cli" is not one of the tool's operations \(a check that proves less than its rule gives a false pass\)/);
  assert.equal(spec.rules.filter((r) => r.core).length, 8, "at most 8 core");
  assert.deepEqual(spec.unknowns, [{ id: "u1", question: "Which JSON Schema version does a document schema follow?", mattersFor: "validating documents" }]);
  const md = formatSpecMd(spec);
  assert.match(md, /- root type \(choose one\): map \| array \| text \| blob/);
  assert.match(md, /- blob \(in order\): DRAFT → ANNOUNCED → READY/);
  assert.match(md, /## What the docs do not say[\s\S]*\*\*u1\*\* Which JSON Schema version/);
});

test("the hooks send the core rules and the unknowns — the rest is on demand", async () => {
  const reply = structuredClone(base);
  reply.rules = [
    { text: "Call wait_ready before get_blob", why: "readable only once READY", core: true, cite: "Always call wait_ready before calling get_blob", check: null },
    { text: "Never write an empty payload", why: "nothing is stored", cite: "Empty payloads are never written to the store", check: null },
  ];
  reply.unknowns = [{ question: "Can a connection be read-only?" }];
  const { root } = await withSpec("hooks", reply);
  await sw(root, "ratify", "ledgerbox");
  execFileSync("git", ["init", "-q"], { cwd: root });
  const ctx = runHook("prompt", { session_id: "h", prompt: "change load in app.py please" }, { absRoot: root, pipeline: {} })?.json?.hookSpecificOutput?.additionalContext ?? "";
  assert.match(ctx, /Its core rules: s1 Call wait_ready before get_blob \(why: readable only once READY\)\. \(\+1 more rule in the full spec\.\)/);
  assert.doesNotMatch(ctx, /Never write an empty payload/);
  assert.match(ctx, /The docs do NOT say — do not assume: u1 Can a connection be read-only\?/);
});

test("editing: a person's edit keeps it ratified and marks what they stated; a bad quote writes nothing", async () => {
  const { root } = await withSpec("edit");
  await sw(root, "ratify", "ledgerbox");
  const r = await sw(root, "rule", "add", "ledgerbox", "--text", "One schema per top-level shared type", "--why", "the schema name must match the root it describes", "--core");
  assert.equal(r.exitCode, 0, r.text);
  assert.match(r.text, /rule s4 added — still ratified \(a person's edit\)/);
  let spec = loadSpec(root, "ledgerbox");
  assert.equal(spec.status, "ratified");
  assert.deepEqual(spec.rules.at(-1), { id: "s4", text: "One schema per top-level shared type", why: "the schema name must match the root it describes", cite: null, check: null, core: true, by: "human" });
  assert.match(formatSpecMd(spec), /\*\*s4\*\* \*\(core\)\* One schema per top-level shared type — \*why:\* .* — STATED by a person — not in the docs/);
  assert.match((await sw(root, "unknown", "add", "ledgerbox", "--question", "Is $ref supported?", "--matters", "splitting schemas")).text, /unknown u1 added/);
  const before = readFileSync(join(root, specFile("ledgerbox")), "utf-8");
  const bad = await sw(root, "rule", "update", "ledgerbox", "--id", "s1", "--cite", "Always call wait_ready first, then get_blob");
  assert.equal(bad.exitCode, 1);
  assert.match(bad.text, /refused, nothing written: these quotes are not in the saved documents: rule s1/);
  assert.equal(readFileSync(join(root, specFile("ledgerbox")), "utf-8"), before, "nothing written");
  spec = loadSpec(root, "ledgerbox");
  assert.match(spec.changes.map((c) => c.change).join(" | "), /rule s4 added \| unknown u1 added/);
});

test("a spec rule changed after it entered the plan is updated there, back to proposed", async () => {
  const { root } = await withSpec("replan");
  await sw(root, "ratify", "ledgerbox");
  runPlan(["init", "A service that stores readings in LedgerBox", "--root", root]);
  await sw(root, "plan", "ledgerbox", "--param", "wait_ready=wait_ready");
  runPlan(["agree", "policies", "p2", "--root", root]);
  assert.equal(loadPlan(root).policies[1].status, "agreed");
  await sw(root, "rule", "update", "ledgerbox", "--id", "s2", "--why", "an empty payload is never stored, so the write silently does nothing and the reader waits forever");
  const r = await sw(root, "plan", "ledgerbox", "--param", "wait_ready=wait_ready");
  assert.match(r.text, /update policies p2/);
  const p2 = loadPlan(root).policies[1];
  assert.equal(p2.status, "proposed", "the person agreed to the old words");
  assert.match(p2.why, /the reader waits forever/);
  assert.match((await sw(root, "plan", "ledgerbox", "--param", "wait_ready=wait_ready")).text, /already in the plan, up to date/);
});

test("run by Claude Code (CLAUDECODE=1): a person's steps are refused; the rest are recorded as the model's", async () => {
  const { root } = await withSpec("guard");
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf-8", env: { ...process.env, CLAUDECODE: "1", NODE_NO_WARNINGS: "1" } });
  for (const args of [["software", "ratify", "ledgerbox"], ["plan", "init", "An objective"], ["init", "--remove-hooks"], ["constraints", "ratify", "c1"], ["skills", "ratify", "app.py:load"]]) {
    const r = run(...args);
    assert.equal(r.status, 1, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /refused: .* this is a person's step, and Claude Code is running this command/);
  }
  runPlan(["init", "A service that stores readings in LedgerBox", "--root", root]); // the person
  assert.equal(run("plan", "edit", JSON.stringify({ op: "set-objective", text: "Something else entirely" })).status, 0);
  assert.equal(loadPlan(root).objective, "A service that stores readings in LedgerBox");
  assert.match(loadPlan(root).open[0].text, /^Proposed objective: Something else entirely/);
  const c = run("constraints", "add", "--kind", "invariant", "--all", "--text", "Every write goes through store.py");
  assert.match(c.stdout, /stated c1 \(agent — a person ratifies it/);
  // A ratified spec edited by the model goes back to draft.
  await sw(root, "ratify", "ledgerbox");
  const e = run("software", "rule", "update", "ledgerbox", "--id", "s1", "--why", "a model's rewording");
  assert.equal(e.status, 0, e.stderr);
  const spec = loadSpec(root, "ledgerbox");
  assert.equal(spec.status, "draft");
  assert.equal(spec.rules[0].by, "agent");
  assert.match(spec.changes.at(-1).change, /back to DRAFT: a model edited it/);
});
