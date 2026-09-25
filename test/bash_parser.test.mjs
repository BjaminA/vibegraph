// M-LANG2a (PLAN-M-LANG.md) — bash frontend snapshot + contract test.
// Mirrors test/parser.test.mjs: spawn the frontend against the committed
// fixture, byte-compare to the committed snapshot (regen via
// scripts/regen_bash.sh, never hand-edit), Ajv-validate every member
// against the SAME schemas/ir.schema.json as Python, then pin the
// mapping decisions the arc plan names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FRONTEND = join(ROOT, "scripts", "frontends", "bash", "parse_bash.mjs");
const LINKER = join(ROOT, "scripts", "frontends", "bash", "link_bash.mjs");
const FIXTURE = join(ROOT, "test", "fixtures", "bash", "deploy_demo");
const SNAPSHOT = join(FIXTURE, "deploy_demo.ir.json");
const BROKEN = join(ROOT, "test", "fixtures", "bash", "broken", "broken.sh");
const NODE_ID = /^module(\/[^/]+)*$/;

function runPipe(cmd, args, input, opts = {}) {
  const r = spawnSync(cmd, args, { input, encoding: "utf-8", cwd: ROOT, ...opts });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

function parseAndLink() {
  const batchOut = runPipe(
    process.execPath, [FRONTEND, "--batch"],
    "deploy.sh\tdeploy.sh\nlib/common.sh\tlib/common.sh\n",
    { cwd: FIXTURE },
  );
  const { files, errors } = JSON.parse(batchOut);
  assert.deepEqual(errors, {}, "fixture must parse without drops");
  const linked = runPipe(process.execPath, [LINKER], JSON.stringify({ files }));
  return JSON.parse(linked).files;
}

const files = parseAndLink();

test("bash frontend output matches deploy_demo.ir.json (snapshot)", () => {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  assert.deepEqual(files, snapshot,
    "frontend output drifted from the committed snapshot — regen via scripts/regen_bash.sh if intentional");
});

test("every deploy_demo IR validates against ir.schema.json at 2.0", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "schemas", "ir.schema.json"), "utf-8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  for (const [fname, ir] of Object.entries(files)) {
    assert.equal(ir.version, "2.0", `${fname}: bash frontend emits IR 2.0`);
    assert.equal(ir.language, "bash", `${fname}: language discriminator`);
    assert.ok(validate(ir), `${fname}: ${JSON.stringify(validate.errors)}`);
    for (const n of ir.nodes) {
      assert.match(n.id, NODE_ID, `${fname}: ${n.id} violates the ID grammar`);
    }
  }
});

test("source lib/common.sh links: cross-file reference edges land", () => {
  const dep = files["deploy.sh"];
  const xf = dep.edges.filter((e) => e.type === "reference" && e.targetFile === "lib/common.sh");
  const targets = xf.map((e) => e.qualifiedTarget).sort();
  assert.deepEqual(targets, ["lib/common.sh:fetch_status", "lib/common.sh:log_step"]);
  // and each edge's target node really exists in the target file
  const commonIds = new Set(files["lib/common.sh"].nodes.map((n) => n.id));
  for (const e of xf) assert.ok(commonIds.has(e.target), `${e.target} missing in lib/common.sh`);
});

test("effect vocabulary: curl→http, psql→db, rm→fs, echo→log, ssh→subprocess default", () => {
  const dep = files["deploy.sh"];
  const byName = (fn) => dep.nodes.filter((n) => n.type === "call" && n.funcName === fn);
  assert.equal(byName("curl")[0].effectKind, "http");
  assert.equal(byName("psql")[0].effectKind, "db");
  assert.equal(byName("rm")[0].effectKind, "fs");
  assert.equal(byName("echo")[0].effectKind, "log");
  // unresolved bare word = external command: the honest bash default
  assert.equal(byName("ssh")[0].effectKind, "subprocess");
  // but grep (pipeline stage, unresolved) also defaults — pin one pipeline stage
  assert.equal(byName("grep")[0].effectKind, "subprocess");
});

