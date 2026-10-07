// FINDING CLAUDE (2026-10-07, from a field report: on Windows VibeGraph said
// "claude CLI not on PATH — Install Claude Code" while `claude` worked in
// PowerShell). Four copies of the lookup each split VG_CLAUDE_BIN on spaces
// and spawned the bare word `claude` without a shell — which on Windows finds
// only a real .exe, never npm's `claude.cmd` — and searched PATH alone. This
// is the ONE resolver every caller uses (test:find-claude pins that no other
// file reads VG_CLAUDE_BIN or spawns "claude").
//
// Order, first hit wins, every step recorded in `tried`:
//   1. a setting: VG_CLAUDE_BIN — the WHOLE string when it is an existing
//      file (spaces are fine), else a JSON array [cmd, …args], else a quoted
//      argv line (never split on whitespace); VG_CLAUDE_ARGS adds arguments;
//      then the saved `config set claude.bin` (per user, no env editing);
//   2. PATH, searched as the OS does: on Windows each PATHEXT extension,
//      .exe/.com first; an npm wrapper (.cmd/.ps1) is FOLLOWED to the
//      package's own claude.exe (or its JS entry, run with this Node) and
//      never run through cmd; on POSIX a file with the execute bit;
//   3. where Claude Code is installed: the native installer, npm's global
//      package folder, Homebrew, the old ~/.claude/local, and last the
//      binary bundled with the VS Code / Cursor extension (it moves with
//      every extension update, so it is labelled).
// It never uses a shell: a prompt with quotes, %, & or ^ reaches Claude as
// written. `checkClaude` runs `--version` once and caches it by mtime.

import { detectHost, isWindowsSide } from "./host_os.ts";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";

export interface ClaudeTarget { cmd: string; args: string[]; via: string; version?: string }
export interface ClaudeMissing { error: string; tried: string[] }

/** The filesystem and platform, injectable so every platform is testable anywhere. */
export interface FindIO {
  platform: NodeJS.Platform;
  /** Linux inside WSL: a Windows program on PATH (/mnt/c/…) is the last resort */
  wsl?: boolean;
  home: string;
  execPath: string;
  isFile(p: string): boolean;
  isExecutable(p: string): boolean;
  read(p: string): string | null;
  list(dir: string): string[];
  configFile(): string;
}

export function realIO(): FindIO {
  const platform = process.platform;
  return {
    platform, home: os.homedir(), execPath: process.execPath, wsl: detectHost().kind === "wsl",
    isFile: (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } },
    isExecutable: (p) => { try { if (!fs.statSync(p).isFile()) return false; if (platform === "win32") return true; fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } },
    read: (p) => { try { return fs.readFileSync(p, "utf-8"); } catch { return null; } },
    list: (d) => { try { return fs.readdirSync(d); } catch { return []; } },
    configFile: () => userConfigFile(platform, process.env, os.homedir()),
  };
}

export function userConfigFile(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
  if (platform === "win32") return nodePath.win32.join(env.APPDATA ?? nodePath.win32.join(home, "AppData", "Roaming"), "vibegraph", "config.json");
  return nodePath.posix.join(env.XDG_CONFIG_HOME || nodePath.posix.join(home, ".config"), "vibegraph", "config.json");
}

/** A command line as argv: quotes honoured ("C:\\Program Files\\x" stays one), never a whitespace split. */
export function parseArgv(s: string): string[] {
  const out: string[] = [];
  let cur = "", quote: string | null = null, any = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) quote = null; else cur += c; continue; }
    if (c === '"' || c === "'") { quote = c; any = true; continue; }
    if (/\s/.test(c)) { if (cur || any) out.push(cur); cur = ""; any = false; continue; }
    cur += c;
  }
  if (cur || any) out.push(cur);
  return out;
}

const pathOf = (io: FindIO) => (io.platform === "win32" ? nodePath.win32 : nodePath.posix);
const isJs = (p: string) => /\.(c|m)?js$/i.test(p);
/** A file to run: a .js entry goes through this Node, a bare `node` is this Node. */
function asTarget(io: FindIO, cmd: string, args: string[], via: string): ClaudeTarget {
  if (/^node(\.exe)?$/i.test(cmd)) return { cmd: io.execPath, args, via };
  if (isJs(cmd)) return { cmd: io.execPath, args: [cmd, ...args], via };
  return { cmd, args, via };
}

