// M-CMD.1 — tsconfig path aliases, read by the PARSER.
//
// `@/lib/db` is a project's own file. Without the alias map it is a bare
// specifier, which the linker correctly treats as external — so a project
// that uses the standard Next.js `@/*` convention has its ENTIRE internal
// import graph read as leaving the project: no call chain resolves, no
// funnel forms, and the stack index lists the project's own directories as
// third-party dependencies (an internal field review B4).
//
// The parser reads it, not the linker, and that is M-RUST's ruling rather
// than a preference: `spawnDerived` passes no cwd, so a linker runs in the
// SERVER's directory and cannot find the analysed project's manifest, while
// the parser is handed each file's path and can walk up for it exactly as
// tsc does. Rust stamps `crateName`/`cratePath` this way; this stamps
// `tsPaths`.
//
// Deliberately partial, and honest about it: `extends` is NOT followed (a
// base config may live in node_modules, which we never walk), and a pattern
// with more than one `*` is skipped rather than guessed at. An alias we
// cannot resolve stays external, which is the answer we had before.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CONFIG_NAMES = ["tsconfig.json", "jsconfig.json"];
const cache = new Map();

/** JSON with comments and trailing commas — tsconfig.json is JSONC in practice. */
function parseJsonc(text) {
  const stripped = text
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*$)|(\/\*[\s\S]*?\*\/)/gm, (m, line, block) => (line || block ? "" : m))
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped);
}

/**
 * The nearest tsconfig/jsconfig above `relFile`, as an alias map.
 *
 * @param relFile project-relative path of the source file ("app/api/x/route.ts")
 * @param root    absolute project root; defaults to the process cwd, which is
 *                where the batch parser already runs (regen_polyglot spawns
 *                parse with `cwd: root`).
 * @returns {{ configDir: string, aliases: Array<{prefix: string, suffix: string, targets: string[]}> } | null}
 *          `configDir` is project-relative ("" at the root). Never throws.
 */
export function findTsPaths(relFile, root = process.cwd()) {
  let dir = dirname(relFile);
  if (dir === ".") dir = "";
  const seen = [];
  for (;;) {
    if (cache.has(dir)) {
      const hit = cache.get(dir);
      for (const d of seen) cache.set(d, hit);
      return hit;
    }
    seen.push(dir);
    for (const name of CONFIG_NAMES) {
      const abs = join(root, dir, name);
      if (!existsSync(abs)) continue;
      let parsed = null;
      try {
        const cfg = parseJsonc(readFileSync(abs, "utf-8"));
        const paths = cfg?.compilerOptions?.paths;
        if (paths && typeof paths === "object") {
          const baseUrl = typeof cfg.compilerOptions.baseUrl === "string" ? cfg.compilerOptions.baseUrl : ".";
          const base = normalizeRel(join(dir, baseUrl));
          const aliases = [];
          for (const [pattern, targetsRaw] of Object.entries(paths)) {
            const targets = (Array.isArray(targetsRaw) ? targetsRaw : []).filter((t) => typeof t === "string");
            if (!targets.length) continue;
            const star = pattern.indexOf("*");
            if (pattern.indexOf("*", star + 1) !== -1) continue; // two stars: skipped, never guessed
            aliases.push({
              prefix: star === -1 ? pattern : pattern.slice(0, star),
              suffix: star === -1 ? "" : pattern.slice(star + 1),
              exact: star === -1,
              targets: targets.map((t) => ({
                prefix: t.indexOf("*") === -1 ? t : t.slice(0, t.indexOf("*")),
                suffix: t.indexOf("*") === -1 ? "" : t.slice(t.indexOf("*") + 1),
                base,
              })),
            });
          }
          if (aliases.length) parsed = { configDir: dir, aliases };
        }
      } catch {
        parsed = null; // a config we cannot read tells us nothing, and says so by absence
      }
      for (const d of seen) cache.set(d, parsed);
      return parsed;
    }
    if (dir === "") break;
    const up = dirname(dir);
    dir = up === "." ? "" : up;
  }
  for (const d of seen) cache.set(d, null);
  return null;
}

function normalizeRel(p) {
  const parts = [];
  for (const seg of p.split(/[\\/]/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Candidate project-relative paths for a specifier under an alias map, best
 * first. Empty when no alias matches — the specifier is then bare, which is
 * what it was before.
 */
export function expandAlias(spec, tsPaths) {
  if (!tsPaths?.aliases?.length) return [];
  const out = [];
  for (const a of tsPaths.aliases) {
    if (a.exact) {
      if (spec !== a.prefix) continue;
      for (const t of a.targets) out.push(normalizeRel(`${t.base}/${t.prefix}${t.suffix}`));
      continue;
    }
    if (!spec.startsWith(a.prefix) || !spec.endsWith(a.suffix)) continue;
    const middle = spec.slice(a.prefix.length, spec.length - (a.suffix.length || 0));
    for (const t of a.targets) out.push(normalizeRel(`${t.base}/${t.prefix}${middle}${t.suffix}`));
  }
  return out;
}

/** Test seam: the cache is per-process and a fixture run may change configs. */
export function _clearTsPathCache() {
  cache.clear();
}

const PROBE_EXT = ["", ".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx",
  "/index.ts", "/index.tsx", "/index.mjs", "/index.cjs", "/index.js", "/index.jsx"];

/**
 * The project-relative file a BARE specifier resolves to through the alias
 * map, or null. Probes the real filesystem, so an alias pattern that matches
 * nothing on disk resolves to nothing — the pattern alone never makes a file
 * exist.
 *
 * Stamped by the parser onto the import node as `aliasTarget`, which is why
 * neither the linker nor the stack index carries its own copy of this logic:
 * they read one resolved fact. (The confinement-vectors lesson, applied
 * before there were two implementations to keep in step rather than after.)
 */
export function resolveAliasTarget(spec, tsPaths, root = process.cwd()) {
  for (const base of expandAlias(spec, tsPaths)) {
    for (const ext of PROBE_EXT) {
      const cand = base + ext;
      if (cand && existsSync(join(root, cand))) return cand;
    }
  }
  return null;
}
