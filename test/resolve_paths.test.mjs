// One resolver for every path VibeGraph keeps outside a project (2026-10-22,
// the root-cause handoff RC7: "cache and hook paths have several resolvers,
// and hooks pin only part of the environment"). With VG_CACHE_DIR set, setup,
// hook install and the Claude check write nothing under ~/.cache; every hook
// command carries the variable, and a re-install keeps it.
//
//   npm run test:resolve-paths
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cacheDirFor, resolvePaths } from "../scripts/cache_dir.mjs";
import { serverCacheDir } from "../src/server/pipeline_cache.ts";
import { applyHooks, hookCommand, hookEnv, pinnedFromSettings, windowsHookCommand } from "../scripts/cli/init.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), "vg-paths-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const HOME = join(tmp, "home");
mkdirSync(HOME, { recursive: true });

test("one precedence: the project's config, then VG_CACHE_DIR, then XDG_CACHE_HOME, then ~/.cache", () => {
  const proj = join(tmp, "p1");
  mkdirSync(join(proj, ".vibegraph"), { recursive: true });
  const prevHome = process.env.HOME;
  process.env.HOME = HOME;
  try {
    assert.equal(resolvePaths(proj, {}).cacheRoot, join(HOME, ".cache", "vibegraph-knowledge"));
    assert.equal(resolvePaths(proj, { XDG_CACHE_HOME: "/x" }).cacheRoot, "/x/vibegraph-knowledge");
    assert.equal(resolvePaths(proj, { XDG_CACHE_HOME: "/x", VG_CACHE_DIR: "/v" }).cacheRoot, "/v");
    writeFileSync(join(proj, ".vibegraph", "config.json"), JSON.stringify({ cacheDir: ".vgcache" }));
    const p = resolvePaths(proj, { VG_CACHE_DIR: "/v" });
    assert.equal(p.cacheRoot, join(proj, ".vgcache"));
    assert.equal(p.source, ".vibegraph/config.json cacheDir");
  } finally { process.env.HOME = prevHome; }
});

test("every path comes from it, and a directory VG_CACHE_DIR names keeps its old layout", () => {
  const proj = resolve(join(tmp, "p2"));
  const v = resolvePaths(proj, { VG_CACHE_DIR: "/v" });
  assert.equal(v.envelopes, cacheDirFor(proj, { VG_CACHE_DIR: "/v" }));
  assert.match(v.envelopes, /^\/v\/[0-9a-f]{16}$/, "a project's envelopes directly under it, as before");
  assert.equal(serverCacheDir(proj, { VG_CACHE_DIR: "/v" }), v.server);
  assert.match(v.server, /^\/v\/server\/[0-9a-f]{16}$/);
  assert.equal(v.pydeps, "/v");
  assert.equal(v.claudeVersion, "/v/claude-version.json");
  const d = resolvePaths(proj, { XDG_CACHE_HOME: "/x" });
  assert.match(d.envelopes, /^\/x\/vibegraph-knowledge\/envelopes\/[0-9a-f]{16}$/);
  assert.equal(resolvePaths(proj, { XDG_CACHE_HOME: "/x" }).pydeps, "/x/vibegraph-knowledge", "the Python deps follow XDG_CACHE_HOME now");
  assert.equal(resolvePaths(proj, { VIBEGRAPH_KNOWLEDGE_HOME: "/k" }).pydeps, "/k");
});

test("an installed hook pins every path variable, and a re-install keeps what it pinned", () => {
  const proj = join(tmp, "p3");
  mkdirSync(proj, { recursive: true });
  const verified = { VG_PYTHON: "/usr/bin/python3" };
  const install = (env) => applyHooks({ root: proj, command: (r, e) => hookCommand(r, e, hookEnv(verified, env, pinnedFromSettings(proj))) });
  install({ VG_CACHE_DIR: "/data/vg cache" });
  const commands = () => Object.values(JSON.parse(readFileSync(join(proj, ".claude", "settings.local.json"), "utf-8")).hooks).flat().flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(commands().length >= 4 && commands().every((c) => c.includes('VG_CACHE_DIR="/data/vg cache"')), commands()[0]);
  assert.deepEqual(pinnedFromSettings(proj), { VG_CACHE_DIR: "/data/vg cache", VG_PYTHON: "/usr/bin/python3" });
  install({}); // a later shell without the variable
  assert.ok(commands().every((c) => c.includes('VG_CACHE_DIR="/data/vg cache"')), "kept on re-install");
  // the Windows form pins it too, and reads back
  const win = windowsHookCommand(proj, "prompt", hookEnv(verified, { VG_CACHE_DIR: "/data/vg" }), "Ubuntu");
  assert.match(win, /VG_CACHE_DIR=\/\/data\/vg/);
});

test("with VG_CACHE_DIR set, setup, hook install and the Claude check write nothing under ~/.cache", () => {
  const proj = join(tmp, "p4");
  cpSync(join(ROOT, "test/fixtures/env/platform_demo"), proj, { recursive: true });
  const cache = join(tmp, "vgcache");
  const env = { ...process.env, HOME, VG_CACHE_DIR: cache, CLAUDECODE: "", VIBEGRAPH_PYDEPS: join(ROOT, ".pydeps"), VG_CLAUDE_BIN: `node ${join(ROOT, "test/fixtures/claude/echo_claude.mjs")}` };
  delete env.XDG_CACHE_HOME;
  const cli = (args, e = env) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), ...args], { cwd: ROOT, encoding: "utf-8", env: e });
  const s = cli(["setup", proj]);
  assert.equal(s.status === 0 || s.status === 1, true, s.stderr);
  const h = cli(["init", proj, "--hooks"]);
  assert.equal(h.status, 0, h.stderr || h.stdout);
  const d = cli(["doctor", proj]);
  assert.match(d.stdout, new RegExp(`paths \\(cache from VG_CACHE_DIR\\): cache ${cache.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.ok(existsSync(join(cache, "claude-version.json")), "the Claude check wrote under VG_CACHE_DIR");
  assert.equal(existsSync(join(HOME, ".cache")), false, "nothing under ~/.cache");
  // re-install from a shell without the variable: the hooks keep it
  const plain = { ...env };
  delete plain.VG_CACHE_DIR;
  assert.equal(cli(["init", proj, "--hooks"], plain).status, 0);
  const settings = readFileSync(join(proj, ".claude", "settings.local.json"), "utf-8");
  assert.ok(settings.includes(`VG_CACHE_DIR=\\"${cache}\\"`), settings.slice(0, 400));
});
