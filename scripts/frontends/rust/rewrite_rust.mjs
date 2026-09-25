#!/usr/bin/env node
// The Rust edit floor (2026-09-25) — the span-splice pipeline
// (../span_rewriter.mjs) with the Rust builder and rustfmt:
//
//   1. whole-file rustfmt (stable rustfmt cannot scope to a line range —
//      `--file-lines` is nightly-only — so on a file that is not rustfmt-clean
//      elsewhere, confinement REJECTS this candidate and the ladder falls
//      through, exactly as whole-file prettier does for TypeScript);
//   2. the raw splice, verified, {"formatted": false} — rustfmt missing is the
//      formatter-unavailable precedent (shfmt, black).
// The edition comes from the nearest Cargo.toml (rustfmt's parse differs by
// edition); none found, 2021. Every candidate is re-parsed and
// confinement-checked; none is trusted.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildFromSource, sourceHasParseErrors } from "./parse_rust.mjs";
import { runSpanRewriter } from "../span_rewriter.mjs";

let hasRustfmt = null;
function rustfmtAvailable() {
  if (hasRustfmt === null) {
    const r = spawnSync("rustfmt", ["--version"], { stdio: "ignore" });
    hasRustfmt = !r.error && r.status === 0;
  }
  return hasRustfmt;
}

function editionFor(file) {
  for (let d = dirname(resolve(file)); ; d = dirname(d)) {
    const m = join(d, "Cargo.toml");
    if (existsSync(m)) return /^\s*edition\s*=\s*"(\d{4})"/m.exec(readFileSync(m, "utf-8"))?.[1] ?? "2021";
    if (dirname(d) === d) return "2021";
  }
}

export const rust = {
  script: "rewrite_rust.mjs",
  build: (source) => buildFromSource(source),
  hasErrors: (source) => sourceHasParseErrors(source),
  async *formatCandidates(out, file) {
    if (!rustfmtAvailable()) return;
    const r = spawnSync("rustfmt", ["--edition", editionFor(file), "--emit", "stdout"], { input: out, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
    if (!r.error && r.status === 0 && r.stdout) yield { text: r.stdout, formatted: true };
  },
};

if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "rewrite_rust.mjs") {
  await runSpanRewriter(rust);
}