/** Find a bare command name on PATH, the way the OS would (and follow npm's Windows wrappers). */
export function onPath(io: FindIO, name: string, env: NodeJS.ProcessEnv, tried: string[]): { cmd: string; args: string[]; via: string } | null {
  const P = pathOf(io);
  const dirs = (env.PATH ?? env.Path ?? "").split(io.platform === "win32" ? ";" : ":").filter(Boolean);
  if (io.platform !== "win32") {
    for (const d of dirs) {
      const p = P.join(d, name);
      // WSL: a Windows program here would run against Windows paths and a
      // Windows login — keep looking for a Linux one; it is the last resort
      if (io.wsl && isWindowsSide(p) && io.isExecutable(p)) { tried.push(`${p} — a Windows program seen from WSL (used only if no Linux one is found)`); continue; }
      if (io.isExecutable(p)) return { cmd: p, args: [], via: `PATH (${d})` };
      if (io.isFile(p)) tried.push(`${p} — not executable`);
    }
    tried.push(`PATH: no executable ${name} in ${dirs.length} director${dirs.length === 1 ? "y" : "ies"}`);
    return null;
  }
  const exts = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase()).filter(Boolean);
  const order = [".exe", ".com", ...exts.filter((e) => e !== ".exe" && e !== ".com"), ".ps1"];
  const wrappers: string[] = [];
  for (const d of dirs) {
    for (const e of order) {
      const p = P.join(d, `${name}${e}`);
      if (!io.isFile(p)) continue;
      if (e === ".exe" || e === ".com") return { cmd: p, args: [], via: `PATH (${d})` };
      wrappers.push(p);
    }
  }
  for (const w of wrappers) {
    const followed = followNpmWrapper(io, w);
    if (followed) return { ...followed, via: `npm wrapper ${w} → ${followed.via}` };
    tried.push(`${w} — a wrapper whose target could not be found (it is never run through cmd)`);
  }
  if (!wrappers.length) tried.push(`PATH: no ${name}.exe / .com / .cmd in ${dirs.length} directories`);
  return null;
}

