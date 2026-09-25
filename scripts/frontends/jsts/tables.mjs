// M-LANG3 (PLAN-M-LANG.md) — the ONE home of JS/TS effect vocabulary.
// The parser stamps effectKind at parse time; the extractor trusts IR
// effectKind for language != "python" (decision (c) of the arc), so no
// second copy exists anywhere.

const HTTP_HEADS = new Set(["fetch", "axios", "got", "superagent", "ky"]);
const LOG_HEADS = new Set(["console", "winston", "pino", "logger", "log"]);
const SUBPROCESS_HEADS = new Set(["child_process", "execa"]);
const SUBPROCESS_BARE = new Set(["exec", "execFile", "execSync", "spawn", "spawnSync", "fork"]);
const FS_HEADS = new Set(["fs", "fsp"]);
const FS_BARE = new Set([
  "readFile", "readFileSync", "writeFile", "writeFileSync", "appendFile",
  "mkdir", "mkdirSync", "rm", "rmSync", "unlink", "unlinkSync",
  "readdir", "readdirSync", "copyFile", "rename", "stat", "statSync",
]);
const DB_HEADS = new Set(["pg", "sqlite3", "mysql", "knex", "prisma"]);
const DB_RECEIVERS = new Set(["pool", "client", "db", "conn", "connection", "database"]);
const DB_TAILS = new Set(["query", "execute", "exec"]);

/**
 * Parse-time effect classification for a (possibly dotted) callee.
 * String-match heuristic in the spirit of parse_cst.py's
 * _classify_effect_kind — a scanning aid, never a correctness claim.
 */
export function effectKindForCallee(callee) {
  if (!callee) return null;
  const parts = callee.split(".");
  const head = parts[0];
  const tail = parts[parts.length - 1];
  if (HTTP_HEADS.has(head)) return "http";
  if (LOG_HEADS.has(head)) return "log";
  if (FS_HEADS.has(head) || (parts.length === 1 && FS_BARE.has(head))) return "fs";
  if (SUBPROCESS_HEADS.has(head) || (parts.length === 1 && SUBPROCESS_BARE.has(head))) return "subprocess";
  if (DB_HEADS.has(head)) return "db";
  if (parts.length > 1 && DB_RECEIVERS.has(head) && DB_TAILS.has(tail)) return "db";
  return null;
}
