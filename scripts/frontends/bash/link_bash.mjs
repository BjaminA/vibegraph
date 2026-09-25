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
//      unlinked: never guessed.
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
    const sourced = [];
    for (const n of nodes) {
      if (n.type !== "import") continue;
      const target = n.names?.[0] ?? "";
      if (!target || target.includes("$")) continue; // interpolated: honest gap
      const candidates = [normalize(`${posixDir(rel)}/${target}`), normalize(target)];
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
