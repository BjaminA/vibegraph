// U3.2 (revised) — three-family semantic palette picker.
//
// Family 1 — Logic / control     --accent-thread (teal)
//   function_def, class_def (non-Exception), if_stmt, return_stmt,
//   for_loop, raise_stmt fallback, decision-point pseudos. Anything
//   that IS the user's program logic.
//
// Family 2 — I/O / external boundary  --accent-io* (blue)
//   --accent-io-write : mutation (commit / insert / update / delete /
//                       save / rollback). Brightest in family — the
//                       eye snaps to writes when scanning a thread.
//   --accent-io       : reads + receivers + network + filesystem.
//                       conn.* / cursor.* / session.* / engine.*;
//                       requests / urllib / httpx / aiohttp; open(),
//                       Path().read/write, os.path; effectKind in
//                       {db, http, fs, subprocess}.
//   --accent-io-muted : least bright — print, log, sys.std*, log/info/
//                       warn/error calls, effectKind="log".
//
// Family 3 — Configuration / setup  --accent-config (warm muted)
//   argparse + click + framework registration code (Flask
//   add_url_rule, FastAPI router, Django urlpatterns / path() / url())
//   and unittest setUp/tearDown fixtures. These are anchors but they
//   aren't the program — they recede.
//
// Errors stay --accent-error: raise_stmt, class_def ending Error/
// Exception. The old --accent-warning is NOT used for mutation any
// more; warning stays reserved for genuine warnings / dynamic
// dispatches the user should treat with care.
//
// Returns CSS variable names so the renderer composes via var() +
// color-mix without this helper knowing actual values.

import type { ThreadNode as ThreadNodeJSON } from "./types";
import type {
  AstNode, ProjectFileData, EntryPoint,
} from "../../shared/protocol";

export interface ThreadNodeAccent {
  accentVar: string;
  kindLabel: string;
}

// ── Family 2 — I/O regex sets ──────────────────────────────────────────────
// Method-tail tokens that signal MUTATION on a database / session.
// Matched against the *last* dotted segment so "session.commit",
// "conn.commit", and "engine.commit" all hit. `set` / `put` removed —
// false-positive prone with regular `set()` / `dict.put`.
const DB_WRITE_TAILS = new Set([
  "commit", "insert", "update", "delete", "save", "rollback",
  "drop", "truncate", "create_all", "create_table",
]);
// Reads that signal DB on their own — cursor/ORM vocabulary that
// ordinary Python objects don't use.
const DB_READ_TAILS = new Set([
  "query", "select", "fetch", "fetchone", "fetchall",
  "fetchmany", "scalar", "scalars",
]);
// Generic English verbs that only mean DB when the RECEIVER pledges it
// (DB_RECEIVER_HEADS). Bare `self.levels.get` is a dict access, not a
// database read — an honesty-first panel must not invent a DB
// (full-scope review 2026-07, P2 false positive).
const DB_READ_GENERIC_TAILS = new Set([
  "get", "read", "find", "count", "list", "all", "first",
  "exists", "filter",
]);
const DB_NEUTRAL_TAILS = new Set([
  "execute", "executemany",
]);
// Same receiver-gated treatment for generic session/connection verbs —
// `flagged.add` / `fh.close` are not database operations.
const DB_NEUTRAL_GENERIC_TAILS = new Set([
  "close", "begin", "flush", "refresh", "expunge", "merge", "add",
]);
// Connection-like receivers — any call against one of these reads as
// DB even if the verb isn't otherwise classified. Matched as the
// FIRST dotted segment.
const DB_RECEIVER_HEADS = /^(conn|cursor|session|db|engine|tx|transaction|cx|connection)\b/i;
// Network receivers / functions.
const HTTP_HEADS = /^(requests|httpx|aiohttp|urllib|urllib3|fetch)\b/i;
// Filesystem entry points.
const FS_TAILS = /^(open|read_text|write_text|read_bytes|write_bytes)$/i;
const FS_HEADS = /^(os\.path|pathlib|shutil)\b/i;
// I/O sinks — least bright.
const IO_MUTED_TAILS = /^(print|log|debug|info|warn|warning|error|critical|exception)$/i;
const IO_MUTED_HEADS = /^(sys\.stdout|sys\.stderr|sys\.stdin|logging)\b/i;

// ── Family 3 — config regex sets ──────────────────────────────────────────
const CONFIG_HEADS = /^(argparse|click)\b/i;
const CONFIG_TAILS = new Set([
  "add_argument", "add_subparsers", "add_parser", "parse_args",
  "ArgumentParser",
  // Framework registration — Flask, FastAPI, Django.
  "add_url_rule", "register_blueprint", "include_router", "add_api_route",
  "path", "re_path", "url",
]);
// Function names that fall under config (test fixtures + framework
// app-factories). Matched on EXACT function_def name (post-strip of
// any leading dunder).
const CONFIG_FUNCTION_NAMES = new Set([
  "setUp", "tearDown",
  "setup_method", "teardown_method",
  "setup_class", "teardown_class",
  "setup_module", "teardown_module",
  "setup_function", "teardown_function",
  "setUpClass", "tearDownClass",
  "create_app", "configure",
]);

