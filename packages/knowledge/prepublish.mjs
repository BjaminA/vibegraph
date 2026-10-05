#!/usr/bin/env node
// Runs before every `npm publish` of this package (package.json
// prepublishOnly). Twice (0.21.1, 0.23.0) a release went out with 3 files
// instead of ~93: dist/ and vendor/ are build output, never committed, and
// the public repo is re-exported from tracked files only, so a publish run
// right after an export had nothing to ship. This builds the package from
// the repository it sits in, then refuses to publish unless the files a
// working release needs are there.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = dirname(fileURLToPath(import.meta.url));
const ROOT = join(PKG, "..", "..");

execFileSync(process.execPath, [join(ROOT, "scripts", "cli", "build.mjs")], { cwd: ROOT, stdio: "inherit" });

const count = (dir) => {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    n += statSync(p).isDirectory() ? count(p) : 1;
  }
  return n;
};
const need = [
  ["dist/cli.mjs", existsSync(join(PKG, "dist", "cli.mjs")) && statSync(join(PKG, "dist", "cli.mjs")).size > 100_000],
  ["vendor/dist (the viewer)", count(join(PKG, "vendor", "dist")) > 0],
  ["vendor/scripts (the parsers)", count(join(PKG, "vendor", "scripts")) >= 20],
];
const missing = need.filter(([, ok]) => !ok).map(([what]) => what);
if (missing.length) {
  console.error(`refusing to publish: the build is incomplete — missing ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`package built: ${count(join(PKG, "dist")) + count(join(PKG, "vendor"))} build files ready to publish`);
