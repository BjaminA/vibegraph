// Untrusted input → dangerous sinks (2026-09-29, src/server/dataflow.ts).
// The fixture carries every shape the pass must tell apart, in three
// languages, plus the three a real codebase (a private production codebase) taught it: a
// destructured argv, a module-level value read inside a function, and a
// regex's .exec() that is not a shell exec.
//
//   npm run test:dataflow
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { computeDataflow, codeOf, boundNames, callsInText, formatDataflowMd } from "../src/server/dataflow.ts";
import { threadContexts } from "../scripts/thread_context.mjs";
import { formatContractBlock } from "../src/server/thread_contract.ts";
import { runDataflow } from "../scripts/cli/dataflow.mjs";
import { exportKnowledge } from "../scripts/export_knowledge.mjs";
import { runHook } from "../scripts/cli/hooks.mjs";

const ROOT = "test/fixtures/dataflow/taint_demo";
let env, report, cache;
before(() => {
  cache = mkdtempSync(join(tmpdir(), "vg-df-cache-"));
  process.env.VG_CACHE_DIR = cache;
  env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  report = computeDataflow(env);
});
after(() => { rmSync(cache, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });
const at = (file, line) => report.findings.find((f) => f.sink.file === file && f.sink.line === line);

test("reading code out of text: string literals are not code, interpolations are", () => {
  assert.doesNotMatch(codeOf('"name"', "python"), /name/);
  assert.match(codeOf('f"SELECT {name}"', "python"), /name/);
  assert.match(codeOf("`nslookup ${domain}`", "jsts"), /domain/);
  assert.doesNotMatch(codeOf("'$1'", "bash"), /\$1/);
  assert.match(codeOf('"$query"', "bash"), /\$query/);
  assert.deepEqual(boundNames("[, , target]"), ["target"]);
  assert.deepEqual(boundNames("{ a, b: c, ...rest }"), ["a", "c", "rest"]);
  assert.deepEqual(boundNames("host"), ["host"]);
  assert.deepEqual(callsInText('conn.execute(f"x {n}", (a, b)).fetchall()')[0], { callee: "conn.execute", args: ['f"x {n}"', "(a, b)"] });
});

test("unguarded: shell strings, SQL query text, eval — across calls and languages", () => {
  const high = report.findings.filter((f) => f.severity === "high").map((f) => `${f.kind} ${f.sink.file}:${f.sink.line}`).sort();
  assert.deepEqual(high, [
    "code run_query.sh:8", "command app.py:19", "command helpers.py:8", "command server.ts:12", "command server.ts:31",
    "sql app.py:28", "sql run_query.sh:7",
  ]);
  assert.deepEqual(at("helpers.py", 8).path, ["archive_route", "archive"], "followed into the helper's parameter");
  assert.match(at("app.py", 28).sink.text, /^conn\.execute\(/, "found inside a method chain");
  assert.match(at("server.ts", 31).source.what, /process\.argv/, "a destructured argv, read as a module global");
});

test("review, not unguarded: a condition on the way, and a list-form subprocess", () => {
  assert.equal(at("app.py", 55).severity, "review");
  assert.match(at("app.py", 55).guard, /kind not in ALLOWED/);
  assert.equal(at("app.py", 70).kind, "argument");
});

test("safe shapes are not findings", () => {
  assert.equal(at("app.py", 36), undefined, "parameterised SQL");
  assert.equal(at("app.py", 44), undefined, "int() before the query text");
  assert.equal(at("app.py", 76), undefined, "no input at all");
  assert.equal(report.findings.find((f) => f.sink.file === "server.ts" && f.kind === "sql"), undefined, "pg parameters");
  assert.equal(report.findings.find((f) => /officerId/.test(f.sink.fn)), undefined, "a regex's .exec() is not a shell");
  assert.equal(report.findings.length, 9);
});

test("the report and the thread contract say it, with the limits", () => {
  const md = formatDataflowMd(report);
  assert.match(md, /## Unguarded \(7\)/);
  assert.match(md, /no findings is not a clean bill/);
  assert.match(md, /second-order input/);
  const ctx = threadContexts(env, ROOT, [], { dataflow: report, only: new Set(["app.py:archive_route"]) });
  const block = formatContractBlock(ctx.byEntry.get("app.py:archive_route").contract);
  assert.match(block, /Untrusted input reaches \(name-based data flow/);
  assert.match(block, /- \[UNGUARDED\] reaches a shell command: `os\.system\("tar czf backup\.tgz " \+ target\)` \(helpers\.py:8\) from `request\.json\["path"\]`/);
});

test("the CLI exits 1 on an unguarded flow; the export writes security.md", () => {
  const r = runDataflow([ROOT]);
  assert.equal(r.exitCode, 1);
  assert.match(r.text, /Unguarded \(7\)/);
  const out = mkdtempSync(join(tmpdir(), "vg-df-exp-"));
  try {
    exportKnowledge({ root: ROOT, out, commit: "t" });
    assert.match(readFileSync(join(out, "security.md"), "utf-8"), /reaches a shell command/);
    assert.match(readFileSync(join(out, "README.md"), "utf-8"), /\*\*Untrusted input:\*\* `security\.md`[^\n]*\(7 unguarded, 2 to review\)/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("the post-edit hook notes a NEW unguarded flow an edit introduced (advisory)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "vg-df-hook-"));
  try {
    const root = join(tmp, "p");
    cpSync(ROOT, root, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "b"], { cwd: root });
    const hook = (event, input) => runHook(event, input, { absRoot: root, pipeline: {} });
    hook("prompt", { session_id: "s", prompt: "tidy ping_route in app.py" });
    const src = readFileSync(join(root, "app.py"), "utf-8");
    writeFileSync(join(root, "app.py"), src.replace('    os.system("uptime")', '    who = request.args.get("who")\n    os.system("finger " + who)'));
    const r = hook("post-edit", { session_id: "s", tool_name: "Edit", tool_input: { file_path: join(root, "app.py") } });
    const text = r?.block ?? r?.json?.hookSpecificOutput?.additionalContext ?? "";
    assert.match(text, /New since the session began — untrusted input now reaches a dangerous sink/);
    assert.match(text, /os\.system\("finger " \+ who\)/);
    assert.equal(r.block, undefined, "advisory: it never blocks");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
