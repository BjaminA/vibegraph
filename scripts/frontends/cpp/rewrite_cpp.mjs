#!/usr/bin/env node
// The C++ edit floor (2026-09-25) — the span-splice pipeline
// (../span_rewriter.mjs) with the C++ builder and clang-format:
//
//   1. clang-format SCOPED to the edited lines (`--lines=a:b`, the project's
//      own .clang-format found via --assume-filename) — the M-DIRTY win: a
//      file that is not clang-format-clean elsewhere still takes the edit;
//   2. whole-file clang-format (REJECTED by confinement on a file that is not
//      clang-format-clean — the ladder falls through);
//   3. the raw splice, verified, {"formatted": false} — clang-format missing
//      is the formatter-unavailable precedent (shfmt, black).
// Every candidate is re-parsed and confinement-checked; none is trusted.
import { spawnSync } from "node:child_process";
import { buildFromSource, sourceHasParseErrors } from "./parse_cpp.mjs";
import { runSpanRewriter } from "../span_rewriter.mjs";

let hasClangFormat = null;
function clangFormatAvailable() {
  if (hasClangFormat === null) {
    const r = spawnSync("clang-format", ["--version"], { stdio: "ignore" });
    hasClangFormat = !r.error && r.status === 0;
  }
  return hasClangFormat;
}

function clangFormat(text, file, lines) {
  const args = [`--assume-filename=${file}`, ...(lines ? [`--lines=${lines.first}:${lines.last}`] : [])];
  const r = spawnSync("clang-format", args, { input: text, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  return !r.error && r.status === 0 ? r.stdout : null;
}

export const cpp = {
  script: "rewrite_cpp.mjs",
  build: (source) => buildFromSource(source),
  hasErrors: (source) => sourceHasParseErrors(source),
  async *formatCandidates(out, file, region) {
    if (!clangFormatAvailable()) return;
    const scoped = clangFormat(out, file, region);
    if (scoped !== null) yield { text: scoped, formatted: true };
    const whole = clangFormat(out, file, null);
    if (whole !== null) yield { text: whole, formatted: true };
  },
};

if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "rewrite_cpp.mjs") {
  await runSpanRewriter(cpp);
}