// ── Function_def → I/O classification by name ──────────────────────────────
// Exact-name match against the IR function name so `def insert(...)` reads
// as a DB write but `def create_user(...)` does NOT (the leading `cmd_`
// or `_user` etc. blocks the match — "create_user" is a domain function,
// not a DB primitive).
const FUNCTION_DB_WRITE_NAMES = new Set([
  "insert", "update", "delete", "save", "commit", "rollback",
  "create_all", "drop", "truncate",
]);
const FUNCTION_DB_READ_NAMES = new Set([
  "query", "find", "select", "fetch", "fetchone", "fetchall",
  "fetchmany", "scalar", "first", "all",
]);
const FUNCTION_DB_NEUTRAL_NAMES = new Set([
  "execute", "close", "begin", "flush",
]);
// Suffixes that mark a function as DB-receiver-flavoured (returns a
// connection / session / cursor / engine).
const FUNCTION_DB_SUFFIXES = /(_conn|_db|_cursor|_session|_engine|_transaction)$/i;

// Scan-friendly kindLabel per container subtype. (except is handled
// inline — it's the only red one.) if_then / if_else collapse to IF / ELSE
// so the tooltip / inspector reads cleanly; the bordered region's own chip
// still shows the full `IF <cond>` header from the node label.
const CONTAINER_KIND_LABELS: Record<string, string> = {
  try: "TRY",
  finally: "FINALLY",
  while: "WHILE",
  for: "FOR",
  if_then: "IF",
  if_else: "ELSE",
};

