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
//   4. dev: <repo>/.pydeps   installed: <cache>/pydeps (created on demand)
import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { PACKAGE_NAME } from "./paths.mjs";

// libcst defines no __version__ (the first probe asked for it, so every
// environment "failed" and the installer ran); the distribution metadata
// has the version, and importing the package is the fact that matters.
const PROBE = "import libcst, sys\ntry:\n    import importlib.metadata as m; v = m.version('libcst')\nexcept Exception:\n    v = 'unknown'\nsys.stdout.write(v)";

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

/**
 * @returns {{ bin: string, env: NodeJS.ProcessEnv, libcst: string, how: string }}
 * @throws when no usable python can be found or provisioned; the message
 *   carries the command a person would run.
 */
export function resolvePython(loc, { log = () => {} } = {}) {
  const bins = process.env.VG_PYTHON ? [process.env.VG_PYTHON] : ["python3", "python"];
  const explicitDeps = process.env.VIBEGRAPH_PYDEPS;
  const ownDeps = loc.mode === "dev" ? join(loc.repoRoot, ".pydeps") : join(cacheDir(), "pydeps");

  // A python that already has libcst, in any of the candidate environments.
  const envs = [
    ...(explicitDeps ? [[withPath(explicitDeps), `VIBEGRAPH_PYDEPS=${explicitDeps}`]] : []),
    [process.env, "as installed"],
    ...(existsSync(ownDeps) ? [[withPath(ownDeps), ownDeps]] : []),
  ];
  let firstBin = null;
  for (const bin of bins) {
    if (spawnSync(bin, ["--version"], { encoding: "utf-8" }).status !== 0) continue;
    firstBin ??= bin;
    for (const [env, how] of envs) {
      const v = probe(bin, env);
      if (v) return { bin, env, libcst: v, how };
    }
  }
  if (!firstBin) {
    throw new Error(`${PACKAGE_NAME}: no python interpreter found (tried ${bins.join(", ")}). Install Python 3 and libcst, or point VG_PYTHON at an interpreter.`);
  }

  // Provision libcst into the directory this package owns.
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
