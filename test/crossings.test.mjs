/**
 * M-XLANG.1 (PLAN-M-V5FORKS.md, PLAN-v5 §5.1) — CROSSINGS: the join from
 * an HTTP boundary in one language to the route, in another, that serves
 * it.
 *
 * The floor under test is the same one M-BOUNDARY holds: a match is
 * derived from parsed data on both sides, and what cannot be established
 * is SAID rather than guessed. Two routes that both serve a path stay two;
 * two framework defaults agreeing is not a method match; and a thread's
 * `filesReached` is never touched, because a crossing is a hop, not a
 * merge.
 *
 * Run: npm run test:crossings
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildCrossingIndex, urlPath, pathMatchesRoute, callerMethod } from "../src/server/crossings.ts";
import { languageForPath } from "../src/shared/languages.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const fleet = buildPolyglotEnvelope(join(ROOT, "examples", "fleet-telemetry")).envelope;
const shop = buildPolyglotEnvelope(join(ROOT, "test", "fixtures", "polyglot", "shop_demo")).envelope;
const fleetIdx = buildCrossingIndex(fleet);
const shopIdx = buildCrossingIndex(shop);

const one = (idx, ep, path) => idx.all.find((c) => c.entryPointId === ep && c.path === path);

test("urlPath reads the URL expression, never the source line", () => {
  // The four shapes fleet actually contains. The M19 system tier's
  // `_LITERAL_RE` requires a `/` straight after the quote and so matches
  // NONE of the first four — the reason this module exists.
  assert.equal(urlPath("`${API_BASE}/ingest`"), "/ingest");
  assert.equal(urlPath("`${API_BASE}/devices/${encodeURIComponent(id)}`"), "/devices/*");
  assert.equal(urlPath("`${API_BASE}/devices`"), "/devices");
  assert.equal(urlPath("`${API_BASE}/export?since=${since}`"), "/export", "a query string is not part of the route");
  assert.equal(urlPath('"http://$host/health"'), "/health", "an absolute URL loses scheme and host");
  assert.equal(urlPath("`/api/users/${id}`"), "/api/users/*");
  assert.equal(urlPath('"/api/users"'), "/api/users");
  // Honest nulls: nothing static to match on.
  assert.equal(urlPath("url"), null, "a bare variable yields no path");
  assert.equal(urlPath("`${BASE}`"), null, "a base with no path yields none");
  assert.equal(urlPath("users/1"), null, "a relative word is not a base-URL interpolation");
  assert.equal(urlPath(""), null);
});

test("pathMatchesRoute matches SHAPE, so /devices and /devices/<id> never collide", () => {
  assert.equal(pathMatchesRoute("/devices", "/devices"), true);
  assert.equal(pathMatchesRoute("/devices", "/devices/<device_id>"), false, "the discriminating pair");
  assert.equal(pathMatchesRoute("/devices/*", "/devices"), false);
  // All three parameter syntaxes the frameworks use.
  assert.equal(pathMatchesRoute("/devices/*", "/devices/<device_id>"), true, "flask");
  assert.equal(pathMatchesRoute("/devices/*", "/devices/:id"), true, "express");
  assert.equal(pathMatchesRoute("/items/*", "/items/{id}"), true, "brace style");
  assert.equal(pathMatchesRoute("/users/*", "/users/<int:uid>"), true, "flask converter");
  assert.equal(pathMatchesRoute("/ingest", "/export"), false);
  assert.equal(pathMatchesRoute("/a/b", "/a"), false, "segment counts must agree");
});

test("callerMethod parses what it can and defaults only where the caller documents one", () => {
  assert.deepEqual(callerMethod("requests.post", []), { method: "POST", assumed: false });
  assert.deepEqual(callerMethod("session.get", []), { method: "GET", assumed: false });
  assert.deepEqual(callerMethod("fetch", ['{ method: "POST" }']), { method: "POST", assumed: false });
  assert.deepEqual(callerMethod("curl", ["-X", "PUT", '"/x"']), { method: "PUT", assumed: false });
  assert.deepEqual(callerMethod("fetch", ["`/x`"]), { method: "GET", assumed: true }, "fetch's documented default");
  assert.deepEqual(callerMethod("curl", ['"/x"']), { method: "GET", assumed: true });
  assert.deepEqual(callerMethod("mystery_send", ["/x"]), { method: null, assumed: false }, "no method, and none invented");
});

test("fleet: every gateway fetch lands on the Python route that serves it", () => {
  const ingest = one(fleetIdx, "gateway/server.ts:postIngestRoute", "/ingest");
  assert.ok(ingest, "the POST /ingest crossing exists");
  assert.deepEqual(ingest.targets.map((t) => t.entryPointId), ["telemetry/app.py:ingest_route"]);
  assert.equal(ingest.confidence, "path+method", "both sides PARSED a method");
  assert.equal(languageForPath(ingest.file).id, "jsts");

  const devices = one(fleetIdx, "gateway/server.ts:getFleet", "/devices");
  assert.deepEqual(devices.targets.map((t) => t.entryPointId), ["telemetry/app.py:devices_route"]);
  const device = one(fleetIdx, "gateway/server.ts:getFleet", "/devices/*");
  assert.deepEqual(device.targets.map((t) => t.entryPointId), ["telemetry/app.py:device_route"],
    "the parameterised path takes the parameterised route, not the bare one");

  const exp = one(fleetIdx, "gateway/server.ts:getExport", "/export");
  assert.deepEqual(exp.targets.map((t) => t.entryPointId), ["telemetry/app.py:export_route"]);
});

test("fleet: same-service exclusion is what makes those matches single", () => {
  // The gateway serves /ingest, /export and /devices/:id ITSELF while
  // calling the Python service for all three. Without the exclusion each
  // would be ambiguous; with it, each is one target and the note says why.
  for (const [ep, path, self] of [
    ["gateway/server.ts:postIngestRoute", "/ingest", "gateway/server.ts:postIngestRoute"],
    ["gateway/server.ts:getExport", "/export", "gateway/server.ts:getExport"],
    ["gateway/server.ts:getFleet", "/devices/*", "gateway/server.ts:getDevice"],
  ]) {
    const c = one(fleetIdx, ep, path);
    assert.equal(c.targets.length, 1, `${ep} ${path}`);
    assert.match(c.note, /is inside this thread's own files/);
    assert.match(c.note, new RegExp(self.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("fleet: two services serve /health, so the shell script's curl stays AMBIGUOUS", () => {
  const c = one(fleetIdx, "ops/deploy.sh:main", "/health");
  assert.ok(c, "a bash caller crosses too — this is not a JS-only feature");
  assert.equal(c.confidence, "ambiguous");
  assert.deepEqual(c.targets.map((t) => t.entryPointId).sort(),
    ["gateway/server.ts:getHealth", "telemetry/app.py:health"]);
  assert.match(c.note, /neither is claimed/);
});

test("a default method is never dressed up as a match", () => {
  const devices = one(fleetIdx, "gateway/server.ts:getFleet", "/devices");
  assert.equal(devices.confidence, "path",
    "fetch's default GET and Flask's implicit GET agreeing is two assumptions, not evidence");
  assert.equal(devices.methodAssumed, true);
  assert.equal(devices.targets[0].methodAssumed, true);
  assert.match(devices.note, /fetch defaults to GET/);
  assert.match(devices.note, /declares no methods/);
});

test("every crossing says the base URL was not resolved", () => {
  assert.ok(fleetIdx.all.length > 0);
  // M-FLOW.2 — the base URL is the HTTP kind's business; a command or tool
  // hop says what IT could not establish instead.
  for (const c of [...fleetIdx.all, ...shopIdx.all].filter((x) => (x.kind ?? "http") === "http")) {
    assert.match(c.note, /base URL is not resolved/, `${c.entryPointId} ${c.path}`);
  }
});

test("a path no route serves is reported as unmatched, not dropped", () => {
  const c = one(shopIdx, "gateway/server.ts:getOrders", "/orders/*");
  assert.equal(c.confidence, "unmatched");
  assert.deepEqual(c.targets, []);
  assert.match(c.note, /no route in this project serves that path/);
  // shop_demo has no /health route at all, so the ops curl is unmatched
  // there while the same script's curl is ambiguous in fleet.
  assert.equal(one(shopIdx, "ops/deploy.sh:main", "/health").confidence, "unmatched");
});

test("shop_demo: the POST and GET on one path separate by their PARSED methods", () => {
  const post = one(shopIdx, "gateway/server.ts:createOrder", "/orders");
  assert.deepEqual(post.targets.map((t) => t.entryPointId), ["api/app.py:create_order"]);
  assert.equal(post.confidence, "path+method");
  const get = one(shopIdx, "gateway/server.ts:getOrders", "/orders");
  assert.deepEqual(get.targets.map((t) => t.entryPointId), ["api/app.py:get_orders"]);
});

test("FLOOR: a crossing never widens the thread — filesReached stays one language", () => {
  for (const env of [fleet, shop]) {
    const idx = buildCrossingIndex(env);
    for (const ep of Object.keys(idx.byThread)) {
      const t = env.threads.find((x) => x.entryPointId === ep);
      const lang = languageForPath(t.seed.file).id;
      for (const f of t.filesReached) {
        assert.equal(languageForPath(f).id, lang, `${ep} crossed into ${f}`);
      }
      // ...and the crossing genuinely points at ANOTHER language somewhere.
      const crossesLanguage = idx.byThread[ep].some((c) => c.targets.some((tg) => {
        const rf = env.entryPoints.find((e) => e.id === tg.entryPointId)?.file;
        return rf && languageForPath(rf).id !== lang;
      }));
      if (idx.byThread[ep].some((c) => c.targets.length)) {
        assert.ok(crossesLanguage, `${ep} has targets but none in another language`);
      }
    }
  }
});

test("no HTTP call, no crossing — and an unparseable URL yields none", () => {
  // requests.Session() carries effectKind http but has no URL argument.
  const sessionCall = Object.values(fleet.files)
    .flatMap((ir) => ir.nodes ?? [])
    .find((n) => n.callTarget === "requests.Session");
  assert.ok(sessionCall, "the fixture still has the call this guards");
  assert.equal(fleetIdx.all.some((c) => c.nodeId === sessionCall.id), false);
  // A project with no routes at all yields nothing rather than throwing.
  assert.deepEqual(buildCrossingIndex({ files: {}, entryPoints: [], threads: [] }), { all: [], byThread: {} });
});
