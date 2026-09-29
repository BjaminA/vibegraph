// Configuration surface + coverage (2026-09-28), from the codebase-memory-mcp
// comparison on a private production codebase: environment variables as facts read from the
// parse, and a per-file coverage answer an agent asks before trusting — or
// before claiming anything is unused, untested or unconfigured.
//
//   npm run test:configuration-coverage
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildFromSource as buildJsts } from "../scripts/frontends/jsts/builder.mjs";
import { buildFromSource as buildBash } from "../scripts/frontends/bash/builder.mjs";
import { buildEnvSurface, envReadsFor, configuredByFor, formatConfiguredBy, formatEnvSurfaceMd, toolThatReads } from "../src/shared/env_surface.ts";
import { readEnvDeclarations } from "../src/server/infra_manifests.ts";
import { coverageFor, sha1 } from "../src/server/coverage.ts";
import { computeReachability } from "../src/server/reachability.ts";

const names = (ir) => (ir.envReads ?? []).map((r) => `${r.name}:${r.form}`);

test("JS/TS: member, index and destructured reads; a computed key is not a name", async () => {
  const { ir } = await buildJsts([
    "const a = process.env.OPENAI_API_KEY;",
    "const b = process.env[\"REGION\"];",
    "const { DB_URL, PORT: port } = process.env;",
    "const k = 'X'; const c = process.env[k];",
    "const d = import.meta.env.VITE_BASE;",
  ].join("\n"), "m", "ts");
  assert.deepEqual(names(ir), ["OPENAI_API_KEY:member", "REGION:index", "DB_URL:destructure", "PORT:destructure", "VITE_BASE:member"]);
  const { ir: none } = await buildJsts("const x = 1;\n", "m", "ts");
  assert.equal(none.envReads, undefined, "a file that reads nothing is byte-identical to before");
});

