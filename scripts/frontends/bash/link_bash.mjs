#!/usr/bin/env node
// M-LANG2a (PLAN-M-LANG.md) — the bash cross-file linker. Speaks
// cross_file_link.py's exact stdin/stdout contract over a map of BASH
// per-file IRs:  stdin {files: {relPath: IR}} → stdout {files: {…}}.
// IDEMPOTENT (mirrors the M26.1 requirement): re-feeding linked output
// changes nothing, so refreshDerived() can loop it.
//
// What it does, in order, per file:
//   1. `source x.sh` / `. x.sh` import nodes resolve relative to the
//      SOURCING file's directory first, then the project root. ONE hop,
//      direct sources only — transitive chains are a NAMED LIMIT.
//      Variable-interpolated targets ("$DIR/x.sh") stay honestly
//      unlinked: never guessed — with ONE exception that is not a guess: a
//      name the same file binds once to the script-directory idiom
//      (`DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`) holds this
//      file's directory by the language's own definition (2026-09-25; a private production codebase binds it this
//      way in 74 scripts and sources its shared _lib through it).
//   2. Calls that match a function in a sourced file gain a reference
//      edge {targetFile, qualifiedTarget: "<moduleId>:<fn>"} — the same
//      wire shape cross_file_link.py emits.
//   3. Honest-external default: a call that resolves to NO project
//      function (same-file or sourced), has no effectKind from the
//      vocabulary tables, is not a NEUTRAL shell builtin and not a
//      dynamic callee, is stamped effectKind="subprocess" — in bash an
//      unresolved bare word IS an external command. Dynamic callees
//      ("$CMD", eval) stay unstamped so the extractor renders `dynamic`.

import { NEUTRAL_BUILTINS, isDynamicCallee } from "./tables.mjs";

function posixDir(p) {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function normalize(p) {
  // Preserve absoluteness: the live server keys its map by ABSOLUTE
  // path (fixture snapshots are relative-keyed) — losing the leading
  // "/" made every lookup miss and silently degraded cross-file steps
  // to external terminals in the live renderer only.
  const abs = p.startsWith("/");
  const parts = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { parts.pop(); continue; }
    parts.push(seg);
  }
  return (abs ? "/" : "") + parts.join("/");
}

function unquote(s) {
  return s.length >= 2 && (s[0] === '"' || s[0] === "'") && s.at(-1) === s[0] ? s.slice(1, -1) : s;
}

// The script-directory idiom, spelled the ways it is actually written:
//   DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   (74 of 74 on a private production codebase)
//   DIR="$(dirname "$0")"
// Its value is the directory of THIS file by the language's own definition,
// so `source "${DIR}/../_lib/x.sh"` is a path, not a guess.
const SCRIPT_DIR_IDIOM = /^"?\$\((?:cd "?\$\(dirname "?\$(?:\{BASH_SOURCE\[0\]\}|\{?0\}?)"?\)"? && pwd(?: -P)?|dirname "?\$(?:\{BASH_SOURCE\[0\]\}|\{?0\}?)"?)\)"?$/;

/** Names bound to the script-directory idiom, and bound EXACTLY once: a
 *  rebind means the file does not say what the name holds at the source
 *  line, and that stays an honest gap. */
function scriptDirVars(nodes) {
  const seen = new Map();
  for (const n of nodes) {
    if (n.type !== "assignment" || typeof n.name !== "string") continue;
    const idiom = SCRIPT_DIR_IDIOM.test(String(n.preview ?? "").trim());
    seen.set(n.name, seen.has(n.name) ? false : idiom);
  }
  return new Set([...seen].filter(([, ok]) => ok).map(([k]) => k));
}

/** `${DIR}/x.sh` / `$DIR/x.sh` → `./x.sh` when DIR is the script directory. */
function expandScriptDir(target, dirVars) {
  const m = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))(\/.*)$/.exec(target);
  const name = m && (m[1] ?? m[2]);
  return name && dirVars.has(name) ? `.${m[3]}` : target;
}

export function linkFiles(files) {
  // fnIndex: relPath → Map(fnName → nodeId)
  const fnIndex = new Map();
  for (const [rel, ir] of Object.entries(files)) {
    const m = new Map();
    for (const n of ir.nodes ?? []) {
      if (n.type === "function_def") m.set(n.name, n.id);
    }
    fnIndex.set(rel, m);
  }

  for (const [rel, ir] of Object.entries(files)) {
    if (ir.language !== "bash") continue; // isolation: never touch other frontends' IRs
    const nodes = ir.nodes ?? [];
    const edges = ir.edges ?? [];

    // 1. resolve direct sources (one hop)
    const dirVars = scriptDirVars(nodes);
    const sourced = [];
    for (const n of nodes) {
      if (n.type !== "import") continue;
      const target = expandScriptDir(unquote(n.names?.[0] ?? ""), dirVars);
      if (!target || target.includes("$")) continue; // interpolated: honest gap
      const fromDir = normalize(`${posixDir(rel)}/${target}`);
      // an expanded script-dir path is relative to THIS file by definition
      const candidates = target.startsWith("./") ? [fromDir] : [fromDir, normalize(target)];
      const hit = candidates.find((c) => c in files);
      if (hit) sourced.push(hit);
    }

    // 2. cross-file references + 3. subprocess default
    const localFns = fnIndex.get(rel);
    const hasRef = new Set(
      edges.filter((e) => e.type === "reference").map((e) => e.source),
    );
    for (const n of nodes) {
      if (n.type !== "call") continue;
      if (hasRef.has(n.id)) continue; // same-file reference already emitted (idempotence)
      const word = n.funcName ?? "";
      if (localFns?.has(word)) continue; // parse pass owns same-file edges
      let resolved = false;
      for (const srcRel of sourced) {
        const fnId = fnIndex.get(srcRel)?.get(word);
        if (!fnId) continue;
        edges.push({
          source: n.id,
          target: fnId,
          type: "reference",
          targetFile: srcRel,
          qualifiedTarget: `${files[srcRel].modulePath ?? srcRel}:${word}`,
        });
        resolved = true;
        break;
      }
      if (!resolved && !n.effectKind && !NEUTRAL_BUILTINS.has(word) && !isDynamicCallee(word)) {
        n.effectKind = "subprocess"; // the honest bash default for an unresolved bare word
      }
    }
  }
  return files;
}

// stdin/stdout mode (skipped when imported by tests)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  let raw = "";
  process.stdin.setEncoding("utf-8");
  for await (const chunk of process.stdin) raw += chunk;
  const { files } = JSON.parse(raw);
  process.stdout.write(JSON.stringify({ files: linkFiles(files ?? {}) }));
}
