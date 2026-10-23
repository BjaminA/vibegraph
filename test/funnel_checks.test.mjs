// Funnel checks from what the funnel calls (2026-10-22, the root-cause handoff
// RC4: "funnel checks come from wording, not from what the funnel calls"). Each
// funnel in the fixture imports two libraries and calls ONE function from one
// of them, in Python and in TypeScript. Expect `wraps` to hold exactly that
// library and `calls` that function by its full name; the derived check to
// pass on the fixture and fail when a second module calls the function; and a
// check on the imported-but-uncalled library to be said to be trivial.
//
//   npm run test:funnel-checks
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildQualityFacts } from "../src/server/quality/facts.ts";
import { checkConstraint } from "../src/server/constraint_grammar.ts";
import { funnelChecks, trivialCheck } from "../src/server/funnel_checks.ts";
import { fullCallName } from "../src/shared/call_names.ts";
import { checkStatedRules } from "../src/server/constraint_report.ts";
import { gateRuleDraft } from "../src/server/rule_draft_gate.ts";
import { harvestRules } from "../src/server/rule_harvest.ts";

const FIX = "test/fixtures/funnel/funnel_demo";
const built = (root) => { const env = buildPolyglotEnvelope(root).envelope; const stack = buildStackIndex(env, root); return { env, stack, facts: buildQualityFacts({ envelope: env, root, commit: "test", stack }) }; };
let base;
before(() => { base = built(FIX); });
const tmp = mkdtempSync(join(tmpdir(), "vg-funnel-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const funnelOf = (stack, home) => stack.tools.find((t) => t.origin === "project" && t.home === home);

test("a call's full name through its file's imports, however the import is spelled", () => {
  const nodes = [
    { type: "import", names: ["urllib.request"] }, { type: "import", names: ["requests as rq"] },
    { type: "import_from", module: "urllib.request", names: ["urlopen"] }, { type: "import_from", module: "axios", names: ["default as ax"] },
    { type: "import_from", module: "node:child_process", names: ["* as cp"] },
  ];
  assert.equal(fullCallName("urllib.request.urlopen", nodes), "urllib.request.urlopen");
  assert.equal(fullCallName("urlopen", nodes), "urllib.request.urlopen");
  assert.equal(fullCallName("rq.post", nodes), "requests.post");
  assert.equal(fullCallName("ax.get", nodes), "axios.get");
  assert.equal(fullCallName("cp.execFile", nodes), "node:child_process.execFile");
  assert.equal(fullCallName("local_helper", nodes), null);
});

test("a funnel wraps what it calls, by full name, not everything it imports", () => {
  const py = funnelOf(base.stack, "app/net/http.py");
  assert.deepEqual(py.wraps, ["urllib"], "http is imported for a constant and never called");
  assert.deepEqual(py.calls, ["urllib.request.urlopen"]);
  const ts = funnelOf(base.stack, "src/net/client.ts");
  assert.deepEqual(ts.wraps, ["axios"], "undici is imported for a type and never called");
  assert.deepEqual(ts.calls, ["axios.get"]);
});

test("the derived check passes while only the funnel calls the function, and fails when a second module does", () => {
  // a standard-library namespace: callers-only on the function; a client package: import-only
  const py = funnelChecks(funnelOf(base.stack, "app/net/http.py"), [], base.stack);
  assert.deepEqual(py, [{ rule: "callers-only", target: "urllib.request.urlopen", files: ["app/net/http.py"] }]);
  const ts = funnelChecks(funnelOf(base.stack, "src/net/client.ts"), [], base.stack);
  assert.deepEqual(ts, [{ rule: "import-only", tool: "axios", files: ["src/net/client.ts"] }]);
  for (const c of [...py, ...ts]) assert.equal(checkConstraint(base.facts, c).verdict, "pass", JSON.stringify(c));
  const proj = join(tmp, "rogue");
  cpSync(FIX, proj, { recursive: true });
  writeFileSync(join(proj, "app", "rogue.py"), ["from urllib.request import urlopen", "", "", "def peek(url):", "    return urlopen(url).read()", ""].join("\n"));
  writeFileSync(join(proj, "src", "rogue.ts"), ['import axios from "axios";', "", "export async function peek(url: string): Promise<unknown> {", "  const res = await axios.get(url);", "  return res.data;", "}", ""].join("\n"));
  const r = built(proj);
  const pyr = checkConstraint(r.facts, funnelChecks(funnelOf(r.stack, "app/net/http.py"), [], r.stack)[0]);
  assert.equal(pyr.verdict, "violated");
  assert.ok(JSON.stringify(pyr.offenders).includes("app/rogue.py"), JSON.stringify(pyr.offenders));
  const tsr = checkConstraint(r.facts, funnelChecks(funnelOf(r.stack, "src/net/client.ts"), [], r.stack)[0]);
  assert.equal(tsr.verdict, "violated");
});

test("a check on a library the funnel imports and never calls is trivial, and `check` says so", () => {
  const weak = { rule: "import-only", tool: "undici", files: ["src/net/client.ts"] };
  assert.match(trivialCheck(weak, base.stack), /src\/net\/client\.ts imports undici but makes no call through it that leaves the project[\s\S]*what leaves is axios\.get/);
  assert.equal(trivialCheck({ rule: "import-only", tool: "axios", files: ["src/net/client.ts"] }, base.stack), null);
  const report = checkStatedRules({ envelope: base.env, root: FIX, stack: base.stack, constraints: [{ id: "c1", kind: "proxy", source: "human", text: "t", scope: { all: true }, createdAt: "", check: weak }] });
  assert.match(report.results[0].trivial, /makes no call through it/);
});

test("the drafting gate replaces a trivial funnel check, and gives an unchecked funnel rule one", () => {
  const funnel = funnelOf(base.stack, "src/net/client.ts");
  const dossier = { project: "p", counts: { files: 1, entryPoints: 1 }, items: [{ id: `funnel:${funnel.tool}`, kind: "funnel", text: "the dashboard's HTTP door" }], stated: [], vocab: { entryPoints: [], folders: [], tools: [] } };
  const rule = (text, check) => ({ kind: "proxy", text, why: "one timeout", scope: { files: ["src/"] }, cites: [`funnel:${funnel.tool}`], ...(check ? { check } : {}) });
  const gate = (r) => gateRuleDraft(JSON.stringify({ rules: [r] }), dossier, {
    existing: [], files: new Set(Object.keys(base.env.files)), entryPoints: new Set(), tools: new Set(base.stack.tools.map((t) => t.tool)),
    checkOne: (input) => checkStatedRules({ envelope: base.env, root: FIX, stack: base.stack, constraints: [{ ...input, id: "draft", source: "agent", createdAt: "" }] }).results.map((x) => ({ verdict: x.verdict, reason: x.reason, offenders: x.offenders })),
    funnels: base.stack.tools.filter((t) => t.origin === "project"), stack: base.stack, model: "test",
  });
  const derived = { rule: "import-only", tool: "axios", files: ["src/net/client.ts"] };
  const replaced = gate(rule("Every request leaves through src/net/client.ts.", { rule: "import-only", tool: "undici", files: ["src/net/client.ts"] })).accepted[0];
  assert.deepEqual(replaced.input.check, derived);
  assert.match(replaced.input.note, /its check was replaced: src\/net\/client\.ts imports undici but makes no call through it/);
  const given = gate(rule("Only src/net/client.ts talks to the network.", null)).accepted[0];
  assert.deepEqual(given.input.check, derived);
  assert.match(given.input.note, /its check comes from what the funnel calls/);
});

test("the prose harvest suggests the funnel's own call as the check", () => {
  const c = harvestRules(FIX, base.env, base.stack, { min: 0 }).candidates.find((x) => /app\/net\/http\.py/.test(x.quote));
  assert.ok(c, "the CLAUDE.md rule is a candidate");
  assert.deepEqual(c.suggestedCheck, { rule: "callers-only", target: "urllib.request.urlopen", files: ["app/net/http.py"] });
});
