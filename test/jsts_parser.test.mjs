// M-LANG3 (PLAN-M-LANG.md) — JS/TS frontend snapshot + contract test.
// Mirrors test/bash_parser.test.mjs: spawn the frontend, byte-compare to
// the committed snapshot (regen: scripts/regen_jsts.sh), Ajv-validate
// against the SAME schemas/ir.schema.json, pin the mapping decisions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FRONTEND = join(ROOT, "scripts", "frontends", "jsts", "parse_jsts.mjs");
const LINKER = join(ROOT, "scripts", "frontends", "jsts", "link_jsts.mjs");
const DISCOVER = join(ROOT, "scripts", "frontends", "jsts", "discover_jsts.mjs");
const FIXTURE = join(ROOT, "test", "fixtures", "jsts", "api_demo");
const SNAPSHOT = join(FIXTURE, "api_demo.ir.json");
const NODE_ID = /^module(\/[^/]+)*$/;

function runPipe(cmd, args, input, opts = {}) {
  const r = spawnSync(cmd, args, { input, encoding: "utf-8", cwd: ROOT, ...opts });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

function parseAndLink() {
  const batchOut = runPipe(
    process.execPath, [FRONTEND, "--batch"],
    "server.ts\tserver.ts\ndb.ts\tdb.ts\ndb.test.ts\tdb.test.ts\n",
    { cwd: FIXTURE },
  );
  const { files, errors } = JSON.parse(batchOut);
  assert.deepEqual(errors, {}, "fixture must parse without drops");
  return JSON.parse(runPipe(process.execPath, [LINKER], JSON.stringify({ files }))).files;
}

const files = parseAndLink();

test("jsts frontend output matches api_demo.ir.json (snapshot)", () => {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
  assert.deepEqual(files, snapshot,
    "frontend output drifted — regen via scripts/regen_jsts.sh if intentional");
});

test("every api_demo IR validates against ir.schema.json at 2.0", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "schemas", "ir.schema.json"), "utf-8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  for (const [fname, ir] of Object.entries(files)) {
    assert.equal(ir.version, "2.0", fname);
    assert.equal(ir.language, "jsts", fname);
    assert.ok(validate(ir), `${fname}: ${JSON.stringify(validate.errors)}`);
    for (const n of ir.nodes) assert.match(n.id, NODE_ID, `${fname}: ${n.id}`);
  }
});

test("relative imports link cross-file with extension probing", () => {
  const xf = files["server.ts"].edges.filter((e) => e.targetFile === "db.ts");
  assert.deepEqual(
    xf.map((e) => e.qualifiedTarget).sort(),
    ["db.ts:insertUser", "db.ts:queryUsers"],
  );
  const dbIds = new Set(files["db.ts"].nodes.map((n) => n.id));
  for (const e of xf) assert.ok(dbIds.has(e.target));
  // the test file links into db.ts too
  assert.ok(files["db.test.ts"].edges.some((e) => e.targetFile === "db.ts"));
});

test("isAsync is REAL for the first time outside Python", () => {
  const fns = files["server.ts"].nodes.filter((n) => n.type === "function_def");
  assert.ok(fns.length >= 3);
  for (const fn of fns) assert.equal(fn.isAsync, true, `${fn.name} is async in the fixture`);
});

test("effect vocabulary: pool.query→db, readFile→fs, console→log; bare express() unstamped", () => {
  const db = files["db.ts"].nodes;
  assert.equal(db.find((n) => n.type === "assignment" && n.name === "result").effectKind, "db");
  assert.equal(db.find((n) => n.type === "assignment" && n.name === "seed").effectKind, "fs");
  const srv = files["server.ts"].nodes;
  assert.equal(srv.find((n) => n.funcName === "console.warn").effectKind, "log");
  assert.equal(srv.find((n) => n.name === "app").effectKind, undefined,
    "express() is an external-module call, not a vocabulary effect");
});

test("template literal → fstring; dynamic import keeps funcName 'import'", () => {
  const sql = files["db.ts"].nodes.find((n) => n.name === "sql");
  assert.equal(sql.valueKind, "fstring");
  const mod = files["server.ts"].nodes.find((n) => n.name === "mod");
  assert.equal(mod.callTarget, "import");
});

