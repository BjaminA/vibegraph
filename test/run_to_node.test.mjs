// M-RUN SM1 — the deterministic test-run harness contract.
//
// Mirrors exactly what server.ts runThreadToNodeCore composes: inject a capture
// probe after node N via op_insert_after (--dry-run), append the _VGStop scaffold
// via op_append_end (--dry-run), run the patched temp module via run_to_node.py.
// The REAL fixture file must be byte-identical after every run (clean-tree by
// construction — the load-bearing safety property), INCLUDING runs that throw.
//
// Run: npm run test:run-to-node

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const REWRITE = path.join(ROOT, "scripts", "cst_rewrite.py");
const RUN_TO_NODE = path.join(ROOT, "scripts", "run_to_node.py");
const PYENV = { ...process.env, PYTHONPATH: `${path.join(ROOT, ".pydeps")}:${process.env.PYTHONPATH ?? ""}` };

const md5 = (s) => createHash("md5").update(s).digest("hex");

function dryRun(file, op, nodeId, stdin) {
  const args = nodeId ? [file, op, nodeId, "--dry-run"] : [file, op, "--dry-run"];
  const out = execFileSync("python3", [REWRITE, ...args], { input: stdin, env: PYENV }).toString();
  if (out.trim().startsWith("{")) {
    const j = JSON.parse(out.trim());
    if (j.success === false) return { error: j.error };
  }
  return { source: out };
}

// Run the full harness on `src` for node `nodeId`, capturing `exprN` in `entryFn`.
// Asserts the on-disk fixture is byte-identical before/after (clean-tree).
function harness(src, nodeId, exprN, entryFn) {
  const realFile = path.join(os.tmpdir(), `vg-fix-${process.pid}-${Math.abs(hash(src))}.py`);
  fs.writeFileSync(realFile, src, "utf-8");
  const before = md5(fs.readFileSync(realFile, "utf-8"));
  let result, tmp;
  try {
    const probe = `print("__VG__::" + __import__("json").dumps(repr(${exprN})))\nraise _VGStop()`;
    const r1 = dryRun(realFile, "insert_after", nodeId, probe);
    if (r1.error) { result = { outcome: "unsupported-target", error: r1.error }; }
    else {
      tmp = path.join(os.tmpdir(), `vg-run-${process.pid}-${Math.abs(hash(src))}.py`);
      fs.writeFileSync(tmp, r1.source, "utf-8");
      const scaffold = `\n\nclass _VGStop(BaseException):\n    pass\n\n\ntry:\n    ${entryFn}()\n    print("__VG_DONE__")\nexcept _VGStop:\n    pass\n`;
      const r2 = dryRun(tmp, "append_end", null, scaffold);
      fs.writeFileSync(tmp, r2.source, "utf-8");
      result = JSON.parse(execFileSync("python3", [RUN_TO_NODE, tmp], { env: PYENV }).toString());
    }
  } finally {
    const after = md5(fs.readFileSync(realFile, "utf-8"));
    // CLEAN-TREE: the real fixture file is byte-identical after the run.
    assert.equal(after, before, "clean-tree: real file was modified by the run");
    try { fs.unlinkSync(realFile); } catch {}
    if (tmp) try { fs.unlinkSync(tmp); } catch {}
  }
  return result;
}

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

test("ok: captures the value at N, clean tree", () => {
  const src = "def compute():\n    a = 2 + 3\n    b = a * a\n    return b\n";
  const r = harness(src, "module/compute.fn/b.assign", "b", "compute");
  assert.equal(r.outcome, "ok");
  assert.equal(r.value, "25");
  assert.equal(r.valueOpaque, false);
});

test("clean-tree holds even when the path THROWS mid-execution", () => {
  // N is captured, then user code after it would raise — but stop-at-N halts
  // first. Either way the real file must be byte-identical (asserted in harness).
  const src = 'def compute():\n    x = 7\n    raise ValueError("boom")\n';
  const r = harness(src, "module/compute.fn/x.assign", "x", "compute");
  assert.equal(r.outcome, "ok");      // stop-at-N fires before the raise
  assert.equal(r.value, "7");
});

