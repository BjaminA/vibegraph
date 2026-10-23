// WHICH `.js` FILES AND PAGES ARE SOURCE (2026-10-22, the root-cause handoff
// RC2: "admit files by evidence, not only by extension"). `.js`/`.jsx` are not
// registered by extension, because most of them in a repository are bundles,
// vendored libraries and generated output (src/shared/languages.ts). A Worker
// that serves the whole site, or a page whose app is one inline script, was
// then never read. Here a candidate is read when something says it is source:
//
//   a run or deploy config names it     (the RUN_CONFIGS table below)
//   package.json names it               main / module / browser / bin / exports / scripts
//   a parsed file imports it, or a page loads it with <script src>
//   it is a Worker (`export default { fetch }`, `addEventListener("fetch")`)
//   it starts with a `#!` line naming node
//
// and stays out, whatever names it, when it is minified, bundled, vendored or
// compiled from a sibling `.ts` (GENERATED below). A page is read when it has
// an inline script. Every candidate leaves with a reason, admitted or
// deferred: the coverage ledger lists both (coverage_ledger.ts).

import * as fs from "fs";
import * as path from "path";
import { languageForShebang } from "../shared/languages.ts";
import { inlineScripts, isHtmlPath, pageScriptSource } from "../../scripts/frontends/inline_scripts.mjs";

/** Config files whose documented job is to name the script a platform runs.
 *  Read line by line for path tokens: no TOML or YAML parser, since a path is
 *  all that is wanted. Data: add a row when a platform is met.
 *  wrangler   `main`, developers.cloudflare.com/workers/wrangler/configuration/
 *  Procfile   `<type>: <command>`, devcenter.heroku.com/articles/procfile
 *  vercel / netlify / fly   build and function settings that name files
 *  workflows  `run:` steps, docs.github.com/actions/reference/workflow-syntax-for-github-actions */
export const RUN_CONFIGS: ReadonlyArray<{ name: RegExp; label: string }> = [
  { name: /^wrangler\.(toml|json|jsonc)$/, label: "the Cloudflare wrangler config" },
  { name: /^Procfile$/, label: "the Procfile" },
  { name: /^vercel\.json$/, label: "the Vercel config" },
  { name: /^netlify\.toml$/, label: "the Netlify config" },
  { name: /^fly\.toml$/, label: "the Fly config" },
  { name: /^ecosystem\.config\.(c?js|json)$/, label: "the pm2 ecosystem file" },
];

/** What marks a file as output rather than source, checked before any evidence. */
const GENERATED_NAME = /[.-](min|bundle|umd|prod|production)\.jsx?$/i;
/** Folders that hold someone else's code (npm's own folder is never walked). */
export const VENDOR_DIRS = new Set(["vendor", "vendors", "third_party", "third-party", "bower_components", "jspm_packages"]);
const SOURCE_MAP = /\/[/*][#@]\s*sourceMappingURL=/;
const LONG_LINE = 2000;
const HEAD_BYTES = 64 * 1024;

const WORKER = [/export\s+default\s*\{[\s\S]{0,4000}?\bfetch\s*\(/, /addEventListener\(\s*["']fetch["']/];
const IMPORT_SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(["'])(\.{1,2}\/[^"'\n]+)\1/gm;
const SCRIPT_SRC = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
const SCRIPT_TOKEN = /(?:^|[\s"'=(,:[])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:jsx?|mjs|cjs))\b/g;

export interface Admission {
  /** rel path → why it is read */
  admitted: Map<string, string>;
  /** rel path → why it is not */
  deferred: Map<string, string>;
}

const posix = (p: string) => p.split(path.sep).join("/");
const readHead = (full: string): string => {
  try {
    const fd = fs.openSync(full, "r");
    try { const buf = Buffer.alloc(HEAD_BYTES); const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0); return buf.subarray(0, n).toString("utf-8"); }
    finally { fs.closeSync(fd); }
  } catch { return ""; }
};
const readAll = (full: string): string => { try { return fs.readFileSync(full, "utf-8"); } catch { return ""; } };

/** Why a candidate is output rather than source, or null. */
function generatedBy(rel: string, head: string, exists: (rel: string) => boolean): string | null {
  if (GENERATED_NAME.test(rel)) return "minified or bundled (by its name)";
  const dir = rel.split("/").slice(0, -1).find((s) => VENDOR_DIRS.has(s.toLowerCase()));
  if (dir) return `vendored (it sits under ${dir}/)`;
  const stem = rel.replace(/\.jsx?$/i, "");
  const sibling = [".ts", ".tsx"].map((e) => stem + e).find(exists);
  if (sibling) return `compiled from ${sibling}`;
  if (SOURCE_MAP.test(head)) return "generated (it carries a source map)";
  const long = head.split("\n").find((l) => l.length > LONG_LINE);
  if (long) return `minified (a line of ${long.length.toLocaleString("en-GB")}+ characters)`;
  return null;
}

/** The candidate a path token names, resolved from a directory and from the root. */
function resolveToken(token: string, fromDir: string, candidates: ReadonlySet<string>): string | null {
  const t = token.replace(/^\.\//, "");
  for (const base of [fromDir, ""]) {
    const rel = posix(path.posix.normalize(path.posix.join(base, t)));
    if (candidates.has(rel)) return rel;
  }
  return null;
}

function stringsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsIn(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => stringsIn(x, out));
  return out;
}