test("dynamic honesty: $CMD and eval calls carry NO effectKind and no resolution", () => {
  const dep = files["deploy.sh"];
  const dyn = dep.nodes.filter(
    (n) => n.type === "call" && (n.funcName.includes("$") || n.funcName === "eval"),
  );
  assert.equal(dyn.length, 2, "the \"$HOOK_CMD\" call and the eval call");
  const refSources = new Set(dep.edges.filter((e) => e.type === "reference").map((e) => e.source));
  for (const n of dyn) {
    assert.equal(n.effectKind, undefined, `${n.funcName} must stay unstamped (dynamic, not subprocess)`);
    assert.ok(!refSources.has(n.id), `${n.funcName} must not resolve`);
  }
});

test("project-function calls resolve, never default to subprocess", () => {
  const dep = files["deploy.sh"];
  const refSources = new Set(dep.edges.filter((e) => e.type === "reference").map((e) => e.source));
  for (const fn of ["prepare", "upload", "record_release", "watch_logs", "main", "log_step", "fetch_status"]) {
    const call = dep.nodes.find((n) => n.type === "call" && n.funcName === fn);
    assert.ok(call, `call to ${fn} exists`);
    assert.equal(call.effectKind, undefined, `${fn} is a project function, not an external command`);
    assert.ok(refSources.has(call.id), `${fn} call carries a reference edge`);
  }
});

test("PARITY: derived params, comment docstrings, structured assignment args", () => {
  const dep = files["deploy.sh"];
  const upload = dep.nodes.find((n) => n.type === "function_def" && n.name === "upload");
  assert.deepEqual(upload.params, ["$1"], "positional usage derives the parameter list");
  assert.equal(upload.docstring, "Upload the tarball to the target environment (staging|canary|prod).");
  const main = dep.nodes.find((n) => n.type === "function_def" && n.name === "main");
  assert.equal(main.docstring, "Build, upload everywhere, record the release, then run the deploy hook.");
  const logStep = files["lib/common.sh"].nodes.find((n) => n.name === "log_step");
  assert.deepEqual(logStep.params, ["$1"]);
  assert.equal(logStep.docstring, "Log one deploy step to stdout and syslog.");
  // undocumented functions stay honestly null — absence is not invented
  const fetchStatus = files["lib/common.sh"].nodes.find((n) => n.name === "fetch_status");
  assert.equal(fetchStatus.docstring, null);
  // $(date +%s) carries its args like Python's call-valued assignments
  const stamp = dep.nodes.find((n) => n.name === "BUILD_STAMP");
  assert.deepEqual(stamp.args, ["+%s"]);
  // and the symbol signature says what the body consumes
  const sym = dep.symbolIndex.find((s) => s.name === "upload");
  assert.equal(sym.signature, "upload($1)");
});

test("pipeline stages carry data edges in order", () => {
  const dep = files["deploy.sh"];
  const dataEdges = dep.edges.filter((e) => e.type === "data");
  const byId = new Map(dep.nodes.map((n) => [n.id, n]));
  const chain = dataEdges.map((e) => `${byId.get(e.source).funcName}→${byId.get(e.target).funcName}`);
  assert.deepEqual(chain, ["fetch_status→grep", "grep→tee"]);
});

test("linker is idempotent (M26.1 contract)", () => {
  const relinked = JSON.parse(
    runPipe(process.execPath, [LINKER], JSON.stringify({ files })),
  ).files;
  assert.deepEqual(relinked, files, "re-linking linked output must change nothing");
});

test("broken file: unparseable region dropped + reported, healthy constructs kept", async () => {
  const r = spawnSync(process.execPath, [FRONTEND, BROKEN], { encoding: "utf-8", cwd: ROOT });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /dropped 1 unparseable construct/);
  const ir = JSON.parse(r.stdout);
  const ids = ir.nodes.map((n) => n.id);
  assert.ok(ids.includes("module/healthy.fn"), "healthy fn swallowed by the ERROR node is recovered");
  assert.ok(!ids.some((id) => id.includes("case")), "no garbage from the broken region");
});
