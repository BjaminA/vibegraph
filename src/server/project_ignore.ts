// What a PROJECT says not to read (2026-10-07, from a real export: a repo kept
// 188 old copies of its Python under `_archive/`, the parse of them passed the
// parser's output buffer, and the CLI died with "parse_cst.py failed:" and an
// empty message — the only way through was exporting from a copy without the
// folder). `.vibegraphignore` at the project root, one pattern a line, read by
// every walker (the CLI's parse, the envelope cache, the server, the hooks):
//
//   _archive/        a folder of that name, anywhere   (a bare name: file or folder)
//   legacy/old/      a path from the project root       (contains a `/`)
//   **/*.gen.py      a glob over the project-relative path
//   # …              a comment
//
// `VG_IGNORE` (comma-separated, the same forms) adds patterns for one run.
// What is skipped is REPORTED by the callers that already report skipped
// build directories — skipping in silence is how real source disappears.

import * as fs from "node:fs";
import * as path from "node:path";
import { globRegExp } from "../shared/path_match.ts";

export const IGNORE_FILE = ".vibegraphignore";

export interface ProjectIgnore {
  patterns: string[];
  /** a project-relative folder (posix) */
  skipDir(rel: string): boolean;
  /** a project-relative file (posix) */
  skipFile(rel: string): boolean;
}

export function parseIgnore(lines: string[]): Array<(rel: string, isDir: boolean) => boolean> {
  const tests: Array<(rel: string, isDir: boolean) => boolean> = [];
  for (const raw of lines) {
    let p = raw.trim();
    if (!p || p.startsWith("#")) continue;
    p = p.replace(/^\.\//, "").replace(/^\//, "");
    const dirOnly = p.endsWith("/");
    const core = p.replace(/\/+$/, "");
    if (!core) continue;
    if (/[*?]/.test(core)) {
      const re = globRegExp(core.includes("/") ? core : `**/${core}`);
      tests.push((rel, isDir) => (!dirOnly || isDir) && re.test(rel));
    } else if (core.includes("/")) {
      tests.push((rel, isDir) => (!dirOnly || isDir) && (rel === core || rel.startsWith(`${core}/`)));
    } else {
      tests.push((rel, isDir) => (!dirOnly || isDir) && rel.split("/").pop() === core);
    }
  }
  return tests;
}

export function projectIgnore(root: string, env: NodeJS.ProcessEnv = process.env): ProjectIgnore {
  let lines: string[] = [];
  try { lines = fs.readFileSync(path.join(root, IGNORE_FILE), "utf-8").split(/\r?\n/); } catch { lines = []; }
  if (env.VG_IGNORE) lines.push(...env.VG_IGNORE.split(","));
  const patterns = lines.map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const tests = parseIgnore(patterns);
  return {
    patterns,
    skipDir: (rel) => tests.some((t) => t(rel, true)),
    // a file is skipped when it, or any folder it sits in, is named
    skipFile: (rel) => tests.some((t) => t(rel, false)) || rel.split("/").slice(0, -1).some((_, i, a) => tests.some((t) => t(a.slice(0, i + 1).join("/"), true))),
  };
}
