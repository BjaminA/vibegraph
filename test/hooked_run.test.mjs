// The hooked run's pure parts (src/server/hooked_run.ts) and its refusals
// (hooked_runner.ts): the hooks as --settings, the stream parse, and the
// snapshot that makes Reject an undo. The live path — spawn, injected hooks
// firing, Accept / Reject from the panel — is test:e2e-hooked-run.
//
//   npm run test:hooked-run
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hookSettings, parseStreamLine, projectHasHooks, snapshotTree, compareTree, restoreTree, editableFiles, dropSnapshot,
} from "../src/server/hooked_run.ts";
import { startHookedRun } from "../src/server/hooked_runner.ts";

const dir = mkdtempSync(join(tmpdir(), "vg-hooked-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("the hooks as inline settings: the four init --hooks installs, Python pinned, marked", () => {
  const s = hookSettings("/p r/oj", ["/usr/bin/node", "/x/cli.mjs"], { VG_PYTHON: "/usr/bin/python3" });
  assert.deepEqual(Object.keys(s.hooks).sort(), ["PostToolUse", "SessionStart", "Stop", "UserPromptSubmit"]);
  assert.equal(s.hooks.PostToolUse[0].matcher, "Write|Edit|MultiEdit|NotebookEdit|Bash");
  const cmd = s.hooks.PostToolUse[0].hooks[0].command;
  assert.equal(cmd, 'VG_PYTHON="/usr/bin/python3" "/usr/bin/node" "/x/cli.mjs" hook post-edit --root "/p r/oj" --vg-hook');
  mkdirSync(join(dir, "withhooks", ".claude"), { recursive: true });
  writeFileSync(join(dir, "withhooks", ".claude", "settings.local.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "x hook stop --vg-hook" }] }] } }));
  assert.equal(projectHasHooks(join(dir, "withhooks")), true, "the project's own hooks are not injected twice");
  assert.equal(projectHasHooks(dir), false);
});

test("the stream: tool calls, text, a hook's block, and the result", () => {
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "sed -i s/a/b/ app.py" } }] } })).events,
    [{ kind: "tool", text: "Bash sed -i s/a/b/ app.py" }]);
  assert.equal(parseStreamLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } })).events[0].kind, "text");
  const blocked = parseStreamLine(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "VibeGraph …\nThis edit introduced a break of a stated rule. Fix it before going on — …\n- [c3] Only the store writes status" }] } }));
  assert.match(blocked.events[0].text, /blocked an edit \(c3\)/);
  const r = parseStreamLine(JSON.stringify({ type: "result", result: "ok", total_cost_usd: 1.19, num_turns: 12, duration_ms: 163000, is_error: false }));
  assert.deepEqual(r.result, { text: "ok", costUsd: 1.19, turns: 12, durationMs: 163000, isError: false });
  assert.deepEqual(parseStreamLine("not json").events, []);
});

test("the snapshot: added, modified and deleted are seen, Reject restores byte for byte, .env and build dirs are left alone", () => {
  const root = join(dir, "proj");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "node_modules", "x"), { recursive: true });
  writeFileSync(join(root, "src", "a.py"), "a = 1\n");
  writeFileSync(join(root, "src", "gone.py"), "b = 2\n");
  writeFileSync(join(root, ".env"), "SECRET=1\n");
  writeFileSync(join(root, "node_modules", "x", "i.js"), "x\n");
  assert.deepEqual(editableFiles(root).files, ["src/a.py", "src/gone.py"]);
  const s = snapshotTree(root, "r1");
  assert.equal(s.ok, true);
  assert.equal(s.files, 2);
  writeFileSync(join(root, "src", "a.py"), "a = 2\n");
  rmSync(join(root, "src", "gone.py"));
  writeFileSync(join(root, "src", "new.py"), "c = 3\n");
  const changes = compareTree(root, "r1");
  assert.deepEqual(changes.map((c) => [c.file, c.status]), [["src/a.py", "modified"], ["src/gone.py", "deleted"], ["src/new.py", "added"]]);
  assert.match(changes[0].diff, /a = 2/);
  const touched = restoreTree(root, "r1", changes);
  assert.equal(touched.length, 3);
  assert.equal(readFileSync(join(root, "src", "a.py"), "utf-8"), "a = 1\n");
  assert.equal(readFileSync(join(root, "src", "gone.py"), "utf-8"), "b = 2\n");
  assert.equal(existsSync(join(root, "src", "new.py")), false);
  assert.deepEqual(compareTree(root, "r1"), []);
  dropSnapshot(root, "r1");
  assert.equal(existsSync(join(root, ".vibegraph", "work-snapshots", "hooked", "r1")), false);
});

