// M-FLOW.2 (PLAN-M-FLOW.md R4) — SCRIPT REFERENCES: a string literal in a
// call's or assignment's arguments that names a script this project parses.
//
// `"accounts/get_accounts_financials.sh"` handed to a Volt CommandStream,
// `"${SCRIPT_DIR}/ingest.mjs"` handed to node, `../scripts/run.sh` handed to
// exec — each is the CALLER naming its target by a literal the callee's file
// path declares. That is the join the `command` crossing and the
// project-level discoverer (scripts/discover_project.mjs) both read, so it
// lives here once, as plain JS both a spawned script and the server can
// import (the nests.mjs / confinement.mjs precedent).
//
// Reads IR DATA (the `args` and `preview` fields), never source text.

/** Extensions a script literal may end with. A path with none of these is
 *  accepted only when it has ≥ 2 segments and a parsed file ends with it
 *  (`/opt/app/bin/ops-run` → `bin/ops-run`). */
const SCRIPT_EXT = /\.(sh|bash|mjs|cjs|js|ts|tsx|py|rb|pl|rs|cpp|cc)$/;

/** What may stand alone as an UNMATCHED hop — a literal that names a script
 *  nothing here parses. A bare `out.ts` is an MPEG transport stream in the
 *  C++ fixture and `%s.js` a format string; only a PATH (a slash) or an
 *  unambiguous script extension is script-shaped enough to record when no
 *  parsed file answers to it. Anything else becomes a hop only by matching. */
const UNAMBIGUOUS_SCRIPT = /\.(sh|bash|mjs|cjs|py|pl|rb)$/;
export function isScriptShaped(suffix) {
  return SCRIPT_EXT.test(suffix) && (suffix.includes("/") || UNAMBIGUOUS_SCRIPT.test(suffix));
}

/** The quoted string literals inside one argument text. An argument may
 *  be an array literal (`[ORCH, id, "orders/export.sh"]`) or an object;
 *  every quoted run inside it is a candidate. */
export function quotedLiterals(argText) {
  if (typeof argText !== "string" || !argText) return [];
  const out = [];
  const re = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m;
  while ((m = re.exec(argText)) !== null) out.push(m[2]);
  return out;
}

/**
 * The path SUFFIX a literal names, or null when it is not script-shaped.
 *
 *   "accounts/x.sh"             → accounts/x.sh
 *   "${SCRIPT_DIR}/lib/log.sh"  → lib/log.sh      (a variable prefix is unknown, the tail is not)
 *   "$(dirname "$0")/../scripts/run.sh" → scripts/run.sh
 *   "./ingest.mjs"              → ingest.mjs
 *   "/opt/app/bin/ops-run"  → opt/app/bin/ops-run  (matched as a suffix of a parsed path)
 *   "N/A", "see utils.py for"   → null (spaces, or not path-shaped)
 */
export function scriptSuffix(literal) {
  if (typeof literal !== "string") return null;
  let s = literal.trim();
  if (!s || s.length > 240) return null;
  // Drop every leading interpolation / substitution and `./`, `../` step
  // FIRST: `$(dirname "$0")/../scripts/run.sh` has a space inside the
  // substitution and none in the path it yields.
  const PREFIX = /^(?:\$\{[^}]*\}|\$\([^)]*\)|\$[A-Za-z_][A-Za-z0-9_]*|\.{1,2})(?:\/|$)/;
  while (PREFIX.test(s)) s = s.replace(PREFIX, "");
  s = s.replace(/^\/+/, "");
  if (!s || /\s/.test(s) || s.includes("${") || s.includes("$(")) return null;
  if (!/^[A-Za-z0-9_.@][A-Za-z0-9_.\-@/]*$/.test(s)) return null;
  // A bare extension (`".sh"`) names nothing; a HOST path (`duckduckgo.com/y.js`)
  // is a URL's tail, the http kind's business.
  if (/(^|\/)\.[A-Za-z0-9]+$/.test(s)) return null;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|org|net|io|gov|edu|ai|dev|app|co|uk|de|fr)\//i.test(s)) return null;
  if (SCRIPT_EXT.test(s)) return s;
  // Extensionless: only a multi-segment path can be a script reference
  // (a bare word is a command name or a key, and the tables own those).
  if (s.includes("/") && !s.endsWith("/")) return s;
  return null;
}

