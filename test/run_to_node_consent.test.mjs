// M-RUN SM3 — the consented side-effect run, end to end at the composition
// level (mirrors run_to_node.test.mjs; does not boot the server). Composes the
// real pieces: scan --list-effects -> mint/verify consent (effect_consent) ->
// run harness. Asserts the five gate-review requirements that are testable
// without the WS layer:
//   - req1: the scan lists the detected effects ({kind,effectKind,target,...});
//   - req2: consent is scope-bound — a valid token authorizes, no token refuses;
//   - req3: stop-at-N bounds the effect set (an effect AFTER N is not listed);
//   - req5: a consented run that crashes is the PROGRAM's behaviour (runtime-error).
// (req4, two distinct consents, is a UI concern — covered by the wiring.)
//
// Run: npm run test:run-to-node-consent

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mintEffectConsent, verifyEffectConsent } from "../src/server/run/effect_consent.ts";

const ROOT = process.cwd();
const PARSE = path.join(ROOT, "scripts", "parse_cst.py");
const SCAN = path.join(ROOT, "scripts", "scan_effects.py");
const REWRITE = path.join(ROOT, "scripts", "cst_rewrite.py");
const RUN_TO_NODE = path.join(ROOT, "scripts", "run_to_node.py");
const PYENV = { ...process.env, PYTHONPATH: `${path.join(ROOT, ".pydeps")}:${process.env.PYTHONPATH ?? ""}` };

const md5 = (s) => createHash("md5").update(s).digest("hex");
const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };

function parseFixture(relPath, name) {
  const out = execFileSync("python3", [PARSE, path.join(ROOT, relPath), "--module-path", name.replace(/\.py$/, "")], { env: PYENV }).toString();
  return { [name]: JSON.parse(out) };
}
const findAssign = (ir, v) => ir.nodes.find((n) => n.type === "assignment" && n.name === v).id;

function scanListEffects(files, stopFile, stopId) {
  const out = execFileSync("python3", [SCAN, "--stop-file", stopFile, "--stop-id", stopId, "--list-effects"],
    { input: JSON.stringify({ files }), env: PYENV }).toString();
  return JSON.parse(out);
}

function dryRun(file, op, nodeId, stdin) {
  const args = nodeId ? [file, op, nodeId, "--dry-run"] : [file, op, "--dry-run"];
  const out = execFileSync("python3", [REWRITE, ...args], { input: stdin, env: PYENV }).toString();
  if (out.trim().startsWith("{")) { const j = JSON.parse(out.trim()); if (j.success === false) return { error: j.error }; }
  return { source: out };
}

// Run the no-arg path-to-N harness on `src` (clean-tree asserted).
function runHarness(src, nodeId, exprN, entryFn) {
  const realFile = path.join(os.tmpdir(), `vg-consent-${process.pid}-${Math.abs(hash(src))}.py`);
  fs.writeFileSync(realFile, src, "utf-8");
  const before = md5(fs.readFileSync(realFile, "utf-8"));
  let result, tmp;
  try {
    const r1 = dryRun(realFile, "insert_after", nodeId, `print("__VG__::" + __import__("json").dumps(repr(${exprN})))\nraise _VGStop()`);
    if (r1.error) { result = { outcome: "unsupported-target", error: r1.error }; }
    else {
      tmp = path.join(os.tmpdir(), `vg-consentrun-${process.pid}-${Math.abs(hash(src))}.py`);
      fs.writeFileSync(tmp, r1.source, "utf-8");
      const scaffold = `\n\nclass _VGStop(BaseException):\n    pass\n\n\ntry:\n    ${entryFn}()\n    print("__VG_DONE__")\nexcept _VGStop:\n    pass\n`;
      const r2 = dryRun(tmp, "append_end", null, scaffold);
      fs.writeFileSync(tmp, r2.source, "utf-8");
      result = JSON.parse(execFileSync("python3", [RUN_TO_NODE, tmp], { env: PYENV }).toString());
    }
  } finally {
    assert.equal(md5(fs.readFileSync(realFile, "utf-8")), before, "clean-tree");
    try { fs.unlinkSync(realFile); } catch {}
    if (tmp) try { fs.unlinkSync(tmp); } catch {}
  }
  return result;
}

test("req1+req3: scan lists the before-N effect and EXCLUDES the after-N one", () => {
  const files = parseFixture("test/fixtures/run_effects/consented_effect.py", "consented_effect.py");
  const stopId = findAssign(files["consented_effect.py"], "x");
  const scan = scanListEffects(files, "consented_effect.py", stopId);
  assert.equal(scan.pure, false);
  assert.equal(scan.offenses.length, 1, `only the before-N effect should be listed: ${JSON.stringify(scan.offenses)}`);
  assert.equal(scan.offenses[0].kind, "effect");
  assert.equal(scan.offenses[0].effectKind, "log");
  assert.equal(scan.offenses[0].target, "logging.info");
});

test("req2: a scope-bound consent authorizes; no token refuses", () => {
  const files = parseFixture("test/fixtures/run_effects/consented_effect.py", "consented_effect.py");
  const stopId = findAssign(files["consented_effect.py"], "x");
  const { offenses } = scanListEffects(files, "consented_effect.py", stopId);
  const token = mintEffectConsent(stopId, offenses);
  assert.equal(verifyEffectConsent(stopId, offenses, token), true, "valid scoped token authorizes");
  assert.equal(verifyEffectConsent(stopId, offenses, undefined), false, "no token refuses (no blanket run)");
});

test("req2: consented run executes the effect and captures N honestly", () => {
  const src = fs.readFileSync(path.join(ROOT, "test/fixtures/run_effects/consented_effect.py"), "utf-8");
  const files = parseFixture("test/fixtures/run_effects/consented_effect.py", "consented_effect.py");
  const stopId = findAssign(files["consented_effect.py"], "x");
  const { offenses } = scanListEffects(files, "consented_effect.py", stopId);
  // The gate would only run because a valid scoped consent verifies here.
  assert.equal(verifyEffectConsent(stopId, offenses, mintEffectConsent(stopId, offenses)), true);
  const r = runHarness(src, stopId, "x", "main");
  assert.equal(r.outcome, "ok");
  assert.equal(r.value, "4");
});

test("req5: a consented run that crashes is reported as the PROGRAM's behaviour", () => {
  const src = fs.readFileSync(path.join(ROOT, "test/fixtures/run_effects/consented_crash.py"), "utf-8");
  const files = parseFixture("test/fixtures/run_effects/consented_crash.py", "consented_crash.py");
  const stopId = findAssign(files["consented_crash.py"], "z");
  const { offenses } = scanListEffects(files, "consented_crash.py", stopId);
  const token = mintEffectConsent(stopId, offenses);
  assert.equal(verifyEffectConsent(stopId, offenses, token), true);
  const r = runHarness(src, stopId, "z", "main");
  assert.equal(r.outcome, "runtime-error");
  assert.match(r.stderr || r.error || "", /ZeroDivisionError/);
});
