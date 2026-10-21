// The rule form's scope picker, grouped (2026-10-19, PLAN-M-RULES M1,
// src/webview/rules/scopeGroups.ts). On a large project the form showed every
// tool the stack index knows as one flat wall of grey chips, threads were not
// offered and files were typed by hand. Pinned on the fleet example: each
// group is read from a fact the envelope carries; each chip's "reaches" count
// is what the SERVER's routing gives for that scope (one predicate,
// shared/scope_route.ts); picked chips add up to the scope the stored rule has.
//
//   npm run test:rule-scope-groups
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { routeConstraints } from "../src/server/constraint_store.ts";
import { buildScopeGroups, reachOf, scopeOfPicked } from "../src/webview/rules/scopeGroups.ts";

const FLEET = "examples/fleet-telemetry";
let env, stack, input, groups;
before(() => {
  env = buildPolyglotEnvelope(FLEET, { skipSystem: true }).envelope;
  stack = buildStackIndex(env, FLEET);
  const architecture = archModelForEnvelope(env, stack, buildCrossingIndex(env), FLEET, undefined, { applyStore: false });
  input = { entryPoints: env.entryPoints, threads: env.threads, stack, architecture, files: Object.keys(env.files) };
  groups = buildScopeGroups(input);
});
const group = (id) => groups.find((g) => g.id === id);
const opts = (id) => (group(id)?.subgroups ?? []).flatMap((s) => s.options);
const opt = (key) => groups.flatMap((g) => g.subgroups.flatMap((s) => s.options)).find((o) => o.key === key);

test("the groups, in order, each from a fact; libraries and runtime folded", () => {
  assert.deepEqual(groups.map((g) => g.id), ["architecture", "threads", "scripts", "protocols", "code", "libraries", "runtime"].filter((id) => group(id)));
  for (const id of ["architecture", "threads", "scripts", "protocols", "code"]) assert.ok(group(id), `${id} is drawn`);
  assert.equal(group("libraries")?.folded ?? true, true);
  assert.equal(group("runtime")?.folded, true);
  assert.equal(group("threads").folded, false);
  // every entry point is offered once, as a thread or a script
  const eps = [...opts("threads"), ...opts("scripts")].filter((o) => o.key.startsWith("ep:"));
  assert.equal(eps.length, env.entryPoints.length);
  assert.equal(new Set(eps.map((o) => o.key)).size, eps.length);
});

test("threads by kind and framework; scripts apart, with their folders", () => {
  const subs = group("threads").subgroups.map((s) => s.label);
  assert.ok(subs.includes("Routes · flask"), subs.join(", "));
  assert.ok(subs.some((s) => s.startsWith("Routes · express")), subs.join(", "));
  assert.ok(subs.includes("Tests"));
  const ingest = opts("threads").find((o) => o.key === "ep:telemetry/app.py:ingest_route");
  assert.match(ingest.label, /\/ingest$/, "a route reads as its path");
  assert.ok(opts("scripts").some((o) => o.key.startsWith("ep:ops/") && o.kind === "process"));
  assert.ok(opts("scripts").some((o) => o.key === "files:ops/" && o.kind === "path"), "a folder holding two or more scripts");
});

test("protocols by role, in the kind's colours; the project's funnels under code", () => {
  const http = group("protocols").subgroups.find((s) => s.label === "HTTP");
  assert.ok(http.options.some((o) => o.label === "requests" && o.kind === "external"));
  const db = group("protocols").subgroups.find((s) => s.label === "Databases");
  assert.ok(db.options.some((o) => o.label === "sqlite3" && o.kind === "store"), "a standard-library database is still a database");
  assert.ok(http.options.some((o) => o.label === "fetch"), "a language-global HTTP client is still HTTP");
  const funnels = group("code").subgroups.find((s) => s.label === "Project modules (funnels)");
  assert.ok(funnels.options.some((o) => o.key === "stack:telemetry.http_client" && o.label === "telemetry/http_client.py"));
  assert.ok(group("code").subgroups.find((s) => s.label === "Folders").options.some((o) => o.key === "files:telemetry/"));
  assert.ok(!opts("protocols").some((o) => o.key === "stack:json"), "the standard library is runtime, not a protocol");
  assert.ok(opts("runtime").some((o) => o.key === "stack:json" || o.key === "stack:os"));
});

test("the architecture's processes scope by their entry points", () => {
  const procs = group("architecture").subgroups.find((s) => s.label === "Processes");
  assert.ok(procs.options.length >= 2);
  for (const o of procs.options) {
    assert.equal(o.kind, "process");
    assert.ok(o.adds.entryPointIds.every((id) => env.entryPoints.some((e) => e.id === id)));
  }
});

test("each chip's count is what the server routes; picked chips add up to one scope", () => {
  const thread = (t) => ({ entryPointId: t.entryPointId, filesReached: t.filesReached, stack: stack.byThread[t.entryPointId] });
  for (const key of ["stack:sqlite3", "stack:requests", "files:telemetry/", "ep:telemetry/app.py:ingest_route"]) {
    const o = opt(key);
    const server = env.threads.filter((t) => routeConstraints([{ id: "x", scope: o.adds }], thread(t)).length).length;
    assert.equal(o.reaches, server, `${key}: picker says ${o.reaches}, the server routes to ${server}`);
  }
  const scope = scopeOfPicked([opt("ep:telemetry/app.py:ingest_route"), opt("stack:sqlite3"), opt("stack:sqlite3")]);
  assert.deepEqual(scope, { entryPointIds: ["telemetry/app.py:ingest_route"], stack: ["sqlite3"] });
  assert.ok(reachOf(scope, input).length >= opt("stack:sqlite3").reaches);
});

test("a project with no stack index and no architecture still offers its threads; nothing is invented", () => {
  const bare = buildScopeGroups({ entryPoints: env.entryPoints, threads: env.threads, stack: null, architecture: null, files: [] });
  assert.deepEqual(bare.map((g) => g.id), ["threads", "scripts"]);
});