test("a module's own `if __name__ == \"__main__\"` guard never fires (no _VGStop NameError)", () => {
  // The analyzed module invokes its entry under a __main__ guard. Run as
  // __main__ that block fired BEFORE the appended `_VGStop` class existed, so
  // the probe's `raise _VGStop()` died with `NameError: _VGStop is not
  // defined` and the captured value came back wrapped in a spurious traceback
  // (the pump-lab evaluate_holdout symptom). The harness now runs the module
  // under a synthetic name, so ONLY the appended scaffold drives execution.
  const src = [
    "def evaluate():",
    "    x = 41 + 1",
    "    return x",
    "",
    "",
    'if __name__ == "__main__":',
    "    evaluate()",
    "",
  ].join("\n");
  const r = harness(src, "module/evaluate.fn/x.assign", "x", "evaluate");
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.equal(r.value, "42");
  // The load-bearing assertion: no sentinel leak in the captured output.
  assert.doesNotMatch(r.stderr ?? "", /_VGStop|NameError/, "the __main__ guard leaked _VGStop");
});

test("probe-not-reached: N behind an untaken branch", () => {
  const src = "def compute():\n    if False:\n        y = 1\n    return 0\n";
  // The assignment inside the if won't be on the executed path.
  const r = harness(src, "module/compute.fn/if@0/y.assign", "y", "compute");
  assert.equal(r.outcome, "probe-not-reached");
  assert.equal(r.value, null);
});

test("import-error: a dependency not in the env, reported honestly (never blank)", () => {
  const src = "import definitely_not_real_pkg_xyz as _z\n\n\ndef compute():\n    a = 1\n    return a\n";
  const r = harness(src, "module/compute.fn/a.assign", "a", "compute");
  assert.equal(r.outcome, "import-error");
  assert.ok(r.stderr && r.stderr.length > 0, "stderr must surface the import failure");
});

test("stop-not-enforced: a bare except swallows the BaseException stop → reports ran-past-N", () => {
  const src = [
    "def compute():",
    "    a = 5",
    "    try:",
    "        a = a + 1",
    "        b = a",   // N here; after capture, _VGStop raised, swallowed below
    "    except BaseException:",
    "        pass",
    "    return a",
    "",
  ].join("\n");
  const r = harness(src, "module/compute.fn/try@0/b.assign", "b", "compute");
  assert.equal(r.outcome, "stop-not-enforced");
});

test("unsupported-target: N in a one-line compound body declines (no IndentedBlock to rebuild)", () => {
  // `if True: x = 5` is a one-line suite, not an IndentedBlock — op_insert_after
  // cannot place a sibling statement, so the harness declines honestly.
  const src = "def compute():\n    if True: x = 5\n    return x\n";
  const r = harness(src, "module/compute.fn/if@0/x.assign", "x", "compute");
  assert.equal(r.outcome, "unsupported-target");
});

test("value-opaque: a non-deterministic repr (memory address) is flagged, not snapshotted", () => {
  // Black-clean source (2 blank lines) so the probe-injection diff stays confined.
  const src = "class Thing:\n    pass\n\n\ndef compute():\n    t = Thing()\n    return t\n";
  const r = harness(src, "module/compute.fn/t.assign", "t", "compute");
  assert.equal(r.outcome, "value-opaque");
  assert.equal(r.valueOpaque, true);
});

// ── M-RUN3 — capture_probe harness: returns and bare calls capture their value ──
// Mirrors the server's capture path: capture_probe (--dry-run) → append_end
// scaffold → run_to_node.py. Same clean-tree assertion as the classic harness.