/** Parsed files whose path ends with the suffix (segment-aligned). */
export function matchScriptFiles(fileKeys, suffix) {
  if (!suffix) return [];
  const out = [];
  for (const f of fileKeys) {
    if (f === suffix || f.endsWith("/" + suffix)) out.push(f);
  }
  return out.sort();
}

/**
 * The parsed files a literal names, allowing for a caller that spells the
 * path as it is DEPLOYED: `/srv/app/src/bash-scripts/company/x.sh` is not
 * a suffix of `ops-scripts/src/bash-scripts/company/x.sh`, but the tail
 * they share is. Leading segments are dropped one at a time until exactly
 * one parsed file answers; never below two segments — except a UNIQUE
 * basename when the literal was itself a multi-segment path (an absolute
 * deploy path naming a file this tree holds once). A bare basename literal
 * (`"query.mjs"`) matches only as itself.
 * Returns { files, matched } — `matched` is the suffix that answered.
 */
export function resolveScriptFiles(fileKeys, suffix) {
  const exact = matchScriptFiles(fileKeys, suffix);
  if (exact.length) return { files: exact, matched: suffix };
  const segs = suffix.split("/");
  if (segs.length < 2) return { files: [], matched: suffix };
  for (let i = 1; i < segs.length; i++) {
    const tail = segs.slice(i).join("/");
    const files = matchScriptFiles(fileKeys, tail);
    if (segs.length - i >= 2) {
      if (files.length === 1) return { files, matched: tail };
      if (files.length > 1) return { files, matched: tail }; // ambiguous at this depth: say so, do not go shorter
    } else if (files.length === 1) {
      return { files, matched: tail }; // a unique basename, reached from a path
    }
  }
  return { files: [], matched: suffix };
}

/**
 * Every script reference in one IR node: the literals in its `args`, for an
 * assignment its `preview` (a bash `MJS_SCRIPT="${DIR}/ingest.mjs"` carries
 * the literal as its value) and its `literals` (a composite JS value's
 * strings — `process.env.X ?? "accounts/x.sh"` — and a function's parameter
 * defaults, M-FLOW.5). Returns [{ literal, suffix, scriptShaped }].
 */
export function nodeScriptRefs(node) {
  if (!node || typeof node !== "object") return [];
  const texts = [];
  if (Array.isArray(node.args)) for (const a of node.args) if (typeof a === "string") texts.push(a);
  if (node.type === "assignment" && typeof node.preview === "string") texts.push(node.preview);
  // M-FLOW.5 — the literals a composite value or a parameter default holds
  // (recorded unquoted; quoted here so the same reader sees them).
  if (Array.isArray(node.literals)) for (const l of node.literals) if (typeof l === "string") texts.push(JSON.stringify(l));
  const seen = new Set();
  const out = [];
  for (const t of texts) {
    // The quoted runs INSIDE the text, and the WHOLE text with its outer
    // quotes stripped: a bash word like "$(dirname "$0")/../scripts/run.sh"
    // nests quotes, so only the whole word names the path.
    const candidates = [...quotedLiterals(t), t.trim().replace(/^["'`]|["'`]$/g, "")];
    for (const lit of candidates) {
      const suffix = scriptSuffix(lit);
      if (!suffix || seen.has(suffix)) continue;
      seen.add(suffix);
      out.push({ literal: lit, suffix, scriptShaped: isScriptShaped(suffix) });
    }
  }
  return out;
}

/** The callee text a node carries, for a label. */
export function nodeCallee(node) {
  if (typeof node.funcName === "string" && node.funcName) return node.funcName;
  if (typeof node.callTarget === "string" && node.callTarget) return node.callTarget;
  if (node.type === "assignment" && typeof node.name === "string") return `${node.name} =`;
  return node.type ?? "?";
}
