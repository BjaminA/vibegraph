// M-CRYSTAL.1 — where the pipeline lives, for the two places this code runs.
//
//   installed:  <pkg>/dist/cli.mjs (the esbuild bundle)  →  <pkg>/vendor/scripts
//   dev:        <repo>/scripts/cli/*.mjs                 →  <repo>/scripts
//
// Both are decided from import.meta.url, which is why the bundle is ESM:
// the CJS server bundle inlines import.meta.url as undefined (the h2h3
// standings.json lesson — every verb went silently advisory in dist).
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "vibegraph-knowledge";

export function locate() {
  const here = dirname(fileURLToPath(import.meta.url));
  const installedRoot = resolve(here, "..");
  const vendored = join(installedRoot, "vendor", "scripts");
  if (existsSync(join(vendored, "parse_cst.py"))) {
    return { mode: "installed", packageRoot: installedRoot, scriptsDir: vendored, repoRoot: null };
  }
  const repoRoot = resolve(here, "..", "..");
  const repoScripts = join(repoRoot, "scripts");
  if (existsSync(join(repoScripts, "parse_cst.py"))) {
    return { mode: "dev", packageRoot: join(repoRoot, "packages", "knowledge"), scriptsDir: repoScripts, repoRoot };
  }
  throw new Error(`${PACKAGE_NAME}: cannot find the pipeline scripts next to ${here} (expected vendor/scripts or a VibeGraph checkout)`);
}

/** The tool's own version label: package version, plus the checkout in dev. */
export function toolLabel(loc) {
  let version = "unknown";
  try { version = JSON.parse(readFileSync(join(loc.packageRoot, "package.json"), "utf-8")).version ?? version; } catch { /* no manifest */ }
  if (loc.mode !== "dev") return `${PACKAGE_NAME} ${version}`;
  const sha = gitHead(loc.repoRoot);
  return `${PACKAGE_NAME} ${version} (dev, VibeGraph ${sha ?? "not a git checkout"})`;
}

/** The analysed project's HEAD, or null when it is not a git repository. */
export function gitHead(dir) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dir, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}
