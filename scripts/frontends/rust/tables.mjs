// M-RUST (PLAN-M-RUST.md §5.4) — the ONE home of Rust effect vocabulary.
// Parse-time stamping; the extractor trusts IR effectKind for
// language != "python" (decision (c) of the M-LANG arc).
//
// Keyed on the LAST TWO path segments where the path has them, falling
// back to the tail. `read_to_string` alone is ambiguous — it is a method
// on several types — but `fs::read_to_string` is the std free function
// this table means. A tail-only key would claim the effect for any
// receiver that happens to spell the same method.

/** `a::b::c` → ["c", "b::c"]; `c` → ["c"]. Strongest key first. */
function keysFor(callee) {
  // Drop a turbofish before keying: `parse::<i64>` keys as `parse`.
  const bare = callee.replace(/::<[^>]*>/g, "");
  const segs = bare.split("::").filter(Boolean);
  const tail = segs[segs.length - 1] ?? bare;
  if (segs.length >= 2) return [`${segs[segs.length - 2]}::${tail}`, tail];
  return [tail];
}

/** Two-segment keys: the std free functions whose bare tail is ambiguous. */
const QUALIFIED = {
  "fs::read_to_string": "fs", "fs::read": "fs", "fs::write": "fs",
  "fs::copy": "fs", "fs::rename": "fs", "fs::remove_file": "fs",
  "fs::remove_dir": "fs", "fs::remove_dir_all": "fs",
  "fs::create_dir": "fs", "fs::create_dir_all": "fs",
  "fs::metadata": "fs", "fs::read_dir": "fs", "fs::canonicalize": "fs",
  "File::open": "fs", "File::create": "fs", "OpenOptions::new": "fs",
  "process::exit": "subprocess", "process::abort": "subprocess",
  "Command::new": "subprocess",
  "TcpStream::connect": "http", "TcpListener::bind": "http",
};

/** Macro names that write somewhere a person reads. */
const LOG_MACROS = new Set([
  "println!", "print!", "eprintln!", "eprint!", "dbg!",
  "info!", "warn!", "error!", "debug!", "trace!",
]);

/** Crate roots whose every call is that kind of boundary. */
const CRATE_ROOT_EFFECT = {
  reqwest: "http", ureq: "http", hyper: "http", isahc: "http", surf: "http",
  rusqlite: "db", sqlx: "db", diesel: "db", postgres: "db",
  tokio_postgres: "db", mongodb: "db", redis: "db",
};

/**
 * Parse-time effect classification for a Rust callee (bare `f`, path
 * `a::b::f`, method `x.f`, turbofish `f::<T>`, or macro `m!`).
 *
 * A scanning heuristic, never a correctness claim — the C++ table's
 * note applies verbatim. A METHOD call (`x.write_all(..)`) is NOT keyed
 * here: which type's method it is needs the receiver, which this
 * frontend does not infer, and claiming the effect from the name alone
 * is the guess M-BOUNDARY refuses.
 */
export function effectKindForCallee(callee) {
  if (!callee) return null;
  if (callee.endsWith("!")) {
    const macro = callee.split("::").pop();
    return LOG_MACROS.has(macro) ? "log" : null;
  }
  // A method call carries its receiver in the text; leave it alone.
  if (callee.includes(".")) return null;
  const root = callee.split("::")[0];
  if (CRATE_ROOT_EFFECT[root]) return CRATE_ROOT_EFFECT[root];
  for (const key of keysFor(callee)) {
    if (QUALIFIED[key]) return QUALIFIED[key];
  }
  return null;
}

/** Macros that never return — they end the flow, so they render as a
 *  raise rather than a call (python's `raise` shape). */
export const DIVERGING_MACROS = new Set([
  "panic!", "todo!", "unimplemented!", "unreachable!", "assert!",
  "assert_eq!", "assert_ne!",
]);

/** `assert*!` diverges only on failure — it is a test's whole point, so
 *  it stays a CALL and only the true never-returns macros raise. */
export const ALWAYS_DIVERGING = new Set([
  "panic!", "todo!", "unimplemented!", "unreachable!",
]);