export function accentForThreadNode(
  threadNode: ThreadNodeJSON,
  projectIR: Record<string, ProjectFileData> | null,
  entryPoints: EntryPoint[] | null,
): ThreadNodeAccent {
  // ── External / dynamic / return — kinds without an IR node ─────────────
  if (threadNode.kind === "external") {
    return classifyExternal(threadNode.label ?? "");
  }
  if (threadNode.kind === "dynamic") {
    // Genuine runtime dispatch (getattr family, or a local var invoked at
    // runtime). Amber --accent-warning is the reserved "treat with care /
    // runtime-determined" accent (aesthetic skill). A confident call with
    // a runtime target — NOT ghosted in ThreadNode.
    return { accentVar: "--accent-warning", kindLabel: "DYNAMIC" };
  }
  if (threadNode.kind === "unresolved") {
    // R3 — resolution gap: a bare name the linker couldn't resolve and
    // that isn't a local binding. --text-muted (recessive, low-confidence)
    // keeps it honestly distinct from runtime-determined dynamic dispatch;
    // ThreadNode ghosts it. No family hue — an absence of classification
    // should recede, not claim a meaning.
    return { accentVar: "--text-muted", kindLabel: "UNRESOLVED" };
  }
  if (threadNode.kind === "return") {
    return { accentVar: "--accent-thread", kindLabel: "RETURN" };
  }
  if (threadNode.kind === "container") {
    // M17.3 — Family 1 (teal control flow) for try / finally / while / for
    // / if_then / if_else; --accent-error for except (only red, exception
    // path). containerKind discriminates; falling through to teal is the
    // safe default for any unknown future subtype. kindLabel is largely
    // informational for containers (the visible chip uses the node's
    // `label`, not this), so keep it short + scan-friendly.
    if (threadNode.containerKind === "except") {
      return { accentVar: "--accent-error", kindLabel: "EXCEPT" };
    }
    const kindLabel = CONTAINER_KIND_LABELS[threadNode.containerKind ?? ""] ?? "CONTAINER";
    return { accentVar: "--accent-thread", kindLabel };
  }

  // ── IR-backed nodes ────────────────────────────────────────────────────
  const ir = irNodeFor(threadNode, projectIR);
  if (!ir) {
    return { accentVar: "--accent-thread", kindLabel: threadNode.kind.toUpperCase() };
  }

  if (ir.type === "function_def") {
    return classifyFunctionDef(ir, threadNode, entryPoints);
  }

  if (ir.type === "class_def") {
    const bases = ir.bases ?? [];
    const decorators = ir.decorators ?? [];
    if (bases.some((b) => /(?:Error|Exception)$/.test(b))) {
      return { accentVar: "--accent-error", kindLabel: "EXCEPTION" };
    }
    if (decorators.some((d) => /@?dataclass\b/.test(d)) || bases.includes("BaseModel")) {
      return { accentVar: "--accent-thread", kindLabel: "DATA" };
    }
    return { accentVar: "--accent-thread", kindLabel: "CLASS" };
  }

  if (ir.type === "if_stmt") {
    return { accentVar: "--accent-thread", kindLabel: "BRANCH" };
  }

  if (ir.type === "raise_stmt") {
    return { accentVar: "--accent-error", kindLabel: "RAISE" };
  }

  if (ir.type === "return_stmt") {
    return { accentVar: "--accent-thread", kindLabel: "RETURN" };
  }

  if (ir.type === "for_loop") {
    return { accentVar: "--accent-thread", kindLabel: "LOOP" };
  }

  if (ir.type === "import" || ir.type === "import_from") {
    return { accentVar: "--accent-io-muted", kindLabel: "IMPORT" };
  }

  // call / assignment — try effectKind first (M9.1 IR field), then
  // fall back to label-pattern heuristics. Note the no-double-dipping
  // rule: even though effectKind says "db", we still inspect the call
  // name to pick write vs read vs neutral.
  if (ir.type === "call" || ir.type === "assignment") {
    const funcName = funcNameOf(ir);
    const cls = classifyCallLike(funcName, ir.effectKind ?? null);
    if (cls) return cls;
    return { accentVar: "--accent-thread", kindLabel: ir.type === "call" ? "CALL" : "ASSIGN" };
  }

  return { accentVar: "--accent-thread", kindLabel: ir.type.toUpperCase() };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function classifyExternal(label: string): ThreadNodeAccent {
  const tail = label.split(".").pop() ?? label;
  // Config first — argparse calls show up as both "argparse.X" (head)
  // and "X" (tail) — match both.
  if (CONFIG_HEADS.test(label) || CONFIG_TAILS.has(tail)) {
    return { accentVar: "--accent-config", kindLabel: "CONFIG" };
  }
  // I/O sinks before DB checks — print / log are unambiguously muted.
  if (IO_MUTED_TAILS.test(tail) || IO_MUTED_HEADS.test(label)) {
    return { accentVar: "--accent-io-muted", kindLabel: "I/O" };
  }
  // Network heads.
  if (HTTP_HEADS.test(label)) {
    return { accentVar: "--accent-io", kindLabel: "HTTP" };
  }
  // Filesystem.
  if (FS_TAILS.test(tail) || FS_HEADS.test(label)) {
    return { accentVar: "--accent-io", kindLabel: "FS" };
  }
  // DB tails — write vs read vs neutral, in order of specificity.
  // Generic verbs (get/list/add/close/…) need a db-pledging receiver.
  const dbReceiver = DB_RECEIVER_HEADS.test(label);
  if (DB_WRITE_TAILS.has(tail)) {
    return { accentVar: "--accent-io-write", kindLabel: "DB WRITE" };
  }
  if (DB_READ_TAILS.has(tail) || (dbReceiver && DB_READ_GENERIC_TAILS.has(tail))) {
    return { accentVar: "--accent-io", kindLabel: "DB READ" };
  }
  if (DB_NEUTRAL_TAILS.has(tail) || (dbReceiver && DB_NEUTRAL_GENERIC_TAILS.has(tail))) {
    return { accentVar: "--accent-io", kindLabel: "DB" };
  }
  // DB receiver fallback — any call against conn / cursor / session etc.
  if (DB_RECEIVER_HEADS.test(label)) {
    return { accentVar: "--accent-io", kindLabel: "DB" };
  }
  return { accentVar: "--accent-io-muted", kindLabel: "EXTERNAL" };
}

function classifyFunctionDef(
  ir: AstNode,
  threadNode: ThreadNodeJSON,
  entryPoints: EntryPoint[] | null,
): ThreadNodeAccent {
  const fnName = functionNameFromIr(ir);

  // Setup / teardown / app-factory fixtures land in Family 3 by name.
  if (fnName && CONFIG_FUNCTION_NAMES.has(fnName)) {
    return { accentVar: "--accent-config", kindLabel: "FIXTURE" };
  }

  // DB primitives by exact function name. "insert", "query", etc. —
  // these read as part of the DB blue column; their callers (cmd_create,
  // create_user, etc.) stay teal because their NAME doesn't trip the
  // DB regexes.
  if (fnName) {
    if (FUNCTION_DB_WRITE_NAMES.has(fnName)) {
      return { accentVar: "--accent-io-write", kindLabel: "DB WRITE" };
    }
    if (FUNCTION_DB_READ_NAMES.has(fnName)) {
      return { accentVar: "--accent-io", kindLabel: "DB READ" };
    }
    if (FUNCTION_DB_NEUTRAL_NAMES.has(fnName)) {
      return { accentVar: "--accent-io", kindLabel: "DB" };
    }
    if (FUNCTION_DB_SUFFIXES.test(fnName)) {
      return { accentVar: "--accent-io", kindLabel: "DB" };
    }
  }

  // Entry-point affiliation — these stay Family 1 (teal) but get a
  // descriptive kindLabel for the tooltip / future U5 surface.
  if (entryPoints) {
    const ep = entryPoints.find(
      (e) => e.irNodeId === ir.id &&
        (!threadNode.file || e.file === threadNode.file || e.file.endsWith(threadNode.file)),
    );
    if (ep) {
      switch (ep.kind) {
        case "route":      return { accentVar: "--accent-thread", kindLabel: "ROUTE" };
        case "cli":        return { accentVar: "--accent-thread", kindLabel: "CLI" };
        case "test":       return { accentVar: "--accent-thread", kindLabel: "TEST" };
        case "public_api": return { accentVar: "--accent-thread", kindLabel: "API" };
        case "manual":     return { accentVar: "--accent-thread", kindLabel: "PINNED" };
      }
    }
  }
  if (ir.isAsync) return { accentVar: "--accent-thread", kindLabel: "ASYNC FN" };
  return { accentVar: "--accent-thread", kindLabel: "FN" };
}

function classifyCallLike(
  funcName: string | null,
  effectKind: string | null,
): ThreadNodeAccent | null {
  if (funcName) {
    const tail = funcName.split(".").pop() ?? funcName;
    if (CONFIG_HEADS.test(funcName) || CONFIG_TAILS.has(tail)) {
      return { accentVar: "--accent-config", kindLabel: "CONFIG" };
    }
    if (IO_MUTED_TAILS.test(tail) || IO_MUTED_HEADS.test(funcName)) {
      return { accentVar: "--accent-io-muted", kindLabel: "I/O" };
    }
    const dbReceiver = DB_RECEIVER_HEADS.test(funcName);
    if (DB_WRITE_TAILS.has(tail)) {
      return { accentVar: "--accent-io-write", kindLabel: "DB WRITE" };
    }
    if (DB_READ_TAILS.has(tail) || (dbReceiver && DB_READ_GENERIC_TAILS.has(tail))) {
      return { accentVar: "--accent-io", kindLabel: "DB READ" };
    }
    if (DB_NEUTRAL_TAILS.has(tail) || (dbReceiver && DB_NEUTRAL_GENERIC_TAILS.has(tail))) {
      return { accentVar: "--accent-io", kindLabel: "DB" };
    }
    if (DB_RECEIVER_HEADS.test(funcName)) {
      return { accentVar: "--accent-io", kindLabel: "DB" };
    }
    if (HTTP_HEADS.test(funcName)) {
      return { accentVar: "--accent-io", kindLabel: "HTTP" };
    }
    if (FS_TAILS.test(tail) || FS_HEADS.test(funcName)) {
      return { accentVar: "--accent-io", kindLabel: "FS" };
    }
  }
  if (effectKind === "db")          return { accentVar: "--accent-io", kindLabel: "DB" };
  if (effectKind === "http")        return { accentVar: "--accent-io", kindLabel: "HTTP" };
  if (effectKind === "fs")          return { accentVar: "--accent-io", kindLabel: "FS" };
  if (effectKind === "subprocess")  return { accentVar: "--accent-io", kindLabel: "SHELL" };
  if (effectKind === "log")         return { accentVar: "--accent-io-muted", kindLabel: "LOG" };
  return null;
}

function irNodeFor(
  threadNode: ThreadNodeJSON,
  projectIR: Record<string, ProjectFileData> | null,
): AstNode | null {
  if (!threadNode.irNodeId || !threadNode.file || !projectIR) return null;
  const direct = projectIR[threadNode.file];
  if (direct) {
    const n = direct.nodes.find((m) => m.id === threadNode.irNodeId);
    if (n) return n;
  }
  for (const [k, v] of Object.entries(projectIR)) {
    if (k === threadNode.file || k.endsWith(threadNode.file)) {
      const n = v.nodes.find((m) => m.id === threadNode.irNodeId);
      if (n) return n;
    }
  }
  return null;
}

// IR node id for function_def is "<path>/<name>.fn". Pull the name
// from the id since the IR doesn't carry it as a separate field. The
// thread node's label is the same string, so use that as a fallback.
function functionNameFromIr(ir: AstNode): string | null {
  const m = ir.id.match(/(?:^|\/)([^/]+)\.fn$/);
  return m ? m[1] : null;
}

function funcNameOf(ir: AstNode): string | null {
  if (ir.type === "call") return ir.funcName ?? null;
  if (ir.type === "assignment") return (ir as any).callTarget ?? null;
  return null;
}
