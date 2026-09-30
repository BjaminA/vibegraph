// `init --hooks` + `hook <event>` (2026-09-28): VibeGraph's delivery and
// enforcement inside one Claude Code session. Driven here through runHook on
// a copy of the fleet example (its operators' rules are the real ones), with
// the envelope cache in a temp dir.
//
//   npm run test:hooks
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fitText, INLINE_CAP, runHook } from "../scripts/cli/hooks.mjs";
import { readLessons, runLessons } from "../scripts/cli/lessons.mjs";
import { fitContract, restOfContract } from "../scripts/cli/contract_fit.mjs";
import { runSkills } from "../scripts/cli/skills.mjs";
import { keywordTerms } from "../src/server/thread_keywords.ts";
import { applyHooks, hookCommand, HOOK_MARKER } from "../scripts/cli/init.mjs";
// These tests act as a PERSON at the command line; a Claude Code terminal sets CLAUDECODE,
// which makes the CLI refuse a person's steps (scripts/cli/actor.mjs) — so it is cleared here.
delete process.env.CLAUDECODE;

let base, root;
const DIRECT_NOTIFY = "\n\nfrom telemetry.alerts import notify\n\n\ndef page_direct(e):\n    notify(e)\n";
before(() => {
  base = mkdtempSync(join(tmpdir(), "vg-hooks-"));
  root = join(base, "fleet");
  process.env.VG_CACHE_DIR = join(base, "cache");
  cpSync("examples/fleet-telemetry", root, { recursive: true, filter: (p) => !p.includes("__pycache__") });
  const git = (...a) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  git("init", "-q"); git("add", "-A"); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
});
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

const hook = (event, input) => runHook(event, input, { absRoot: root, pipeline: {} });
const edit = (session, file) => hook("post-edit", { session_id: session, tool_name: "Edit", tool_input: { file_path: join(root, file) } });
const restore = (file) => execFileSync("git", ["checkout", "-q", "--", file], { cwd: root });

