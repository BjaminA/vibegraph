// `config get|set|unset <key> [<value>]` (2026-10-07): per-USER settings, so
// nobody has to edit their environment. One key so far — `claude.bin`, the
// Claude Code executable (or a JSON array of it plus arguments) that every
// Claude path uses (src/server/find_claude.ts) when VG_CLAUDE_BIN is not set.
// Stored at %APPDATA%\vibegraph\config.json or ~/.config/vibegraph/config.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describeClaude, envOverridesClaude, findClaude, isMissing, realIO } from "../../src/server/find_claude.ts";

export const CONFIG_USAGE = `config get|set|unset <key> [<value>]   per-user settings (keys: claude.bin — the Claude Code
                                  executable every Claude call uses when VG_CLAUDE_BIN is unset; spaces are fine)`;
const KEYS = { "claude.bin": ["claude", "bin"] };

export function runConfig(args, io = realIO()) {
  const [sub, key, ...value] = args;
  const done = (text, exitCode = 0) => ({ exitCode, text: text.endsWith("\n") ? text : `${text}\n` });
  const file = io.configFile();
  if (!sub || !["get", "set", "unset"].includes(sub) || (sub !== "get" && !key)) return done(`usage: vibegraph-knowledge ${CONFIG_USAGE}`, 2);
  if (key && !KEYS[key]) return done(`unknown key ${key} (known: ${Object.keys(KEYS).join(", ")})`, 2);
  let cfg = {};
  try { if (existsSync(file)) cfg = JSON.parse(readFileSync(file, "utf-8")); } catch (e) { return done(`${file} is not JSON: ${e.message}`, 1); }
  if (sub === "get") {
    if (!key) return done(`${file}\n${JSON.stringify(cfg, null, 2)}`);
    const v = KEYS[key].reduce((o, k) => o?.[k], cfg);
    return done(v === undefined ? `${key} is not set` : String(v), v === undefined ? 1 : 0);
  }
  const [a, b] = KEYS[key];
  if (sub === "unset") { if (cfg[a]) delete cfg[a][b]; }
  else {
    const v = value.join(" ").trim();
    if (!v) return done(`config set ${key} needs a value`, 2);
    cfg[a] = { ...(cfg[a] ?? {}), [b]: v };
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  if (key !== "claude.bin") return done(`${sub === "set" ? "set" : "unset"} ${key} in ${file}`);
  // say at once whether the setting finds Claude (VG_CLAUDE_BIN still wins)
  const env = { ...process.env, VG_CLAUDE_BIN: "" };
  const f = findClaude(env);
  return done(`${sub === "set" ? "set" : "unset"} ${key} in ${file}\n${isMissing(f) ? f.error : describeClaude(env)}${envOverridesClaude() ? "\n(note: VG_CLAUDE_BIN is set in this environment and takes precedence)" : ""}`, isMissing(f) ? 1 : 0);
}
