// Hooks and the person gate, from a field session (2026-10-07): a
// Windows-side Claude running commands inside WSL, hooks naming an nvm Node,
// edits made through PowerShell, and noise in what the hooks send.
//
//   F1  a person's step needs an interactive terminal as well as no
//       CLAUDECODE — the mark does not cross the Windows → WSL hop
//   E2  doctor names a hook path that no longer exists (an nvm upgrade)
//   E4  everyday words do not route a prompt to a thread; a test thread
//       needs a prompt about tests
//   E5  many tests are summarised by file
//   E6  `hook run` always says what it did
//
//   npm run test:field-hooks
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { personRefusal, wslMarkAdvice, NO_TERMINAL, PERSONS_STEP } from "../scripts/cli/actor.mjs";
import { missingPaths } from "../scripts/cli/hook_tools.mjs";
import { testsLine } from "../scripts/cli/hooks.mjs";
import { buildKeywordIndex, matchKeywords } from "../src/server/thread_keywords.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), "vg-fieldhooks-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("F1: a person's step is refused with no terminal, whatever the environment says", () => {
  assert.equal(personRefusal({ CLAUDECODE: "1" }, { stdinTTY: true }), PERSONS_STEP);
  assert.equal(personRefusal({ CLAUDE_CODE_ENTRYPOINT: "cli" }, { stdinTTY: true }), PERSONS_STEP);
  assert.equal(personRefusal({}, { stdinTTY: false }), NO_TERMINAL);
  assert.equal(personRefusal({}, { stdinTTY: true }), null);
  assert.equal(personRefusal({ VG_PERSON_NO_TTY: "1" }, { stdinTTY: false }), null);

  // through the real CLI: no CLAUDECODE (it did not cross the hop), no terminal
  const env = { ...process.env };
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT; delete env.NODE_TEST_CONTEXT; delete env.VG_PERSON_NO_TTY;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), "plan", "agree", "p1", tmp],
    { encoding: "utf-8", env, stdio: ["pipe", "pipe", "pipe"] });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /refused: `plan agree` — this is a person's step, and no terminal is attached/);
});

test("F1: doctor's advice when WSLENV does not carry CLAUDECODE into WSL", () => {
  assert.match(wslMarkAdvice({ WSL_DISTRO_NAME: "Ubuntu", WSLENV: "PATH/l" }), /setx WSLENV "CLAUDECODE\/u:%WSLENV%"/);
  assert.equal(wslMarkAdvice({ WSL_DISTRO_NAME: "Ubuntu", WSLENV: "CLAUDECODE/u:PATH/l" }), null);
  assert.equal(wslMarkAdvice({}), null, "not inside WSL");
});

test("E2: a hook naming a Node that is gone is named, with the nvm reason", () => {
  const gone = `VG_PYTHON="/usr/bin/python3" "/home/u/.nvm/versions/node/v0.0.1/bin/node" "/home/u/.nvm/versions/node/v0.0.1/lib/cli.mjs" hook prompt --root "/p" --vg-hook`;
  const why = missingPaths(gone, "linux");
  assert.ok(why.some((w) => /v0\.0\.1\/bin\/node no longer exists.*nvm upgrade/.test(w)), why.join("\n"));
  assert.ok(!why.some((w) => w.includes("/p ")), "the --root after `hook` is not a program path");
  assert.deepEqual(missingPaths(`"${process.execPath}" "${join(ROOT, "scripts/cli/main.mjs")}" hook stop --root "/p" --vg-hook`, "linux"), []);
});

test("E5: many tests are summarised by file", () => {
  const tests = [...Array.from({ length: 30 }, (_, i) => ({ entryPointId: `tests/test_big.py:test_${i}` })), { entryPointId: "tests/test_small.py:test_a" }];
  const line = testsLine("the 3 changed source files", tests, ["a.py", "b.py", "c.py"]);
  assert.match(line, /^31 discovered tests reach the 3 changed source files: 30 in `tests\/test_big\.py`, 1 in `tests\/test_small\.py`/);
  assert.match(line, /vibegraph-knowledge affected a\.py b\.py c\.py/);
  assert.doesNotMatch(line, /test_17/);
  assert.match(testsLine("x.py", [{ entryPointId: "t.py:test_x" }], ["x.py"]), /: t\.py:test_x$/);
});

test("E4: everyday words route nothing; a test thread needs a prompt about tests", () => {
  const thread = (file, name, steps = []) => ({ entryPointId: `${file}:${name}`, seed: { file, qualifiedName: `${file.replace(/\.py$/, "")}:${name}` }, nodes: steps.map((label) => ({ kind: "step", label })) });
  const docs = buildKeywordIndex([
    thread("tests/test_layout.py", "test_keep_line"),
    thread("tests/test_dates.py", "test_left_date_bits"),
    thread("tests/test_export.py", "test_region_csv_export", ["write_region_csv"]),
    thread("app/report.py", "render_report", ["load_rows", "format_table"]),
    thread("app/ingest.py", "ingest_readings", ["parse_reading", "store_reading"]),
    thread("app/notify.py", "notify_operators"),
  ], () => null);
  assert.deepEqual(matchKeywords("keep this line in place, the date bits on the left are a problem", docs), []);
  assert.deepEqual(matchKeywords("make the region csv export faster", docs), [], "a test thread, and the prompt is not about tests");
  assert.deepEqual(matchKeywords("the region csv export tests fail", docs).map((m) => m.entryPointId), ["tests/test_export.py:test_region_csv_export"]);
  assert.deepEqual(matchKeywords("render the report as a table", docs).map((m) => m.entryPointId), ["app/report.py:render_report"]);
});

test("E6: `hook run` says what it did", () => {
  const proj = join(tmp, "p");
  cpSync(join(ROOT, "test/fixtures/python_layout/scripts_demo"), proj, { recursive: true });
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"),
    "hook", "run", "post-edit", "--file", "tools/report.py", "--root", proj], { encoding: "utf-8", env: { ...process.env, CLAUDECODE: "" } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /hook run post-edit: (baseline recorded; no new findings|ran; no new findings|delivered \d+ chars of context|nothing to report)/);
});
