/**
 * The pump-wear demo example, pinned against its README (2026-08-04).
 *
 * `examples/pump-wear` is what a new user opens first, and its README makes
 * specific claims — which launchpad groups appear, that two run-to-here
 * drills return particular values, that a third fails honestly on a missing
 * file. Nothing else in the suite touches examples/, so a parser, extractor
 * or discovery change could quietly falsify the documentation and no test
 * would notice. This is that test.
 *
 * It runs the REAL pipeline (parse_cst -> cross_file_link ->
 * discover_entry_points / extract_thread) and the REAL capture machinery
 * (cst_rewrite capture_probe -> run_to_node) over a throwaway copy, so the
 * example's own files are never touched.
 *
 * Run: npm run test:example-pump
 */
import { test, skip } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, copyFileSync, existsSync, mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXAMPLE = join(ROOT, "examples", "pump-wear");
const PYDEPS = join(ROOT, ".pydeps");
const PYENV = { ...process.env, PYTHONPATH: PYDEPS };
const CSV_SOURCE = join(EXAMPLE, "data", "pump.csv");

// The capture drills import torch. Skip LOUDLY rather than pass vacuously.
const HAVE_TORCH = spawnSync("python3", ["-c", "import torch"], { env: PYENV }).status === 0;

function py(script, args, input) {
  const r = spawnSync("python3", [join(ROOT, "scripts", script), ...args],
    { env: PYENV, encoding: "utf-8", cwd: ROOT, input, maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, `${script} failed: ${r.stderr?.slice(-400)}`);
  return r.stdout;
}

/** Parse + link the example exactly as the server does on boot. */
function linkedProject() {
  const files = {};
  for (const f of ["data.py", "metrics.py", "model.py", "predict.py", "train.py"]) {
    files[f] = JSON.parse(py("parse_cst.py", [join(EXAMPLE, f), "--module-path", f.slice(0, -3)]));
  }
  return JSON.parse(py("cross_file_link.py", [], JSON.stringify({ files }))).files;
}

/** A throwaway copy with the data in place — the example itself stays clean. */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "vg-pump-"));
  cpSync(EXAMPLE, dir, { recursive: true });
  copyFileSync(CSV_SOURCE, join(dir, "data", "pump.csv"));
  return dir;
}

/** Drive capture_probe + run_to_node the way the server's run-to-here does. */
function captureReturn(dir, file, nodeId, scaffoldCall) {
  const target = join(dir, file);
  py("cst_rewrite.py", [target, "capture_probe", nodeId, "__vg_value"]);
  appendFileSync(target,
    `\n\nclass _VGStop(BaseException):\n    pass\n\n\ntry:\n${scaffoldCall}\n    print("__VG_DONE__")\nexcept _VGStop:\n    pass\n`);
  const out = execFileSync("python3", [join(ROOT, "scripts", "run_to_node.py"), target],
    { env: PYENV, encoding: "utf-8", cwd: dir, maxBuffer: 1 << 26 });
  return JSON.parse(out);
}

test("README §3 — the launchpad groups the README documents", () => {
  const files = linkedProject();
  const eps = JSON.parse(py("discover_entry_points.py", [], JSON.stringify({ files }))).entryPoints;
  const byKind = {};
  for (const e of eps) (byKind[e.kind] ??= []).push(e.id);

  assert.deepEqual(byKind.model, ["model.py:WearMLP.forward"],
    "MODEL group: the README names WearMLP.forward");
  assert.deepEqual(byKind.cli?.sort(), ["predict.py:evaluate_holdout", "train.py:main"],
    "CLI group: the README names main and evaluate_holdout");
  for (const fn of ["data.py:load", "data.py:read_rows", "data.py:target_stats",
                    "metrics.py:r_squared", "model.py:build_model"]) {
    assert.ok(byKind.public_api?.includes(fn), `PUBLIC API group should list ${fn}`);
  }

  // The README explains predict_wear has no ROW (called only within
  // predict.py) and Standardizer.apply has no row either — both are the
  // reason the pin flow is demonstrated. If either gained one, the README
  // would be telling users to pin something that is already there.
  const ids = eps.map((e) => e.id);
  assert.ok(!ids.some((i) => i.includes("predict_wear")),
    "predict_wear must NOT be an entry point — the README explains why");
  assert.ok(!ids.some((i) => i.includes("Standardizer.apply")),
    "Standardizer.apply must NOT be an entry point — drill B pins it");
});