/** npm's `claude.cmd` names its target (`%dp0%\node_modules\…`); its package holds bin\claude.exe or a JS entry. */
export function followNpmWrapper(io: FindIO, wrapper: string): { cmd: string; args: string[]; via: string } | null {
  const P = pathOf(io);
  const dir = P.dirname(wrapper);
  const text = io.read(wrapper) ?? "";
  const named = [...text.matchAll(/(?:%~?dp0%?|\$basedir)[\\/]+([^"'\r\n*]+?\.(?:exe|c?m?js))/gi)].map((m) => P.join(dir, m[1].replace(/[\\/]/g, P.sep)));
  const pkg = P.join(dir, "node_modules", "@anthropic-ai", "claude-code");
  for (const c of [...named.filter((p) => /\.exe$/i.test(p)), P.join(pkg, "bin", "claude.exe"), ...named.filter(isJs), ...packageEntries(io, pkg)]) {
    if (io.isFile(c)) return { cmd: c, args: [], via: /\.exe$/i.test(c) ? "the package's claude.exe" : "the package's JS entry, with this Node" };
  }
  return null;
}

function packageEntries(io: FindIO, pkg: string): string[] {
  const P = pathOf(io);
  try {
    const bin = JSON.parse(io.read(P.join(pkg, "package.json")) ?? "{}").bin;
    const rel = typeof bin === "string" ? bin : bin?.claude;
    return rel ? [P.join(pkg, rel)] : [];
  } catch { return []; }
}

const versionKey = (name: string) => (name.match(/(\d+(?:\.\d+)*)/)?.[1] ?? "0").split(".").map((x) => x.padStart(6, "0")).join(".");

/** The places Claude Code installs itself, in order, when PATH found nothing. */
export function knownPlaces(io: FindIO, env: NodeJS.ProcessEnv): Array<{ path: string; via: string }> {
  const P = pathOf(io);
  const h = io.home;
  const win = io.platform === "win32";
  const exe = win ? "claude.exe" : "claude";
  const out: Array<{ path: string; via: string }> = [
    { path: P.join(win ? (env.USERPROFILE ?? h) : h, ".local", "bin", exe), via: "the native installer" },
  ];
  const npmRoots = win
    ? [P.join(env.APPDATA ?? P.join(h, "AppData", "Roaming"), "npm", "node_modules")]
    : [P.join(P.dirname(P.dirname(io.execPath)), "lib", "node_modules"), "/usr/local/lib/node_modules", "/usr/lib/node_modules"];
  for (const r of npmRoots) {
    const pkg = P.join(r, "@anthropic-ai", "claude-code");
    out.push({ path: P.join(pkg, "bin", exe), via: "npm's global package" });
    for (const e of packageEntries(io, pkg)) out.push({ path: e, via: "npm's global package (JS entry)" });
  }
  if (!win) out.push({ path: "/opt/homebrew/bin/claude", via: "Homebrew" }, { path: "/usr/local/bin/claude", via: "Homebrew / /usr/local" });
  out.push({ path: P.join(h, ".claude", "local", exe), via: "an older local install" });
  for (const ed of [".vscode", ".vscode-insiders", ".vscode-server", ".cursor", ".cursor-server"]) {
    const dir = P.join(h, ed, "extensions");
    const exts = io.list(dir).filter((n) => /^anthropic\.claude-code-/.test(n)).sort((a, b) => versionKey(b).localeCompare(versionKey(a)));
    for (const x of exts) out.push({ path: P.join(dir, x, "resources", "native-binary", exe), via: `bundled with the editor (${ed.replace(/^\./, "")} extension ${x.replace(/^anthropic\.claude-code-/, "")}; it changes with every update)` });
  }
  return out;
}

/** The saved setting (`config set claude.bin`), or null. */
export function savedClaudeBin(io: FindIO): string | null {
  try { const v = JSON.parse(io.read(io.configFile()) ?? "{}")?.claude?.bin; return typeof v === "string" && v.trim() ? v : null; } catch { return null; }
}

function fromSetting(io: FindIO, raw: string, extra: string[], via: string, env: NodeJS.ProcessEnv, tried: string[]): ClaudeTarget | null {
  const s = raw.trim();
  // a relative path means relative to where it was set: spawns run elsewhere (the project)
  const abs = (p: string) => (io.platform === process.platform && !pathOf(io).isAbsolute(p) && io.isFile(p) ? nodePath.resolve(p) : p);
  if (io.isFile(s)) return asTarget(io, abs(s), extra, `${via} (a file)`);
  let argv: string[] | null = null;
  if (s.startsWith("[")) {
    try { const a = JSON.parse(s); if (Array.isArray(a) && a.length && a.every((x) => typeof x === "string")) argv = a; } catch { /* not JSON */ }
    if (!argv) { tried.push(`${via}: starts with [ but is not a JSON array of strings`); return null; }
  } else argv = parseArgv(s);
  if (!argv.length) return null;
  const [cmd, ...rest] = argv;
  // a bare name is looked up the way the OS would; a path is used as given
  if (!/[\\/]/.test(cmd) && !/^node(\.exe)?$/i.test(cmd)) {
    const hit = onPath(io, cmd, env, tried);
    if (hit) return asTarget(io, hit.cmd, [...hit.args, ...rest, ...extra], `${via} → ${hit.via}`);
  }
  // `node stub.mjs`: the script, too, is relative to where it was set
  if (/^node(\.exe)?$/i.test(cmd) && rest[0]) return asTarget(io, cmd, [abs(rest[0]), ...rest.slice(1), ...extra], via);
  return asTarget(io, abs(cmd), [...rest, ...extra], via);
}

/** Where Claude is, or every place that was tried and how to fix it. */
export function findClaude(env: NodeJS.ProcessEnv = process.env, io: FindIO = realIO()): ClaudeTarget | ClaudeMissing {
  const tried: string[] = [];
  const extra = env.VG_CLAUDE_ARGS ? parseArgv(env.VG_CLAUDE_ARGS) : [];
  if (env.VG_CLAUDE_BIN?.trim()) {
    const t = fromSetting(io, env.VG_CLAUDE_BIN, extra, "VG_CLAUDE_BIN", env, tried);
    if (t) return t;
  }
  const saved = savedClaudeBin(io);
  if (saved) {
    const t = fromSetting(io, saved, extra, `config claude.bin (${io.configFile()})`, env, tried);
    if (t && io.isFile(t.cmd)) return t;
    tried.push(`config claude.bin = ${saved} — not a file`);
  }
  const hit = onPath(io, "claude", env, tried);
  if (hit) return asTarget(io, hit.cmd, [...hit.args, ...extra], hit.via);
  for (const k of knownPlaces(io, env)) {
    if (io.platform === "win32" ? io.isFile(k.path) : (isJs(k.path) ? io.isFile(k.path) : io.isExecutable(k.path))) return asTarget(io, k.path, extra, k.via);
    tried.push(`${k.path} (${k.via})`);
  }
  // WSL, nothing Linux-side: the Windows Claude on PATH still runs (through interop)
  if (io.wsl) {
    const P = pathOf(io);
    for (const d of (env.PATH ?? "").split(":").filter((x) => isWindowsSide(x))) {
      const p = P.join(d, "claude");
      if (io.isExecutable(p)) return asTarget(io, p, extra, `PATH (${d}) — the Windows Claude, through WSL interop; install Claude Code inside WSL for one that sees Linux paths`);
    }
  }
  return {
    tried,
    error: [
      "Claude Code was not found where VibeGraph looked (it may be installed elsewhere). Tried:",
      ...tried.map((t) => `  - ${t}`),
      "Fix it either way:",
      `  - set VG_CLAUDE_BIN to the claude executable (the whole path; spaces are fine), or`,
      `  - vibegraph-knowledge config set claude.bin "<path to claude>"`,
      "If Claude Code is not installed: https://docs.claude.com/en/docs/claude-code",
    ].join("\n"),
  };
}

export const isMissing = (x: ClaudeTarget | ClaudeMissing): x is ClaudeMissing => "error" in x;

/** What a spawn site runs: the found Claude, or — when nothing was found — the bare
 *  name, so the spawn fails with ENOENT and the caller's error can say `findClaude().error`. */
export function claudeCommand(env: NodeJS.ProcessEnv = process.env, io?: FindIO): ClaudeTarget {
  const f = findClaude(env, io);
  return isMissing(f) ? { cmd: "claude", args: [], via: "not found" } : f;
}

/** The model a setting pins (`… --model X`), read from the parsed args. */
export function pinnedModel(t: Pick<ClaudeTarget, "args">): string | null {
  const i = t.args.indexOf("--model");
  if (i >= 0 && t.args[i + 1]) return t.args[i + 1];
  const eq = t.args.find((a) => a.startsWith("--model="));
  return eq ? eq.slice(8) : null;
}

/** `--version`, once per binary and mtime (cached under the user cache). */
export function checkClaude(t: ClaudeTarget, opts: { cacheFile?: string; timeoutMs?: number } = {}): { ok: boolean; version?: string; error?: string } {
  const cacheFile = opts.cacheFile ?? nodePath.join(os.homedir(), ".cache", "vibegraph-knowledge", "claude-version.json");
  const file = t.cmd === process.execPath ? (t.args[0] ?? t.cmd) : t.cmd;
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { /* not a file we can stat */ }
  const key = `${file}|${mtime}`;
  let cache: Record<string, string> = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf-8")); } catch { cache = {}; }
  if (cache[key]) return { ok: true, version: cache[key] };
  const r = spawnSync(t.cmd, [...t.args, "--version"], { encoding: "utf-8", timeout: opts.timeoutMs ?? 5000, shell: false });
  if (r.error || r.status !== 0) return { ok: false, error: r.error?.message ?? `exited ${r.status}: ${String(r.stderr ?? "").trim().slice(0, 200)}` };
  const version = String(r.stdout).trim().split(/\s+/)[0] || "unknown";
  try { fs.mkdirSync(nodePath.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify({ ...cache, [key]: version })); } catch { /* cache is a convenience */ }
  return { ok: true, version };
}

/** One line for doctor and the startup log. */
export function describeClaude(env: NodeJS.ProcessEnv = process.env): string {
  const f = findClaude(env);
  if (isMissing(f)) return f.error;
  const v = checkClaude(f);
  const shown = f.cmd === process.execPath ? `${f.args[0] ?? f.cmd} (with this Node)` : f.cmd;
  return v.ok ? `Claude: ${shown} (${v.version}) — found via ${f.via}` : `Claude: ${shown} — found via ${f.via}, but \`--version\` failed: ${v.error}`;
}

/** Whether the environment carries a Claude setting (it outranks the saved one). */
export const envOverridesClaude = (env: NodeJS.ProcessEnv = process.env) => !!env.VG_CLAUDE_BIN?.trim();
