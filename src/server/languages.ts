// M-LANG1 (PLAN-M-LANG.md) — the server-side language-frontend registry.
// Pure data + pure functions over src/shared/languages.ts: NO closure over
// server state (lastParse / projectParse / inputPath), so server.ts only
// dispatches at its existing seams (file walk, watcher, parse spawns) and
// the 500-line-rule debt does not grow roots here.
//
// A frontend = the commands that turn one language's source into IR.
// Python is the only registered frontend until M-LANG2 lands bash; the
// contract every future frontend must speak is parse_cst.py's:
//   single:  <bin> <script> <file> [--module-path <id>]   → IR on stdout
//   batch:   <bin> <script> --batch                        → stdin "path\tmoduleId"
//                                                             lines, {files, errors} out

import * as path from "path";
// .ts extension: required by the node --experimental-strip-types test
// harness (ESM needs explicit extensions); esbuild resolves it the same.
// Matches the pattern in thread_remit.ts / skill_sweep.ts / plan_work.ts.
import * as fs from "fs";
import {
  LANGUAGES,
  languageById,
  languageForPath,
  languageForShebang,
  type LanguageId,
  type LanguageInfo,
} from "../shared/languages.ts";

export { LANGUAGES, languageById, languageForPath, languageForShebang };
export type { LanguageId, LanguageInfo };

/**
 * Directories no frontend ever walks or watches into.
 *
 * M-CMD.1 added the COMPILED-OUTPUT set. It is a convention, not a fact —
 * a project may keep real source in a directory called `build` — so the
 * walker's caller REPORTS what it skipped rather than skipping in silence
 * (`skippedDirs` from the walk; the export names them in its README). The
 * evidence for the default: on a real codebase 197 of ~1100 IR files came
 * from one `build/` tree, so its MCP server was double-counted and half of
 * its "IR" was `.d.ts` declarations with no call bodies
 * (an internal field review B11). build_system_tier.py's own `_SKIP_DIRS`
 * has skipped `dist` and `build` since M19 — this makes the two walkers
 * agree rather than inventing a new rule.
 */
const EXCLUDE_DIRS = new Set([
  "__pycache__", "node_modules",
  "build", "dist", "out", "target", "venv",
]);

/** The compiled-output directory names, for a caller that wants to say so. */
export const COMPILED_OUTPUT_DIRS: readonly string[] = ["build", "dist", "out", "target"];

export function shouldSkipDir(name: string): boolean {
  return name.startsWith(".") || EXCLUDE_DIRS.has(name);
}

/**
 * TypeScript DECLARATION files: types with no call bodies. Parsing one
 * yields an IR that looks like a module and contains no behaviour, and it
 * duplicates the `.ts` it was generated from.
 */
export function isDeclarationFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".d.ts");
}

/**
 * The registered language for a file, or null.
 *
 * Extension first (unchanged). When the name carries NO extension and the
 * caller supplies a readable path, the first line is read and matched
 * against the registry's `interpreters` — M-CMD.1, for the
 * `#!/usr/bin/env bash` executables that carry no suffix and are often the
 * only thing a caller is permitted to run. The read is bounded (256 bytes),
 * never follows a directory, and any I/O error means "not source" rather
 * than an exception out of a file walk.
 */
export function languageForFile(fileName: string, fullPath?: string): LanguageInfo | null {
  if (isDeclarationFile(fileName)) return null;
  const byExt = languageForPath(fileName);
  if (byExt) return byExt;
  if (!fullPath || fileName.includes(".")) return null;
  let fd: number | null = null;
  try {
    fd = fs.openSync(fullPath, "r");
    const buf = Buffer.alloc(256);
    const n = fs.readSync(fd, buf, 0, 256, 0);
    if (n < 2 || buf[0] !== 0x23 || buf[1] !== 0x21) return null; // not "#!"
    const firstLine = buf.subarray(0, n).toString("utf-8").split("\n")[0];
    return languageForShebang(firstLine);
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* already gone */ } }
  }
}

/**
 * True when this file belongs to a REGISTERED language.
 *
 * `fullPath` is optional and additive: without it the answer is exactly what
 * it was before M-CMD.1 (extension only), so server.ts's walker keeps its
 * behaviour until it chooses to pass the path.
 */