test("refusals: an empty task, and a worker tier that is not Claude Code", () => {
  const deps = {
    root: join(dir, "proj"), target: { cmd: "x", args: [], label: "ollama:qwen", provider: "ollama", env: {} }, cli: [], pinEnv: {}, mcpUrl: null,
    checkSnapshot: () => [], settle: async () => {}, testsFor: () => [], afterRestore: async () => {}, broadcast: () => {},
  };
  assert.match(startHookedRun("  ", deps).error, /describe the task/);
  assert.match(startHookedRun("do it", deps).error, /needs Claude Code; the worker tier routes to ollama:qwen/);
});

// 2026-10-16 (review): a run could loosen a stated rule, the evidence then read
// the loosened rule, and Reject left it loosened.
test("what the project states under .vibegraph/ is snapshotted, marked, and put back by Reject", async () => {
  const { ruleChanges } = await import("../src/server/hooked_runner.ts");
  const root = join(dir, "stated");
  mkdirSync(join(root, ".vibegraph", "knowledge"), { recursive: true });
  writeFileSync(join(root, "app.py"), "x = 1\n");
  const rules = { version: "1", constraints: [{ id: "c1", kind: "invariant", text: "Only the store writes status.", scope: { all: true }, source: "human" }] };
  writeFileSync(join(root, ".vibegraph", "constraints.json"), JSON.stringify(rules));
  writeFileSync(join(root, ".vibegraph", "knowledge", "README.md"), "an export, not a statement\n");
  const files = editableFiles(root).files;
  assert.ok(files.includes(".vibegraph/constraints.json"), "a stated file is part of the snapshot");
  assert.ok(!files.some((f) => f.startsWith(".vibegraph/knowledge/") || f.startsWith(".vibegraph/work-snapshots/")), "exports and snapshots are not");
  assert.equal(snapshotTree(root, "h1").ok, true);
  writeFileSync(join(root, ".vibegraph", "constraints.json"), JSON.stringify({ version: "1", constraints: [] }));
  const changes = compareTree(root, "h1");
  assert.deepEqual(changes.map((c) => [c.file, c.status, !!c.stated]), [[".vibegraph/constraints.json", "modified", true]]);
  restoreTree(root, "h1", changes);
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".vibegraph", "constraints.json"), "utf-8")), rules, "Reject restores the rules");
  dropSnapshot(root, "h1");
  const c1 = rules.constraints[0];
  assert.deepEqual(ruleChanges([c1], []), ['c1 removed — "Only the store writes status."']);
  assert.deepEqual(ruleChanges([c1], [{ ...c1, text: "Anyone writes status." }]), ['c1 changed — now "Anyone writes status."']);
  assert.deepEqual(ruleChanges([c1], [c1]), []);
});

// 2026-10-16 — the run is a conversation: a `QUESTION:` line is the person's
// to answer, and the framing tells the session how the run works and what it knows.
test("a QUESTION: line becomes its own event; the framing names the project's facts and the tools", async () => {
  const { runFraming, RUN_DENIED_MCP } = await import("../src/server/hooked_framing.ts");
  const ev = parseStreamLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "I changed create().\nQUESTION: Should a duplicate id raise?\nQUESTION: Keep the old name too?" }] } })).events;
  assert.deepEqual(ev.map((e) => `${e.kind}: ${e.text}`), ["text: I changed create().", "question: Should a duplicate id raise?", "question: Keep the old name too?"]);
  const f = runFraming({ objective: "Partners see only signed decisions", rules: 3, waiting: 2, openQuestions: [{ id: "q1", text: "Does the platform sync deletes?" }], direction: ["repetition-cost"] });
  for (const want of ['Objective: "Partners see only signed decisions"', "3 stated rules", "2 decisions wait for a person", "q1: Does the platform sync deletes?", "Direction enabled: repetition-cost", "`QUESTION:`", "vibegraph_thread_brief", "vibegraph_coverage", "Never edit .vibegraph/"]) assert.ok(f.includes(want), want);
  const bare = runFraming({ objective: null, rules: 0, waiting: 0, openQuestions: [], direction: [] });
  assert.match(bare, /Objective: none stated/);
  assert.doesNotMatch(bare, /wait for a person|Open plan questions|Direction enabled/, "what is not there is not said");
  assert.ok(RUN_DENIED_MCP.includes("mcp__vibegraph__vibegraph_propose_architecture") && RUN_DENIED_MCP.includes("mcp__vibegraph__vibegraph_spawn_thread_agent"));
  assert.ok(!RUN_DENIED_MCP.some((t) => /thread_brief|coverage|plan_edit/.test(t)), "the reading tools stay");
});
