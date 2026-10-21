// `hook log` (2026-10-19, PLAN-M-RULES M4): what each real hook firing did.
// One recorded session on a copy of the fleet example — a prompt naming code,
// a prompt naming none, a shell command that changed nothing, an edit that
// breaks a stated rule, a compaction — read back through the log.
//
//   npm run test:hook-log
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook } from "../scripts/cli/hooks.mjs";
import { offenderIdentity } from "../scripts/cli/hook_findings.mjs";
import { runConstraintChecks } from "../scripts/cli/check.mjs";
import { loadEnvelope } from "../scripts/quality_check.mjs";
import { hookLogPath, hookLogText, programOf, readHookLog, summarise } from "../scripts/cli/hook_log.mjs";
delete process.env.CLAUDECODE;

let base, root;
before(() => {
  base = mkdtempSync(join(tmpdir(), "vg-hooklog-"));
  root = join(base, "fleet");
  process.env.VG_CACHE_DIR = join(base, "cache");
  cpSync("examples/fleet-telemetry", root, { recursive: true, filter: (p) => !p.includes("__pycache__") });
  const git = (...a) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  git("init", "-q"); git("add", "-A"); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
});
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

const fire = (event, input, log = true) => runHook(event, { session_id: "s1", ...input }, { absRoot: root, pipeline: {}, log });
const SECRET_PROMPT = "make evaluate in telemetry/alerts.py page on region changes PROMPT-MARKER";

test("a recorded session reads back firing by firing", () => {
  fire("session-start", { source: "startup" });
  fire("prompt", { prompt: SECRET_PROMPT });
  fire("prompt", { prompt: "include the device region in the csv export" });
  fire("post-edit", { tool_name: "Edit", tool_input: { file_path: join(root, "telemetry/ingest.py") } });
  fire("post-edit", { tool_name: "Bash", tool_input: { command: "TOKEN=hunter2 ls -la telemetry" } });
  appendFileSync(join(root, "telemetry/ingest.py"), "\n\nfrom telemetry.alerts import notify\n\n\ndef page_direct(e):\n    notify(e)\n");
  fire("post-edit", { tool_name: "Edit", tool_input: { file_path: join(root, "telemetry/ingest.py") } });
  fire("stop", {});
  fire("session-start", { source: "compact" });

  const log = readHookLog(root);
  assert.equal(log.length, 8);
  const [start, named, unnamed, edit, shell, breaking, stop, compact] = log;

  assert.equal(start.event, "session-start");
  assert.ok(start.chars > 0 && start.parsed, "the orientation's size is recorded");

  assert.ok(named.routed.some((r) => r.ep === "telemetry/alerts.py:evaluate" && /file|symbol/.test(r.how)), "a code-shaped token says which kind matched");
  assert.ok(named.sent.contracts.includes("telemetry/alerts.py:evaluate"), "the contract newly sent");
  assert.ok(named.sent.rules.includes("c3"), "the rules newly sent");

  assert.ok(unnamed.routed.length && unnamed.routed.every((r) => r.how === "keyword"), "no code named: a KEYWORD guess, labelled as such");

  assert.equal(edit.outcome, "context");
  assert.deepEqual(edit.findings.introduced, []);

  assert.equal(shell.parsed, false, "a shell command that changed no source file costs no parse");
  assert.equal(shell.program, "ls", "the program, never the command line");
  assert.match(shell.skipped, /no source file changed/);

  assert.equal(breaking.outcome, "block");
  assert.deepEqual(breaking.findings.blocked, ["c3"]);
  assert.ok(breaking.findings.introduced.some((f) => f.id === "c3" && f.gates));

  assert.deepEqual(stop.findings.blocked, ["c3"], "the turn's end holds it");
  assert.equal(compact.source, "compact");
  assert.equal(compact.reset, true, "the delivery record went with the compaction");

  const raw = readFileSync(hookLogPath(root), "utf-8");
  assert.doesNotMatch(raw, /PROMPT-MARKER/, "never the prompt");
  assert.doesNotMatch(raw, /hunter2/, "never a command line");

  const s = summarise(log);
  assert.equal(s.keywordRoutes, unnamed.routed.length);
  assert.equal(s.blocks, 1);
  assert.equal(s.shellEdits, 1);
  assert.deepEqual(s.resets, [true]);

  const text = hookLogText(root, {});
  assert.match(text, /session s1: 8 firing\(s\)/);
  assert.match(text, /KEYWORD guess/);
  assert.match(text, /BLOCKED on c3/);
  assert.match(text, /delivery record reset/);
  assert.match(hookLogText(root, { list: true }), /^s1 {2}8 firing\(s\)/);
});

