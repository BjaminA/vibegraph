// SOFTWARE SPECS (2026-09-30): a tool's documents crystallised into
// .vibegraph/software/<tool>.json behind a citation gate, ratified by a
// person, then used by the stack index, the plan, the checks and the hooks.
// The fixture is a made-up tool (LedgerBox) with its own doc page, a saved
// model reply that fabricates two quotes and infers one rule, and a service
// with one reader that waits for READY and one that does not.
//
//   npm run test:software
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runSoftware, readFrom } from "../scripts/cli/software.mjs";
import { runPlanDraft } from "../scripts/cli/plan_draft.mjs";
import { runPlan } from "../scripts/cli/plan.mjs";
import { runHook } from "../scripts/cli/hooks.mjs";
import { runConstraintChecks } from "../scripts/cli/check.mjs";
import { exportKnowledge } from "../scripts/export_knowledge.mjs";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { loadSpec, specFile } from "../src/server/software_store.ts";
import { specUsage } from "../src/server/software_apply.ts";
import { loadPlan } from "../src/server/plan_store.ts";
import { softwareToolText } from "../src/server/software_server.ts";
import { checkConstraint } from "../src/server/constraint_grammar.ts";
import { buildQualityFacts } from "../src/server/quality/facts.ts";

const FIXTURE = "test/fixtures/software/sw_demo";
let tmp, cache;
const copy = (name) => { const d = join(tmp, name); cpSync(FIXTURE, d, { recursive: true }); return d; };
const sw = (root, ...args) => runSoftware([...args, "--root", root]);
async function drafted(name) {
  const root = copy(name);
  const r = await sw(root, "add", "ledgerbox", "--from", join(root, "docs/ledgerbox.md"), "--reply", join(root, "docs/reply.json"));
  assert.equal(r.exitCode, 0, r.text);
  return { root, text: r.text };
}
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "vg-sw-"));
  cache = mkdtempSync(join(tmpdir(), "vg-sw-cache-"));
  process.env.VG_CACHE_DIR = cache;
});
after(() => { rmSync(tmp, { recursive: true, force: true }); rmSync(cache, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

test("the citation gate: a quote not in the docs drops its item; no quote keeps it, labelled inferred", async () => {
  const { root, text } = await drafted("gate");
  assert.match(text, /2 dropped \(quote not in the documents\), 1 inferred/);
  assert.match(text, /dropped: operation delete_entry — its quote is not in the sources/);
  assert.match(text, /dropped: rule s4 \(Sign every entry\)/);
  const spec = loadSpec(root, "ledgerbox");
  assert.equal(spec.status, "draft");
  assert.deepEqual(spec.operations.map((o) => o.name), ["put_blob", "get_blob", "append_entry"]);
  assert.deepEqual(spec.rules.map((r) => [r.id, r.cite === null]), [["s1", false], ["s2", false], ["s3", true]], "renumbered after the drop; s3 inferred");
  assert.ok(existsSync(join(root, ".vibegraph/software", spec.sources[0].saved)), "the source text is kept, so quotes stay checkable");
  const dry = await sw(root, "add", "ledgerbox", "--from", join(root, "docs/ledgerbox.md"), "--dry-run");
  assert.match(dry.text, /^\(dry run — nothing spent, nothing saved\)/);
  assert.match(dry.text, /EXACT quote copied from a source/);
});

test("a draft is used nowhere; ratifying re-checks every quote, and refuses one edited by hand", async () => {
  const { root } = await drafted("ratify");
  const env = buildPolyglotEnvelope(root, { skipSystem: true }).envelope;
  assert.notEqual(buildStackIndex(env, root).tools.find((t) => t.tool === "ledgerbox")?.role, "db", "a draft states nothing");
  const file = join(root, specFile("ledgerbox"));
  const good = readFileSync(file, "utf-8");
  writeFileSync(file, good.replace("get_blob returns the payload for a key", "get_blob returns the payload for any key, fast"));
  assert.match((await sw(root, "ratify", "ledgerbox")).text, /not in the saved sources: operation get_blob/);
  writeFileSync(file, good);
  assert.match((await sw(root, "ratify", "ledgerbox")).text, /ratified ledgerbox \(with 1 inferred item/);
  const tool = buildStackIndex(env, root).tools.find((t) => t.tool === "ledgerbox");
  assert.equal(tool.role, "db");
  assert.equal(tool.roleStatedBy, "software:ledgerbox", "the role carries where it came from");
});

test("where the code uses it: the import, and every call that is one of its operations", async () => {
  const { root } = await drafted("usage");
  const env = buildPolyglotEnvelope(root, { skipSystem: true }).envelope;
  const u = specUsage(loadSpec(root, "ledgerbox"), env.files);
  assert.deepEqual(u.imports, ["app.py"]);
  assert.deepEqual(u.calls.map((c) => `${c.operation}:${c.does}:${c.line}`), ["put_blob:write:11", "get_blob:read:15", "get_blob:read:20"], "a returned call counts too");
});

test("into the plan: its rules become planned rules; with the project's names, the check finds the reader that does not wait", async () => {
  const { root } = await drafted("plan");
  await sw(root, "ratify", "ledgerbox");
  runPlan(["init", "A service that stores readings in LedgerBox", "--root", root]);
  const noParam = copy("plan-noparam");
  cpSync(join(root, ".vibegraph"), join(noParam, ".vibegraph"), { recursive: true });
  assert.match((await sw(noParam, "plan", "ledgerbox")).text, /all proposed/);
  assert.match(loadPlan(noParam).policies[0].text, /\(check needs: wait_ready\)/);
  assert.equal(loadPlan(noParam).policies[0].check, undefined, "no check until the project's names are given");

  assert.match((await sw(root, "plan", "ledgerbox", "--param", "wait_ready=wait_ready")).text, /add stack ledgerbox; add policies p1/);
  const plan = loadPlan(root);
  assert.deepEqual(plan.policies[0].check, { rule: "calls-through", target: "*.get_blob", through: "wait_ready" });
  assert.equal(plan.policies[0].source, "ledgerbox s1");
  assert.equal(plan.policies[0].groundedIn, "Always call wait_ready before calling get_blob");
  assert.match((await sw(root, "plan", "ledgerbox")).text, /already in the plan/);
  assert.match(runPlan(["check", "--root", root]).text, /\*\*violated\*\*: `\*\.get_blob` is called from function\(s\) that never call `wait_ready`: app\.py:module\/load\.fn/);
  runPlan(["promote", "p1", "--root", root]);
  const c = runConstraintChecks({ root, pipeline: {}, commit: "t" });
  assert.equal(c.results[0].verdict, "violated");
  assert.deepEqual(c.results[0].offenders, ["app.py:module/load.fn/return@0"], "load_safely waits, and passes");
});

test("the grammar: an external API target counts its calls; a bare name is still a project function", async () => {
  const root = copy("grammar");
  const env = buildPolyglotEnvelope(root, { skipSystem: true }).envelope;
  const facts = buildQualityFacts({ envelope: env, root, commit: "t" });
  assert.equal(checkConstraint(facts, { rule: "callers-only", target: "ledgerbox.put_blob", files: ["app.py"] }).verdict, "pass");
  assert.equal(checkConstraint(facts, { rule: "callers-only", target: "*.get_blob", files: ["lib.py"] }).verdict, "violated");
  assert.match(checkConstraint(facts, { rule: "calls-through", target: "get_blob", through: "wait_ready" }).reason, /knows no definition of `get_blob`/, "unchanged: a bare name means the project's own function");
});

test("a hooked session gets a ratified spec once, with this code's calls — and nothing from a draft", async () => {
  const { root } = await drafted("hook");
  execFileSync("git", ["init", "-q"], { cwd: root });
  const ctx = (r) => r?.json?.hookSpecificOutput?.additionalContext ?? "";
  assert.doesNotMatch(ctx(runHook("prompt", { session_id: "d", prompt: "change load in app.py please" }, { absRoot: root, pipeline: {} })), /## Software:/);
  await sw(root, "ratify", "ledgerbox");
  const first = ctx(runHook("prompt", { session_id: "r", prompt: "change load in app.py please" }, { absRoot: root, pipeline: {} }));
  assert.match(first, /## Software: ledgerbox \(LedgerBox\) — db; a ratified spec cited from its own docs/);
  assert.match(first, /This code calls it: .*get_blob \(read blob\) at app\.py:15/);
  assert.match(first, /s1 Call wait_ready before get_blob \(why: a blob is readable only once it is READY\)/);
  assert.match(first, /s3 Retry a failed write with backoff .*\[inferred\]/);
  assert.doesNotMatch(ctx(runHook("prompt", { session_id: "r", prompt: "and load_safely in app.py" }, { absRoot: root, pipeline: {} })), /## Software:/, "once per session");
});

test("plan draft: items from documents, each quoted — a fabricated quote is dropped, the rest land proposed", async () => {
  const { root } = await drafted("draft");
  await sw(root, "ratify", "ledgerbox");
  runPlan(["init", "A service that stores readings in LedgerBox", "--root", root]);
  await sw(root, "plan", "ledgerbox");
  const r = await runPlanDraft(["--root", root, "--reply", join(root, "docs/plan_reply.json")]);
  assert.equal(r.exitCode, 0, r.text);
  assert.match(r.text, /1 dropped .*, 1 inferred/);
  assert.match(r.text, /dropped: policies Shard ledgers by region/);
  const plan = loadPlan(root);
  assert.equal(plan.processes[0].groundedIn, "Use put_blob to store a binary payload under a key", "a quote from the spec's own sources counts");
  assert.equal(plan.threads[0].groundedIn, null);
  assert.ok(plan.processes.every((p) => p.status === "proposed"), "a model's items are proposals");
  assert.match(runPlan(["show", "--root", root]).text, /_\(from the docs: “Use put_blob to store/);
});

test("the export, the MCP read, and a spec drawn from a web page", async () => {
  const { root } = await drafted("out");
  const out = join(tmp, "out-export");
  exportKnowledge({ root, out, commit: "t" });
  assert.equal(existsSync(join(out, "software", "ledgerbox.md")), false, "a draft is withheld");
  assert.match(readFileSync(join(out, "README.md"), "utf-8"), /Withheld as unreviewed drafts: ledgerbox/);
  assert.match(softwareToolText(root, null, null).text, /ledgerbox — draft \(NOT ratified: do not rely on it\)/);
  await sw(root, "ratify", "ledgerbox");
  rmSync(out, { recursive: true, force: true });
  exportKnowledge({ root, out, commit: "t" });
  assert.match(readFileSync(join(out, "software", "ledgerbox.md"), "utf-8"), /`get_blob` — read · blob — "get_blob returns the payload for a key"/);

  const html = "<html><head><style>x{}</style><script>alert(1)</script></head><body><h1>LedgerBox</h1><p>Always call wait_ready&nbsp;before calling get_blob.</p></body></html>";
  const server = createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const got = await readFrom(`http://127.0.0.1:${server.address().port}/docs`);
    assert.match(got.text, /LedgerBox\n+Always call wait_ready before calling get_blob\./);
    assert.doesNotMatch(got.text, /alert|x\{\}/);
  } finally { server.close(); }
});