test("Python: os.environ[...], os.environ.get, os.getenv, the bare getenv; a runtime key is skipped", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-env-py-"));
  try {
    const f = join(dir, "m.py");
    writeFileSync(f, "import os\nfrom os import getenv\nA = os.environ['DB_URL']\nB = os.environ.get('TOKEN', 'x')\ndef f():\n    return getenv('REGION')\nk = 'DYN'\nC = os.environ[k]\n");
    const r = spawnSync("python3", ["scripts/parse_cst.py", f], { encoding: "utf-8", env: { ...process.env, PYTHONPATH: ".pydeps" } });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(names(JSON.parse(r.stdout)), ["DB_URL:index", "TOKEN:call", "REGION:call"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("bash: an UPPERCASE variable expanded and never assigned is inherited; shell and ambient ones are not", async () => {
  const { ir } = await buildBash([
    "#!/bin/bash", "SCRIPT_DIR=x", "for F in a b; do echo $F; done", "read -r NAME REST", "export OUT=1",
    "echo ${API_KEY:-none} $HOME $DB_URL $SCRIPT_DIR $NAME $1 ${lower} $IFS $OUT",
  ].join("\n") + "\n", "m");
  assert.deepEqual(names(ir), ["API_KEY:inherited", "DB_URL:inherited"]);
});

test("C++ / Rust getenv-style CALLS are read from the IR's call nodes, placed in their function", () => {
  const reads = envReadsFor("main.cpp", {
    nodes: [
      { id: "module/main.fn", type: "function_def", name: "main", line: 1, endLine: 9 },
      { id: "module/main.fn/getenv.call", type: "call", funcName: "std::getenv", args: ["\"HOME_DIR\""], line: 3 },
      { id: "module/main.fn/getenv.call@1", type: "call", funcName: "getenv", args: ["name"], line: 4 },
    ],
  });
  assert.deepEqual(reads, [{ name: "HOME_DIR", file: "main.cpp", line: 3, form: "call", fnId: "module/main.fn" }]);
});

test("declarations: every KEY= name in an env example (commented too) and compose environment keys — names only", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-env-decl-"));
  try {
    writeFileSync(join(dir, ".env.example"), "OPENAI_API_KEY=sk-not-a-real-key\n# OPTIONAL_FLAG=1\nnot a line\n");
    writeFileSync(join(dir, ".env"), "SECRET=must-never-be-read\n");
    writeFileSync(join(dir, "docker-compose.yml"), "services:\n  api:\n    image: x\n    environment:\n      - REGION=eu\n      TOKEN: abc\n    ports:\n      - 80:80\n");
    const d = readEnvDeclarations(dir);
    assert.deepEqual(d.map((x) => x.name).sort(), ["OPENAI_API_KEY", "OPTIONAL_FLAG", "REGION", "TOKEN"]);
    assert.ok(!d.some((x) => x.name === "SECRET"), "the real .env is never read");
    assert.ok(d.every((x) => Object.keys(x).sort().join() === "file,line,name"), "no value is carried");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the surface: threads that read each variable, undeclared vs declared, tool-read, sourced bash names", () => {
  const env = {
    files: {
      "app.ts": { language: "jsts", nodes: [{ id: "module/handler.fn", type: "function_def", line: 1, endLine: 5 }], envReads: [{ name: "OPENAI_API_KEY", line: 2, form: "member" }, { name: "FLAG", line: 3, form: "member" }] },
      "run.sh": { language: "bash", nodes: [], envReads: [{ name: "CACHE", line: 2, form: "inherited" }, { name: "DEBUG", line: 3, form: "inherited" }] },
      "env.sh": { language: "bash", nodes: [{ type: "assignment", name: "CACHE" }] },
    },
    threads: [
      { entryPointId: "app.ts:handler", nodes: [{ kind: "seed", file: "app.ts", irNodeId: "module/handler.fn" }] },
      { entryPointId: "run.sh:module", nodes: [{ kind: "seed", file: "run.sh", irNodeId: "module" }], filesReached: ["run.sh"] },
    ],
  };
  const s = buildEnvSurface(env, [{ name: "OPENAI_API_KEY", file: ".env.example", line: 1 }, { name: "PGUSER", file: ".env.example", line: 2 }]);
  assert.deepEqual(s.vars.map((v) => v.name), ["DEBUG", "FLAG", "OPENAI_API_KEY"], "CACHE is set by a project script (sourced), not the environment");
  assert.deepEqual(s.undeclared, ["DEBUG", "FLAG"]);
  assert.deepEqual(s.unread.map((d) => d.name), ["PGUSER"]);
  assert.equal(toolThatReads("PGUSER"), "libpq / psql");
  assert.deepEqual(s.byThread["app.ts:handler"], ["FLAG", "OPENAI_API_KEY"]);
  assert.deepEqual(s.byThread["run.sh:module"], ["DEBUG"], "a module-level read belongs to the thread that runs the file");
  assert.equal(formatConfiguredBy(configuredByFor(s, "app.ts:handler")), "Configured by: `FLAG` (NOT declared), `OPENAI_API_KEY`.");
  assert.equal(formatConfiguredBy(undefined), null);
  assert.match(formatEnvSurfaceMd(s), /read by libpq \/ psql itself: expected/);
});

test("coverage: parsed / partial / not parsed, reached + tested + env, and changed since the export", () => {
  const files = {
    "a.py": { language: "python", nodes: [{ id: "module/f.fn", type: "function_def", name: "f", line: 1 }, { id: "module/g.fn", type: "function_def", name: "g", line: 5 }], edges: [], envReads: [{ name: "TOKEN", line: 2, form: "call" }] },
    "b.ts": { language: "jsts", degraded: { dropped: 3, note: "x" }, nodes: [], edges: [] },
  };
  const env = {
    files,
    threads: [
      { entryPointId: "a.py:f", nodes: [{ kind: "seed", file: "a.py", irNodeId: "module/f.fn" }], filesReached: ["a.py"] },
      { entryPointId: "tests/test_a.py:test_f", nodes: [{ kind: "seed", file: "tests/test_a.py", irNodeId: "module/test_f.fn" }, { kind: "step", file: "a.py", irNodeId: "module/f.fn" }], filesReached: ["tests/test_a.py", "a.py"] },
    ],
    entryPoints: [{ id: "a.py:f", file: "a.py", irNodeId: "module/f.fn", kind: "cli" }, { id: "tests/test_a.py:test_f", file: "tests/test_a.py", irNodeId: "module/test_f.fn", kind: "test" }],
  };
  const contents = { "a.py": "v2", "b.ts": "b", "c.md": "doc" };
  const rows = coverageFor(["a.py", "b.ts", "c.md", "gone.py"], {
    env, reach: computeReachability(env), surface: buildEnvSurface(env, []),
    exported: { "a.py": sha1("v1"), "b.ts": sha1("b") },
    readFile: (p) => contents[p] ?? null,
  });
  const [a, b, c, gone] = rows;
  assert.equal(a.status, "parsed");
  assert.deepEqual(a.threads, ["a.py:f"]);
  assert.deepEqual(a.tests, ["tests/test_a.py:test_f"]);
  assert.deepEqual(a.functions, { defs: 2, reached: 1 });
  assert.equal(a.unreached[0].name, "g");
  assert.deepEqual(a.envVars, ["TOKEN"]);
  assert.equal(a.changedSinceExport, true);
  assert.match(a.action, /changed since the knowledge export/);
  assert.equal(b.status, "partial");
  assert.match(b.action, /3 construct\(s\) dropped/);
  assert.equal(b.changedSinceExport, false);
  assert.equal(c.status, "not-parsed");
  assert.equal(gone.action, "no such file in the project");
});

test("the export writes configuration.md and sources.json, and the coverage CLI reads the hashes back", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-cov-cli-"));
  try {
    const proj = join(dir, "fleet");
    cpSync("examples/fleet-telemetry", proj, { recursive: true });
    const env = { ...process.env, PYTHONPATH: join(process.cwd(), ".pydeps") };
    const cli = join(process.cwd(), "scripts/cli/main.mjs");
    const node = [process.execPath, "--experimental-strip-types", "--no-warnings"];
    const ex = spawnSync(node[0], [...node.slice(1), cli, "export", proj], { encoding: "utf-8", env });
    assert.equal(ex.status, 0, ex.stderr);
    const run = () => JSON.parse(spawnSync(node[0], [...node.slice(1), cli, "coverage", proj, join(proj, "telemetry/alerts.py"), "--json"], { encoding: "utf-8", env }).stdout)[0];
    assert.equal(run().changedSinceExport, false);
    writeFileSync(join(proj, "telemetry/alerts.py"), "# edited\n", { flag: "a" });
    assert.equal(run().changedSinceExport, true, "an edit after the export is seen");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