function captureHarness(src, nodeId, entryFn) {
  const realFile = path.join(os.tmpdir(), `vg-fix3-${process.pid}-${Math.abs(hash(src))}.py`);
  fs.writeFileSync(realFile, src, "utf-8");
  const before = md5(fs.readFileSync(realFile, "utf-8"));
  let result, tmp;
  try {
    const out = execFileSync("python3", [REWRITE, realFile, "capture_probe", nodeId, "__vg_value", "--dry-run"], { env: PYENV }).toString();
    if (out.trim().startsWith("{") && JSON.parse(out.trim()).success === false) {
      result = { outcome: "unsupported-target", error: JSON.parse(out.trim()).error };
    } else {
      tmp = path.join(os.tmpdir(), `vg-run3-${process.pid}-${Math.abs(hash(src))}.py`);
      fs.writeFileSync(tmp, out, "utf-8");
      const scaffold = `\n\nclass _VGStop(BaseException):\n    pass\n\n\ntry:\n    ${entryFn}()\n    print("__VG_DONE__")\nexcept _VGStop:\n    pass\n`;
      const r2 = dryRun(tmp, "append_end", null, scaffold);
      fs.writeFileSync(tmp, r2.source, "utf-8");
      result = JSON.parse(execFileSync("python3", [RUN_TO_NODE, tmp], { env: PYENV }).toString());
    }
  } finally {
    const after = md5(fs.readFileSync(realFile, "utf-8"));
    assert.equal(after, before, "clean-tree: real file was modified by the capture run");
    try { fs.unlinkSync(realFile); } catch {}
    if (tmp) try { fs.unlinkSync(tmp); } catch {}
  }
  return result;
}

test("M-RUN3: a return statement's value is captured — real value, synthetic name only", () => {
  const src = "def evaluate():\n    score = 6\n    return score * 7\n";
  const r = captureHarness(src, "module/evaluate.fn/return@0", "evaluate");
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.equal(r.value, "42");
});

test("M-RUN3: a bare call statement captures the call's result", () => {
  const src = "def compute():\n    return \"hello\"\n\n\ndef main():\n    compute()\n";
  const r = captureHarness(src, "module/main.fn/compute.call", "main");
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.equal(r.value, "'hello'");
});

test("M-RUN3: a return inside a conditional captures when the branch is taken", () => {
  const src = "def pick(flag=True):\n    if flag:\n        return \"taken\"\n    return \"other\"\n";
  const r = captureHarness(src, "module/pick.fn/if@0/return@0", "pick");
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.equal(r.value, "'taken'");
});

// A repr is not guaranteed single-line, and the marker scan is line-based.
// Before the probe JSON-encoded its payload, a multi-line repr was silently
// cut to its first line and presented as the whole captured value — on a
// torch model that meant `WineQualityRegressor(` and nothing else. No torch
// in the test env, so a __repr__ with the same shape stands in for it.
test("M-RUN3: a MULTI-LINE repr is captured whole, not cut to its first line", () => {
  const src = [
    "class Net:",
    "    def __repr__(self):",
    '        return "Net(\\n  (fc): Linear(11, 64)\\n  (out): Linear(64, 1)\\n)"',
    "",
    "",
    "def build():",
    "    return Net()",
    "",
  ].join("\n");
  const r = captureHarness(src, "module/build.fn/return@0", "build");
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.equal(
    r.value,
    "Net(\n  (fc): Linear(11, 64)\n  (out): Linear(64, 1)\n)",
    "the full multi-line repr must survive the stdout round-trip",
  );
  assert.ok(r.value.includes("(out): Linear(64, 1)"), "the last line must not be dropped");
});

test("M-RUN3: an oversized repr is truncated with an explicit marker, never silently", () => {
  const src = [
    "class Big:",
    "    def __repr__(self):",
    '        return "x" * 9000',
    "",
    "",
    "def build():",
    "    return Big()",
    "",
  ].join("\n");
  const r = captureHarness(src, "module/build.fn/return@0", "build");
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.ok(r.value.length < 9000, "an unbounded repr must not reach the tooltip whole");
  assert.match(r.value, /truncated — 9000 chars total/,
    "the cut must announce itself and state the true size");
});
