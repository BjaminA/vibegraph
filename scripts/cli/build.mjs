#!/usr/bin/env node
// M-CRYSTAL.1 — build the publishable package under packages/knowledge:
//
//   dist/cli.mjs            scripts/cli/main.mjs + the src/server modules it
//                           imports, bundled by esbuild as ESM (import.meta.url
//                           stays real; the CJS server bundle's undefined
//                           import.meta.url is the h2h3 standings.json lesson)
//   vendor/scripts/*.py     the five libcst scripts the pipeline spawns
//   vendor/scripts/frontends/**  the four tree-sitter frontends, linkers,
//                           discoverers and the committed WASM grammars — they
//                           run as separate processes and are shipped as files
//   LICENSE                 copied from the repo root
//
// The frontends resolve `web-tree-sitter` by walking up from vendor/, so it
// is the package's one npm dependency. Nothing here is committed; run
// `npm run build:cli` (test:cli-pack does) before `npm pack`.
import * as esbuild from "esbuild";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const PKG = join(ROOT, "packages", "knowledge");
const VENDOR = join(PKG, "vendor", "scripts");

/** The Python scripts buildPolyglotEnvelope spawns (scripts/regen_polyglot.mjs
 *  + src/server/languages.ts). Each imports only the stdlib and libcst. */
export const PYTHON_SCRIPTS = ["parse_cst.py", "literal_table.py", "cross_file_link.py", "discover_entry_points.py", "thin_script_entry.py", "extract_thread.py", "build_system_tier.py"];
/** M-FLOW.2 — Node scripts at scripts/ root the pipeline spawns (the
 *  frontends under scripts/frontends/ are copied whole, below). */
export const NODE_SCRIPTS = ["discover_project.mjs"];

/** 2026-09-25 — `view`, the VISUALISATION, ships in the same package. The
 *  server finds everything relative to its own file (server.ts PROJECT_ROOT =
 *  dist/..), so its bundle goes to vendor/dist/ and it reads vendor/scripts
 *  and vendor/skills — the parser scripts above are shared, not duplicated.
 *  These are the scripts only the app spawns (runs, edits, traces, placement). */
export const APP_PYTHON_SCRIPTS = [
  "cst_rewrite.py", "scan_effects.py", "check_literals.py", "check_project_deps.py", "run_block.py",
  "run_to_node.py", "trace_run.py", "place_intent.py", "resolve_external_callable.py",
];
export const APP_NODE_SCRIPTS = ["trace_bash.mjs"];

