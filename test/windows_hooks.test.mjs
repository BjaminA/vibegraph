// `init --hooks --windows` (2026-10-01): hooks for a Claude Code running on
// WINDOWS against a project inside WSL. Measured on this laptop before it was
// written down: Git Bash (Claude Code's default hook shell on Windows)
// rewrites `/tmp/x` into `C:/Users/…/Temp/x` on its way to wsl.exe, while
// `//tmp/x` passes Git Bash and PowerShell untouched and Linux reads it as
// `/tmp/x`; PowerShell prepends a byte-order mark when it pipes text; and
// Claude Code hands file paths as \\wsl.localhost\<distro>\…. Live, from both
// Windows shells and from inside WSL: the prompt hook delivered its context
// and the post-edit hook blocked a c3 bypass with exit 2. Here: the command's
// shape, the path translation, and the CLI's own hook entry fed what Windows
// sends (no wsl.exe needed, so it runs anywhere).
//
//   npm run test:windows-hooks
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { windowsHookCommand, HOOK_MARKER } from "../scripts/cli/init.mjs";
import { fromWindowsPath, hookInputFromWindows } from "../scripts/cli/winpath.mjs";
delete process.env.CLAUDECODE;

test("the command is one executable with arguments: no shell syntax, every absolute path spelled // for Git Bash", () => {
  const c = windowsHookCommand("/home/u/proj", "post-edit", { VG_PYTHON: "/usr/bin/python3" }, "Ubuntu",
    ["node", "/usr/lib/node_modules/vibegraph-knowledge/dist/cli.mjs"], "/usr/bin/node", []);
  assert.equal(c, `wsl.exe -d Ubuntu -e //usr/bin/env VG_PYTHON=//usr/bin/python3 //usr/bin/node //usr/lib/node_modules/vibegraph-knowledge/dist/cli.mjs hook post-edit --root //home/u/proj ${HOOK_MARKER}`);
  assert.doesNotMatch(c, /\$|"|;|&&/, "nothing a shell would interpret");
  assert.match(windowsHookCommand("/home/u/my proj", "stop", {}, "Ubuntu", ["node", "/x/cli.mjs"], "/n", []), /--root '\/\/home\/u\/my proj'/, "a space is single-quoted — literal in both shells");
  assert.throws(() => windowsHookCommand("/p", "stop", {}, ""), /run init from inside the WSL distro/);
  assert.throws(() => windowsHookCommand("/p", "stop", {}, "Ubuntu", ["node", "/home/u/.npm/_npx/ab/node_modules/x/cli.mjs"], "/n", []), /installed CLI/);
  assert.throws(() => windowsHookCommand("/it's", "stop", {}, "Ubuntu", ["node", "/x/cli.mjs"], "/n", []), /single quote/);
});

test("Windows paths become WSL paths; anything else is left alone", () => {
  assert.equal(fromWindowsPath("\\\\wsl.localhost\\Ubuntu\\home\\u\\a.ts"), "/home/u/a.ts");
  assert.equal(fromWindowsPath("\\\\wsl$\\Ubuntu\\tmp\\x"), "/tmp/x");
  assert.equal(fromWindowsPath("//wsl.localhost/Ubuntu/home/u"), "/home/u");
  assert.equal(fromWindowsPath("\\\\wsl.localhost\\Ubuntu"), "/");
  assert.equal(fromWindowsPath("C:\\Users\\me\\x.py"), "/mnt/c/Users/me/x.py");
  assert.equal(fromWindowsPath("/home/u/a.ts"), "/home/u/a.ts");
  assert.equal(fromWindowsPath("src/a.ts"), "src/a.ts");
  const i = hookInputFromWindows({ cwd: "\\\\wsl.localhost\\Ubuntu\\p", tool_input: { file_path: "\\\\wsl.localhost\\Ubuntu\\p\\a.py", command: "ls C:\\x" } });
  assert.deepEqual(i, { cwd: "/p", tool_input: { file_path: "/p/a.py", command: "ls C:\\x" } }, "a Bash command's text is never rewritten");
});

let base, root;
before(() => {
  base = mkdtempSync(join(tmpdir(), "vg-winhooks-"));
  root = join(base, "fleet");
  process.env.VG_CACHE_DIR = join(base, "cache");
  cpSync("examples/fleet-telemetry", root, { recursive: true, filter: (p) => !p.includes("__pycache__") });
  const git = (...a) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  git("init", "-q"); git("add", "-A"); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
});
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

test("the hook entry takes what Windows sends: a //root, a byte-order mark, a UNC file path — and still blocks a new violation", () => {
  const unc = (p) => `\\\\wsl.localhost\\Ubuntu${p.split("/").join("\\")}`;
  const run = (event, input) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", "hook", event, "--root", `/${root}`, HOOK_MARKER], {
    input: "\uFEFF" + JSON.stringify(input), encoding: "utf-8", env: { ...process.env, VG_CACHE_DIR: join(base, "cache") },
  });
  const p = run("prompt", { session_id: "w1", cwd: unc(root), prompt: "add a region-change page in telemetry/alerts.py" });
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /Operators are paged ONLY through alerts\.notify/, "the BOM did not break the JSON; the //root was folded");
  appendFileSync(join(root, "telemetry", "alerts.py"), "\n\ndef check_region(reading: dict) -> None:\n    notify({\"device_id\": reading[\"device_id\"], \"message\": \"region changed\"})\n");
  const e = run("post-edit", { session_id: "w1", tool_name: "Edit", cwd: unc(root), tool_input: { file_path: unc(join(root, "telemetry", "alerts.py")) } });
  assert.equal(e.status, 2, `the UNC path reached the edited file: ${e.stdout}${e.stderr}`);
  assert.match(e.stderr, /\[c3\][\s\S]*VIOLATED at telemetry\/alerts\.py:module\/check_region\.fn\/notify\.call/);
});
