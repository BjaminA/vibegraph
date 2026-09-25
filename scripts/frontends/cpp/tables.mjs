// M-LANG5a (PLAN-M-LANG.md) — the ONE home of C++ effect vocabulary.
// Parse-time stamping; the extractor trusts IR effectKind for
// language != "python" (decision (c) of the arc).

const LOG_CALLS = new Set(["printf", "fprintf", "puts", "perror", "fputs", "vprintf"]);
const FS_CALLS = new Set([
  "fopen", "fclose", "fread", "fwrite", "fseek", "fgets", "fputc",
  "open", "close", "read", "write", "remove", "rename", "mkdir",
  "unlink", "tmpfile", "freopen",
]);
const SUBPROCESS_CALLS = new Set(["system", "popen", "pclose", "fork", "execl", "execv", "execvp", "execve"]);

/**
 * Parse-time effect classification for a C++ callee (bare, qualified
 * `ns::f`, member `x.f`/`x->f`, or template `f<T>`). Prefix families:
 * sqlite3_* → db, curl_* → http. std::-qualified stdio wrappers land
 * on their tail. A scanning heuristic, never a correctness claim
 * (std::cout's operator<< is NOT a call — a NAMED LIMIT of call-based
 * effect detection).
 */
export function effectKindForCallee(callee) {
  if (!callee) return null;
  const tail = callee.split("::").pop().split("->").pop().split(".").pop().split("<")[0];
  if (LOG_CALLS.has(tail)) return "log";
  if (FS_CALLS.has(tail)) return "fs";
  if (SUBPROCESS_CALLS.has(tail)) return "subprocess";
  if (tail.startsWith("sqlite3_")) return "db";
  if (tail.startsWith("curl_")) return "http";
  return null;
}