export function isSourceFile(fileName: string, fullPath?: string): boolean {
  return languageForFile(fileName, fullPath) !== null;
}

export interface ParseCommand {
  bin: string;
  /** Tried when `bin` fails to start (python3 → python). */
  fallbackBin?: string;
  argv: string[];
  /** Inject .pydeps into PYTHONPATH (Python frontend only). */
  needsPythonEnv: boolean;
}

/** Command for a single-file parse: <file> [--module-path <id>]. */
export function parseCommand(
  lang: LanguageInfo,
  scriptsDir: string,
  filePath: string,
  moduleId?: string,
): ParseCommand {
  switch (lang.id) {
    case "python": {
      const argv = [path.join(scriptsDir, "parse_cst.py"), filePath];
      if (moduleId) argv.push("--module-path", moduleId);
      return { bin: "python3", fallbackBin: "python", argv, needsPythonEnv: true };
    }
    case "bash": {
      const argv = [path.join(scriptsDir, "frontends", "bash", "parse_bash.mjs"), filePath];
      if (moduleId) argv.push("--module-path", moduleId);
      return { bin: process.execPath, argv, needsPythonEnv: false };
    }
    case "jsts": {
      const argv = [path.join(scriptsDir, "frontends", "jsts", "parse_jsts.mjs"), filePath];
      if (moduleId) argv.push("--module-path", moduleId);
      return { bin: process.execPath, argv, needsPythonEnv: false };
    }
    case "cpp": {
      const argv = [path.join(scriptsDir, "frontends", "cpp", "parse_cpp.mjs"), filePath];
      if (moduleId) argv.push("--module-path", moduleId);
      return { bin: process.execPath, argv, needsPythonEnv: false };
    }
    case "rust": {
      const argv = [path.join(scriptsDir, "frontends", "rust", "parse_rust.mjs"), filePath];
      if (moduleId) argv.push("--module-path", moduleId);
      return { bin: process.execPath, argv, needsPythonEnv: false };
    }
    default:
      throw new Error(`No parse frontend registered for language '${lang.id}'`);
  }
}

/** Command for a batch parse (stdin "path\tmoduleId" lines). */
export function batchParseCommand(lang: LanguageInfo, scriptsDir: string): ParseCommand {
  switch (lang.id) {
    case "python":
      return {
        bin: "python3",
        fallbackBin: "python",
        argv: [path.join(scriptsDir, "parse_cst.py"), "--batch"],
        needsPythonEnv: true,
      };
    case "bash":
      return {
        bin: process.execPath,
        argv: [path.join(scriptsDir, "frontends", "bash", "parse_bash.mjs"), "--batch"],
        needsPythonEnv: false,
      };
    case "jsts":
      return {
        bin: process.execPath,
        argv: [path.join(scriptsDir, "frontends", "jsts", "parse_jsts.mjs"), "--batch"],
        needsPythonEnv: false,
      };
    case "cpp":
      return {
        bin: process.execPath,
        argv: [path.join(scriptsDir, "frontends", "cpp", "parse_cpp.mjs"), "--batch"],
        needsPythonEnv: false,
      };
    case "rust":
      return {
        bin: process.execPath,
        argv: [path.join(scriptsDir, "frontends", "rust", "parse_rust.mjs"), "--batch"],
        needsPythonEnv: false,
      };
    default:
      throw new Error(`No batch-parse frontend registered for language '${lang.id}'`);
  }
}

/**
 * M-LANG2b — per-language derived-data commands. `null` = this language
 * contributes nothing to that stage (no bash entry-point frameworks
 * beyond its own discover step, no bash dep-check). The server fans the
 * project map out per language and merges results; a language's linker
 * only ever sees its OWN files (isolation: a bash IR can never be
 * mutated by cross_file_link.py's Python conventions, and vice versa).
 */
export function linkCommand(lang: LanguageInfo, scriptsDir: string): ParseCommand | null {
  switch (lang.id) {
    case "python":
      return { bin: "python3", argv: [path.join(scriptsDir, "cross_file_link.py")], needsPythonEnv: true };
    case "bash":
      return { bin: process.execPath, argv: [path.join(scriptsDir, "frontends", "bash", "link_bash.mjs")], needsPythonEnv: false };
    case "jsts":
      return { bin: process.execPath, argv: [path.join(scriptsDir, "frontends", "jsts", "link_jsts.mjs")], needsPythonEnv: false };
    case "cpp":
      return { bin: process.execPath, argv: [path.join(scriptsDir, "frontends", "cpp", "link_cpp.mjs")], needsPythonEnv: false };
    case "rust":
      return { bin: process.execPath, argv: [path.join(scriptsDir, "frontends", "rust", "link_rust.mjs")], needsPythonEnv: false };
    default:
      return null;
  }
}

