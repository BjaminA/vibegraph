// M8.2.3 — entry-point discovery tests against the flask_demo fixture.
//
//   1. All 5 EntryPointKind values are produced (cli / route / public_api
//      / test / manual). PLAN-v2.md M8.2 done definition.
//   2. Negative cases: leading-underscore tests are NOT detected; module-
//      private helpers (no cross-file edges) are NOT detected as
//      public_api; route handlers are NOT also detected as public_api
//      (precedence dedup).
//   3. Per-kind shape: framework strings are correct; route metadata
//      carries route + method; precedence dedup picks the more specific
//      kind for the same function.
//
// Run: npm run test:discover

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));

const FLASK_DIR = join(ROOT, "test", "fixtures", "threads", "flask_demo");
const FLASK_IR = join(FLASK_DIR, "flask_demo.ir.json");
const MANUAL_SEEDS = join(FLASK_DIR, ".vibegraph", "manual_seeds.json");
const DISCOVER = join(ROOT, "scripts", "discover_entry_points.py");
const PYDEPS = join(ROOT, ".pydeps");

function discover(extraArgs = []) {
  const files = JSON.parse(readFileSync(FLASK_IR, "utf-8"));
  const r = spawnSync("python3", [DISCOVER, ...extraArgs], {
    env: { ...process.env, PYTHONPATH: PYDEPS },
    encoding: "utf-8",
    cwd: ROOT,
    input: JSON.stringify({ files }),
  });
  assert.equal(r.status, 0, `discover failed: ${r.stderr}`);
  return JSON.parse(r.stdout).entryPoints;
}

test("all 5 entry-point kinds detected on flask_demo (M8.2 done definition)", () => {
  const entries = discover(["--manual-seeds", MANUAL_SEEDS]);
  const kinds = new Set(entries.map((e) => e.kind));
  for (const k of ["cli", "route", "public_api", "test", "manual"]) {
    assert.ok(kinds.has(k), `missing kind: ${k}`);
  }
});

test("Flask routes: 3 handlers, framework=flask, route+method metadata", () => {
  const entries = discover();
  const routes = entries.filter((e) => e.kind === "route");
  assert.equal(routes.length, 3, "expected exactly 3 route handlers");
  for (const r of routes) {
    assert.equal(r.framework, "flask", `${r.qualifiedName} should be framework=flask`);
    assert.ok(r.metadata?.route, `${r.qualifiedName} missing route metadata`);
  }
  const byName = Object.fromEntries(routes.map((r) => [r.label, r]));
  assert.equal(byName.list_users_route.metadata.route, "/users");
  assert.equal(byName.get_user_route.metadata.route, "/users/<int:uid>");
  assert.equal(byName.get_user_route.metadata.method, "GET");
  assert.equal(byName.create_user_route.metadata.method, "POST");
});

test("CLI: cli:main detected with framework=argparse (signal 1 + signal 2 dedupe)", () => {
  const entries = discover();
  const cli = entries.filter((e) => e.kind === "cli");
  assert.equal(cli.length, 1, `expected exactly 1 cli entry; got ${cli.length}`);
  assert.equal(cli[0].qualifiedName, "cli:main");
  assert.equal(cli[0].framework, "argparse",
    "framework should back-fill from the argparse.ArgumentParser call inside main()");
});

test("test seeds: 2 detected; leading-underscore helper NOT detected", () => {
  const entries = discover();
  const tests = entries.filter((e) => e.kind === "test");
  assert.equal(tests.length, 2, `expected 2 test seeds; got ${tests.length}`);
  for (const t of tests) {
    assert.equal(t.framework, "pytest");
    assert.ok(t.label.startsWith("test_"));
  }
  assert.equal(
    entries.find((e) => e.label === "_helper_not_a_test"),
    undefined,
    "_helper_not_a_test must NOT be detected (leading underscore)",
  );
});

test("public_api: cross-file callees only (db._get_conn excluded)", () => {
  const entries = discover();
  const apis = entries.filter((e) => e.kind === "public_api").map((e) => e.qualifiedName);
  // db._get_conn has no cross-file edges, so must NOT be public_api.
  assert.equal(
    apis.find((q) => q === "db:_get_conn"),
    undefined,
    "db:_get_conn must NOT be public_api (no cross-file edges)",
  );
  // Functions that ARE called cross-file must appear.
  for (const expected of ["db:query", "db:insert", "models:create_user", "models:find_user", "models:list_users"]) {
    assert.ok(apis.includes(expected), `missing public_api: ${expected}`);
  }
});

test("precedence dedup: route handlers do NOT also appear as public_api", () => {
  const entries = discover();
  const apis = new Set(entries.filter((e) => e.kind === "public_api").map((e) => e.qualifiedName));
  for (const route of ["app:list_users_route", "app:get_user_route", "app:create_user_route"]) {
    assert.ok(!apis.has(route), `${route} should be route-only, not also public_api`);
  }
});

test("manual seed merges only when file/irNodeId resolves", () => {
  const entries = discover(["--manual-seeds", MANUAL_SEEDS]);
  const manual = entries.filter((e) => e.kind === "manual");
  assert.equal(manual.length, 1);
  assert.equal(manual[0].qualifiedName, "db:_get_conn");
  assert.equal(manual[0].irNodeId, "module/_get_conn.fn");
});

