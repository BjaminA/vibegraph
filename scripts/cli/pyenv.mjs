// M-CRYSTAL.1 — the Python half. Parsing, linking, discovery, thread
// extraction and the system tier are libcst scripts; npm cannot install
// libcst, so this does what runVis.sh does for the checkout: find a python
// that already imports libcst, else install libcst into a directory this
// package owns and put it on PYTHONPATH. Nothing is installed system-wide.
// When python itself is missing the exact command is printed and the CLI
// exits — a missing interpreter is not something to paper over.
//
// Order:
//   1. VG_PYTHON             — the binary to use (still probed for libcst)
//   2. VIBEGRAPH_PYDEPS      — a directory that already holds libcst
//   3. python3 / python as they are
//   4. dev: <repo>/.pydeps (read, never written)   installed: <cache>/pydeps
//   5. provisioned on demand into <cache>/pydeps-py<major><minor>, one per Python
import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { PACKAGE_NAME } from "./paths.mjs";

// libcst defines no __version__ (the first probe asked for it, so every
// environment "failed" and the installer ran); the distribution metadata
// has the version. Importing the package is NOT enough (2026-09-28): a
// libcst whose compiled parser was built for another Python imports cleanly
// and then fails on every file ("cannot import name 'native'") — a hook run
// under /usr/bin/python3 3.12 against a .pydeps built for 3.13 parsed no
// Python at all and reported the rules as unverifiable. Parsing one
// statement is the fact that matters.
const PROBE = "import libcst, sys\nlibcst.parse_module('x = 1\\n')\ntry:\n    import importlib.metadata as m; v = m.version('libcst')\nexcept Exception:\n    v = 'unknown'\nsys.stdout.write(v)";

function probe(bin, env) {
  const r = spawnSync(bin, ["-c", PROBE], { encoding: "utf-8", env });
  return r.status === 0 ? r.stdout.trim() : null;
}

function withPath(dir) {
  const prior = process.env.PYTHONPATH;
  return { ...process.env, PYTHONPATH: prior ? `${dir}${process.platform === "win32" ? ";" : ":"}${prior}` : dir };
}

export function cacheDir() {
  return process.env.VIBEGRAPH_KNOWLEDGE_HOME ?? join(homedir(), ".cache", PACKAGE_NAME);
}

/** The provisioning directory kept for ONE interpreter version: compiled
 *  wheels (libcst's parser, black's mypyc modules) do not survive another. */
export function ownDepsFor(bin) {
  const tag = spawnSync(bin, ["-c", "import sys; print(f'{sys.version_info[0]}{sys.version_info[1]}')"], { encoding: "utf-8" }).stdout?.trim();
  return join(cacheDir(), `pydeps-py${tag || "unknown"}`);
}

/**
 * @returns {{ bin: string, env: NodeJS.ProcessEnv, libcst: string, how: string }}
 * @throws when no usable python can be found or provisioned; the message
 *   carries the command a person would run.
 */
