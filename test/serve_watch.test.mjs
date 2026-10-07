// The viewer on a project it cannot watch, and on a busy port (2026-10-07,
// field report: Windows Node on a `\\wsl.localhost\…` project exited on an
// unguarded watch; the CLI opened `localhost` while the server bound
// 127.0.0.1; a busy port opened ANOTHER project's viewer).
//
//   npm run test:serve-watch     (the two-server case needs dist/ built)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { watchProject, isWslShare, POLL_CAP } from "../src/server/watch_project.ts";
import { servedUrl } from "../src/server/serve_address.ts";
import { servedUrlFrom } from "../scripts/cli/view.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eisdir = () => Object.assign(new Error("EISDIR: illegal operation on a directory, watch"), { code: "EISDIR" });
const fakeFs = ({ recursive = "ok", perFile = () => "ok", poll = "ok" } = {}) => {
  const calls = { watch: [], watchFile: [] };
  const w = { on() { return w; } };
  return {
    calls,
    watch(p, opts) {
      calls.watch.push(p);
      if (opts.recursive) { if (recursive === "throw") throw new Error("recursive unsupported"); return w; }
      if (perFile(p) === "throw") throw eisdir();
      return w;
    },
    watchFile(p) { calls.watchFile.push(p); if (poll === "throw") throw new Error("no"); },
  };
};
const files = ["/p/a.py", "/p/ui/test_ui.mjs", "/p/b.py"];
const quiet = () => {};

test("the ladder: recursive, then per-file (each guarded), then polling, then off — never a throw", () => {
  let f = fakeFs();
  assert.deepEqual(watchProject("/p", { files: () => files, onChange: quiet, log: quiet, platform: "linux", fsImpl: f }), { mode: "recursive", note: null });

  // the field case: recursive fails, ONE file throws EISDIR — the rest are watched
  f = fakeFs({ recursive: "throw", perFile: (p) => (p.endsWith("test_ui.mjs") ? "throw" : "ok") });
  const r = watchProject("/p", { files: () => files, onChange: quiet, log: quiet, platform: "linux", fsImpl: f });
  assert.equal(r.mode, "per-file");
  assert.match(r.note, /1 of 3 files could not be watched/);

  f = fakeFs({ recursive: "throw", perFile: () => "throw" });
  assert.equal(watchProject("/p", { files: () => files, onChange: quiet, log: quiet, platform: "linux", fsImpl: f }).mode, "polling");
  assert.equal(f.calls.watchFile.length, 3);

  f = fakeFs({ recursive: "throw", perFile: () => "throw", poll: "throw" });
  const off = watchProject("/p", { files: () => files, onChange: quiet, log: quiet, platform: "linux", fsImpl: f });
  assert.equal(off.mode, "off");
  assert.match(off.note, /live reload is off/);
});

test("WSL's file share from Windows goes straight to polling and says why", () => {
  const share = "\\\\wsl.localhost\\Ubuntu\\home\\me\\proj";
  assert.equal(isWslShare(share, "win32"), true);
  assert.equal(isWslShare("\\\\wsl$\\Ubuntu\\x", "win32"), true);
  assert.equal(isWslShare(share, "linux"), false);
  assert.equal(isWslShare("C:\\code\\proj", "win32"), false);
  const f = fakeFs();
  const many = Array.from({ length: POLL_CAP + 5 }, (_, i) => `${share}\\f${i}.py`);
  const r = watchProject(share, { files: () => many, onChange: quiet, log: quiet, platform: "win32", fsImpl: f });
  assert.equal(r.mode, "polling");
  assert.equal(f.calls.watch.length, 0, "no fs.watch tried on the share");
  assert.match(r.note, /from inside WSL/);
  assert.match(r.note, new RegExp(`first ${POLL_CAP} of ${POLL_CAP + 5}`));
});

test("the URL is the address bound, never the name localhost", () => {
  assert.equal(servedUrl("127.0.0.1", 4201), "http://127.0.0.1:4201");
  assert.equal(servedUrl("localhost", 4200), "http://127.0.0.1:4200");
  assert.equal(servedUrl("::1", 4200), "http://[::1]:4200");
  assert.equal(servedUrl("192.168.1.5", 80), "http://192.168.1.5:80");
  assert.equal(servedUrlFrom("  Port 4200 in use\n\n  VibeGraph is running!\n  Project: /x\n  Open:     http://127.0.0.1:4201\n"), "http://127.0.0.1:4201");
  assert.equal(servedUrlFrom("  Open:     http://127.0.0.1:4201\n"), null, "only after the server says it is running");
});

test("the boot screen's phase line says what the first pass does, and why a big tree is slow", async () => {
  const { phaseTexter } = await import("../src/server/pass_progress.ts");
  const big = phaseTexter(248, 248, () => 1178);
  assert.equal(big("parse"), "parsing 248 of 248 files — a large tree (248 source files), so this takes a while");
  assert.match(big("threads"), /^tracing threads from 1178 entry points/);
  const cached = phaseTexter(40, 3, () => 9);
  assert.equal(cached("parse"), "parsing 3 of 40 files (37 unchanged, from the cache)");
  assert.equal(cached("map"), "building the system map…");
});

const procs = [];
after(() => { for (const p of procs) p.kill(); });

function boot(project, port) {
  const p = spawn(process.execPath, [path.join(ROOT, "dist", "server.js"), project], {
    env: { ...process.env, PORT: String(port), VG_VERSION: "9.9.9" }, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  procs.push(p);
  let out = "";
  return new Promise((resolve, reject) => {
    p.stdout.on("data", (d) => { out += d; const u = servedUrlFrom(out); if (u) resolve({ out, url: u }); });
    p.on("exit", (c) => reject(new Error(`server exited (${c}): ${out}`)));
    setTimeout(() => reject(new Error(`boot timeout: ${out}`)), 30_000).unref();
  });
}

test("a busy port: the second viewer names what holds it and prints the port it bound", { skip: !fs.existsSync(path.join(ROOT, "dist", "server.js")) }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vg-serve-"));
  const a = path.join(tmp, "a"), b = path.join(tmp, "b");
  for (const d of [a, b]) { fs.mkdirSync(d); fs.writeFileSync(path.join(d, "app.py"), "def main():\n    return 1\n"); }
  try {
    const first = await boot(a, 4343);
    assert.equal(first.url, "http://127.0.0.1:4343");
    const about = await (await fetch(`${first.url}/vg-about`)).json();
    assert.deepEqual(about, { app: "vibegraph", project: a, version: "9.9.9" });
    const second = await boot(b, 4343);
    assert.match(second.out, new RegExp(`Port 4343 is another VibeGraph 9\\.9\\.9 serving ${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.equal(second.url, "http://127.0.0.1:4344");
  } finally {
    for (const p of procs) p.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