/**
 * M-LANG4 — per-language rewrite chokepoint. Both implementations speak
 * the SAME CLI + result contract (file-first argv, stdin source,
 * --dry-run prints raw new source, JSON envelope, the cst_rewrite
 * errorKind taxonomy) and their confinement checks are pinned to the
 * same shared vectors (test/fixtures/rewrite_confinement/). `null` =
 * the language has no edit floor yet (its capabilities.edit is false
 * and the UI never sends an edit).
 */
export function rewriteCommand(lang: LanguageInfo, scriptsDir: string): ParseCommand | null {
  switch (lang.id) {
    case "python":
      return { bin: "python3", argv: [path.join(scriptsDir, "cst_rewrite.py")], needsPythonEnv: true };
    case "bash":
      return { bin: process.execPath, argv: [path.join(scriptsDir, "frontends", "bash", "rewrite_bash.mjs")], needsPythonEnv: false };
    case "jsts":
      return { bin: process.execPath, argv: [path.join(scriptsDir, "frontends", "jsts", "rewrite_jsts.mjs")], needsPythonEnv: false };
    // 2026-09-25 — the span-splice core (frontends/span_rewriter.mjs) with
    // each language's own builder; clang-format / rustfmt when installed.
    case "cpp":
      return { bin: process.execPath, argv: [path.join(scriptsDir, "frontends", "cpp", "rewrite_cpp.mjs")], needsPythonEnv: false };
    case "rust":
      return { bin: process.execPath, argv: [path.join(scriptsDir, "frontends", "rust", "rewrite_rust.mjs")], needsPythonEnv: false };
    default:
      return null;
  }
}

/** M-FLOW.2 — the PROJECT-LEVEL discoverer, run once over the whole map
 *  after every per-language discover: a script another file names by a
 *  string literal is run, whatever its own file says (scripts/discover_project.mjs). */
export function discoverProjectCommand(scriptsDir: string): ParseCommand {
  return { bin: process.execPath, argv: [path.join(scriptsDir, "discover_project.mjs")], needsPythonEnv: false };
}

export function discoverCommand(lang: LanguageInfo, scriptsDir: string): ParseCommand | null {
  switch (lang.id) {
    case "python":
      return { bin: "python3", argv: [path.join(scriptsDir, "discover_entry_points.py")], needsPythonEnv: true };
    case "bash":
      return { bin: process.execPath, argv: [path.join(scriptsDir, "frontends", "bash", "discover_bash.mjs")], needsPythonEnv: false };
    case "jsts":
      return { bin: process.execPath, argv: [path.join(scriptsDir, "frontends", "jsts", "discover_jsts.mjs")], needsPythonEnv: false };
    case "cpp":
      return { bin: process.execPath, argv: [path.join(scriptsDir, "frontends", "cpp", "discover_cpp.mjs")], needsPythonEnv: false };
    case "rust":
      return { bin: process.execPath, argv: [path.join(scriptsDir, "frontends", "rust", "discover_rust.mjs")], needsPythonEnv: false };
    default:
      return null;
  }
}

/**
 * Language-defined module identity for a PROJECT-RELATIVE path.
 * Python: dotted path; __init__.py collapses to the package name
 * (mirrors cross_file_link.py:file_to_module_path — parity pinned by
 * test/languages.test.mjs). Future frontends use project-relative
 * file paths with extension (see PLAN-M-LANG.md).
 */
export function moduleIdentity(lang: LanguageInfo, relPath: string): string {
  const parts = relPath.split(/[\\/]/);
  switch (lang.id) {
    case "python": {
      const last = parts[parts.length - 1];
      if (last === "__init__.py") {
        parts.pop();
      } else if (last.endsWith(".py")) {
        parts[parts.length - 1] = last.slice(0, -3);
      }
      return parts.filter(Boolean).join(".");
    }
    default:
      return parts.filter(Boolean).join("/");
  }
}
