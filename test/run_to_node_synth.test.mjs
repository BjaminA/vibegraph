// M-RUN SM2.c — the synthesized-input run harness, end to end at the
// composition level (mirrors run_to_node.test.mjs; does not boot the server).
//
// Proves the SM2.c assembly: validate args through check_literals.py
// (SM2.a chokepoint) -> inject `entryFn(<validated call>)` -> run the path
// to N -> capture N's value. And that a non-literal arg is REFUSED at the
// chokepoint so it never reaches injection. Clean-tree is asserted (the real
// fixture file is byte-identical after every run, including refusals).
//
// Run: npm run test:run-to-node-synth

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
const CHECK_LITERALS = path.join(ROOT, "scripts", "check_literals.py");
const PYENV = { ...process.env, PYTHONPATH: `${path.join(ROOT, ".pydeps")}:${process.env.PYTHONPATH ?? ""}` };

const md5 = (s) => createHash("md5").update(s).digest("hex");
const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };

function dryRun(file, op, nodeId, stdin) {
  const args = nodeId ? [file, op, nodeId, "--dry-run"] : [file, op, "--dry-run"];
  const out = execFileSync("python3", [REWRITE, ...args], { input: stdin, env: PYENV }).toString();
  if (out.trim().startsWith("{")) {
    const j = JSON.parse(out.trim());
    if (j.success === false) return { error: j.error };
  }
  return { source: out };
}

// The SM2.a chokepoint, as the server calls it (_validateLiterals).
function validateLiterals(args) {
  const out = execFileSync("python3", [CHECK_LITERALS], { input: JSON.stringify({ args }), env: PYENV }).toString();
  return JSON.parse(out);
}

// Full synthesized-input harness for `src`: run to `nodeId`, capturing `exprN`
// in `entryFn(<args>)`. Returns { outcome, value, provenance } or a refusal.
function synthHarness(src, nodeId, exprN, entryFn, args) {
  const realFile = path.join(os.tmpdir(), `vg-synth-${process.pid}-${Math.abs(hash(src))}.py`);
  fs.writeFileSync(realFile, src, "utf-8");
  const before = md5(fs.readFileSync(realFile, "utf-8"));
  let result, tmp;
  try {
    // Chokepoint FIRST — a bad arg never reaches injection.
    const v = validateLiterals(args);
    if (!v.ok) { result = { refused: true, rejected: v.rejected }; }
    else {
      const probe = `print("__VG__::" + __import__("json").dumps(repr(${exprN})))\nraise _VGStop()`;
      const r1 = dryRun(realFile, "insert_after", nodeId, probe);
      if (r1.error) { result = { outcome: "unsupported-target", error: r1.error }; }
      else {
        tmp = path.join(os.tmpdir(), `vg-synthrun-${process.pid}-${Math.abs(hash(src))}.py`);
        fs.writeFileSync(tmp, r1.source, "utf-8");
        const scaffold = `\n\nclass _VGStop(BaseException):\n    pass\n\n\ntry:\n    ${entryFn}(${v.call})\n    print("__VG_DONE__")\nexcept _VGStop:\n    pass\n`;
        const r2 = dryRun(tmp, "append_end", null, scaffold);
        fs.writeFileSync(tmp, r2.source, "utf-8");
        result = JSON.parse(execFileSync("python3", [RUN_TO_NODE, tmp], { env: PYENV }).toString());
        result.provenance = "synthesized-input";
        result.callUsed = v.call;
      }
    }
  } finally {
    const after = md5(fs.readFileSync(realFile, "utf-8"));
    assert.equal(after, before, "clean-tree: real file was modified by the run");
    try { fs.unlinkSync(realFile); } catch {}
    if (tmp) try { fs.unlinkSync(tmp); } catch {}
  }
  return result;
}

test("runs an arg-needing function with synthesized args; captures the value", () => {
  const src = "def compute(factor):\n    a = factor * 2\n    b = a + 1\n    return b\n";
  const r = synthHarness(src, "module/compute.fn/b.assign", "b", "compute", { factor: "3" });
  assert.equal(r.outcome, "ok");
  assert.equal(r.value, "7");                       // 3*2=6 -> a=6 -> b=7
  assert.equal(r.provenance, "synthesized-input");
  assert.equal(r.callUsed, "factor=3");
});

test("multiple params, mixed literal types", () => {
  const src = "def greet(name, times):\n    msg = name * times\n    return msg\n";
  const r = synthHarness(src, "module/greet.fn/msg.assign", "msg", "greet", { name: "'ab'", times: "2" });
  assert.equal(r.outcome, "ok");
  assert.equal(r.value, "'abab'");
  assert.equal(r.callUsed, "name='ab', times=2");
});

test("a non-literal synthesized arg is REFUSED at the chokepoint (never injected)", () => {
  const src = "def compute(factor):\n    a = factor * 2\n    b = a + 1\n    return b\n";
  const r = synthHarness(src, "module/compute.fn/b.assign", "b", "compute", { factor: "open('/etc/passwd')" });
  assert.equal(r.refused, true, "a call-valued arg must be refused before injection");
  assert.ok(r.rejected.some((x) => x.param === "factor"));
});
