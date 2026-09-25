// M-LANG3 (PLAN-M-LANG.md) — JS/TS thread extraction contract. The SAME
// extract_thread.py walks the jsts IR via classify_jsts (trusts
// frontend-stamped effectKind; import()/this./param-receivers →
// dynamic). Snapshot regen: scripts/regen_jsts.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(ROOT, "test", "fixtures", "jsts", "api_demo");
const files = JSON.parse(readFileSync(join(FIXTURE, "api_demo.ir.json"), "utf-8"));

function extractThreads() {
  const payload = JSON.stringify({
    files,
    seeds: [
      { seedFile: "server.ts", seedId: "module/listUsers.fn", entryPointId: "server.ts:listUsers" },
      { seedFile: "server.ts", seedId: "module/createUser.fn", entryPointId: "server.ts:createUser" },
      { seedFile: "db.test.ts", seedId: "module/checkQueryUsers.fn", entryPointId: "db.test.ts:checkQueryUsers" },
    ],
  });
  const r = spawnSync("python3", [join(ROOT, "scripts", "extract_thread.py"), "--batch-seeds"], {
    input: payload, encoding: "utf-8", cwd: ROOT,
    env: { ...process.env, PYTHONPATH: join(ROOT, ".pydeps") },
  });
  assert.equal(r.status, 0, `extract_thread failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const out = extractThreads();
const byEntry = Object.fromEntries(out.threads.map((t) => [t.entryPointId, t]));

test("jsts thread output matches api_demo.thread.json (snapshot)", () => {
  const snapshot = JSON.parse(readFileSync(join(FIXTURE, "api_demo.thread.json"), "utf-8"));
  assert.deepEqual(out, snapshot, "drifted — regen via scripts/regen_jsts.sh if intentional");
});

test("route thread walks the cross-file import into db.ts", () => {
  const th = byEntry["server.ts:listUsers"];
  assert.ok(th.nodes.some((n) => n.kind === "step" && n.id === "db.ts:queryUsers"));
  assert.deepEqual(th.filesReached.sort(), ["db.ts", "server.ts"]);
});

test("external terminals carry effectKind: pool.query db, readFile fs, console.warn log", () => {
  const th = byEntry["server.ts:listUsers"];
  const byId = Object.fromEntries(th.nodes.map((n) => [n.id, n]));
  assert.equal(byId["external:pool.query"].effectKind, "db");
  assert.equal(byId["external:readFile"].effectKind, "fs");
  assert.equal(byId["external:console.warn"].effectKind, "log");
});

test("honest dynamics: param receivers (res.json) and dynamic import()", () => {
  const list = byEntry["server.ts:listUsers"];
  assert.ok(list.nodes.some((n) => n.kind === "dynamic" && n.id === "dynamic:res.json"),
    "res is a PARAM — a method on it is runtime dispatch, never a failed external");
  const create = byEntry["server.ts:createUser"];
  assert.ok(create.nodes.some((n) => n.kind === "dynamic" && n.id === "dynamic:import"),
    "import(...) is genuine runtime module dispatch");
  assert.ok(create.nodes.some((n) => n.kind === "step" && n.id === "server.ts:loadPlugins"),
    "the same-file helper is a step, and the dynamic import sits inside it");
});

test("new Error(...) classifies as a builtin external, not a gap", () => {
  const create = byEntry["server.ts:createUser"];
  assert.ok(create.nodes.some((n) => n.kind === "external" && n.label === "Error"));
  for (const th of out.threads) {
    assert.equal(th.nodes.filter((n) => n.kind === "unresolved").length, 0,
      `${th.entryPointId}: nothing in this fixture is a genuine resolution gap`);
  }
});

test("test-entry thread reaches db.ts through the tested import", () => {
  const th = byEntry["db.test.ts:checkQueryUsers"];
  assert.ok(th.nodes.some((n) => n.kind === "step" && n.id === "db.ts:queryUsers"));
});
