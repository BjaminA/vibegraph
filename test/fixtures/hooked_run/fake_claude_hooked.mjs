#!/usr/bin/env node
// A stand-in for `claude -p … --output-format stream-json` in the hooked-run
// e2e (VG_CLAUDE_BIN). It behaves like a session that edits app.py — and it
// RUNS THE HOOK COMMANDS it was handed through --settings, exactly as Claude
// Code would (session-start, then post-edit after its edit), so the test
// proves the injected hooks fire and block, not only that a flag was passed.
//
// The task decides the edit: a task containing "purge" calls store.purge
// from app.py (breaking the fixture's stated rule c1); anything else only
// rewrites a docstring. Every argument is recorded in
// .vibegraph/fake-claude-args.json for the spec to read.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const task = argv[argv.length - 1];
const si = argv.indexOf("--settings");
const settings = si >= 0 ? JSON.parse(argv[si + 1]) : null;
mkdirSync(".vibegraph", { recursive: true });
writeFileSync(join(".vibegraph", "fake-claude-args.json"), JSON.stringify({ argv, settings }, null, 2));

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const hook = (event, input) => {
  const cmd = settings?.hooks?.[event]?.[0]?.hooks?.[0]?.command;
  if (!cmd) return { code: null, stdout: "", stderr: "" };
  try {
    const stdout = execSync(cmd, { input: JSON.stringify(input), encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], shell: "/bin/sh" });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
};

out({ type: "system", subtype: "init", session_id: "fake-hooked" });
const start = hook("SessionStart", { session_id: "fake-hooked", source: "startup" });
if (start.stdout.includes("Stated rules")) out({ type: "assistant", message: { content: [{ type: "text", text: "Read the VibeGraph orientation: 1 stated rule." }] } });

out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "app.py" } }] } });
let src = readFileSync("app.py", "utf-8");
if (/purge/.test(task)) {
  src = src.replace("from store import save", "from store import save, purge") + "\n\ndef wipe():\n    \"\"\"Clear everything.\"\"\"\n    return purge()\n";
} else {
  src = src.replace('"""Create a record."""', '"""Create one record and return what was stored."""');
}
writeFileSync("app.py", src);
const post = hook("PostToolUse", { session_id: "fake-hooked", tool_name: "Edit", tool_input: { file_path: join(process.cwd(), "app.py") } });
if (post.code === 2) out({ type: "user", message: { content: [{ type: "tool_result", content: post.stderr }] } });

out({
  type: "result", subtype: "success", is_error: false, num_turns: 3, duration_ms: 1234, total_cost_usd: 0.05,
  result: /purge/.test(task) ? "Added wipe() to app.py." : "Clarified create()'s docstring.",
});
