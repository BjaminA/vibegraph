// FUNNEL USERS (2026-10-20, src/server/funnel_users.ts): a funnel's users
// are the importers that take a binding whose body uses what it wraps — not
// every importer. The first live setup run on a public Next.js app proposed
// "Reach fetch through lib.utils — 52 files use fetch through lib/utils.ts"
// because 52 files imported lib/utils.ts for `cn()`; four took `fetcher`.
// Fixture: test/fixtures/stack/funnel_users_demo (TS + Python).
//
//   npm run test:funnel-users
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { census } from "../src/server/project_direction.ts";
import { boundName, exportedName, funnelUsers, wrappingBindings } from "../src/server/funnel_users.ts";

const ROOT = "test/fixtures/stack/funnel_users_demo";
const env = buildPolyglotEnvelope(ROOT).envelope;
const stack = buildStackIndex(env, ROOT);
const funnel = (home, role) => stack.tools.find((t) => t.origin === "project" && t.home === home && t.role === role);

test("a grab-bag module: importing it for cn() is not using the fetch wrapper beside it", () => {
  const f = funnel("lib/utils.ts", "http-client");
  assert.ok(f, "lib/utils.ts is a funnel wrapping fetch");
  assert.deepEqual(f.files.filter((x) => x !== f.home), ["app/item.ts", "app/items.ts", "app/preload.ts", "components/button.ts", "components/footer.ts", "components/header.ts"], "every importer stays in files (presence)");
  // items takes fetcher; item takes loadItem, which calls fetcher; preload
  // takes loader = withRetry(loadItem), the wrapper passed as a value
  assert.deepEqual(f.users, ["app/item.ts", "app/items.ts", "app/preload.ts"]);
});

test("a database module: a type or an unrelated helper is not the driver", () => {
  const f = funnel("lib/db.ts", "db");
  assert.ok(f, "lib/db.ts wraps drizzle-orm");
  assert.deepEqual(f.users, ["app/admin.ts", "app/profile.ts"], "getUser runs db.select() on `db = drizzle(…)`; names.ts takes slugOf and a type");
});

test("python: a function imported by name, or reached by a resolved call through the module", () => {
  const f = stack.tools.find((t) => t.origin === "project" && t.home === "py/store.py");
  assert.ok(f, "py/store.py wraps sqlite3");
  assert.ok(f.files.includes("py/use_slug.py"), "use_slug imports it");
  assert.ok(!f.users.includes("py/use_slug.py"), "slug() touches no database");
  assert.ok(f.users.includes("py/use_save.py"), "save() is the wrapper");
  assert.ok(f.users.includes("py/use_module.py"), "store.save() resolves into the wrapper");
});

test("the census counts users, and a manifest line is not a direct use", () => {
  const model = archModelForEnvelope(env, stack, buildCrossingIndex(env), ROOT, undefined, { applyStore: false });
  const found = census({ stack, model, files: env.files, plan: null });
  const by = Object.fromEntries(found.map((c) => [c.basis, c]));
  assert.match(by["funnel:fetch"].why, /^3 files use fetch through lib\/utils\.ts; none reach it directly/);
  assert.match(by["funnel:drizzle-orm"].why, /^2 files use drizzle-orm through lib\/db\.ts; none reach it directly/, "package.json declares it; that is not reaching it");
  assert.deepEqual(by["funnel:drizzle-orm"].files, ["lib/db.ts", "app/admin.ts", "app/profile.ts"]);
});

test("bindings: names, aliases, defaults; a wrapper reached through another", () => {
  assert.equal(boundName("default as postgres"), "postgres");
  assert.equal(boundName("* as ns"), "ns");
  assert.equal(boundName("type User"), "User");
  assert.equal(boundName("os.path"), "os");
  assert.equal(exportedName("fetcher as get"), "fetcher");
  assert.equal(exportedName("default as Chart"), "default");
  const nodes = [
    { id: "module/client.import_from", type: "import_from", parentId: null, names: ["default as client"] },
    { id: "module/conn.assign", type: "assignment", parentId: null, name: "conn", callTarget: "client" },
    { id: "module/query.fn", type: "function_def", parentId: null, name: "query" },
    { id: "module/query.fn/r.assign", type: "assignment", parentId: "module/query.fn", callTarget: "conn.run" },
    { id: "module/Page.fn", type: "function_def", parentId: null, name: "Page", isDefaultExport: true },
    { id: "module/Page.fn/call@0", type: "call", parentId: "module/Page.fn", funcName: "query" },
    { id: "module/pad.fn", type: "function_def", parentId: null, name: "pad" },
  ];
  const w = wrappingBindings(nodes, [], ["client"]);
  assert.deepEqual([...w.names].sort(), ["Page", "conn", "default", "query"]);
  const users = funnelUsers(w, [
    { file: "a.ts", imports: [{ names: ["default as Home"] }], refTargets: [] },
    { file: "b.ts", imports: [{ names: ["pad"] }], refTargets: [] },
    { file: "c.ts", imports: [{ names: ["* as lib"] }], refTargets: ["module/query.fn"] },
    { file: "d.ts", imports: [{ names: ["* as lib"] }], refTargets: [] },
  ]);
  assert.deepEqual(users, ["a.ts", "c.ts"], "a namespace import with no resolved call says nothing, so it is not counted");
});
