// FINDING CLAUDE ON EVERY PLATFORM (2026-10-07). On Windows VibeGraph said
// "claude CLI not on PATH — Install Claude Code" while `claude` worked in
// PowerShell: four copies of the lookup split VG_CLAUDE_BIN on spaces and
// spawned the bare word `claude` with no shell, which on Windows finds only a
// real .exe — never npm's claude.cmd — and they searched PATH alone. Pinned
// here, the brief's matrix, over a virtual filesystem per platform: an npm
// wrapper followed to the package's claude.exe (or its JS entry, run with
// this Node), the native installer and the editor's bundled binary found off
// PATH, a path with spaces used whole, a JSON array, a quoted argv line, the
// saved setting, the execute bit, every place tried when nothing is found; a
// prompt with & % ^ " reaching Claude exactly as written, with no permission
// bypass; and that no other file reads VG_CLAUDE_BIN or spawns "claude".
//
//   npm run test:find-claude
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { findClaude, isMissing, parseArgv, pinnedModel } from "../src/server/find_claude.ts";
import { spawnClassifier } from "../scripts/cli/classify.mjs";
import { runConfig } from "../scripts/cli/config.mjs";

/** A virtual machine: `files` maps a path to { text?, exec? }. */
function vio(platform, files, { home = platform === "win32" ? "C:\\Users\\u" : "/home/u", config = null } = {}) {
  const sep = platform === "win32" ? "\\" : "/";
  const cfg = platform === "win32" ? `${home}\\AppData\\Roaming\\vibegraph\\config.json` : `${home}/.config/vibegraph/config.json`;
  const all = { ...files, ...(config ? { [cfg]: { text: JSON.stringify(config) } } : {}) };
  return {
    platform, home, execPath: platform === "win32" ? "C:\\node\\node.exe" : "/usr/bin/node",
    isFile: (p) => p in all, isExecutable: (p) => p in all && (platform === "win32" || !!all[p].exec),
    read: (p) => all[p]?.text ?? null,
    list: (d) => [...new Set(Object.keys(all).filter((p) => p.startsWith(d + sep)).map((p) => p.slice(d.length + 1).split(sep)[0]))],
    configFile: () => cfg,
  };
}
const WIN_ENV = { PATH: "C:\\Windows\\System32;C:\\Users\\u\\AppData\\Roaming\\npm", PATHEXT: ".COM;.EXE;.BAT;.CMD", APPDATA: "C:\\Users\\u\\AppData\\Roaming", USERPROFILE: "C:\\Users\\u" };
const NPM = "C:\\Users\\u\\AppData\\Roaming\\npm";
const PKG = `${NPM}\\node_modules\\@anthropic-ai\\claude-code`;
const WRAPPER = `@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe" %*\r\n`;