export async function buildPackage({ quiet = false } = {}) {
  rmSync(join(PKG, "dist"), { recursive: true, force: true });
  rmSync(join(PKG, "vendor"), { recursive: true, force: true });
  mkdirSync(VENDOR, { recursive: true });
  // M-FLOW.2 — the project-level discoverer is spawned like a frontend's.
  for (const s of NODE_SCRIPTS) copyFileSync(join(ROOT, "scripts", s), join(VENDOR, s));

  const outfile = join(PKG, "dist", "cli.mjs");
  const result = await esbuild.build({
    entryPoints: [join(ROOT, "scripts", "cli", "main.mjs")],
    bundle: true,
    outfile,
    format: "esm",
    platform: "node",
    target: "node20",
    // esbuild keeps the entry's own `#!/usr/bin/env node` above the banner
    // (a second hashbang line is a syntax error in ESM — found by running
    // the first build). The banner only gives bundled CommonJS a `require`.
    banner: { js: "import { createRequire as __vgCreateRequire } from 'node:module'; const require = __vgCreateRequire(import.meta.url);" },
    alias: { "@xyflow/react": join(ROOT, "scripts", "cli", "stubs", "xyflow.mjs") },
    metafile: true,
    logLevel: quiet ? "error" : "warning",
  });
  chmodSync(outfile, 0o755);

  for (const f of PYTHON_SCRIPTS) copyFileSync(join(ROOT, "scripts", f), join(VENDOR, f));
  cpSync(join(ROOT, "scripts", "frontends"), join(VENDOR, "frontends"), {
    recursive: true,
    filter: (src) => !/(^|[\\/])(__pycache__|node_modules)([\\/]|$)/.test(src),
  });
  copyFileSync(join(ROOT, "LICENSE"), join(PKG, "LICENSE"));

  // The visualisation: the same two esbuild configs `npm run build` uses,
  // written to vendor/dist without source maps.
  const { serverConfig, webviewConfig } = await import(join(ROOT, "esbuild.mjs"));
  const APP = join(PKG, "vendor", "dist");
  await esbuild.build({ ...serverConfig, entryPoints: [join(ROOT, "server.ts")], outfile: join(APP, "server.js"), sourcemap: false, logLevel: quiet ? "error" : "warning" });
  await esbuild.build({ ...webviewConfig, entryPoints: [join(ROOT, "src", "webview", "index.tsx")], outfile: join(APP, "webview.js"), sourcemap: false, logLevel: quiet ? "error" : "warning" });
  // The package is "type": "module" (the CLI is ESM); the server bundle is
  // CommonJS. Without this marker Node reads server.js as ESM and it dies on
  // `module.exports` (found on the first packed install).
  writeFileSync(join(APP, "package.json"), JSON.stringify({ type: "commonjs" }) + "\n");
  for (const f of APP_PYTHON_SCRIPTS) copyFileSync(join(ROOT, "scripts", f), join(VENDOR, f));
  for (const f of APP_NODE_SCRIPTS) copyFileSync(join(ROOT, "scripts", f), join(VENDOR, f));
  // The Ollama shim imports the MCP SDK, which the package does not install:
  // bundled, it needs nothing but Node.
  await esbuild.build({
    entryPoints: [join(ROOT, "scripts", "vg_ollama_shim.mjs")], bundle: true, format: "esm", platform: "node", target: "node20",
    outfile: join(VENDOR, "vg_ollama_shim.mjs"),
    banner: { js: "import { createRequire as __vgCreateRequire } from 'node:module'; const require = __vgCreateRequire(import.meta.url);" },
    logLevel: quiet ? "error" : "warning",
  });
  cpSync(join(ROOT, "skills"), join(PKG, "vendor", "skills"), { recursive: true });
  // The Claude Code skill (`init --skill`): how a plain Claude chat sets this up.
  cpSync(join(ROOT, "scripts", "cli", "claude-skill"), join(PKG, "vendor", "claude-skill"), { recursive: true });
  cpSync(join(ROOT, "scripts", "cli", "claude-skills"), join(PKG, "vendor", "claude-skills"), { recursive: true });

  // 2026-10-02 — a vendored script that imports a sibling the lists above
  // forgot dies at run time with ERR_MODULE_NOT_FOUND (0.17–0.18 shipped
  // discover_project.mjs without package_entries.mjs, and project-level
  // discovery failed in every `view`). Follow every relative import of every
  // vendored .mjs, copy what is missing from scripts/, and refuse to finish
  // when one still does not resolve.
  vendorImportClosure(VENDOR, join(ROOT, "scripts"));

  const bundleBytes = statSync(outfile).size;
  if (!quiet) {
    const inputs = Object.entries(result.metafile.outputs[relative(ROOT, outfile).split("\\").join("/")]?.inputs ?? {})
      .sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput).slice(0, 5)
      .map(([f, m]) => `    ${f} ${(m.bytesInOutput / 1024).toFixed(0)} KB`);
    console.log(`built ${relative(ROOT, outfile)} (${(bundleBytes / 1024).toFixed(0)} KB); largest inputs:\n${inputs.join("\n")}`);
    console.log(`vendored ${PYTHON_SCRIPTS.length} python scripts + scripts/frontends → ${relative(ROOT, VENDOR)}`);
    console.log(`vendored the visualisation (server + web app, ${APP_PYTHON_SCRIPTS.length} more python scripts, skills) → ${relative(ROOT, join(PKG, "vendor"))}`);
  }
  return { outfile, bundleBytes, vendor: VENDOR, pkg: PKG };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(join(ROOT, "node_modules", "esbuild"))) { console.error("npm install first"); process.exit(2); }
  buildPackage().catch((e) => { console.error(e); process.exit(1); });
}

/** Copy the relative-import closure of every .mjs under `vendor` from
 *  `source` (the same relative layout), then fail on any import that still
 *  does not resolve. Exported for test:cli-pack. */
export function vendorImportClosure(vendor, source) {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" ? [] : walk(join(dir, e.name))) : e.name.endsWith(".mjs") ? [join(dir, e.name)] : []));
  const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
  const queue = walk(vendor);
  const seen = new Set();
  const dangling = [];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    // Comments describe imports too (`// … await import("./x")`): not code.
    const text = readFileSync(file, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([;{}),])\s*\/\/.*$/gm, "$1");
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2];
      const target = join(dirname(file), spec);
      if (existsSync(target)) { if (target.endsWith(".mjs")) queue.push(target); continue; }
      const from = join(source, relative(vendor, target));
      if (existsSync(from)) {
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(from, target);
        if (target.endsWith(".mjs")) queue.push(target);
      } else dangling.push(`${relative(vendor, file)} imports ${spec}`);
    }
  }
  if (dangling.length) throw new Error(`vendored scripts import files that do not exist:\n  ${dangling.join("\n  ")}`);
}
