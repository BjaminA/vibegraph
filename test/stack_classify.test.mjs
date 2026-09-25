// M-CMD.3 — the fallback for a tool no table knows, end to end: the dossier
// the IR yields, the prompt built from it, a model's reply validated against
// what was ASKED, the agent-stated `describe` policy it becomes, the index
// reading it back with provenance, a human's statement outranking it, and
// the learn loop that carries a ratified answer toward the tables.
//
// The model is a canned-reply stub (test/fixtures/run_effects/fake_claude_json.mjs)
// — automated tests never spawn real claude.
//
//   npm run test:stack-classify
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { formatSystemSpec } from "../src/server/stack_spec.ts";
import { addConstraint, loadConstraints } from "../src/server/constraint_store.ts";
import {
  ASSIGNABLE_ROLES, applyClassifications, buildClassifyPrompt, collectUnknownTools, parseClassifyResponse,
} from "../src/server/stack_classify.ts";
import { formatLearn, learn } from "../scripts/stack_learn.mjs";
import { classifierTarget } from "../scripts/cli/classify.mjs";
import { mentionPattern } from "../src/server/stack_classify.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(ROOT, "test/fixtures/webstack/next_demo");
const STUB = join(ROOT, "test/fixtures/run_effects/fake_claude_json.mjs");
const CLI = join(ROOT, "scripts/cli/main.mjs");
const LEDGER = "@acme/ledger-client";

function fixtureCopy(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cpSync(FIXTURE, dir, { recursive: true });
  // No stated roles: the private SDK is what the pass exists for.
  rmSync(join(dir, ".vibegraph", "constraints.json"));
  return dir;
}

let tmp, env, dossiers, parsed;
const GOOD_REPLY = {
  classifications: [
    { tool: LEDGER, role: "platform", confidence: "high", definition: "The accounting platform's SDK; lib/ledger.ts posts entries and reads balances through one LedgerClient instance.", why: "LedgerClient.post / .balance through one instance; the README calls it the accounting platform's SDK" },
    { tool: "clsx", role: "frontend", confidence: "medium", definition: "A class-name joiner used by React components.", why: "called from components/Badge.tsx; no I/O" },
    { tool: "clsx", role: "db", confidence: "high", definition: "listed twice", why: "" },
    { tool: "openai", role: "model-api", confidence: "high", definition: "was not asked", why: "" },
    { tool: "@acme/other", role: "platform", confidence: "high", definition: "was not asked either", why: "" },
  ],
  unsure: [{ tool: "zod", reason: "not asked about" }],
};

before(() => {
  tmp = fixtureCopy("vg-classify-");
  env = buildPolyglotEnvelope(tmp).envelope;
  const stack = buildStackIndex(env, tmp);
  dossiers = collectUnknownTools(env, stack, { root: tmp });
});

