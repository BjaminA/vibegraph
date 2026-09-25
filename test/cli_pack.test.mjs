// M-CRYSTAL.1 — the bundle stands alone. Builds packages/knowledge, packs
// it with npm, unpacks the tarball into a temp dir, and runs `export` from a
// cwd OUTSIDE this checkout against a COPY of examples/fleet-telemetry. Pins:
// the tarball ships the bundle, the five python scripts, the frontends and
// grammars, and none of the repo; the packed CLI writes the same file set
// as the in-repo script and byte-identical contracts; the README's
// provenance names the package version, not a VibeGraph commit.
//
// The unpacked package gets `web-tree-sitter` by symlink from this repo's
// node_modules rather than a network install — the test is about the
// package's own files and paths, not the registry. libcst comes from the
// repo's .pydeps through VIBEGRAPH_PYDEPS, the documented "a directory that
// already holds libcst" knob, for the same reason.
//
//   npm run test:cli-pack
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPackage, PYTHON_SCRIPTS } from "../scripts/cli/build.mjs";
import { exportKnowledge } from "../scripts/export_knowledge.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG = join(ROOT, "packages", "knowledge");
const TASK = "Persist `region` in `telemetry/storage.py` (`insert_readings`) and show it in `gateway/server.ts` (`getFleet`).";

const tmp = mkdtempSync(join(tmpdir(), "vgk-pack-"));
let packed; // { filename, files: [{path}] }
let cli;    // path to the unpacked dist/cli.mjs
let run;    // spawn result of the packed export
const fleet = join(tmp, "fleet");
const installedOut = join(fleet, ".vibegraph", "knowledge");
const devOut = join(tmp, "dev-out");

function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p).split("\\").join("/"));
  }
  return out.sort();
}

before(async () => {
  await buildPackage({ quiet: true });
  const pack = spawnSync("npm", ["pack", "--json", "--pack-destination", tmp], { cwd: PKG, encoding: "utf-8" });
  assert.equal(pack.status, 0, `npm pack failed: ${pack.stderr}`);
  packed = JSON.parse(pack.stdout)[0];
  const untar = spawnSync("tar", ["-xzf", join(tmp, packed.filename), "-C", tmp], { encoding: "utf-8" });
  assert.equal(untar.status, 0, `tar failed: ${untar.stderr}`);
  const pkgDir = join(tmp, "package");
  mkdirSync(join(pkgDir, "node_modules"), { recursive: true });
  symlinkSync(join(ROOT, "node_modules", "web-tree-sitter"), join(pkgDir, "node_modules", "web-tree-sitter"), "dir");
  cli = join(pkgDir, "dist", "cli.mjs");

  cpSync(join(ROOT, "examples", "fleet-telemetry"), fleet, { recursive: true });
  rmSync(installedOut, { recursive: true, force: true });
  const env = { ...process.env, VIBEGRAPH_PYDEPS: join(ROOT, ".pydeps"), VIBEGRAPH_KNOWLEDGE_HOME: join(tmp, "home") };
  delete env.VG_PYTHON;
  delete env.PYTHONPATH;
  run = spawnSync(process.execPath, [cli, "export", "fleet", "--task", TASK], { cwd: tmp, encoding: "utf-8", env });
});

test("the tarball ships the bundle, the python scripts, the frontends and grammars, and none of the repo", () => {
  const files = packed.files.map((f) => f.path);
  for (const f of ["dist/cli.mjs", "package.json", "README.md", "LICENSE", "requirements.txt",
    "vendor/scripts/frontends/grammars/tree-sitter-bash.wasm", "vendor/scripts/frontends/grammars/tree-sitter-tsx.wasm",
    "vendor/scripts/frontends/bash/parse_bash.mjs", "vendor/scripts/frontends/rust/parse_rust.mjs"]) {
    assert.ok(files.includes(f), `tarball has ${f}`);
  }
  for (const py of PYTHON_SCRIPTS) assert.ok(files.includes(`vendor/scripts/${py}`), `tarball has ${py}`);
  for (const f of files) {
    assert.ok(!/^(test|examples|reviews|src|scripts|node_modules)\//.test(f), `tarball must not ship ${f}`);
    assert.ok(!f.endsWith(".map"), `no source maps: ${f}`);
  }
  assert.ok(!files.some((f) => f.includes("__pycache__")), "no bytecode caches");
});

test("the packed CLI runs from a cwd outside the checkout and reports what it wrote", () => {
  assert.equal(run.status, 0, `exit ${run.status}\nstdout: ${run.stdout}\nstderr: ${run.stderr}`);
  assert.match(run.stdout, /^wrote \d+ files to /);
  assert.match(run.stdout, /thread contracts, 0 skills, 6 stated constraints, plan of \d+ packets/);
  assert.ok(!resolve(tmp).startsWith(ROOT), "the temp cwd is outside the checkout");
  assert.ok(existsSync(join(installedOut, "README.md")));
});

test("the packed export writes the same file set as the in-repo script, with byte-identical contracts", () => {
  const dev = exportKnowledge({ root: fleet, out: devOut, task: TASK, commit: "test" });
  assert.deepEqual(walk(installedOut), walk(devOut));
  assert.equal(walk(installedOut).length, dev.written.length, "the export's own record of what it wrote (README.md included) matches the disk");
  // Prose mode on both sides (the default): the raw JSON forms are behind --with-ir.
  assert.ok(!existsSync(join(installedOut, "stack.json")) && !existsSync(join(installedOut, "ir")), "no raw forms by default");
  for (const f of ["threads/telemetry_alerts.py_evaluate.md", "threads/INDEX.md", "constraints.md", "system_spec.md", "plan.md"]) {
    assert.equal(readFileSync(join(installedOut, f), "utf-8"), readFileSync(join(devOut, f), "utf-8"), `${f} is byte-identical across the packaged and in-repo pipelines`);
  }
});

test("the README's provenance names the package, and says when the project is not a git repository", () => {
  const readme = readFileSync(join(installedOut, "README.md"), "utf-8");
  const version = JSON.parse(readFileSync(join(PKG, "package.json"), "utf-8")).version;
  assert.ok(readme.includes(`by vibegraph-knowledge ${version};`), "the package version is the provenance");
  assert.ok(!readme.includes("VibeGraph commit"), "not this checkout's commit");
  assert.ok(readme.includes("not a git repository"), "a copied example has no .git, and the README says so rather than inventing a sha");
});

test("--version and --help answer without touching the project", () => {
  const v = spawnSync(process.execPath, [cli, "--version"], { cwd: tmp, encoding: "utf-8" });
  assert.equal(v.status, 0);
  assert.match(v.stdout, /^vibegraph-knowledge \d+\.\d+\.\d+\n$/);
  const h = spawnSync(process.execPath, [cli, "--help"], { cwd: tmp, encoding: "utf-8" });
  assert.equal(h.status, 0);
  assert.match(h.stdout, /export \[<root>\]/);
  const bad = spawnSync(process.execPath, [cli, "frobnicate"], { cwd: tmp, encoding: "utf-8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown command: frobnicate/);
});

after(() => rmSync(tmp, { recursive: true, force: true }));
