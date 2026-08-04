// NEXT-ACTIONS §2 (project-env awareness) — check_project_deps.py.
//
//   1. A declared third-party import that is NOT importable from .pydeps
//      is reported, with the declaring files.
//   2. stdlib imports, project-local modules (both `import local` and
//      `from local import x`), and relative imports are never reported.
//   3. Installed third-party deps (libcst lives in .pydeps by contract)
//      are never reported.
//   4. Contract: garbage stdin still exits 0 with {"missing": []}.
//
// The IR input is built live via parse_cst.py --batch on a synthetic
// two-file project, so the test exercises the real import-node shapes.
//
// Run: npm run test:check-deps

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));
const PARSE = join(ROOT, "scripts", "parse_cst.py");
const CHECK = join(ROOT, "scripts", "check_project_deps.py");
const PYDEPS = join(ROOT, ".pydeps");
const ENV = { ...process.env, PYTHONPATH: PYDEPS };

const APP_PY = `\
import os
import json
import libcst
import totally_absent_pkg_zz
from another_absent_pkg_zz.sub import thing
from helpers import helper
from . import sibling

def main():
    helper()
`;

const HELPERS_PY = `\
import totally_absent_pkg_zz

def helper():
    return 1
`;

function parseProject(files) {
  const dir = mkdtempSync(join(tmpdir(), "vg-deps-"));
  try {
    const abs = {};
    for (const [rel, src] of Object.entries(files)) {
      const p = join(dir, rel);
      writeFileSync(p, src);
      abs[rel] = p;
    }
    // --batch reads newline-delimited `<path>\t<modulePath>` pairs.
    const r = spawnSync("python3", [PARSE, "--batch"], {
      env: ENV,
      encoding: "utf-8",
      cwd: ROOT,
      input: Object.entries(abs)
        .map(([rel, p]) => `${p}\t${rel.replace(/\.py$/, "")}`)
        .join("\n") + "\n",
    });
    assert.equal(r.status, 0, `parse failed: ${r.stderr}`);
    const parsed = JSON.parse(r.stdout);
    // Re-key from absolute temp paths back to project-relative, matching
    // what the server's relativeProjectFiles() hands the check script.
    const rel = {};
    for (const [relName, absPath] of Object.entries(abs)) {
      rel[relName] = parsed.files[absPath];
      assert.ok(rel[relName], `no IR for ${relName}`);
    }
    return rel;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function check(files) {
  const r = spawnSync("python3", [CHECK], {
    env: ENV,
    encoding: "utf-8",
    cwd: ROOT,
    input: JSON.stringify({ files }),
  });
  assert.equal(r.status, 0, `check failed: ${r.stderr}`);
  return JSON.parse(r.stdout).missing;
}

test("missing third-party imports are reported with their declaring files", () => {
  const files = parseProject({ "app.py": APP_PY, "helpers.py": HELPERS_PY });
  const missing = check(files);
  const byModule = Object.fromEntries(missing.map((m) => [m.module, m]));

  assert.ok(byModule.totally_absent_pkg_zz, "plain `import x` of an absent package not flagged");
  assert.deepEqual(
    byModule.totally_absent_pkg_zz.files.sort(),
    ["app.py", "helpers.py"],
    "declaring files should be aggregated across the project",
  );
  assert.ok(byModule.another_absent_pkg_zz, "`from x.sub import y` of an absent package not flagged");
});

test("stdlib, local modules, relative imports, and installed deps are never reported", () => {
  const files = parseProject({ "app.py": APP_PY, "helpers.py": HELPERS_PY });
  const missing = check(files).map((m) => m.module);

  assert.ok(!missing.includes("os"), "stdlib `os` flagged");
  assert.ok(!missing.includes("json"), "stdlib `json` flagged");
  assert.ok(!missing.includes("helpers"), "project-local `helpers` flagged");
  assert.ok(!missing.includes("libcst"), "installed (.pydeps) `libcst` flagged");
  // The relative `from . import sibling` has an empty module field — it
  // must not synthesize any probe at all.
  assert.equal(missing.filter((m) => m === "").length, 0);
});

test("contract: garbage stdin still exits 0 with an empty missing list", () => {
  const r = spawnSync("python3", [CHECK], {
    env: ENV,
    encoding: "utf-8",
    cwd: ROOT,
    input: "not json at all {",
  });
  assert.equal(r.status, 0, "must never fail the parse pipeline");
  assert.deepEqual(JSON.parse(r.stdout), { missing: [] });
});
