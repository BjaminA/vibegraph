// One-shot helper to regenerate the project envelope snapshots
// (`*.project.json`) when the underlying per-file IRs change shape.
//
// Mirrors buildEnvelope in test/project_ir.test.mjs verbatim: pipe
// per-file IRs through discover_entry_points.py + extract_thread.py
// --batch-seeds, then write { version, files, symbolIndex, entryPoints,
// threads } to the fixture's .project.json.
//
// Run after `scripts/regen_link_fixtures.py` so the embedded per-file
// IRs are themselves up to date.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));

const DISCOVER = join(ROOT, "scripts", "discover_entry_points.py");
const EXTRACT = join(ROOT, "scripts", "extract_thread.py");
const SYSTEM = join(ROOT, "scripts", "build_system_tier.py");
const PYDEPS = join(ROOT, ".pydeps");

const FIXTURES = [
  {
    name: "aero_demo",
    ir: join(ROOT, "test", "fixtures", "threads", "aero_demo", "aero_demo.ir.json"),
    out: join(ROOT, "test", "fixtures", "threads", "aero_demo", "aero_demo.project.json"),
    root: join(ROOT, "test", "fixtures", "threads", "aero_demo"),
    manualSeeds: null,
  },
  {
    name: "flask_demo",
    ir: join(ROOT, "test", "fixtures", "threads", "flask_demo", "flask_demo.ir.json"),
    out: join(ROOT, "test", "fixtures", "threads", "flask_demo", "flask_demo.project.json"),
    root: join(ROOT, "test", "fixtures", "threads", "flask_demo"),
    manualSeeds: join(ROOT, "test", "fixtures", "threads", "flask_demo", ".vibegraph", "manual_seeds.json"),
  },
  {
    name: "system_demo",
    ir: join(ROOT, "test", "fixtures", "system", "system_demo", "system_demo.ir.json"),
    out: join(ROOT, "test", "fixtures", "system", "system_demo", "system_demo.project.json"),
    root: join(ROOT, "test", "fixtures", "system", "system_demo"),
    manualSeeds: join(ROOT, "test", "fixtures", "system", "system_demo", ".vibegraph", "manual_seeds.json"),
  },
  {
    name: "library_only",
    ir: join(ROOT, "test", "fixtures", "system", "library_only", "library_only.ir.json"),
    out: join(ROOT, "test", "fixtures", "system", "library_only", "library_only.project.json"),
    root: join(ROOT, "test", "fixtures", "system", "library_only"),
    manualSeeds: null,
  },
];

function buildEnvelope(files, manualSeedsPath = null, projectRoot = null) {
  const symbolIndex = [];
  for (const ir of Object.values(files)) {
    if (ir.symbolIndex) symbolIndex.push(...ir.symbolIndex);
  }
  const discArgs = [DISCOVER];
  if (manualSeedsPath) discArgs.push("--manual-seeds", manualSeedsPath);
  const dr = spawnSync("python3", discArgs, {
    env: { ...process.env, PYTHONPATH: PYDEPS },
    encoding: "utf-8",
    cwd: ROOT,
    input: JSON.stringify({ files }),
  });
  if (dr.status !== 0) throw new Error(`discover failed: ${dr.stderr}`);
  const entryPoints = JSON.parse(dr.stdout).entryPoints;
  const seeds = entryPoints.map((e) => ({
    seedFile: e.file,
    seedId: e.irNodeId,
    entryPointId: e.id,
  }));
  const er = spawnSync("python3", [EXTRACT, "--batch-seeds"], {
    env: { ...process.env, PYTHONPATH: PYDEPS },
    encoding: "utf-8",
    cwd: ROOT,
    input: JSON.stringify({ files, seeds }),
  });
  if (er.status !== 0) throw new Error(`extract failed: ${er.stderr}`);
  const threads = JSON.parse(er.stdout).threads;

  // M19.1 — roll threads + effectKind + entryPoints up into the system tier.
  const sr = spawnSync("python3", [SYSTEM], {
    env: { ...process.env, PYTHONPATH: PYDEPS },
    encoding: "utf-8",
    cwd: ROOT,
    input: JSON.stringify({ files, entryPoints, threads, projectRoot }),
  });
  if (sr.status !== 0) throw new Error(`system-tier build failed: ${sr.stderr}`);
  const system = JSON.parse(sr.stdout).system;

  return { version: "2.1", files, symbolIndex, entryPoints, threads, system };
}

for (const { name, ir, out, root, manualSeeds } of FIXTURES) {
  process.stderr.write(`regenerating ${out.replace(ROOT + "/", "")}…\n`);
  const files = JSON.parse(readFileSync(ir, "utf-8"));
  const envelope = buildEnvelope(files, manualSeeds, root);
  writeFileSync(out, JSON.stringify(envelope, null, 2) + "\n");
}
process.stderr.write("done.\n");
