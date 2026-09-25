// M-LANG2a (PLAN-M-LANG.md) — the ONE home of bash effect/builtin
// vocabulary. The parser stamps effectKind from these at parse time;
// the extractor trusts IR effectKind for language != "python", so no
// second copy of these tables exists anywhere (decision (c) of the arc).

// Known effect vocabulary, first-match by command word. Mirrors the
// spirit of parse_cst.py:_classify_effect_kind: a scanning heuristic,
// not a correctness claim.
const EFFECT_BY_COMMAND = new Map(Object.entries({
  // http
  curl: "http", wget: "http", http: "http", https: "http",
  // db
  sqlite3: "db", psql: "db", mysql: "db", mongosh: "db", "redis-cli": "db",
  // fs
  rm: "fs", cp: "fs", mv: "fs", mkdir: "fs", rmdir: "fs", touch: "fs",
  tee: "fs", dd: "fs", rsync: "fs", tar: "fs", chmod: "fs", chown: "fs",
  ln: "fs", install: "fs", truncate: "fs",
  // log
  echo: "log", printf: "log", logger: "log",
}));

// Pure shell builtins that can never be a thread step — no node emitted.
// (`return` / `exit` become return_stmt; `source` / `.` become import;
// `eval` and `trap` stay as calls: eval is the honesty case, trap a
// named v1 limit.)
export const SKIP_BUILTINS = new Set([
  "cd", "set", "shift", "unset", "true", "false", ":", "break",
  "continue", "wait", "ulimit", "umask", "getopts",
]);

// Builtins that ARE emitted as calls but are shell-internal — the
// linker must not default them to effectKind=subprocess when they
// resolve to no project function.
export const NEUTRAL_BUILTINS = new Set([
  "read", "test", "[", "[[", "eval", "trap", "exec", "command",
  "type", "hash", "let", "local", "declare", "export", "readonly",
]);

export function effectKindForCommand(word) {
  return EFFECT_BY_COMMAND.get(word) ?? null;
}

// A callee whose command word is a variable/expansion is genuine
// runtime dispatch — never resolved, never defaulted to subprocess;
// the thread extractor renders it `dynamic`. `eval` is the same class.
export function isDynamicCallee(word) {
  return word.includes("$") || word === "eval";
}