/**
 * Decide every candidate. `candidates` are the walked `.js`/`.jsx` files and
 * pages; `sources` the files read by their own extension (their imports are
 * evidence); `files` every walked path (config files are found there);
 * `fullOf` the absolute path of a walked file.
 */
export function admitSources(root: string, candidates: string[], sources: string[], files: string[], fullOf: (rel: string) => string): Admission {
  const admitted = new Map<string, string>();
  const deferred = new Map<string, string>();
  if (!candidates.length) return { admitted, deferred };
  const scripts = new Set(candidates.filter((c) => !isHtmlPath(c)));
  const exists = (rel: string) => files.includes(rel) || sources.includes(rel);
  const named = new Map<string, string>(); // a script → the first thing that names it
  const name = (rel: string | null, why: string) => { if (rel && !named.has(rel)) named.set(rel, why); };

  // configs and manifests
  const workflows = (() => {
    const dir = path.join(root, ".github", "workflows");
    try { return fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => `.github/workflows/${f}`); } catch { return []; }
  })();
  for (const rel of [...files, ...workflows]) {
    const base = rel.split("/").pop()!;
    const dir = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
    const config = RUN_CONFIGS.find((c) => c.name.test(base));
    const label = config ? `${config.label} (${rel})` : rel.startsWith(".github/workflows/") ? `the workflow ${rel}` : null;
    if (label) {
      const text = readAll(path.join(root, rel));
      for (const m of text.matchAll(SCRIPT_TOKEN)) name(resolveToken(m[1], rel.startsWith(".github/") ? "" : dir, scripts), `named by ${label}`);
    } else if (base === "package.json") {
      let pkg: Record<string, unknown> = {};
      try { pkg = JSON.parse(readAll(path.join(root, rel))); } catch { continue; }
      for (const field of ["main", "module", "browser", "bin", "exports"]) {
        for (const s of stringsIn(pkg[field])) name(resolveToken(s, dir, scripts), `named by ${rel} "${field}"`);
      }
      for (const cmd of stringsIn(pkg.scripts)) for (const m of cmd.matchAll(SCRIPT_TOKEN)) name(resolveToken(m[1], dir, scripts), `run by ${rel} "scripts"`);
    }
  }

  // pages: read when they have an inline script; what they load is named
  for (const rel of candidates.filter(isHtmlPath)) {
    const html = readAll(fullOf(rel));
    const inline = inlineScripts(html);
    const dir = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
    for (const m of html.matchAll(SCRIPT_SRC)) if (!/^[a-z]+:|^\/\//i.test(m[1])) name(resolveToken(m[1].replace(/^\//, ""), m[1].startsWith("/") ? "" : dir, scripts), `loaded by ${rel}`);
    if (inline.length) {
      const lines = inline.map((s) => `${s.line}-${s.endLine}`).join(", ");
      admitted.set(rel, `${inline.length} inline script${inline.length === 1 ? "" : "s"} (lines ${lines})`);
      for (const m of pageScriptSource(html, inline).matchAll(IMPORT_SPEC)) name(resolveToken(m[2], dir, scripts), `imported by ${rel}`);
    } else deferred.set(rel, "a page with no inline script");
  }

  // content, then imports from every file read, to a fixed point
  const heads = new Map([...scripts].map((rel) => [rel, readHead(fullOf(rel))]));
  for (const rel of scripts) {
    const head = heads.get(rel)!;
    const output = generatedBy(rel, head, exists);
    if (output) { deferred.set(rel, named.has(rel) ? `${output}; ${named.get(rel)}` : output); continue; }
    if (named.has(rel)) { admitted.set(rel, named.get(rel)!); continue; }
    if (WORKER.some((w) => w.test(head))) { admitted.set(rel, "a Worker's fetch handler"); continue; }
    const first = head.split("\n")[0];
    if (first.startsWith("#!") && languageForShebang(first)?.id === "jsts") admitted.set(rel, "a `#!` node script");
  }
  const scanned = new Set<string>();
  let frontier = [...sources.filter((s) => /\.(tsx?|mjs|cjs)$/.test(s)), ...[...admitted.keys()].filter((r) => scripts.has(r))];
  while (frontier.length) {
    const next: string[] = [];
    for (const rel of frontier) {
      if (scanned.has(rel)) continue;
      scanned.add(rel);
      const dir = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
      for (const m of readAll(fullOf(rel)).matchAll(IMPORT_SPEC)) {
        const target = resolveToken(m[2], dir, scripts) ?? resolveToken(`${m[2]}.js`, dir, scripts);
        if (!target || admitted.has(target) || deferred.has(target)) continue;
        admitted.set(target, `imported by ${rel}`);
        next.push(target);
      }
    }
    frontier = next;
  }
  for (const rel of scripts) {
    if (!admitted.has(rel) && !deferred.has(rel)) deferred.set(rel, "no evidence it is source: nothing names or imports it, and it is not a Worker or a `#!` script");
  }
  return { admitted, deferred };
}