test("the dossier asks only about what no table and no policy knows, and says what the IR saw", () => {
  const tools = dossiers.map((d) => d.tool);
  assert.ok(tools.includes(LEDGER), `the private SDK is unknown: ${tools}`);
  assert.ok(tools.includes("clsx"));
  for (const known of ["openai", "@tdxvolt/volt-client-web", "pg", "@modelcontextprotocol/sdk", "react", "next"]) {
    assert.ok(!tools.includes(known), `${known} has a table role and is not asked about`);
  }
  assert.ok(dossiers.every((d) => d.origin !== "project"), "a project module is never a tool to classify");

  const d = dossiers.find((x) => x.tool === LEDGER);
  assert.equal(d.language, "jsts");
  assert.equal(d.version, "3.2.0", "the manifest's version rides along");
  assert.deepEqual(d.files, ["lib/ledger.ts"]);
  assert.ok(d.threads.includes("app/api/orders/route.ts:POST"), `the threads that reach it: ${d.threads}`);
  assert.deepEqual(d.imports, [{ file: "lib/ledger.ts", spec: LEDGER, names: ["LedgerClient"], line: 5 }]);
  // The constructor, and the two calls through the instance ONE hop away
  // (`const ledger = new LedgerClient(…)` → `ledger.post`): the M-RESOLVE rule.
  const targets = Object.fromEntries(d.callCounts.map((c) => [c.target, c.count]));
  assert.deepEqual(targets, { LedgerClient: 1, "ledger.post": 1, "ledger.balance": 1 });
  assert.ok(d.calls.some((c) => c.preview?.includes("new LedgerClient")));
  // The project's own documentation is evidence too.
  assert.ok(d.docs.some((x) => x.file === "README.md" && /accounting platform's SDK/.test(x.text)), JSON.stringify(d.docs));

  const c = dossiers.find((x) => x.tool === "clsx");
  assert.ok(c.callCounts.some((x) => x.target === "clsx"), "a bare call through the default import counts");
});

test("the prompt carries the evidence, the whole role vocabulary, and the downstream cost of an I/O role", () => {
  const prompt = buildClassifyPrompt(dossiers, { project: "next_demo" });
  assert.match(prompt, new RegExp(`### \\d+\\. ${LEDGER.replace("/", "\\/")} \\(jsts; version 3\\.2\\.0; 1 file\\(s\\)`));
  assert.match(prompt, /calls \(by target\): LedgerClient ×1, ledger\.balance ×1, ledger\.post ×1/);
  assert.match(prompt, /docs: README\.md:\d+: .*accounting platform's SDK/);
  for (const r of ASSIGNABLE_ROLES) assert.match(prompt, new RegExp(`^- ${r}: `, "m"), `${r} is offered`);
  assert.ok(!/^- unknown:/m.test(prompt) && !/^- runtime:/m.test(prompt), "the absence of a role and the stdlib are not choices");
  assert.match(prompt, /must NOT be given an I\/O role/);
  assert.match(prompt, /is utility;/, "the home for a no-I\/O library is named, so `data` stops being the dumping ground");
  assert.ok(!/### \d+\. openai/.test(prompt), "a known tool is not asked about");
  assert.match(prompt, /Reply with JSON only/);
});

test("a reply is validated against what was asked: refusals are named, nothing is coerced", () => {
  parsed = parseClassifyResponse("Sure — here it is:\n```json\n" + JSON.stringify(GOOD_REPLY) + "\n```\nHope that helps.", dossiers);
  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.accepted.map((c) => [c.tool, c.role, c.confidence]), [[LEDGER, "platform", "high"], ["clsx", "frontend", "medium"]]);
  const refused = Object.fromEntries(parsed.refused.map((r) => [r.tool, r.reason]));
  assert.match(refused.clsx, /listed twice/);
  assert.match(refused.openai, /not among the tools asked about/);
  assert.match(refused["@acme/other"], /not among the tools asked about/);
  assert.match(refused.zod, /not asked about/);
  // What was asked and not answered is named, not assumed fine.
  const others = dossiers.map((d) => d.tool).filter((t) => t !== LEDGER && t !== "clsx").sort();
  assert.deepEqual(parsed.missing, others);

  const bad = parseClassifyResponse(JSON.stringify({ classifications: [
    { tool: LEDGER, role: "runtime", confidence: "high", definition: "x" },
    { tool: "clsx", role: "unknown", confidence: "high", definition: "x" },
    { tool: LEDGER, role: "platform", confidence: "certain", definition: "" },
  ] }), dossiers);
  assert.equal(bad.accepted.length, 0);
  assert.match(bad.refused[0].reason, /role "runtime" is not one of/);
  assert.match(bad.refused[1].reason, /role "unknown" is not one of/);
  assert.match(bad.refused[2].reason, /no definition/);
  const prose = parseClassifyResponse("I think the ledger client is a platform SDK.", dossiers);
  assert.match(prose.error, /no JSON object/);
  assert.deepEqual(prose.missing.sort(), dossiers.map((d) => d.tool).sort());
});

test("stored as an AGENT-STATED describe policy the index reads back with provenance; a human outranks it; re-running never duplicates", () => {
  const applied = applyClassifications(tmp, parsed.accepted, dossiers, { model: "stub-model", now: () => new Date("2026-09-23T12:00:00Z") });
  assert.equal(applied.added.length, 2);
  const list = loadConstraints(tmp);
  const c = list.find((k) => k.policy?.tool === LEDGER);
  assert.equal(c.kind, "stack-policy");
  assert.equal(c.source, "agent");
  assert.equal(c.policy.rule, "describe");
  assert.equal(c.policy.role, "platform");
  assert.equal(c.text, GOOD_REPLY.classifications[0].definition);
  assert.deepEqual(c.scope, { stack: [LEDGER] });
  assert.match(c.note, /classified by stub-model \(agent — NOT human-reviewed\) from 3 call site\(s\) in 1 file\(s\), 2026-09-23; confidence high; language=jsts/);
  assert.match(c.note, /Ratify: set "source" to "human"/);

  const stack = buildStackIndex(env, tmp);
  const rec = stack.tools.find((t) => t.tool === LEDGER);
  assert.equal(rec.role, "platform");
  assert.equal(rec.roleSource, "stated");
  assert.equal(rec.roleStatedBy, c.id);
  assert.equal(rec.roleStatedSource, "agent");
  assert.ok(stack.tools.some((t) => t.tool === "lib.ledger" && t.role === "platform" && t.origin === "project"), "the funnel forms once the tool has a role");
  assert.ok(!collectUnknownTools(env, stack, { root: tmp }).some((d) => d.tool === LEDGER), "and it is not asked about again");

  // Everywhere the role shows, it says whose classification it is.
  const spec = formatSystemSpec(stack, loadConstraints(tmp), { budget: 200000, truncationHint: "-" });
  assert.match(spec, /@acme\/ledger-client \([^)]*role classified by c\d+ \(agent, NOT human-reviewed\)/);
  assert.match(spec, /agent-stated, NOT human-reviewed\] @acme\/ledger-client is classified as platform SDK/);
  assert.ok(!/WHERE THE FACTS AND A STATED POLICY DISAGREE/.test(spec), "a description decides nothing, so nothing contradicts it");

  const again = applyClassifications(tmp, parsed.accepted, dossiers, { model: "stub-model" });
  assert.equal(again.added.length, 0);
  assert.deepEqual(again.skipped.map((s) => s.tool), [LEDGER, "clsx"]);
  assert.match(again.skipped[0].reason, /already classified by c\d+ \(agent-stated, platform\)/);

  // A person's statement wins whatever the file order says.
  addConstraint(tmp, {
    kind: "stack-policy", text: "the ledger client is remote access to the accounting host", scope: { stack: [LEDGER] },
    policy: { tool: LEDGER, role: "remote", rule: "describe" },
  }, "human");
  const human = buildStackIndex(env, tmp).tools.find((t) => t.tool === LEDGER);
  assert.equal(human.role, "remote");
  assert.equal(human.roleStatedSource, "human");
  assert.match(formatSystemSpec(buildStackIndex(env, tmp), loadConstraints(tmp), { budget: 200000 }), /remote access: [^\n]*@acme\/ledger-client \(role stated by c3;/);
});

test("the learn loop carries only RATIFIED classifications, and says what the table already knows or contradicts", () => {
  // tmp now holds: c1 agent (ledger platform), c2 agent (clsx frontend), c3 human (ledger remote).
  addConstraint(tmp, { kind: "stack-policy", text: "the Volt web client", scope: { stack: ["@tdxvolt/volt-client-web"] }, policy: { tool: "@tdxvolt/volt-client-web", role: "platform", rule: "describe" } }, "human");
  addConstraint(tmp, { kind: "stack-policy", text: "openai is our database", scope: { stack: ["openai"] }, policy: { tool: "openai", role: "db", rule: "describe" } }, "human");
  const items = learn([tmp]);
  const by = Object.fromEntries(items.map((i) => [`${i.id}`, i]));
  assert.equal(by.c1.status, "provisional");
  assert.equal(by.c2.status, "provisional");
  assert.equal(by.c3.status, "candidate");
  assert.equal(by.c3.language, "jsts");
  assert.equal(by.c3.guessed, true, "a hand-written policy has no language; the shape guessed and says so");
  assert.equal(by.c4.status, "in-table");
  assert.equal(by.c5.status, "conflict");
  const text = formatLearn(items);
  assert.match(text, /## jsts → JSTS_TOOLS\n  "@acme\/ledger-client": "remote", \/\/ the ledger client is remote access[^\n]*language guessed from the name/);
  assert.match(text, /## already in the table[^\n]*\n  @tdxvolt\/volt-client-web → platform \(c4/);
  assert.match(text, /## CONFLICTS[^\n]*\n  openai: table says model-api \(model API .*\), c5 says db/);
  assert.match(text, /## provisional — 2 agent- or orchestrator-stated/);
  // With --all-sources the agent's answers are candidates too — labelled by source, language from the note.
  const all = learn([tmp], { allSources: true });
  const c2 = all.find((i) => i.id === "c2");
  assert.equal(c2.status, "candidate");
  assert.equal(c2.guessed, false, "the classify pass recorded language=jsts in the note");
  assert.match(formatLearn(all), /\n  clsx: "frontend", \/\/ A class-name joiner[^\n]*\[c2 · agent/);
});

test("the CLI: --dry-run spawns nothing; a run shows and writes nothing; --apply stores; a failed spawn is exit 3", () => {
  const tmp2 = fixtureCopy("vg-classify-cli-");
  try {
    const capture = join(tmp2, "prompt-seen.txt");
    const constraints = join(tmp2, ".vibegraph", "constraints.json");
    const reply = { classifications: [GOOD_REPLY.classifications[0]], unsure: [{ tool: "clsx", reason: "a class joiner; no I/O role fits and frontend would be a guess" }] };
    const envv = { ...process.env, VG_CLAUDE_BIN: STUB, FAKE_SYNTH_RESPONSE: JSON.stringify(reply), FAKE_PROMPT_CAPTURE: capture };
    const run = (args, extra = {}) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", CLI, "classify", tmp2, ...args], { encoding: "utf-8", env: { ...envv, ...extra } });

    const dry = run(["--dry-run", "--show-prompt"]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.ok(!existsSync(capture), "--dry-run spawns nothing");
    assert.ok(!existsSync(constraints), "and writes nothing");
    assert.match(dry.stdout, /unclassified third-party tool\(s\)/);
    assert.match(dry.stdout, /@acme\/ledger-client  \(jsts, v3\.2\.0; 1 file\(s\)/);
    assert.match(dry.stdout, /--- prompt the model receives ---/);

    const shown = run([]);
    assert.equal(shown.status, 0, shown.stderr);
    assert.ok(existsSync(capture), "the model was asked");
    assert.ok(!existsSync(constraints), "but nothing is stored without --apply");
    assert.match(shown.stdout, /@acme\/ledger-client → platform \(high\): The accounting platform's SDK/);
    assert.match(shown.stdout, /clsx → unsure: a class joiner/);
    assert.match(shown.stderr, /nothing written \(no --apply\)/);
    const seen = readFileSync(capture, "utf-8");
    assert.match(seen, /lib\/ledger\.ts/, "the IR evidence reached the model");
    assert.match(seen, /accounting platform's SDK/, "and so did the project's own README line");

    const applied = run(["--apply"]);
    assert.equal(applied.status, 0, applied.stderr);
    const list = loadConstraints(tmp2);
    assert.equal(list.length, 1);
    assert.equal(list[0].source, "agent");
    assert.equal(list[0].policy.tool, LEDGER);
    assert.match(applied.stdout, /stored c1: @acme\/ledger-client is classified as platform — agent-stated, NOT human-reviewed/);
    assert.match(applied.stderr, /re-run export/);

    // The ledger is stated now; clsx is still unknown, so the model is asked again — and fails.
    const failed = run([], { FAKE_EXIT: "1" });
    assert.equal(failed.status, 3);
    assert.match(failed.stderr, /exited 1/);
    assert.equal(loadConstraints(tmp2).length, 1, "a failed spawn stores nothing");
  } finally {
    rmSync(tmp2, { recursive: true, force: true });
  }
});

test("a doc mention is a WORD: short names do not match inside other words, a scope is a real scope", () => {
  assert.ok(mentionPattern("bc").test("run `bc -l` on it"));
  assert.ok(!mentionPattern("bc").test("| **BCN GROUP LTD.** |"), "not inside a company name");
  assert.ok(!mentionPattern("bc").test("commit `5ebc6ad9`"), "not inside a hash");
  assert.ok(mentionPattern("zod").test("validated with zod."));
  assert.ok(!mentionPattern("zod").test("zodiac"));
  assert.ok(mentionPattern("@tdxvolt/volt-client-web").test("uses `@tdxvolt/volt-client-web` in the browser"));
  assert.ok(!mentionPattern("@tdxvolt/volt-client-web").test("@tdxvolt/volt-client-web-legacy"), "a longer name is a different package");
  assert.ok(mentionPattern("@Acme/Ledger-Client").test("the @acme/ledger-client SDK"), "case-insensitive");
});

test("VG_CLAUDE_BIN names a binary, a node script, or either with arguments", () => {
  assert.deepEqual(classifierTarget({ VG_CLAUDE_BIN: "claude --model haiku" }), { cmd: "claude", args: ["--model", "haiku"], label: "claude" });
  const script = classifierTarget({ VG_CLAUDE_BIN: STUB });
  assert.equal(script.cmd, process.execPath);
  assert.equal(script.args[0], STUB);
  assert.equal(classifierTarget({}).cmd, "claude");
});

after(() => rmSync(tmp, { recursive: true, force: true }));
