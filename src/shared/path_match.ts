// Where a rule allows something (2026-10-01, from a real repo: "allow-lists in
// import-only checks are too rigid — a check listing exact files breaks as
// soon as a legitimate new module is added"). One matcher for every allow-list
// a stated rule names (`import-only` / `callers-only` `files`), webview-safe.
//
//   "src/store.ts"          that file
//   "src/transport/"        every file under that folder (the trailing slash)
//   "src/transport/**"      the same, as a glob; `*` stays inside one folder,
//   "src/**/client.ts"      `**` crosses folders, `?` is one character
//
// `allowTests` beside a list adds every TEST file (isTestFile), so the common
// "the funnel and its tests" needs no list of test paths that goes stale.

/** A path the repository treats as a test: a test/tests/__tests__ directory,
 *  a `test_` basename, or a `.test.` / `.spec.` / `_test.` suffix. */
export function isTestFile(path: string): boolean {
  const segs = path.split("/");
  const base = segs[segs.length - 1] ?? "";
  return segs.slice(0, -1).some((s) => s === "test" || s === "tests" || s === "__tests__")
    || /^test_/.test(base) || /\.(test|spec)\.[A-Za-z]+$/.test(base) || /_test\.[A-Za-z]+$/.test(base);
}

const isGlob = (p: string) => /[*?]/.test(p);

/** A glob as a RegExp over a project-relative path. */
export function globRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      // `**/` matches zero or more folders; a trailing `**` everything below.
      if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Does `file` fall under any of the allow-list's entries? */
export function pathAllowed(file: string, patterns: readonly string[], opts: { allowTests?: boolean } = {}): boolean {
  if (opts.allowTests && isTestFile(file)) return true;
  return patterns.some((p) => (isGlob(p) ? globRegExp(p).test(file) : p.endsWith("/") ? file.startsWith(p) : file === p));
}

/** The allow-list as a person would read it, for a reason line. */
export function describeAllowList(patterns: readonly string[], allowTests?: boolean): string {
  return [...patterns, ...(allowTests ? ["any test file"] : [])].join(", ") || "(nowhere)";
}

/** A list that is a single TEST file — almost always narrower than the rule
 *  means (the reason a promote warns). */
export function singleTestFileList(patterns: readonly string[] | undefined): boolean {
  return !!patterns && patterns.length === 1 && !isGlob(patterns[0]) && !patterns[0].endsWith("/") && isTestFile(patterns[0]);
}
