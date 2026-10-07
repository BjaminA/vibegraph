// WHICH MACHINE, AND WHAT NOT TO READ (2026-10-07). From running VibeGraph in
// WSL and on Windows: the browser was opened with tools WSL does not have, a
// Windows Claude on the WSL PATH outranked the Linux one, the Windows install
// of the package ran from WSL on the system's Node 18, and a project with 188
// old copies of its code under `_archive/` overflowed the parse and failed
// with an empty message. Pinned: one host module (detectHost, openUrlCommands,
// isWindowsSide, pythonBin); `.vibegraphignore` patterns (a bare name, a root
// path, a glob, VG_IGNORE) skip folders and files in the walk and are
// REPORTED with the skipped build directories; on WSL a Linux Claude is found
// before a Windows one; the host warnings name an old Node and a Windows
// install run from WSL.
//
//   npm run test:host-platform
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectHost, openUrlCommands, isWindowsSide, pythonBin } from "../src/server/host_os.ts";
import { projectIgnore, parseIgnore } from "../src/server/project_ignore.ts";
import { findClaude } from "../src/server/find_claude.ts";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { hostWarnings, nodeTooOld } from "../scripts/cli/host_check.mjs";

const tmp = mkdtempSync(join(tmpdir(), "vg-host-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("the host: Windows, WSL (by env or /proc/version), Linux, macOS", () => {
  assert.equal(detectHost({}, "win32").kind, "windows");
  assert.equal(detectHost({}, "darwin").kind, "mac");
  assert.deepEqual(detectHost({ WSL_DISTRO_NAME: "Ubuntu" }, "linux"), { kind: "wsl", distro: "Ubuntu" });
  assert.equal(detectHost({}, "linux", () => "Linux version 6.6.87.2-microsoft-standard-WSL2").kind, "wsl");
  assert.equal(detectHost({}, "linux", () => "Linux version 6.8.0-generic").kind, "linux");
});

test("a URL opens the way the host does: WSL through the Windows browser, never through a shell", () => {
  const url = "http://localhost:4200/?a=1&b=2";
  const wsl = openUrlCommands(url, { kind: "wsl" }).map((c) => c.cmd);
  assert.deepEqual(wsl, ["wslview", "rundll32.exe", "powershell.exe", "xdg-open"]);
  assert.equal(openUrlCommands(url, { kind: "wsl" })[1].cwd, "/mnt/c", "cmd-style programs start from a Windows folder");
  const win = openUrlCommands(url, { kind: "windows" });
  assert.equal(win[0].cmd, "rundll32");
  assert.equal(win[0].args.at(-1), url, "the & reaches the browser intact");
  assert.equal(openUrlCommands(url, { kind: "mac" })[0].cmd, "open");
  assert.equal(openUrlCommands(url, { kind: "linux" })[0].cmd, "xdg-open");
  assert.ok(isWindowsSide("/mnt/c/Users/x/npm/claude") && !isWindowsSide("/home/x/.local/bin/claude"));
  assert.equal(pythonBin({ VG_PYTHON: "C:\\Python312\\python.exe" }), "C:\\Python312\\python.exe");
  assert.equal(pythonBin({}), "python3");
});

test(".vibegraphignore: a name anywhere, a root path, a glob, VG_IGNORE; comments skipped", () => {
  const t = parseIgnore(["# old copies", "_archive/", "legacy/old/", "**/*.gen.py", "notes.py"]);
  const hit = (rel, dir = false) => t.some((f) => f(rel, dir));
  assert.ok(hit("_archive", true) && hit("pkg/_archive", true));
  assert.ok(!hit("_archive", false), "a trailing / means folders only");
  assert.ok(hit("legacy/old", true) && !hit("src/legacy/old", true));
  assert.ok(hit("pkg/x.gen.py") && hit("x.gen.py") && !hit("x.py"));
  assert.ok(hit("notes.py") && hit("a/notes.py"));
  const root = join(tmp, "ig");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, ".vibegraphignore"), "_archive/\n");
  const ig = projectIgnore(root, { VG_IGNORE: "scratch/,*.tmp.py" });
  assert.deepEqual(ig.patterns, ["_archive/", "scratch/", "*.tmp.py"]);
  assert.ok(ig.skipDir("_archive") && ig.skipDir("scratch") && ig.skipFile("a/b.tmp.py") && !ig.skipFile("a/b.py"));
  assert.ok(ig.skipFile("_archive/v1/old.py") && ig.skipFile("pkg/_archive/x.py") && ig.skipFile("legacy/x.py") === false, "a file under an ignored folder is skipped too");
});

test("the walk skips what the project names, and says so", () => {
  const root = join(tmp, "proj");
  mkdirSync(join(root, "app"), { recursive: true });
  mkdirSync(join(root, "_archive", "v1"), { recursive: true });
  writeFileSync(join(root, "app", "main.py"), "def main():\n    return 1\n");
  for (let i = 0; i < 3; i++) writeFileSync(join(root, "_archive", "v1", `old${i}.py`), "def old():\n    return 0\n");
  const before = buildPolyglotEnvelope(root, { skipSystem: true });
  assert.ok(Object.keys(before.envelope.files).some((f) => f.startsWith("_archive/")));
  writeFileSync(join(root, ".vibegraphignore"), "# kept for history, not live code\n_archive/\n");
  const after = buildPolyglotEnvelope(root, { skipSystem: true });
  assert.deepEqual(Object.keys(after.envelope.files), ["app/main.py"]);
  assert.equal(after.skippedDirs["_archive"], 3, "reported with how much it held");
});

test("WSL: a Linux Claude before a Windows one on PATH; the Windows one only as a last resort", () => {
  const vio = (files) => ({
    platform: "linux", wsl: true, home: "/home/u", execPath: "/usr/bin/node",
    isFile: (p) => p in files, isExecutable: (p) => p in files, read: () => null, list: () => [], configFile: () => "/home/u/.config/vibegraph/config.json",
  });
  const env = { PATH: "/usr/bin:/mnt/c/Users/u/AppData/Roaming/npm" };
  const both = findClaude(env, vio({ "/mnt/c/Users/u/AppData/Roaming/npm/claude": {}, "/home/u/.local/bin/claude": {} }));
  assert.equal(both.cmd, "/home/u/.local/bin/claude");
  const winOnly = findClaude(env, vio({ "/mnt/c/Users/u/AppData/Roaming/npm/claude": {} }));
  assert.equal(winOnly.cmd, "/mnt/c/Users/u/AppData/Roaming/npm/claude");
  assert.match(winOnly.via, /Windows Claude, through WSL interop/);
});

test("host warnings: an old Node; the Windows install run from WSL", () => {
  // 2026-10-07 — a Node below 20 STOPS the command (nodeTooOld), not a note
  assert.match(nodeTooOld("18.19.1"), /Node 18\.19\.1.*Node 20 or newer, and stops here/);
  assert.equal(nodeTooOld("20.0.0"), null);
  const wsl = hostWarnings({ WSL_DISTRO_NAME: "Ubuntu" }, "/mnt/c/Users/u/AppData/Roaming/npm/node_modules/vibegraph-knowledge/dist/cli.mjs", "24.1.0");
  assert.match(wsl.join("\n"), /WINDOWS install .* run from WSL/);
  assert.deepEqual(hostWarnings({ WSL_DISTRO_NAME: "Ubuntu" }, "/home/u/.nvm/x/dist/cli.mjs", "24.1.0"), []);
});