test("try/catch/finally take the python v1.5 sibling shape", () => {
  // db.test.ts has none; synthesize a quick file through the frontend.
  const src = [
    "export function f() {",
    "  try { g(); } catch (e) { console.log(e); } finally { console.log('done'); }",
    "}",
  ].join("\n");
  const tmp = join(ROOT, "test", "fixtures", "jsts", ".tmp_try.ts");
  writeFileSync(tmp, src);
  try {
    const out = JSON.parse(runPipe(process.execPath, [FRONTEND, tmp], ""));
    const types = out.nodes.map((n) => n.type);
    assert.ok(types.includes("try_stmt"));
    assert.ok(types.includes("except_handler"));
    assert.ok(types.includes("finally_block"));
    const tryN = out.nodes.find((n) => n.type === "try_stmt");
    const excN = out.nodes.find((n) => n.type === "except_handler");
    assert.equal(excN.parentId, tryN.parentId, "except is a SIBLING of try (v1.5 shape)");
    assert.equal(excN.exceptType, "e");
  } finally {
    rmSync(tmp, { force: true });
  }
});

test("discovery: two express routes + one test entry, evidence-based frameworks", () => {
  const { entryPoints } = JSON.parse(
    runPipe(process.execPath, [DISCOVER], JSON.stringify({ files })),
  );
  const byId = Object.fromEntries(entryPoints.map((e) => [e.id, e]));
  assert.equal(entryPoints.length, 3);
  assert.equal(byId["server.ts:listUsers"].kind, "route");
  assert.equal(byId["server.ts:listUsers"].framework, "express");
  assert.deepEqual(byId["server.ts:listUsers"].metadata, { route: "/users", method: "GET" });
  assert.equal(byId["server.ts:createUser"].metadata.method, "POST");
  assert.equal(byId["db.test.ts:checkQueryUsers"].kind, "test");
});

test("PARITY: JSDoc docstrings, literal return types, structured assignment args", () => {
  const qu = files["db.ts"].nodes.find((n) => n.name === "queryUsers");
  assert.equal(
    qu.docstring,
    "Read the seed file, then fetch up to `limit` users from postgres.\nReturns the raw row objects.",
    "JSDoc gutters stripped to prose",
  );
  assert.equal(qu.returns, "Promise<unknown[]>", "the TS annotation is Python's `-> T` analog");
  const lu = files["server.ts"].nodes.find((n) => n.name === "listUsers");
  assert.equal(lu.docstring, "List every user, capped at 25 — warns when the table is empty.");
  // unannotated + undocumented stay honestly absent/null
  const ins = files["db.ts"].nodes.find((n) => n.name === "insertUser");
  assert.equal(ins.docstring, null);
  assert.equal(ins.returns, undefined);
  // call-valued assignments carry their args (Python parity)
  const users = files["server.ts"].nodes.find((n) => n.id === "module/listUsers.fn/users.assign");
  assert.deepEqual(users.args, ["25"]);
});

// M-SKILLS.3 — a TypeScript `interface` is a NODE, because a node is the
// address an edit is sent to. It is deliberately not a thread construct.
test("an exported interface emits a node, with its docstring and export fact", () => {
  const iface = files["db.ts"].nodes.find((n) => n.type === "interface_def");
  assert.ok(iface, "db.ts's exported interface emits a node");
  assert.equal(iface.id, "module/UserRow.interface");
  assert.equal(iface.name, "UserRow");
  assert.equal(iface.isExported, true);
  assert.equal(iface.docstring, "One row of the users table, as callers see it.");
  // It sits at module scope beside the functions, not inside one.
  assert.equal(iface.parentId, null);
});

test("an interface carries NO thread value: the extractor never walks it", () => {
  // The v1 rule ("type decls have no thread value") was TRUE and was the
  // wrong test for whether to emit a node — but it still governs threads.
  const thread = JSON.parse(readFileSync(join(FIXTURE, "api_demo.thread.json"), "utf-8"));
  const threads = Array.isArray(thread) ? thread : (thread.threads ?? [thread]);
  for (const t of threads) {
    for (const n of t.nodes ?? []) {
      assert.ok(
        !String(n.irNodeId ?? "").endsWith(".interface"),
        `interface reached a thread: ${n.irNodeId}`,
      );
    }
  }
});

test("linker is idempotent", () => {
  const relinked = JSON.parse(
    runPipe(process.execPath, [LINKER], JSON.stringify({ files })),
  ).files;
  assert.deepEqual(relinked, files);
});
