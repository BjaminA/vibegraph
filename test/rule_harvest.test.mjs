// RULE CANDIDATES FROM THE PROSE (2026-10-17, src/server/rule_harvest.ts).
// From a field run: a project's operator rules sat in its CLAUDE.md and module
// headers while its constraints held none of them. Oracle: the fleet example's
// six human-stated rules are each restated in its README's table (and two in
// module headers) — every one must surface at the default threshold, and the
// docstrings that merely describe behaviour must not. The citation gate on
// `constraints add --cite`: a rule read from the prose quotes its sentence,
// and a quote not in the file refuses the rule (the software-spec rule).
//
//   npm run test:rule-harvest
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { harvestRules, formatHarvest, proseSentences, headerOf, markersIn, DEFAULT_MIN } from "../src/server/rule_harvest.ts";
import { formatConstraintsBlock, loadConstraints } from "../src/server/constraint_store.ts";
import { runConstraints, citedAt } from "../scripts/cli/constraints.mjs";
import { orientation } from "../scripts/cli/orientation.mjs";
delete process.env.CLAUDECODE; // the tests act as a person

const FLEET = "examples/fleet-telemetry";
let env, stack, report, tmp;
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "vg-harvest-"));
  process.env.VG_CACHE_DIR = join(tmp, "cache");
  env = buildPolyglotEnvelope(FLEET, { skipSystem: true }).envelope;
  stack = buildStackIndex(env, FLEET);
  report = harvestRules(FLEET, env, stack);
});
after(() => { rmSync(tmp, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });
const at = (file, line) => report.candidates.find((c) => c.file === file && c.line === line);

test("the oracle: every one of the six stated rules surfaces from the README at the default threshold", () => {
  const rows = { 10: "c1", 11: "c2", 12: "c3", 13: "c4", 14: "c5", 15: "c6" };
  for (const [line, id] of Object.entries(rows)) assert.ok(at("README.md", Number(line)), `${id} (README.md:${line}) is missing`);
  assert.equal(at("README.md", 11).narrative, false, "'the first four columns are fixed' is a rule, not a record");
  assert.deepEqual(at("README.md", 13).anchors, [{ kind: "route", id: "/ingest" }], "a route literal anchors");
  assert.deepEqual(at("README.md", 15).anchors, [{ kind: "path", id: "telemetry/migrations.py" }], "a file that does not exist yet, under a known folder, anchors");
  // the module headers that restate c1 and c4
  assert.ok(at("telemetry/http_client.py", 1) && at("telemetry/http_client.py", 1).where === "header");
  assert.ok(at("gateway/auth.ts", 1));
  assert.equal(report.candidates.filter((c) => c.file === "gateway/auth.ts").length, 1, "the header repeated in the docstring is listed once");
});

// M3 measured the prose writer scoping each rule to the file its sentence names (scope overlap
// 0.36 against the gold) and adding no checks: the harvest now suggests what the rule GOVERNS
test("a suggested scope reads what the rule governs; a funnel module suggests its import-only check", () => {
  // with a check: the precise scope — the check catches a break wherever it is written
  assert.deepEqual(at("README.md", 10).suggestedScope, { stack: ["telemetry.http_client", "requests"] }, "a funnel scopes every thread using it or its tool");
  assert.deepEqual(at("README.md", 10).suggestedCheck, { rule: "import-only", tool: "requests", files: ["telemetry/http_client.py"] }, "the gold c1's own check");
  // not a prohibition: what it names, precisely
  assert.deepEqual(at("README.md", 11).suggestedScope, { entryPointIds: ["gateway/server.ts:getExport", "telemetry/app.py:export_route"] }, "a route served twice scopes both");
  assert.deepEqual(at("README.md", 15).suggestedScope, { files: ["telemetry/"] }, "a module not built yet scopes its folder");
  // a prohibition with NO check must be delivered before the edit: the whole area a violation could be written in
  assert.deepEqual(at("README.md", 12).suggestedScope, { files: ["telemetry/"] }, "'paged only via notify': the service, as the person scoped it");
  assert.deepEqual(at("README.md", 13).suggestedScope, { files: ["gateway/"] }, "'the gateway never forwards': the area the sentence names, not both /ingest servers");
  assert.deepEqual(at("README.md", 14).suggestedScope, { files: ["telemetry/"] }, "'never one row at a time': the service — a superset of the person's three files, the principle's cost");
  assert.match(formatHarvest(report), /scope: --tools telemetry\.http_client,requests · try: --check/);
});

test("behaviour-describing docstrings and perfect-tense descriptions stay under the threshold", () => {
  const all = harvestRules(FLEET, env, stack, { min: 0 }).candidates;
  const q = (part) => all.find((c) => c.quote.includes(part));
  assert.equal(q("Celsius passes through"), undefined, "'passes through' is not a routing marker");
  assert.ok(q("has never seen it").score < DEFAULT_MIN && q("has never seen it").narrative, "perfect tense");
  assert.ok(q("later calls only refresh").score < DEFAULT_MIN);
  // precision at the default threshold on this example: the six rules and the headers that restate them
  const top = report.candidates.map((c) => `${c.file}:${c.line}`);
  const oracle = ["README.md:10", "README.md:11", "README.md:12", "README.md:13", "README.md:14", "README.md:15", "telemetry/http_client.py:1", "telemetry/http_client.py:3", "gateway/auth.ts:1", "telemetry/export.py:3"];
  const hits = top.filter((t) => oracle.includes(t)).length;
  assert.ok(hits / top.length >= 0.7, `precision ${hits}/${top.length}: ${top.join(", ")}`);
});

test("sentences, headers and markers: fenced code skipped, a table row is one sentence, each language's header", () => {
  const s = proseSentences("# Rules\n\nNever call `db.exec` outside `lib/store.ts`. Use the store.\n\n```\nnever matters here\n```\n\n| id | rule |\n|---|---|\n| r1 | always `validate()` first |\n");
  assert.deepEqual(s.map((x) => [x.line, x.text]), [[3, "Never call `db.exec` outside `lib/store.ts`."], [11, "r1 — always `validate()` first"]]);
  assert.equal(s[1].under, "Rules | id | rule");
  assert.deepEqual(headerOf('"""One line.\n\nSecond.\n"""\nimport os\n', "python").map((x) => x.text), ["One line.", "Second."]);
  assert.deepEqual(headerOf("#!/usr/bin/env bash\n# Deploy.\n# Never run as root.\nset -e\n", "bash").map((x) => x.text), ["Deploy.", "Never run as root."]);
  assert.deepEqual(headerOf("// Edge.\n// Only forwards.\nimport x from 'y';\n", "jsts").map((x) => x.text), ["Edge.", "Only forwards."]);
  assert.deepEqual(headerOf("/* Codec.\n * Never allocates. */\n#include <x>\n", "cpp").map((x) => x.text), ["Codec.", "Never allocates."]);
  assert.deepEqual(markersIn("Readings must leave through the funnel; never one at a time.").map((m) => m.name).sort(), ["must", "never", "through"]);
  assert.deepEqual(markersIn("A description with no modal."), []);
});

// The shapes a field review named, under neutral names (test/fixtures/harvest/ops_demo):
// a root-owned copy, an ACL fact with no modal verb, a correctness setting, a
// payload key that must never be sent, a database with no grants — plus the
// history that must rank below them.
test("the review's five shapes surface from CLAUDE.md and the module headers; history and test prose rank below", () => {
  const root = "test/fixtures/harvest/ops_demo";
  const e = buildPolyglotEnvelope(root, { skipSystem: true }).envelope;
  const r = harvestRules(root, e, buildStackIndex(e, root));
  const c = (line) => r.candidates.find((x) => x.file === "CLAUDE.md" && x.line === line);
  assert.deepEqual(c(8).anchors, [{ kind: "file", id: "bin/run-task" }], "an extensionless script is a file anchor");
  assert.deepEqual(c(10).markers.sort(), ["inert", "precedence"], "a rule stated as a fact: no modal verb");
  assert.deepEqual(c(13).anchors, [{ kind: "file", id: "jobs/registry.ts" }]);
  assert.deepEqual(c(16).anchors, [{ kind: "key", id: "temperature" }, { kind: "key", id: "max_tokens" }], "payload keys the code sends anchor");
  assert.deepEqual(c(18).anchors, [{ kind: "function", id: "provisionCreditsDb" }], "a bare camelCase name anchors");
  for (const line of [8, 10, 13, 16, 18]) assert.ok(c(line).score >= DEFAULT_MIN, `CLAUDE.md:${line} scores ${c(line)?.score}`);
  assert.ok(r.candidates.some((x) => x.file === "access/rules.py" && x.where === "header"));
  const all = harvestRules(root, e, null, { min: 0 }).candidates;
  const hist = all.find((x) => x.file === "CLAUDE.md" && x.under === "History");
  assert.ok(hist.narrative && hist.score < DEFAULT_MIN, "the history is a record");
  assert.ok(all.filter((x) => x.score >= DEFAULT_MIN).every((x) => x.under !== "History" && x.under !== "Layout"));
});

test("what the corpus taught: release-note headings are records, asides and test files rank low, 'in order to' is not an ordering rule", () => {
  const s = proseSentences("## Version 8.4.0\n\n- `open_url` must not use `shell=True` any more.\n\n## Usage\n\nIn order to use `nvm` you can set `BASH_ENV`.\n");
  assert.equal(s[0].under, "Version 8.4.0");
  assert.deepEqual(markersIn(s[1].text), [], "'in order to' is not 'in order'");
  assert.deepEqual(markersIn("The classifier returns plain values (it never throws)."), [{ name: "never", strength: 1 }], "a marker inside an aside describes");
  assert.deepEqual(markersIn("Never call start() on a transport you hand to a Client.")[0], { name: "never", strength: 3 });
  const env = { files: { "tests/test_x.py": { language: "python", nodes: [] }, "src/x.py": { language: "python", nodes: [] } } };
  const root = join(tmp, "aside");
  mkdirSync(join(root, "tests"), { recursive: true }); mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "tests", "test_x.py"), '"""The mock must never close `src/x.py`\'s stream."""\n');
  writeFileSync(join(root, "src", "x.py"), '"""The stream must never be closed by `tests/test_x.py`\'s mock."""\n');
  const r = harvestRules(root, env, null, { min: 0 }).candidates;
  const inTest = r.find((x) => x.file === "tests/test_x.py"), inSrc = r.find((x) => x.file === "src/x.py");
  assert.equal(inSrc.score - inTest.score, 2, "the same sentence in a test file ranks two below");
});

