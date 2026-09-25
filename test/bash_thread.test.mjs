// M-LANG2b (PLAN-M-LANG.md) — bash thread extraction + discovery contract.
// The SAME extract_thread.py as Python walks the bash IR (its non-python
// branch trusts frontend-stamped effectKind); snapshot regen via
// scripts/regen_bash.sh, never hand-edit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(ROOT, "test", "fixtures", "bash", "deploy_demo");
const IR_SNAPSHOT = join(FIXTURE, "deploy_demo.ir.json");
const THREAD_SNAPSHOT = join(FIXTURE, "deploy_demo.thread.json");

const files = JSON.parse(readFileSync(IR_SNAPSHOT, "utf-8"));

function extractThreads() {
  const payload = JSON.stringify({
    files,
    seeds: [{ seedFile: "deploy.sh", seedId: "module/main.fn", entryPointId: "deploy.sh:main" }],
  });
  const r = spawnSync("python3", [join(ROOT, "scripts", "extract_thread.py"), "--batch-seeds"], {
    input: payload, encoding: "utf-8", cwd: ROOT,
    env: { ...process.env, PYTHONPATH: join(ROOT, ".pydeps") },
  });
  assert.equal(r.status, 0, `extract_thread failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const out = extractThreads();
const thread = out.threads[0];

test("bash thread output matches deploy_demo.thread.json (snapshot)", () => {
  const snapshot = JSON.parse(readFileSync(THREAD_SNAPSHOT, "utf-8"));
  assert.deepEqual(out, snapshot,
    "extractor output drifted — regen via scripts/regen_bash.sh if intentional");
});

test("PARITY: step nodes carry the authored doc line as their preview (the python behaviour)", () => {
  const byId = Object.fromEntries(thread.nodes.map((n) => [n.id, n]));
  assert.equal(byId["deploy.sh:upload"].preview,
    "Upload the tarball to the target environment (staging|canary|prod).");
  assert.equal(byId["lib/common.sh:log_step"].preview,
    "Log one deploy step to stdout and syslog.");
  assert.equal(byId["deploy.sh:main"].preview,
    "Build, upload everywhere, record the release, then run the deploy hook.");
});

test("thread walks INTO the sourced file (cross-file project steps)", () => {
  const stepIds = thread.nodes.filter((n) => n.kind === "step").map((n) => n.id);
  assert.ok(stepIds.includes("lib/common.sh:log_step"), "log_step is a step, not a terminal");
  assert.ok(stepIds.includes("lib/common.sh:fetch_status"));
  assert.deepEqual(thread.filesReached.sort(), ["deploy.sh", "lib/common.sh"]);
});

test("external terminals carry the frontend-stamped effectKind", () => {
  const byId = Object.fromEntries(thread.nodes.map((n) => [n.id, n]));
  assert.equal(byId["external:curl"].effectKind, "http");
  assert.equal(byId["external:psql"].effectKind, "db");
  assert.equal(byId["external:rm"].effectKind, "fs");
  assert.equal(byId["external:ssh"].effectKind, "subprocess");
  assert.equal(byId["external:logger"].effectKind, "log");
});

test("dynamic honesty: $CMD and eval are dynamic, never unresolved/subprocess", () => {
  const dyn = thread.nodes.filter((n) => n.kind === "dynamic").map((n) => n.id).sort();
  assert.deepEqual(dyn, ['dynamic:"$HOOK_CMD"', "dynamic:eval"]);
  assert.equal(thread.nodes.filter((n) => n.kind === "unresolved").length, 0,
    "nothing in this fixture is a genuine resolution gap");
});

test("containers render: if arms, for, while, and the seed return", () => {
  const kinds = new Set(
    thread.nodes.filter((n) => n.kind === "container").map((n) => n.containerKind),
  );
  for (const k of ["if_then", "if_else", "for", "while"]) {
    assert.ok(kinds.has(k), `missing container kind ${k}`);
  }
  assert.ok(thread.nodes.some((n) => n.kind === "return"), "seed return terminal");
});

test("discover_bash: shebang + main-pattern → one shell cli entry", () => {
  const r = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "frontends", "bash", "discover_bash.mjs")],
    { input: JSON.stringify({ files }), encoding: "utf-8", cwd: ROOT },
  );
  assert.equal(r.status, 0, r.stderr);
  const { entryPoints } = JSON.parse(r.stdout);
  assert.equal(entryPoints.length, 1, "lib/common.sh (no shebang, no main) must NOT be an entry");
  const ep = entryPoints[0];
  assert.equal(ep.id, "deploy.sh:main");
  assert.equal(ep.kind, "cli");
  assert.equal(ep.framework, "shell");
  assert.equal(ep.irNodeId, "module/main.fn");
});
