// Hooks across OS boundaries (2026-10-01, item 6 of the hooks-feedback brief):
// `hook install --target wsl`, `hook run <event>` (the payload built for you,
// the hook's own exit codes) and `doctor` (installed, runnable from here,
// fired since installed). Driven through the dev CLI on a copy of the fleet
// example, whose c3 rule a direct notify() violates.
//
//   npm run test:hook-tools
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { doctorReport, hookRunPayload, recordFired } from "../scripts/cli/hook_tools.mjs";
import { applyHooks, hookCommand } from "../scripts/cli/init.mjs";

let base, root;
const env = () => { const e = { ...process.env, VG_CACHE_DIR: join(base, "cache") }; delete e.CLAUDECODE; return e; };
const cli = (args, input) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", ...args], { encoding: "utf-8", env: env(), input });
before(() => {
  base = mkdtempSync(join(tmpdir(), "vg-hooktools-"));
  root = join(base, "fleet");
  process.env.VG_CACHE_DIR = join(base, "cache");
  cpSync("examples/fleet-telemetry", root, { recursive: true, filter: (p) => !p.includes("__pycache__") });
  const git = (...a) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  git("init", "-q"); git("add", "-A"); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
});
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

test("hook run builds the payload Claude Code would send", () => {
  assert.deepEqual(hookRunPayload("post-edit", { absRoot: "/r", file: "/r/a.py" }).tool_input, { file_path: "/r/a.py" });
  assert.equal(hookRunPayload("post-edit", { absRoot: "/r", command: "sed -i x a.py" }).tool_name, "Bash");
  assert.equal(hookRunPayload("prompt", { absRoot: "/r", prompt: "hi" }).hook_event_name, "UserPromptSubmit");
  assert.equal(hookRunPayload("session-start", { absRoot: "/r" }).source, "startup");
});

test("hook run keeps the hook's exit contract: 0 clean, 2 on a new violation, with the rule", () => {
  const p = cli(["hook", "run", "prompt", root, "--session", "s", "--prompt", "add paging to telemetry/ingest.py"]);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /UserPromptSubmit/);
  const clean = cli(["hook", "run", "post-edit", root, "--session", "s", "--file", "telemetry/ingest.py"]);
  assert.equal(clean.status, 0, clean.stderr);
  appendFileSync(join(root, "telemetry/ingest.py"), "\n\nfrom telemetry.alerts import notify\n\n\ndef page_direct(e):\n    notify(e)\n");
  const r = cli(["hook", "run", "post-edit", root, "--session", "s", "--file", "telemetry/ingest.py"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\[c3\]/);
  execFileSync("git", ["checkout", "-q", "--", "telemetry/ingest.py"], { cwd: root });
  assert.equal(cli(["hook", "run", "post-edit", root]).status, 2, "post-edit with no --file/--command is a usage error");
  assert.equal(cli(["hook", "run", "nope", root]).status, 2);
});

test("hook install --target wsl writes the wsl.exe form; posix the plain one", { skip: !process.env.WSL_DISTRO_NAME && "needs WSL" }, () => {
  const r = cli(["hook", "install", "--target", "wsl", root]);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(readFileSync(join(root, ".claude/settings.local.json"), "utf-8"));
  const cmds = Object.values(s.hooks).flat().flatMap((m) => m.hooks.map((h) => h.command));
  assert.equal(cmds.length, 4);
  for (const c of cmds) assert.match(c, /^wsl\.exe -d \S+ -e /);
  assert.equal(cli(["hook", "install", "--target", "mac", root]).status, 2);
  const refused = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", "hook", "install", "--remove", root], { encoding: "utf-8", env: { ...env(), CLAUDECODE: "1" } });
  assert.equal(refused.status, 1, "taking the hooks out is a person's step");
  assert.equal(cli(["hook", "install", "--remove", root]).status, 0);
});

test("doctor: configured but never fired warns; a real fire clears it; a manual run does not count", () => {
  applyHooks({ root, command: (r, ev) => hookCommand(r, ev, {}, ["node", join(process.cwd(), "scripts/cli/main.mjs")], process.execPath, []) });
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(root, ".claude/settings.local.json"), old, old);
  let d = cli(["doctor", root]);
  assert.equal(d.status, 1);
  assert.match(d.stdout, /4 VibeGraph hook\(s\) installed/);
  assert.match(d.stdout, /NOT fired since they were installed/);
  assert.match(d.stdout, /hook install --target wsl/);
  cli(["hook", "run", "stop", root, "--session", "m"]);
  assert.equal(cli(["doctor", root]).status, 1, "hook run is a test, not evidence Claude Code fires them");
  const fired = cli(["hook", "session-start", "--root", root], JSON.stringify({ session_id: "z", source: "startup" }));
  assert.equal(fired.status, 0, fired.stderr);
  d = cli(["doctor", root]);
  assert.equal(d.status, 0, d.stdout);
  assert.match(d.stdout, /last fired: session-start/);
  // From the Windows side, a Linux-path command cannot run at all.
  recordFired(root, "prompt", "w");
  const w = doctorReport(root, { platform: "win32" });
  assert.equal(w.ok, false);
  assert.ok(w.lines.some(([, t]) => /Windows cannot run/.test(t)));
});
