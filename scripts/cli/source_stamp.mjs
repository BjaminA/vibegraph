// The source stamp the post-edit hook compares (moved out of hooks.mjs to keep
// it under 500 lines, 2026-10-07, when the walk learned .vibegraphignore).
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { languageForFile, shouldSkipDir } from "../../src/server/languages.ts";
import { projectIgnore } from "../../src/server/project_ignore.ts";

/** A cheap stamp of every source file (path, size, mtime): whether a Bash
 *  command changed code at all. h2h4 found why this matters: a headless
 *  session made all 18 of its tool calls through Bash — `cat >`, `sed -i`,
 *  python — so a hook on Write|Edit alone never saw an edit. */
export function sourceStamp(absRoot) {
  const parts = [];
  const ig = projectIgnore(absRoot);
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      const rel = relative(absRoot, full).split(sep).join("/");
      if (e.isDirectory()) { if (!shouldSkipDir(e.name) && !ig.skipDir(rel)) walk(full); continue; }
      if (!e.isFile() || ig.skipFile(rel) || !languageForFile(e.name, full)) continue;
      const s = statSync(full);
      parts.push(`${relative(absRoot, full)}:${s.size}:${s.mtimeMs}`);
    }
  };
  walk(absRoot);
  return parts.sort().join("\n");
}