test("a suggested check where the shape is unambiguous; narrative penalised; the text report", () => {
  const root = join(tmp, "prose");
  cpSync(FLEET, root, { recursive: true, filter: (p) => !p.includes("__pycache__") });
  writeFileSync(join(root, "CLAUDE.md"), [
    "# Hard rules", "",
    "- Never import `requests` outside `telemetry/http_client.py`: every call leaves through the egress proxy.",
    "- Never use `boto3` in this service.", "",
    "## History", "",
    "- 2026-09-10 — the auth gate was fixed; `telemetry/auth.py` must now be reached by every ingest thread (it had been missed).", "",
  ].join("\n"));
  const e = buildPolyglotEnvelope(root, { skipSystem: true }).envelope;
  const r = harvestRules(root, e, buildStackIndex(e, root));
  const c = (line) => r.candidates.find((x) => x.file === "CLAUDE.md" && x.line === line);
  assert.deepEqual(c(3).suggestedCheck, { rule: "import-only", tool: "requests", files: ["telemetry/http_client.py"] });
  assert.deepEqual(c(3).anchors.map((a) => a.kind).sort(), ["file", "tool"]);
  assert.equal(c(4), undefined, "boto3 is not in this project's stack: nothing the IR knows is named");
  const hist = harvestRules(root, e, null, { min: 0 }).candidates.find((x) => x.file === "CLAUDE.md" && x.line === 8);
  assert.equal(hist.narrative, true);
  assert.ok(hist.score < c(3).score);
  const text = formatHarvest(r);
  assert.match(text, /rule-shaped sentences that name code the IR knows: \d+/);
  assert.match(text, /CLAUDE\.md:3 — under "Hard rules"/);
  assert.match(text, /try: --check '\{"rule":"import-only"/);
  assert.match(text, /A candidate is a place to read, not a rule/);
});

test("the citation gate: add --cite stores the sentence and refuses one that is not there; the prompt block names the source", () => {
  const root = join(tmp, "cite");
  cpSync(FLEET, root, { recursive: true, filter: (p) => !p.includes("__pycache__") });
  const base = { kind: "proxy", text: "Every outbound HTTP call must leave through telemetry/http_client.py (egress proxy + service token).", files: "telemetry/", cite: "README.md:10" };
  const ok = runConstraints({ root, sub: "add", values: { ...base, quote: "every outbound HTTP call must leave through `telemetry/http_client.py` (egress proxy + service token)" } });
  assert.equal(ok.exitCode, 0, ok.messages.join("\n"));
  const stored = loadConstraints(root).find((c) => c.cite);
  assert.equal(stored.cite.file, "README.md");
  assert.equal(stored.cite.line, 10);
  assert.match(formatConstraintsBlock([stored]), /— from README\.md:10$/m);
  assert.match(runConstraints({ root, sub: "list", values: {} }).lines.join("\n"), /from: README\.md:10 — "c1 — proxy — every outbound HTTP call/, "a table row is cited as its own cells, never across rows");
  const bad = runConstraints({ root, sub: "add", values: { kind: "invariant", text: "Operators are never paged twice a minute.", all: true, cite: "README.md:12", quote: "operators are never paged twice a minute" } });
  assert.equal(bad.exitCode, 2);
  assert.match(bad.messages[0], /not in README\.md near line 12/);
  const frag = citedAt(root, { file: "README.md", line: 14, quote: "inserted in batches through insert_readings" });
  assert.equal(frag.ok, true, "backticks and emphasis are ignored");
  assert.match(frag.quote, /^c5 — perf-lever — readings are inserted in batches through insert_readings, never one row at a time/, "a fragment is stored as the whole sentence it sits in");
  assert.equal(citedAt(root, { file: "nope.md", line: 1, quote: "a sentence that is long enough" }).ok, false);
  assert.match(citedAt(root, { file: "README.md", line: 14, quote: "batches" }).error, /wants the sentence/);
  // a live drill stored a rule under --dry-run because it had no check to run
  const dry = runConstraints({ root, sub: "add", values: { kind: "invariant", text: "A dry run with no check stores nothing at all.", all: true, "dry-run": true } });
  assert.equal(dry.exitCode, 0);
  assert.match(dry.lines[0], /dry run — nothing stored/);
  assert.ok(!loadConstraints(root).some((c) => c.text.startsWith("A dry run")));
  // a model stating a rule is an agent wherever it runs: --as agent, when CLAUDECODE cannot reach the CLI (a Windows Claude Code calling WSL)
  const asAgent = runConstraints({ root, sub: "add", values: { kind: "invariant", text: "Stated by a model through --as agent.", all: true, as: "agent" } });
  assert.equal(asAgent.exitCode, 0, asAgent.messages.join("\n"));
  assert.equal(loadConstraints(root).find((c) => c.text.startsWith("Stated by a model")).source, "agent");
});

test("the session orientation says how many candidates there are while no person has stated a rule", () => {
  const root = join(tmp, "orient");
  cpSync(FLEET, root, { recursive: true, filter: (p) => !p.includes("__pycache__") });
  mkdirSync(join(root, ".vibegraph"), { recursive: true });
  writeFileSync(join(root, ".vibegraph", "constraints.json"), JSON.stringify({ version: "1", constraints: [] }));
  const text = orientation(root, { envelope: env }, []);
  assert.match(text, /\d+ rule-shaped sentences in the project's prose .* name code the IR knows — `vibegraph-knowledge constraints harvest`/);
  const stated = orientation(FLEET, { envelope: env }, loadConstraints(FLEET));
  assert.doesNotMatch(stated, /rule-shaped sentences/, "once a person has stated rules the line is not repeated every session");
});
