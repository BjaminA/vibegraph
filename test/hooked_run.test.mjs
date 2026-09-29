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
  const blocked = parseStreamLine(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "VibeGraph …\nThis edit breaks a stated rule. Fix it…\n[c3 · invariant] …" }] } }));
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