test("M4 class 2: a session's FIRST shell command that changes no source costs no parse", () => {
  // Before: the source stamp was only written by an edit, so `git status` as
  // the first tool call of a session found none and ran a full check.
  const s = (event, input) => runHook(event, { session_id: "s2", ...input }, { absRoot: root, pipeline: {}, log: true });
  s("session-start", { source: "startup" });
  s("post-edit", { tool_name: "Bash", tool_input: { command: "git status" } });
  const prompted = (event, input) => runHook(event, { session_id: "s3", ...input }, { absRoot: root, pipeline: {}, log: true });
  prompted("prompt", { prompt: "include the device region in the csv export" }); // no session-start: installed mid-session
  prompted("post-edit", { tool_name: "Bash", tool_input: { command: "ls" } });
  const shells = readHookLog(root).filter((e) => (e.session === "s2" || e.session === "s3") && e.event === "post-edit");
  assert.equal(shells.length, 2);
  for (const e of shells) {
    assert.equal(e.parsed, false, `${e.session}: ${e.program} parsed`);
    assert.match(e.skipped, /no source file changed/);
  }
});

test("M4 class 3: a violation the tree already had is not 'introduced' by an edit that moves its line", () => {
  // `layer` spells its offender `file.py:LINE imports …`; the finding was keyed
  // on that text, so a line added above it read as a new violation.
  assert.equal(offenderIdentity("telemetry/export.py:7 imports telemetry.storage (telemetry/storage.py)"), "telemetry/export.py imports telemetry.storage (telemetry/storage.py)");
  assert.equal(offenderIdentity("a.ts:12 f calls g only inside a branch or loop (line 14, 19)"), "a.ts f calls g only inside a branch or loop");
  assert.equal(offenderIdentity("telemetry/ingest.py:module/page_direct.fn/notify.call"), "telemetry/ingest.py:module/page_direct.fn/notify.call", "a structural id is unchanged");

  const cpath = join(root, ".vibegraph", "constraints.json");
  const saved = readFileSync(cpath, "utf-8");
  const doc = JSON.parse(saved);
  doc.constraints.push({ id: "c99", kind: "invariant", source: "human", text: "the export module imports nothing, not even the standard library", scope: { files: ["telemetry/export.py"] }, check: { rule: "layer", files: ["telemetry/export.py"], mayImport: [], allowStdlib: false } });
  writeFileSync(cpath, JSON.stringify(doc));
  const file = join(root, "telemetry/export.py");
  const before = readFileSync(file, "utf-8");
  try {
    const s = (event, input) => runHook(event, { session_id: "s4", ...input }, { absRoot: root, pipeline: {}, log: true });
    s("prompt", { prompt: "tidy telemetry/export.py" });
    writeFileSync(file, `# a comment line\n${before}`);
    const r = s("post-edit", { tool_name: "Edit", tool_input: { file_path: file } });
    // not vacuous: c99 is violated, and the edit DID move its offender's line
    const offenders = () => runConstraintChecks({ root, loaded: loadEnvelope(root, null, {}, { cache: true }), uncommitted: true, commit: "working-tree" }).results.filter((x) => x.id === "c99").flatMap((x) => x.offenders);
    const moved = offenders();
    writeFileSync(file, before);
    const original = offenders();
    assert.ok(original.length && moved.length, "c99 is violated before and after");
    assert.notDeepEqual(moved, original, "the raw offender text changed with the line");
    const ctx = r?.json?.hookSpecificOutput?.additionalContext ?? r?.block ?? "";
    assert.doesNotMatch(ctx, /This edit introduced/, ctx);
    const e = readHookLog(root).filter((x) => x.session === "s4" && x.event === "post-edit").at(-1);
    assert.deepEqual(e.findings.introduced, []);
  } finally {
    writeFileSync(file, before);
    writeFileSync(cpath, saved);
  }
});

test("a manual or test call is not logged; the program of a command is its first real word", () => {
  const n = readHookLog(root).length;
  fire("prompt", { prompt: "and keep evaluate in telemetry/alerts.py simple" }, false);
  assert.equal(readHookLog(root).length, n);
  assert.equal(programOf("FOO=1 BAR='a b' /usr/bin/python3 -c 'x'"), "python3");
  assert.equal(programOf("  sed -i s/a/b/ f.py"), "sed");
  assert.ok(existsSync(hookLogPath(root)));
});
