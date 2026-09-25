#!/usr/bin/env node
// M-LANG3 (PLAN-M-LANG.md) — the JS/TS language frontend CLI. Emits
// VibeGraph IR 2.0 speaking parse_cst.py's exact contract:
//
//   single:  node parse_jsts.mjs <file> [--module-path <id>]  → IR on stdout
//   batch:   node parse_jsts.mjs --batch                       → stdin
//            "path\tmoduleId" lines → {files, errors} on stdout
//
// The builder (construct mapping, ID grammar, honesty rules, byte
// spans) lives in builder.mjs — shared with rewrite_jsts.mjs
// (M-LANG5b) so the rewriter resolves the SAME structural IDs the
// parser mints. Mapping decisions + named limits:
//
//   import … from "x" / const y = require("x") → import_from
//   function f / const f = () => {} / method   → function_def (isAsync REAL)
//   class C extends B                          → class_def
//   const x = expr                             → assignment (template → fstring)
//   statement-level call / await call          → call (dotted funcName)
//   if/else (else-if nests) / switch flattened → if_stmt
//   for / for-of / while / do                  → for_loop / while_loop
//   try/catch/finally                          → python v1.5 sibling shape
//   return / throw                             → return_stmt / raise_stmt
//   inline callback bodies flatten into the enclosing scope (NAMED
//   LIMIT); dynamic import() keeps funcName "import"; ERROR regions
//   drop + recover (same floor as bash).

import { createInterface } from "node:readline";
import { parseFile } from "./builder.mjs";
import { findTsPaths, resolveAliasTarget } from "./tsconfig.mjs";
import { isAbsolute, join, relative } from "node:path";

/** M-CMD.1 — what an incomplete parse stamps onto its own IR. */
export function degradedNote(dropped) {
  return {
    dropped,
    note: `the parser could not read ${dropped} construct(s) in this file and dropped them: `
      + "this IR is INCOMPLETE, and anything absent from it may still exist in the source",
  };
}

/** M-CMD.1 — stamp each bare import that a tsconfig alias resolves to project
 *  code. One fact, read by both the linker and the stack index. */
function stampAliases(ir, file) {
  // M-ARCH.2 — the live server hands this parser ABSOLUTE paths from its own
  // directory, so the cwd-relative walk joined the repo's cwd with an
  // absolute path, found no tsconfig, and every `@/` import in the GUI
  // dead-ended (a Next page's thread reached only itself) while the CLI,
  // which runs in the project root with relative paths, resolved them. With
  // VG_PROJECT_ROOT set, an absolute path is read relative to that root and
  // the target stamped ABSOLUTE — the key space the server links in; its
  // relativeProjectFiles() rewrites it with every other file reference.
  const root = process.env.VG_PROJECT_ROOT;
  const absolute = isAbsolute(file) && !!root;
  const rel = absolute ? relative(root, file) : file;
  const base = absolute ? root : process.cwd();
  const tsPaths = findTsPaths(rel, base);
  if (!tsPaths) return;
  ir.tsPaths = tsPaths;
  for (const n of ir.nodes ?? []) {
    if (n.type !== "import_from" && n.type !== "import") continue;
    const spec = typeof n.module === "string" ? n.module : "";
    if (!spec || spec.startsWith(".") || spec.startsWith("/")) continue;
    const target = resolveAliasTarget(spec, tsPaths, base);
    if (target) n.aliasTarget = absolute ? join(root, target) : target;
  }
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
      // M-CMD.1 — the PARSER reads the manifest (M-RUST's ruling): a linker
      // runs in the server's directory and cannot find the analysed project's
      // tsconfig, while the parser is handed each file's path.
      stampAliases(ir, p);
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
    process.stderr.write("usage: parse_jsts.mjs <file> [--module-path <id>] | --batch\n");
    process.exit(2);
  }
  const mpIdx = argv.indexOf("--module-path");
  const moduleId = mpIdx !== -1 ? argv[mpIdx + 1] : undefined;
  try {
    const { ir, dropped } = await parseFile(file, moduleId);
    stampAliases(ir, file);
    if (dropped > 0) ir.degraded = degradedNote(dropped);
    if (dropped > 0) process.stderr.write(`parse_jsts: dropped ${dropped} unparseable construct(s) in ${file}\n`);
    process.stdout.write(JSON.stringify(ir, null, 2));
  } catch (e) {
    process.stderr.write(`parse_jsts: ${e?.message ?? e}\n`);
    process.exit(1);
  }
}