test("Windows, npm only: the .cmd wrapper is followed to the package's claude.exe, never run through cmd", () => {
  const io = vio("win32", { [`${NPM}\\claude`]: { text: "#!/bin/sh" }, [`${NPM}\\claude.cmd`]: { text: WRAPPER }, [`${NPM}\\claude.ps1`]: { text: "" }, [`${PKG}\\bin\\claude.exe`]: {} });
  const t = findClaude(WIN_ENV, io);
  assert.equal(t.cmd, `${PKG}\\bin\\claude.exe`);
  assert.match(t.via, /npm wrapper .*claude\.cmd → the package's claude\.exe/);
  // an older package without the exe: its JS entry, run with this Node
  const io2 = vio("win32", { [`${NPM}\\claude.cmd`]: { text: "@ECHO off\r\nnode %*\r\n" }, [`${PKG}\\package.json`]: { text: JSON.stringify({ bin: { claude: "cli.js" } }) }, [`${PKG}\\cli.js`]: {} });
  const t2 = findClaude(WIN_ENV, io2);
  assert.deepEqual([t2.cmd, t2.args], ["C:\\node\\node.exe", [`${PKG}\\cli.js`]]);
});

test("Windows off PATH: the native installer, then the editor's bundled binary (newest, labelled)", () => {
  const native = findClaude({ ...WIN_ENV, PATH: "C:\\Windows\\System32" }, vio("win32", { "C:\\Users\\u\\.local\\bin\\claude.exe": {} }));
  assert.equal(native.cmd, "C:\\Users\\u\\.local\\bin\\claude.exe");
  assert.equal(native.via, "the native installer");
  const ext = (v) => `C:\\Users\\u\\.vscode\\extensions\\anthropic.claude-code-${v}\\resources\\native-binary\\claude.exe`;
  const ed = findClaude({ ...WIN_ENV, PATH: "C:\\Windows\\System32" }, vio("win32", { [ext("2.0.9")]: {}, [ext("2.1.3")]: {} }));
  assert.equal(ed.cmd, ext("2.1.3"));
  assert.match(ed.via, /bundled with the editor/);
});

test("a setting: a path with spaces whole, a JSON array, a quoted line, the saved config", () => {
  const exe = "C:\\Program Files\\Claude\\claude.exe";
  assert.equal(findClaude({ ...WIN_ENV, VG_CLAUDE_BIN: exe }, vio("win32", { [exe]: {} })).cmd, exe);
  const arr = findClaude({ PATH: "/usr/bin", VG_CLAUDE_BIN: '["/opt/c/claude","--model","opus"]' }, vio("linux", { "/opt/c/claude": { exec: true } }));
  assert.deepEqual([arr.cmd, arr.args, pinnedModel(arr)], ["/opt/c/claude", ["--model", "opus"], "opus"]);
  assert.deepEqual(parseArgv('"/opt/my claude/claude" --model haiku'), ["/opt/my claude/claude", "--model", "haiku"]);
  assert.deepEqual(findClaude({ PATH: "/usr/bin", VG_CLAUDE_ARGS: "--model sonnet" }, vio("linux", { "/usr/bin/claude": { exec: true } })).args, ["--model", "sonnet"]);
  const saved = findClaude({ PATH: "/usr/bin" }, vio("linux", { "/srv/tools/claude": { exec: true } }, { config: { claude: { bin: "/srv/tools/claude" } } }));
  assert.equal(saved.cmd, "/srv/tools/claude");
  assert.match(saved.via, /config claude\.bin/);
});

test("POSIX: the execute bit; a GUI-launched process without ~/.local/bin on PATH still finds it", () => {
  const io = vio("linux", { "/usr/bin/claude": { exec: false }, "/home/u/.local/bin/claude": { exec: true } });
  const t = findClaude({ PATH: "/usr/bin:/bin" }, io);
  assert.equal(t.cmd, "/home/u/.local/bin/claude");
  assert.equal(t.via, "the native installer");
});

test("nothing installed: every place tried, both fixes, no guess", () => {
  const r = findClaude({ PATH: "/usr/bin" }, vio("linux", { "/usr/bin/claude": { exec: false } }));
  assert.ok(isMissing(r));
  assert.ok(r.tried.some((t) => /\/usr\/bin\/claude — not executable/.test(t)));
  assert.ok(r.tried.some((t) => /\.local\/bin\/claude \(the native installer\)/.test(t)));
  assert.ok(r.tried.some((t) => /bundled with the editor|extensions/.test(t)) || r.tried.length >= 5);
  assert.match(r.error, /VG_CLAUDE_BIN/);
  assert.match(r.error, /config set claude\.bin/);
});

test("a prompt with & % ^ \" reaches Claude exactly as written, with no permission bypass", () => {
  const prompt = `say "hi" & echo %PATH% ^ | rm -rf / ; $(whoami) 'q'`;
  const r = spawnClassifier({ prompt, cwd: process.cwd(), env: { ...process.env, VG_CLAUDE_BIN: "node test/fixtures/claude/echo_claude.mjs" } });
  assert.ok(r.ok, r.error);
  const argv = JSON.parse(r.text);
  assert.equal(argv.at(-1), prompt);
  assert.ok(!argv.includes("--dangerously-skip-permissions"));
  assert.ok(argv.includes("--allowedTools"));
});

test("config set claude.bin is saved per user and checked at once", () => {
  const files = {};
  const io = { ...vio("linux", {}), read: (p) => files[p] ?? null };
  // runConfig writes the real file: point it at a temp home instead
  const tmp = join(process.env.TMPDIR ?? "/tmp", `vg-cfg-${process.pid}`);
  const r = runConfig(["set", "claude.bin", join(process.cwd(), "test/fixtures/claude/echo_claude.mjs")], { ...io, configFile: () => join(tmp, "config.json") });
  assert.match(r.text, /set claude\.bin/);
  assert.match(readFileSync(join(tmp, "config.json"), "utf-8"), /echo_claude\.mjs/);
  assert.equal(runConfig(["set", "nope", "x"], io).exitCode, 2);
  rmSync(tmp, { recursive: true, force: true });
});

test("one resolver: no other file reads VG_CLAUDE_BIN or spawns \"claude\"", () => {
  const offenders = [];
  const scan = (p) => readFileSync(p, "utf-8").split("\n").forEach((l, i) => {
    if (/^\s*(\/\/|\*)/.test(l)) return;
    if (/env(\.VG_CLAUDE_BIN|\[["']VG_CLAUDE_BIN["']\])/.test(l) || /spawn(Sync)?\(\s*["']claude["']/.test(l) || /command -v claude/.test(l)) offenders.push(`${p}:${i + 1}`);
  });
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (n === "node_modules" || n.startsWith(".")) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs|js)$/.test(n) && !p.endsWith("find_claude.ts")) scan(p);
    }
  };
  walk("src");
  walk("scripts");
  scan("server.ts");
  assert.deepEqual(offenders, []);
});