test("manual seed: stale entry (unknown file) is silently dropped", () => {
  // Build the manual-seeds payload inline so we don't have to commit a
  // broken fixture. The script is happy to read from any path.
  const tmpPath = join(FLASK_DIR, ".vibegraph", "manual_seeds.stale.json");
  writeFileSync(tmpPath, JSON.stringify({
    seeds: [
      { file: "does_not_exist.py", irNodeId: "module/whatever.fn" },
      { file: "db.py", irNodeId: "module/_get_conn.fn" },
    ],
  }, null, 2));
  try {
    const entries = discover(["--manual-seeds", tmpPath]);
    const manual = entries.filter((e) => e.kind === "manual");
    assert.equal(manual.length, 1, "only the resolvable seed should survive");
    assert.equal(manual[0].file, "db.py");
  } finally {
    unlinkSync(tmpPath);
  }
});

test("output is sorted: route → cli → test → public_api → manual, alphabetical within group", () => {
  const entries = discover(["--manual-seeds", MANUAL_SEEDS]);
  const order = ["route", "cli", "test", "public_api", "manual"];
  let lastKindIdx = -1;
  let lastNameInGroup = "";
  for (const e of entries) {
    const idx = order.indexOf(e.kind);
    assert.ok(idx >= 0, `unknown kind ${e.kind}`);
    if (idx > lastKindIdx) {
      lastKindIdx = idx;
      lastNameInGroup = "";
    } else if (idx < lastKindIdx) {
      assert.fail(`kind ${e.kind} appeared after a higher-precedence kind`);
    }
    assert.ok(
      e.qualifiedName >= lastNameInGroup,
      `within ${e.kind}: ${e.qualifiedName} must come after ${lastNameInGroup}`,
    );
    lastNameInGroup = e.qualifiedName;
  }
});

test("every entry has the required schema fields", () => {
  const entries = discover(["--manual-seeds", MANUAL_SEEDS]);
  const required = ["id", "kind", "file", "irNodeId", "qualifiedName", "label"];
  for (const e of entries) {
    for (const field of required) {
      assert.ok(field in e, `entry ${JSON.stringify(e)} missing field ${field}`);
    }
    assert.ok("framework" in e,
      `entry ${e.id} must always include framework key (null when not meaningful) — schema requires the discriminator be present`);
  }
});

// ── M-NA5 — factory-route discovery (NEXT-ACTIONS §2) ────────────────
//
// flask_factory_demo has ZERO module-level decorated routes: two
// handlers nested inside create_app(), one registered via
// add_url_rule(view_func=…), and one on a module-level Blueprint.
// The fixture is parsed live so this test exercises the real IR shapes
// (nested parentId, call-node funcName/args).

import { readdirSync } from "node:fs";

const FACTORY_DIR = join(ROOT, "test", "fixtures", "threads", "flask_factory_demo");

function discoverFactory() {
  const pyFiles = readdirSync(FACTORY_DIR).filter((f) => f.endsWith(".py"));
  const parse = spawnSync("python3", [join(ROOT, "scripts", "parse_cst.py"), "--batch"], {
    env: { ...process.env, PYTHONPATH: PYDEPS },
    encoding: "utf-8",
    cwd: ROOT,
    input: pyFiles.map((f) => `${join(FACTORY_DIR, f)}\t${f.replace(/\.py$/, "")}`).join("\n") + "\n",
  });
  assert.equal(parse.status, 0, `parse failed: ${parse.stderr}`);
  const parsed = JSON.parse(parse.stdout);
  const files = {};
  for (const f of pyFiles) {
    files[f] = parsed.files[join(FACTORY_DIR, f)];
    assert.ok(files[f], `no IR for ${f}`);
  }
  const r = spawnSync("python3", [DISCOVER], {
    env: { ...process.env, PYTHONPATH: PYDEPS },
    encoding: "utf-8",
    cwd: ROOT,
    input: JSON.stringify({ files }),
  });
  assert.equal(r.status, 0, `discover failed: ${r.stderr}`);
  return JSON.parse(r.stdout).entryPoints;
}

test("factory app: nested, add_url_rule, and blueprint handlers are all discovered as routes", () => {
  const routes = discoverFactory().filter((e) => e.kind === "route");
  const byLabel = Object.fromEntries(routes.map((r) => [r.label, r]));

  // Nested inside create_app() — the original blind spot.
  assert.ok(byLabel.list_users, "nested @app.route handler not discovered");
  assert.ok(byLabel.create_user, "nested @app.post handler not discovered");
  assert.equal(byLabel.list_users.metadata.route, "/users");
  assert.equal(byLabel.create_user.metadata.method, "POST");
  assert.ok(
    byLabel.list_users.irNodeId.includes("create_app"),
    `nested handler must keep its real (nested) irNodeId; got ${byLabel.list_users.irNodeId}`,
  );

  // Registered via add_url_rule(view_func=…).
  assert.ok(byLabel.health, "add_url_rule view_func handler not discovered");
  assert.equal(byLabel.health.metadata.route, "/health");

  // Module-level Blueprint handler (worked pre-fix; must keep working).
  assert.ok(byLabel.list_orders, "blueprint @bp.route handler not discovered");

  assert.equal(routes.length, 4, `expected exactly 4 routes, got ${routes.map((r) => r.label)}`);
  for (const r of routes) {
    assert.equal(r.framework, "flask", `${r.label} should be framework=flask`);
  }
});

test("factory handlers are dedup'd: create_app itself is not a route; no double-claims", () => {
  const entries = discoverFactory();
  const routes = entries.filter((e) => e.kind === "route");
  assert.ok(!routes.some((r) => r.label === "create_app"), "the factory itself must not be a route");
  const ids = routes.map((r) => `${r.file}:${r.irNodeId}`);
  assert.equal(new Set(ids).size, ids.length, "route entries must be unique per function");
});