test("prompt: the matched thread's contract and routed rules arrive once per session", () => {
  const r = hook("prompt", { session_id: "a", prompt: "make evaluate in telemetry/alerts.py page on region changes" });
  const ctx = r.json.hookSpecificOutput.additionalContext;
  assert.equal(r.json.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(ctx, /Thread contract \(IR fact/);
  assert.match(ctx, /telemetry\/alerts\.py:evaluate/);
  assert.match(ctx, /Operators are paged ONLY through alerts\.notify/, "c3, routed by its file scope, with its reason");
  const again = hook("prompt", { session_id: "a", prompt: "and keep evaluate in telemetry/alerts.py simple" });
  const ctx2 = again?.json?.hookSpecificOutput?.additionalContext ?? "";
  assert.match(ctx2, /already given earlier in this session/);
  assert.doesNotMatch(ctx2, /Operators are paged ONLY/, "a rule is not repeated in one session");
});

test("post-edit: a NEW violation blocks with the rule, its reason and the offending call", () => {
  hook("prompt", { session_id: "b", prompt: "add paging to telemetry/ingest.py" });
  appendFileSync(join(root, "telemetry/ingest.py"), DIRECT_NOTIFY);
  const r = edit("b", "telemetry/ingest.py");
  assert.ok(r.block, "blocks");
  assert.match(r.block, /\[c3\] Operators are paged ONLY/);
  assert.match(r.block, /VIOLATED at telemetry\/ingest\.py:module\/page_direct\.fn\/notify\.call/);
  assert.equal((r.block.match(/\[c3\]/g) ?? []).length, 1, "one block per rule, however many of its checks failed");

  const s1 = hook("stop", { session_id: "b" });
  assert.ok(s1.block, "the turn may not end on a violation");
  const s2 = hook("stop", { session_id: "b", stop_hook_active: true });
  assert.equal(s2.block, undefined, "never loops: already continuing because of this hook");
  assert.match(s2.json.systemMessage, /stated-rule violation/);

  restore("telemetry/ingest.py");
  const fixed = edit("b", "telemetry/ingest.py");
  assert.equal(fixed.block, undefined);
  assert.equal(hook("stop", { session_id: "b" }), null);
});

test("an edit made through Bash is caught too; a Bash call that changed no code is free", () => {
  // h2h4: a headless session made all 18 of its tool calls through Bash.
  hook("prompt", { session_id: "sh", prompt: "add paging to telemetry/ingest.py" });
  const bash = () => hook("post-edit", { session_id: "sh", tool_name: "Bash", tool_input: { command: "…" } });
  assert.equal(bash().block, undefined, "first Bash call: nothing new");
  assert.equal(bash(), null, "no source file moved: skipped without a parse");
  appendFileSync(join(root, "telemetry/ingest.py"), DIRECT_NOTIFY);
  const r = bash();
  assert.match(r.block, /\[c3\]/);
  assert.match(r.block, /telemetry\/ingest\.py:module\/page_direct\.fn\/notify\.call/);
  restore("telemetry/ingest.py");
  assert.equal(bash().block, undefined);
});

test("a violation the tree already had at the session's first prompt never blocks", () => {
  appendFileSync(join(root, "telemetry/ingest.py"), DIRECT_NOTIFY);
  hook("prompt", { session_id: "c", prompt: "tidy telemetry/export.py" });
  const r = edit("c", "telemetry/ingest.py");
  assert.equal(r.block, undefined, "baseline, not this session's doing");
  assert.equal(hook("stop", { session_id: "c" }), null);
  restore("telemetry/ingest.py");
});

test("an edit that breaks the parse blocks; a non-source file is ignored", () => {
  hook("prompt", { session_id: "d", prompt: "edit telemetry/normalize.py" });
  appendFileSync(join(root, "telemetry/normalize.py"), "\ndef broken(:\n");
  const r = edit("d", "telemetry/normalize.py");
  assert.match(r.block, /could not parse telemetry\/normalize\.py/);
  restore("telemetry/normalize.py");
  assert.equal(edit("d", "README.md"), null);
  assert.equal(edit("d", "../outside.py"), null);
});

test("an edit to a file the parser read only PARTLY is checked, not refused", () => {
  // The pinned TypeScript grammar cannot read type arguments after an
  // import type: `import("./r").W<T>` drops one construct, the rest parses.
  hook("prompt", { session_id: "partial", prompt: "edit gateway/partial.ts" });
  writeFileSync(join(root, "gateway/partial.ts"), 'function f(d: import("./cache").Cache<any, any>) {}\nexport function keep(): number {\n  return 1;\n}\n');
  const r = edit("partial", "gateway/partial.ts");
  assert.equal(r.block, undefined, "a partly read file carries an IR: never a parse failure");
  assert.match(r.json.hookSpecificOutput.additionalContext, /gateway\/partial\.ts was read only partly/);
  rmSync(join(root, "gateway/partial.ts"));
});

test("init --hooks merges into settings.local.json, is idempotent, and removes only its own", () => {
  const dir = join(base, "proj");
  mkdirSync(join(dir, ".claude"), { recursive: true });
  const foreign = { type: "command", command: "echo mine" };
  writeFileSync(join(dir, ".claude", "settings.local.json"), JSON.stringify({ model: "x", hooks: { Stop: [{ hooks: [foreign] }] } }));
  const cmd = (r, e) => hookCommand(r, e, { VG_PYTHON: "/usr/bin/python3" });
  assert.equal(applyHooks({ root: dir, command: cmd }).state, "installed");
  const s = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf-8"));
  assert.equal(s.model, "x");
  assert.equal(s.hooks.PostToolUse[0].matcher, "Write|Edit|MultiEdit|NotebookEdit|Bash");
  assert.match(s.hooks.SessionStart[0].hooks[0].command, / hook session-start /);
  assert.match(s.hooks.UserPromptSubmit[0].hooks[0].command, /^VG_PYTHON="\/usr\/bin\/python3" .* hook prompt --root .* --vg-hook$/);
  assert.deepEqual(s.hooks.Stop[0].hooks[0], foreign, "a foreign hook is kept");
  assert.equal(applyHooks({ root: dir, command: cmd }).state, "unchanged");
  assert.equal(applyHooks({ root: dir, remove: true }).state, "removed");
  const after = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf-8"));
  assert.ok(!JSON.stringify(after).includes(HOOK_MARKER));
  assert.deepEqual(after.hooks, { Stop: [{ hooks: [foreign] }] });
  assert.equal(existsSync(join(dir, ".claude", "settings.json")), false, "never the committed settings file");
});

// ── 2026-09-29, from the OpenViking review ─────────────────────────────

test("session start orients; after a compaction, contracts and rules are delivered again", () => {
  const s = hook("session-start", { session_id: "cmp", source: "startup" });
  const ctx = s.json.hookSpecificOutput.additionalContext;
  assert.equal(s.json.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(ctx, /This project: \d+ parsed source files .*entry points/);
  assert.match(ctx, /\[c3 · invariant\] Operators are paged ONLY/);
  assert.match(ctx, /checked: callers-only/);
  assert.equal(hook("session-start", { session_id: "cmp", source: "resume" }), null, "resumed with its context: nothing to repeat");

  const ask = () => hook("prompt", { session_id: "cmp", prompt: "tighten evaluate in telemetry/alerts.py" }).json.hookSpecificOutput.additionalContext;
  assert.match(ask(), /Thread contract \(IR fact/);
  assert.match(ask(), /already given earlier in this session/);
  const after = hook("session-start", { session_id: "cmp", source: "compact" }).json.hookSpecificOutput.additionalContext;
  assert.match(after, /compacted/);
  assert.match(ask(), /Thread contract \(IR fact/, "the compaction emptied the context, so the contract comes back");
});

test("every hook context stays under Claude Code's inline limit, and says what it cut", () => {
  const r = hook("prompt", { session_id: "cap", prompt: "change telemetry/alerts.py, telemetry/ingest.py and telemetry/storage.py together" });
  const ctx = r.json.hookSpecificOutput.additionalContext;
  assert.ok(ctx.length <= INLINE_CAP, `${ctx.length} chars`);
  const cut = fitText("line\n".repeat(4000), 500, "see the export");
  assert.ok(cut.length <= 500);
  assert.match(cut, /more characters not shown — the inline limit; see the export\)$/);
});

test("a prompt that names no code gets a keyword guess, labelled as one", () => {
  const r = hook("prompt", { session_id: "kw", prompt: "make the csv export carry one more column" });
  const ctx = r.json.hookSpecificOutput.additionalContext;
  assert.match(ctx, /Possibly related: thread telemetry\/export:export_csv/);
  assert.match(ctx, /a KEYWORD guess from the words "export", "csv"|a KEYWORD guess from the words "csv", "export"/);
  assert.match(ctx, /check this is the right place/);
  const none = hook("prompt", { session_id: "kw2", prompt: "hello there, how are you today?" });
  assert.ok(!none || !/Possibly related/.test(none.json.hookSpecificOutput.additionalContext), "no shared words, no guess");
});

test("a blocked violation that clears becomes a lesson, and skill drafting reads it", async () => {
  hook("prompt", { session_id: "les", prompt: "add paging to telemetry/ingest.py" });
  appendFileSync(join(root, "telemetry/ingest.py"), DIRECT_NOTIFY);
  assert.ok(edit("les", "telemetry/ingest.py").block);
  const p = join(root, "telemetry/ingest.py");
  writeFileSync(p, readFileSync(p, "utf-8").replace("    notify(e)\n", "    print(e)\n"));
  assert.equal(edit("les", "telemetry/ingest.py").block, undefined);
  const mine = readLessons(root).filter((l) => l.session === "les");
  assert.ok(mine.length >= 1, "one episode per cleared finding");
  assert.equal(mine[0].ruleId, "c3");
  assert.match(mine[0].offender, /^telemetry\/ingest\.py:module\/page_direct\.fn\/notify\.call$/);
  assert.match(mine[0].diff, /\+    print\(e\)/, "the file's diff at the moment it cleared");
  const listed = runLessons({ root });
  assert.match(listed.text, /\[c3\] Operators are paged ONLY .* broken and put right/);

  const r = await runSkills({ root, sub: "draft", targets: ["telemetry/ingest.py:ingest_batch"], values: { "dry-run": true }, pipeline: {} });
  const prompt = r.lines.join("\n");
  assert.match(prompt, /Recent episodes on this thread, recorded by the VibeGraph hooks/);
  assert.match(prompt, /rule c3 .*broken at telemetry\/ingest\.py:module\/page_direct\.fn\/notify\.call/);
  const off = await runSkills({ root, sub: "draft", targets: ["telemetry/ingest.py:ingest_batch"], values: { "dry-run": true, "no-lessons": true }, pipeline: {} });
  assert.doesNotMatch(off.lines.join("\n"), /Recent episodes/);
  restore("telemetry/ingest.py");
});

test("a long contract is shortened by section, never from the end, and what was held back is sent later", () => {
  const touches = ["Touches (external calls, by effect):", ...Array.from({ length: 30 }, (_, i) => `- [db] conn.execute(query_${i}) \`module/f.fn/c${i}.call\``)].join("\n");
  const text = [
    "## Thread contract (IR fact)\nSeed: app:f (Python, app.py)\nEnters: x\nLeaves: none",
    touches,
    "Round trips inside loops: none found.",
    `Stack (tools this thread's files use — IR fact): ${"sqlite3 [db, 4 sites]; ".repeat(40)}`,
    "Cross-thread: reaches (none); reached by (none)\nWhere static knowledge ends: 2 resolution gap(s), 0 runtime dispatch",
  ].join("\n\n");
  const fit = fitContract(text, 1400);
  assert.ok(fit && fit.text.length <= 1400, `${fit?.text.length}`);
  assert.match(fit.text, /^## Thread contract/, "the header stays");
  assert.match(fit.text, /Where static knowledge ends: 2 resolution gap/, "the closing block stays — a plain cut would lose it first");
  assert.match(fit.text, /Round trips inside loops/);
  assert.doesNotMatch(fit.text, /^Stack \(/m, "the imported-tools line goes first");
  assert.match(fit.text, /- \[\d+ more held back for length/);
  assert.equal(fit.held.length, 2, "the Stack line and the shortened list are remembered");
  const rest = restOfContract(text, fit.held, 20000);
  assert.match(rest.text, /query_29/, "the whole list arrives next time");
  assert.match(rest.text, /^Stack \(/m);
  assert.deepEqual(rest.held, []);
  assert.equal(fitContract("short", 100).held.length, 0);
});

test("the drill prompt: a contract held back in part arrives in full on the next prompt naming its thread", () => {
  const TASK = "Devices now report a `region`. Persist it in `telemetry/storage.py` (`insert_readings`, `readings_between`), accept it on ingest (`telemetry/ingest.py`, `telemetry/schema.py`, `telemetry/normalize.py`), include it in `telemetry/export.py`, show it in `telemetry/devices.py` and `gateway/server.ts` (`getFleet`), and page on region change (`telemetry/alerts.py`).";
  const first = hook("prompt", { session_id: "part", prompt: TASK }).json.hookSpecificOutput.additionalContext;
  assert.ok(first.length <= INLINE_CAP);
  assert.match(first, /Where static knowledge ends/, "no contract lost its closing block");
  const second = hook("prompt", { session_id: "part", prompt: TASK }).json.hookSpecificOutput.additionalContext;
  assert.ok(second.length <= INLINE_CAP);
  if (/held back for length/.test(first) || /shortened to fit/.test(first)) {
    assert.match(second, /The rest of this thread's contract, held back earlier for length/);
  }
});

test("keyword terms split identifiers and paths, fold plurals, drop stop words", () => {
  assert.deepEqual(keywordTerms("exportCsv readings_between telemetry/alerts.py"), ["export", "csv", "reading", "between", "telemetry", "alert"]);
  assert.deepEqual(keywordTerms("make the change please"), []);
});

test("run from npx, a hook re-runs the pinned version through npx — npx's cache is not a stable path", () => {
  const npx = hookCommand("/p", "prompt", {}, ["node", "/home/u/.npm/_npx/3f2a/node_modules/vibegraph-knowledge/dist/cli.mjs"], "/usr/bin/node", [], "0.10.0");
  assert.match(npx, /^npx --yes vibegraph-knowledge@0\.10\.0 hook prompt --root "\/p" --vg-hook$/);
  const installed = hookCommand("/p", "stop", {}, ["node", "/usr/lib/node_modules/vibegraph-knowledge/dist/cli.mjs"], "/usr/bin/node", [], "0.10.0");
  assert.match(installed, /^"\/usr\/bin\/node" "\/usr\/lib\/node_modules\/vibegraph-knowledge\/dist\/cli\.mjs" hook stop/);
});