export function resolvePython(loc, { log = () => {} } = {}) {
  const bins = process.env.VG_PYTHON ? [process.env.VG_PYTHON] : ["python3", "python"];
  const explicitDeps = process.env.VIBEGRAPH_PYDEPS;
  // Where a provisioned libcst goes. PER INTERPRETER VERSION (2026-09-28):
  // libcst ships a compiled parser, so one shared directory is clobbered by
  // whichever Python installs last — a hook run under the system 3.12 once
  // replaced the 3.13 build every other caller used. The pre-split `pydeps`
  // stays a candidate (the parse probe rejects it if it does not fit).
  const legacyDeps = loc.mode === "dev" ? join(loc.repoRoot, ".pydeps") : join(cacheDir(), "pydeps");

  // A python that already has libcst, in any of the candidate environments.
  const envsFor = (bin) => {
    const own = ownDepsFor(bin);
    return [
      ...(explicitDeps ? [[withPath(explicitDeps), `VIBEGRAPH_PYDEPS=${explicitDeps}`]] : []),
      [process.env, "as installed"],
      ...(existsSync(legacyDeps) ? [[withPath(legacyDeps), legacyDeps]] : []),
      ...(existsSync(own) ? [[withPath(own), own]] : []),
    ];
  };
  let firstBin = null;
  for (const bin of bins) {
    if (spawnSync(bin, ["--version"], { encoding: "utf-8" }).status !== 0) continue;
    firstBin ??= bin;
    for (const [env, how] of envsFor(bin)) {
      const v = probe(bin, env);
      if (v) return { bin, env, libcst: v, how };
    }
  }
  if (!firstBin) {
    throw new Error(`${PACKAGE_NAME}: no python interpreter found (tried ${bins.join(", ")}). Install Python 3 and libcst, or point VG_PYTHON at an interpreter.`);
  }

  // Provision libcst into the directory this package owns — never into a
  // checkout's .pydeps (the repo's tests depend on it), and only ever into a
  // directory kept for THIS interpreter's version.
  const ownDeps = ownDepsFor(firstBin);
  const req = join(loc.packageRoot, "requirements.txt");
  log(`libcst not found for ${firstBin}; installing into ${ownDeps} (one time)`);
  mkdirSync(ownDeps, { recursive: true });
  const pip = spawnSync(firstBin, ["-m", "pip", "install", "--quiet", "--target", ownDeps, "--upgrade", "-r", req], { encoding: "utf-8", stdio: ["ignore", "inherit", "inherit"] });
  if (pip.status !== 0) {
    throw new Error(`${PACKAGE_NAME}: could not install libcst. Run this yourself, then retry:\n  ${firstBin} -m pip install --target "${ownDeps}" libcst\nor set VIBEGRAPH_PYDEPS to a directory where libcst is importable.`);
  }
  const env = withPath(ownDeps);
  const v = probe(firstBin, env);
  if (!v) throw new Error(`${PACKAGE_NAME}: libcst was installed into ${ownDeps} but ${firstBin} still cannot import it.`);
  return { bin: firstBin, env, libcst: v, how: ownDeps };
}

// 2026-09-25 — `view` (the visualisation) also EDITS, and every edit is
// formatted by black (>= 24 for --line-ranges; see the repo requirements).
// The read-only commands never need it, so it is provisioned only here, into
// the same directory as libcst. A black that cannot be installed is a
// warning, not a failure: everything but editing still works, and the edit
// path itself fails loudly rather than writing unformatted code.
const BLACK_PROBE = "import black, sys\nmajor = int(black.__version__.split('.')[0])\nsys.exit(0 if major >= 24 else 1)";

export function ensureBlack(py, loc, { log = () => {} } = {}) {
  if (spawnSync(py.bin, ["-c", BLACK_PROBE], { env: py.env }).status === 0) return { ok: true, env: py.env };
  const ownDeps = ownDepsFor(py.bin);
  log(`black >= 24 not found for ${py.bin}; installing into ${ownDeps} (one time) — edits are formatted with it`);
  mkdirSync(ownDeps, { recursive: true });
  const pip = spawnSync(py.bin, ["-m", "pip", "install", "--quiet", "--target", ownDeps, "--upgrade", "black>=24"], { encoding: "utf-8", stdio: ["ignore", "inherit", "inherit"] });
  // On top of the environment libcst was found in, not in place of it.
  const sepChar = process.platform === "win32" ? ";" : ":";
  const env = { ...py.env, PYTHONPATH: py.env.PYTHONPATH ? `${ownDeps}${sepChar}${py.env.PYTHONPATH}` : ownDeps };
  if (pip.status === 0 && spawnSync(py.bin, ["-c", BLACK_PROBE], { env }).status === 0) return { ok: true, env };
  return { ok: false, env: py.env, error: `could not install black >= 24: editing will be refused until it is importable (${py.bin} -m pip install --target "${ownDeps}" "black>=24")` };
}
