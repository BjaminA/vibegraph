#!/usr/bin/env node
// M-LANG2a (PLAN-M-LANG.md) — the bash language frontend CLI. Emits
// VibeGraph IR 2.0 ({version, language:"bash", nodes, edges,
// symbolIndex, modulePath?, shebang?}) speaking parse_cst.py's exact
// contract so the server's registry dispatch needs no special case:
//
//   single:  node parse_bash.mjs <file> [--module-path <id>]  → IR on stdout
//   batch:   node parse_bash.mjs --batch                       → stdin
//            "path\tmoduleId" lines → {files, errors} on stdout
//
// The builder (construct mapping, ID grammar, honesty rules, byte
// spans) lives in builder.mjs — shared with rewrite_bash.mjs (M-LANG4)
// so the rewriter resolves the SAME structural IDs the parser mints.
// Mapping decisions + named limits are documented there.

import { createInterface } from "node:readline";
import { parseFile } from "./builder.mjs";

/** M-CMD.1 — what an incomplete parse stamps onto its own IR. */
export function degradedNote(dropped) {
  return {
    dropped,
    note: `the parser could not read ${dropped} construct(s) in this file and dropped them: `
      + "this IR is INCOMPLETE, and anything absent from it may still exist in the source",
  };
}

async function runBatch() {
  const files = {};
  const errors = {};
  const rl = createInterface({ input: process.stdin, terminal: false });
  const jobs = [];
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    const [p, moduleId] = t.split("\t");
    jobs.push([p, moduleId]);
  }
  for (const [p, moduleId] of jobs) {
    try {
      const { ir, dropped } = await parseFile(p, moduleId);
      // M-CMD.1 — the damage rides WITH the IR, not only in the batch's error
      // map. A consumer that opens one file's IR (a worker, a contract, the
      // knowledge export) could not otherwise tell an incomplete parse from a
      // complete one: the IR looked whole and the count lived somewhere else.
      // That is the .tsx disaster's other half — the grammar was fixed, the
      // silence was not (reviews/ir-fidelity/REVIEW.md, field review B11).
      if (dropped > 0) ir.degraded = degradedNote(dropped);
      files[p] = ir;
      if (dropped > 0) errors[p] = `dropped ${dropped} unparseable construct(s)`;
    } catch (e) {
      errors[p] = String(e?.message ?? e);
    }
  }
  process.stdout.write(JSON.stringify({ files, errors }));
}

const argv = process.argv.slice(2);
if (argv[0] === "--batch") {
  await runBatch();
} else {
  const file = argv.find((a) => !a.startsWith("--"));
  if (!file) {
    process.stderr.write("usage: parse_bash.mjs <file> [--module-path <id>] | --batch\n");
    process.exit(2);
  }
  const mpIdx = argv.indexOf("--module-path");
  const moduleId = mpIdx !== -1 ? argv[mpIdx + 1] : undefined;
  try {
    const { ir, dropped } = await parseFile(file, moduleId);
    if (dropped > 0) ir.degraded = degradedNote(dropped);
    if (dropped > 0) process.stderr.write(`parse_bash: dropped ${dropped} unparseable construct(s) in ${file}\n`);
    process.stdout.write(JSON.stringify(ir, null, 2));
  } catch (e) {
    process.stderr.write(`parse_bash: ${e?.message ?? e}\n`);
    process.exit(1);
  }
}
