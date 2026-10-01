// What a package.json says it RUNS (2026-10-01, from a real repo: CLIs run
// via `tsx` from package.json scripts or declared in `bin` were not
// discovered and needed manual_seeds.json). Read per package — the project
// root and every sub-package (node_modules, dot and build folders skipped) —
// and handed to the project-level discoverer, which makes each file a cli
// entry with the package's own words as its evidence.
//
//   bin       "bin": "dist/cli.js" or { "vg": "dist/cli.js" }
//   scripts   "provision": "tsx src/bin/provision.ts --dry-run"
//             a segment (split on && || ; |) whose command word, after any
//             VAR=value, is a runner — node, tsx, ts-node, bun, deno,
//             vite-node, or `npx|pnpm exec|yarn` before one — and the first
//             argument after it that names a file.
//
// A `bin` usually points at COMPILED output (dist/…js), which the parser
// skips on purpose; the source it was built from is found by swapping
// dist/ | build/ | lib/ → src/ and .js/.mjs/.cjs → .ts/.mts/.cts/.tsx, and
// only a file the parser read counts.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

const SKIP = new Set(["node_modules", "dist", "build", "out", "coverage", ".next", "vendor"]);
const RUNNERS = new Set(["node", "tsx", "ts-node", "ts-node-esm", "bun", "deno", "vite-node", "esno", "esrun"]);
const WRAPPERS = new Set(["npx", "pnpx", "bunx", "exec", "run", "yarn", "pnpm", "npm"]);
const FILEISH = /\.(m?[jt]sx?|c[jt]s)$/;

/** Every package.json under root (depth ≤ 4): its dir, name, bin and scripts. */
export function readPackageManifests(absRoot) {
  const out = [];
  const walk = (dir, rel, depth) => {
    const pj = join(dir, "package.json");
    if (existsSync(pj)) {
      try {
        const j = JSON.parse(readFileSync(pj, "utf-8"));
        const bin = typeof j.bin === "string" ? { [j.name ?? "bin"]: j.bin } : j.bin && typeof j.bin === "object" ? j.bin : {};
        const scripts = j.scripts && typeof j.scripts === "object" ? j.scripts : {};
        if (Object.keys(bin).length || Object.keys(scripts).length) out.push({ dir: rel, name: typeof j.name === "string" ? j.name : rel || ".", bin, scripts });
      } catch { /* an unreadable package.json is skipped, not guessed */ }
    }
    if (depth >= 4) return;
    let ents = [];
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) if (e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name)) walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1);
  };
  walk(absRoot, "", 0);
  return out;
}

/** A path a package names → the parsed file it is (source for a build output). */
export function resolvePackagePath(pkgDir, p, parsed) {
  const base = posix.normalize(posix.join(pkgDir || ".", p.replace(/^\.\//, "")));
  const cands = [base];
  const swapExt = (x) => [x.replace(/\.m?js$/, ".ts"), x.replace(/\.mjs$/, ".mts"), x.replace(/\.cjs$/, ".cts"), x.replace(/\.jsx?$/, ".tsx")];
  cands.push(...swapExt(base));
  for (const dir of ["dist/", "build/", "lib/", "out/"]) {
    const i = base.indexOf(dir);
    if (i >= 0 && (i === 0 || base[i - 1] === "/")) {
      const src = `${base.slice(0, i)}src/${base.slice(i + dir.length)}`;
      cands.push(src, ...swapExt(src));
    }
  }
  return cands.find((c) => parsed.has(c)) ?? null;
}

/** The files a script command runs, with the words that ran them. */
export function scriptTargets(command) {
  const out = [];
  for (const seg of String(command).split(/&&|\|\||;|\|/)) {
    const words = seg.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < words.length && /^[A-Z_][A-Z0-9_]*=/.test(words[i])) i++;
    while (i < words.length && WRAPPERS.has(words[i])) i++;
    if (i >= words.length || !RUNNERS.has(words[i])) continue;
    const runner = words[i];
    const file = words.slice(i + 1).find((w) => !w.startsWith("-") && FILEISH.test(w));
    if (file) out.push({ runner, file });
  }
  return out;
}

/** Each run file a manifest names: { file, how, pkg } for the parsed ones. */
export function packageRunFiles(manifests, parsedFiles) {
  const parsed = new Set(parsedFiles);
  const out = [];
  for (const m of manifests ?? []) {
    for (const [name, p] of Object.entries(m.bin ?? {})) {
      const file = typeof p === "string" ? resolvePackagePath(m.dir, p, parsed) : null;
      if (file) out.push({ file, how: `bin "${name}" of ${m.name}`, pkg: m.name, bin: name });
    }
    for (const [name, cmd] of Object.entries(m.scripts ?? {})) {
      for (const t of scriptTargets(cmd)) {
        const file = resolvePackagePath(m.dir, t.file, parsed);
        if (file) out.push({ file, how: `script "${name}" of ${m.name} (${t.runner} ${t.file})`, pkg: m.name, script: name });
      }
    }
  }
  return out;
}
