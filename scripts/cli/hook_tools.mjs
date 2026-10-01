// Hooks you can see working (2026-10-01, item 6 of the hooks-feedback brief:
// "Claude Code may run on Windows against a WSL path, and then they never
// fire" — and nothing said so).
//
//   recordFired / readFired   every hook run leaves a one-line record (per
//                             project, under ~/.cache, never in the project):
//                             which event fired last and when.
//   hookRunPayload            `hook run <event> --file <path>`: the stdin JSON
//                             Claude Code would send, built for you — so an
//                             agent or a person can fire a hook by hand
//                             without hand-rolling the payload.
//   doctorReport              `doctor`: are the hooks installed, can their
//                             command run from THIS side (a Linux path from a
//                             Windows host, or the reverse), and have they
//                             fired since they were installed?
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDirFor } from "../envelope_cache.mjs";
import { HOOK_MARKER } from "./init.mjs";

const firedPath = (absRoot) => join(cacheDirFor(absRoot), "hooks-fired.json");

export function recordFired(absRoot, event, sessionId, now = new Date()) {
  try {
    const p = firedPath(absRoot);
    const cur = readFired(absRoot);
    cur[event] = { at: now.toISOString(), session: sessionId ?? null };
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, JSON.stringify(cur));
  } catch { /* a record that cannot be written must never break the hook */ }
}

export function readFired(absRoot) {
  try { return JSON.parse(readFileSync(firedPath(absRoot), "utf-8")); } catch { return {}; }
}

/** The JSON Claude Code would pipe to a hook for this event. */
export function hookRunPayload(event, { absRoot, file, prompt, tool, command, session } = {}) {
  const base = { session_id: session ?? "manual", cwd: absRoot, hook_event_name: { "session-start": "SessionStart", prompt: "UserPromptSubmit", "post-edit": "PostToolUse", stop: "Stop" }[event] };
  if (event === "prompt") return { ...base, prompt: prompt ?? "" };
  if (event === "post-edit") {
    return tool === "Bash" || (!file && command)
      ? { ...base, tool_name: "Bash", tool_input: { command: command ?? "" } }
      : { ...base, tool_name: tool ?? "Edit", tool_input: { file_path: file } };
  }
  if (event === "session-start") return { ...base, source: "startup" };
  return base;
}

/** Can this side run the command? A wsl.exe command needs a Windows host (or
 *  interop); a /linux/path command needs a POSIX host whose path exists. */
function runnableHere(command, platform = process.platform) {
  if (/^wsl\.exe\b/.test(command)) return platform === "win32" || existsSync("/proc/sys/fs/binfmt_misc/WSLInterop") || existsSync("/proc/sys/fs/binfmt_misc/WSLInterop-late") ? null : "a wsl.exe command, but this machine has no WSL interop";
  // The program: the first word after any VAR=value assignments, unquoted.
  const prog = command.replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)\s+)*/, "").match(/^\s*("[^"]*"|'[^']*'|\S+)/)?.[1]?.replace(/^["']|["']$/g, "");
  const first = prog && /^(\/|[A-Za-z]:\\)/.test(prog) ? prog : null;
  if (platform === "win32" && first?.startsWith("/")) return `a Linux path (${first}) that Windows cannot run — reinstall with \`vibegraph-knowledge hook install --target wsl\` from the WSL shell`;
  if (first && first.startsWith("/") && !existsSync(first.replace(/^\/\//, "/"))) return `${first} does not exist here`;
  return null;
}

/** What `doctor` says about the hooks. lines: [level, text]. */
export function doctorReport(absRoot, { platform = process.platform, now = Date.now() } = {}) {
  const lines = [];
  const settings = join(absRoot, ".claude", "settings.local.json");
  if (!existsSync(settings)) return { lines: [["info", "no hooks installed (.claude/settings.local.json is absent) — `vibegraph-knowledge init --hooks`"]], ok: true };
  let hooks = {};
  try { hooks = JSON.parse(readFileSync(settings, "utf-8")).hooks ?? {}; } catch (e) { return { lines: [["error", `.claude/settings.local.json is not JSON: ${e.message}`]], ok: false }; }
  const ours = Object.entries(hooks).flatMap(([event, arr]) => (arr ?? []).flatMap((m) => (m.hooks ?? []).filter((h) => String(h.command ?? "").includes(HOOK_MARKER)).map((h) => ({ event, command: h.command }))));
  if (!ours.length) return { lines: [["info", "settings.local.json has no VibeGraph hooks — `vibegraph-knowledge init --hooks`"]], ok: true };
  let ok = true;
  lines.push(["ok", `${ours.length} VibeGraph hook(s) installed: ${[...new Set(ours.map((h) => h.event))].join(", ")}`]);
  for (const h of ours) {
    const why = runnableHere(h.command, platform);
    if (why) { ok = false; lines.push(["warn", `${h.event}: ${why}`]); }
  }
  const installed = statSync(settings).mtimeMs;
  const fired = readFired(absRoot);
  const last = Object.entries(fired).map(([event, r]) => ({ event, at: Date.parse(r.at) })).filter((r) => r.at >= installed).sort((a, b) => b.at - a.at);
  if (!last.length) {
    ok = false;
    lines.push(["warn", `the hooks have NOT fired since they were installed (${new Date(installed).toISOString()}). They apply from the NEXT Claude Code session; if one has run since, its hooks never reached this project — a Windows-side Claude against a \\\\wsl.localhost path needs \`hook install --target wsl\`, and \`hook run prompt --prompt "…"\` fires one by hand to test.`]);
  } else {
    const ago = Math.round((now - last[0].at) / 60000);
    lines.push(["ok", `last fired: ${last[0].event}, ${ago < 1 ? "under a minute" : `${ago} min`} ago (${last.map((l) => l.event).join(", ")} since install)`]);
  }
  return { lines, ok };
}
