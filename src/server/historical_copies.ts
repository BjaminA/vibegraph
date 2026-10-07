// FOLDERS OF OLD COPIES (2026-10-07, field report). A tool set kept 188
// versioned copies of its own scripts in `_archive/` (`collect-V26.py`, …).
// Without an ignore file they were parsed with the rest — 163 MB of parse
// output — and every import rule listed `_archive/tools/collect-V26.py` and
// onward as offenders. `.vibegraphignore` already fixes it once someone knows
// to write it; this says so, with the count, and marks an offender that lives
// only in such a folder as a historical copy.
//
// A folder is historical when
//   - its NAME says so (`_archive`, `old`, `backup`, `attic`, `deprecated`…), or
//   - most of its files (>= 70%, at least 5) are VERSIONED copies
//     (`x-V26.py`, `x_v2.py`, `x.py.bak`, `x.orig`, `x (2).py`, `x-copy.py`)
//     or MIRROR a live file elsewhere (same path below the folder, version
//     suffix stripped).
// Pure: paths in, findings out.

export interface HistoricalFolder { dir: string; files: number; why: string }

const NAME_HINT = /^_?(archive|archives|archived|old|olds|backup|backups|bak|attic|deprecated|legacy-copies|graveyard)$/i;
const VERSIONED = /([-_. ][vV]\d+(\.\d+)*|[-_ ]copy\d*| \(\d+\))(\.[A-Za-z0-9]+)$|\.(bak|orig|old)$/;

const stripVersion = (p: string) => p.replace(/([-_. ][vV]\d+(\.\d+)*|[-_ ]copy\d*| \(\d+\))(\.[A-Za-z0-9]+)$/, "$3").replace(/\.(bak|orig|old)$/, "");

export function historicalFolders(files: readonly string[]): HistoricalFolder[] {
  // every path suffix (`a/b/c.py`, `b/c.py`, `c.py`) → the files ending so
  const bySuffix = new Map<string, string[]>();
  for (const f of files) {
    const parts = f.split("/");
    for (let i = 0; i < parts.length; i++) {
      const s = parts.slice(i).join("/");
      (bySuffix.get(s) ?? bySuffix.set(s, []).get(s)!).push(f);
    }
  }
  const out: HistoricalFolder[] = [];
  const dirs = new Map<string, string[]>();
  for (const f of files) {
    const parts = f.split("/");
    // every ancestor folder, shallowest first
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join("/");
      (dirs.get(d) ?? dirs.set(d, []).get(d)!).push(f);
    }
  }
  const taken: string[] = [];
  for (const [dir, fs] of [...dirs].sort((a, b) => a[0].length - b[0].length)) {
    if (taken.some((t) => dir.startsWith(`${t}/`))) continue;
    const name = dir.split("/").pop()!;
    if (NAME_HINT.test(name)) {
      out.push({ dir, files: fs.length, why: `the folder is named "${name}"` });
      taken.push(dir);
      continue;
    }
    if (fs.length < 5) continue;
    let versioned = 0, mirrors = 0;
    for (const f of fs) {
      const below = f.slice(dir.length + 1);
      const isVersioned = VERSIONED.test(f);
      if (isVersioned) versioned++;
      const plain = stripVersion(below);
      // the same path below this folder exists live elsewhere — at least two
      // segments of it (`tools/collect.py`): a shared file NAME (`app.py`,
      // `server.ts`) is every fixture folder, not a copy
      // … and a copy sits DEEPER than its original (`copies/tools/x.py` against
      // `tools/x.py`); two sibling folders sharing files are not copies of each other
      const depth = f.split("/").length;
      if (plain.includes("/") && (bySuffix.get(plain) ?? []).some((l) => l !== f && !l.startsWith(`${dir}/`) && l.split("/").length < depth)) mirrors++;
    }
    const flagged = Math.max(versioned, mirrors);
    if (flagged / fs.length >= 0.7) {
      out.push({ dir, files: fs.length, why: versioned >= mirrors ? `${versioned} of ${fs.length} files are versioned copies (like -V2, .bak, .orig)` : `${mirrors} of ${fs.length} files mirror live files elsewhere` });
      taken.push(dir);
    }
  }
  return out;
}

/** One line suggesting the ignore entries, or null. */
export function historicalAdvice(found: readonly HistoricalFolder[]): string | null {
  if (!found.length) return null;
  const list = found.map((h) => `${h.dir}/ (${h.files} files: ${h.why})`).join("; ");
  return `these folders look like old copies of the code and are parsed and checked with the rest: ${list}. `
    + `To leave them out, add to .vibegraphignore: ${found.map((h) => `${h.dir}/`).join(" ")}`;
}

/** Is this file inside one of the folders? */
export function inHistorical(file: string, found: readonly HistoricalFolder[]): HistoricalFolder | null {
  return found.find((h) => file === h.dir || file.startsWith(`${h.dir}/`)) ?? null;
}