test("README §3 — the model is statically enumerable (Arch schematic, not one card)", () => {
  const files = linkedProject();
  const seq = files["model.py"].nodes.find((n) => n.callTarget === "nn.Sequential");
  assert.ok(seq, "model.py must build its stack with a literal nn.Sequential call");
  const layers = (seq.args ?? []).join(" ");
  for (const want of ["nn.Linear(8, 64)", "nn.ReLU()", "nn.Linear(64, 32)", "nn.Linear(32, 1)"]) {
    assert.ok(layers.includes(want), `layer ${want} must be listed literally, not splatted`);
  }
});

test("README §5C — evaluate_holdout reaches r_squared, the drill's run-to-here target", async () => {
  const files = linkedProject();
  const thread = JSON.parse(py("extract_thread.py",
    ["--seed-file", "predict.py", "--seed-id", "module/evaluate_holdout.fn"],
    JSON.stringify({ files })));
  const steps = thread.nodes.filter((n) => n.kind === "step").map((n) => n.label);
  assert.ok(steps.includes("r_squared"), `drill C targets the R² step; steps were ${steps}`);
  assert.ok(steps.includes("load_model"), "the thread must reach load_model (needs model.pt)");
});

test("README §3 — train:main wraps its epoch/batch loops in containers", () => {
  const files = linkedProject();
  const thread = JSON.parse(py("extract_thread.py",
    ["--seed-file", "train.py", "--seed-id", "module/main.fn"], JSON.stringify({ files })));
  const loops = thread.nodes.filter((n) => n.kind === "container" && n.containerKind === "for");
  assert.ok(loops.length >= 2, `expected the epoch and batch loops as containers, got ${loops.length}`);
});

test("README §5A — target_stats captures the documented real value", { skip: !HAVE_TORCH && "torch not in .pydeps" }, () => {
  const dir = sandbox();
  try {
    const r = captureReturn(dir, "data.py", "module/target_stats.fn/return@0", "    target_stats()");
    assert.equal(r.outcome, "ok", JSON.stringify(r));
    // The README prints these digits. They are the real mean/std of the
    // wear column, so a data or split change must fail here loudly.
    assert.match(r.value, /^\(34\.144/, `README documents (34.144…, 21.849…), got ${r.value}`);
    assert.match(r.value, /21\.849/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("README §5B — Standardizer.apply runs on a synthesized instance", { skip: !HAVE_TORCH && "torch not in .pydeps" }, () => {
  const dir = sandbox();
  try {
    // The instance the server would synthesize from __init__'s literal
    // defaults — re-validated through the real chokepoint first.
    const check = spawnSync("python3", [join(ROOT, "scripts", "check_literals.py"), "--mode", "instance"],
      { env: PYENV, encoding: "utf-8", input: JSON.stringify({ class: "Standardizer", args: { mean: "0.0", std: "1.0" } }) });
    assert.equal(JSON.parse(check.stdout).ok, true, "defaults must be literal enough to synthesize");

    const r = captureReturn(dir, "data.py", "module/Standardizer.class/apply.fn/return@0",
      "    _obj = Standardizer(mean=0.0, std=1.0)\n    _obj.apply(value=12.5)");
    assert.equal(r.outcome, "ok", JSON.stringify(r));
    // The README calls this out: the DEFAULT Standardizer is the identity
    // transform, so the value passes through. That is the documented
    // behaviour, not a bug — and the README tells the reader to edit `mean`.
    assert.equal(r.value, "12.5", "default Standardizer is the identity transform");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("README §5C — the missing holdout file fails honestly, naming the path", { skip: !HAVE_TORCH && "torch not in .pydeps" }, () => {
  const dir = sandbox();
  try {
    assert.ok(!existsSync(join(dir, "data", "holdout.csv")),
      "data/holdout.csv must stay absent — the drafted-example drill depends on it");
    // model.pt must exist first, or the run dies on THAT instead — which is
    // precisely why the README tells you to train before attempting drill C.
    // Untrained weights are enough; this drill is about the missing input.
    execFileSync("python3", ["-c",
      "import torch\nfrom model import build_model\ntorch.save(build_model().state_dict(), 'model.pt')"],
      { env: PYENV, cwd: dir });
    const r = spawnSync("python3", ["predict.py"], { env: PYENV, encoding: "utf-8", cwd: dir });
    assert.notEqual(r.status, 0, "evaluate_holdout must fail rather than invent a number");
    assert.match(r.stderr, /FileNotFoundError/);
    assert.match(r.stderr, /data\/holdout\.csv/,
      "the error must name the path — that is what drives the draft-an-example offer");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

if (!HAVE_TORCH) skip("torch missing from .pydeps — the three capture drills were not verified");
