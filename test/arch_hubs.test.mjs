// Dispatchers, shared file stores and the Bird's-eye lens (2026-09-24), from
// Ben comparing the map with Archify on a private production codebase: Archify's agent picked out
// job_orchestrator.sh (the script the web app and MCP server run
// everything through) and output_cache/ (the directory it writes and they
// read). Both are now derived from the IR, pinned on
// test/fixtures/arch/dispatch_demo:
//
//   web/app/api/{run,export}  --exec-->  ops/bin/orchestrator.sh  --allow-list-->  4 scripts
//   orchestrator exports CACHE_ROOT=".../output_cache"; web/app/api/cached reads process.env.CACHE_ROOT
//
//   npm run test:arch-hubs
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { relativeTo, HUB_MIN_SCRIPTS } from "../src/server/arch_model.ts";
import { dirOfPathValue } from "../src/server/arch_stores.ts";
import { birdseyeModel } from "../src/webview/system/arch_birdseye.ts";
import { buildArchLayout } from "../src/webview/system/archLayout.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(ROOT, "test/fixtures/arch/dispatch_demo");
let env, model;
before(() => {
  env = buildPolyglotEnvelope(FIXTURE).envelope;
  model = archModelForEnvelope(env, buildStackIndex(env, FIXTURE), buildCrossingIndex(env), FIXTURE);
});
const node = (id) => model.nodes.find((n) => n.id === id);
const HUB = "hub:ops/bin/orchestrator.sh:module";

test("a bash array keeps every element (the 80-char preview cut a 28-script allow-list to 2)", () => {
  const a = env.files["ops/bin/orchestrator.sh"].nodes.find((n) => n.id === "module/ALLOWED_SCRIPTS.assign");
  assert.deepEqual(a.args, ['"reports/daily.sh"', '"reports/weekly.sh"', '"sync/pull.sh"', '"sync/push.sh"']);
  const hops = buildCrossingIndex(env).all.filter((c) => c.kind === "command" && c.file === "ops/bin/orchestrator.sh");
  assert.equal(hops.length, 4, hops.map((h) => h.path).join(", "));
});

test("a script that names ≥ N scripts and is named by ≥ M files is a DISPATCHER node, its list grouped by directory", () => {
  const h = node(HUB);
  assert.ok(h, "the orchestrator is promoted to a hub");
  assert.equal(h.kind, "hub");
  assert.equal(h.label, "orchestrator.sh");
  assert.equal(h.sublabel, "dispatcher · 4 scripts · named by 2 files");
  assert.deepEqual(h.dispatches.map((d) => [d.dir, d.scripts.map((s) => s.file)]), [
    ["reports", ["ops/bin/reports/daily.sh", "ops/bin/reports/weekly.sh"]],
    ["sync", ["ops/bin/sync/pull.sh", "ops/bin/sync/push.sh"]],
  ]);
  assert.deepEqual(h.callers, ["web/app/api/export/route.ts", "web/app/api/run/route.ts"]);
  // No other script qualifies: each names nothing.
  assert.equal(model.nodes.filter((n) => n.kind === "hub").length, 1);
  assert.equal(HUB_MIN_SCRIPTS, 4);
});

test("hops from another cluster land on the dispatcher; its allow-list is one dispatch edge", () => {
  const into = model.edges.filter((e) => e.to === HUB);
  assert.deepEqual(into.map((e) => [e.from, e.count]), [["cluster:web:web", 2]]);
  const out = model.edges.filter((e) => e.from === HUB && e.kind === "command");
  assert.deepEqual(out.map((e) => [e.to, e.count]), [["cluster:scripts:.", 4]]);
  // The export route ALSO names reports/weekly.sh itself: that hop is real and stays on the cluster.
  assert.ok(model.edges.some((e) => e.from === "cluster:web:web" && e.to === "cluster:scripts:." && e.kind === "command"));
});

test("relativeTo walks up with ../ (a dispatcher's list names siblings)", () => {
  assert.equal(relativeTo("a/b/company", "a/b/company/accounts/x.sh"), "accounts/x.sh");
  assert.equal(relativeTo("a/b/company", "a/b/grants/y.sh"), "../grants/y.sh");
  assert.equal(relativeTo("", "ops/x.sh"), "ops/x.sh");
});

test("a directory two clusters share through an environment variable is a FILE STORE; named cache by its own name", () => {
  const s = node("tool:output_cache/");
  assert.ok(s, model.nodes.map((n) => n.id).join(", "));
  assert.equal(s.category, "cache");
  assert.equal(s.sublabel, "file cache · CACHE_ROOT");
  assert.ok(s.refs.some((r) => r.file === ".env.example"), "the .env.example binding is cited");
  // The orchestrator's own file speaks for the dispatcher, not the whole cluster.
  const users = model.edges.filter((e) => e.to === s.id).map((e) => e.from).sort();
  assert.deepEqual(users, ["cluster:web:web", HUB]);
  assert.ok(model.edges.find((e) => e.to === s.id).protocolBasis.includes("CACHE_ROOT"));
});

test("path values: regex literals, /dev/null and files are never directories", () => {
  assert.equal(dirOfPathValue('"${APP_ROOT}/output_cache"'), "output_cache");
  assert.equal(dirOfPathValue("./output_cache"), "output_cache");
  assert.equal(dirOfPathValue("output_cache"), "output_cache");
  assert.equal(dirOfPathValue("/[A-Z][a-z]+ (Ltd|PLC)/i"), null, "a JS regex with flags");
  assert.equal(dirOfPathValue("/dev/null"), null);
  assert.equal(dirOfPathValue('"${CACHE_DIR}/${STEM}.json"'), null, "a file");
  assert.equal(dirOfPathValue("https://x.example/api"), null);
});

test("every model still validates against the schema", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "schemas/arch_model.schema.json"), "utf-8"));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  assert.ok(validate(model), JSON.stringify(validate.errors?.slice(0, 3)));
});

test("Bird's-eye: a Browser actor, deploy units folded, the dispatcher, the store named — one arrow per pair", () => {
  const b = birdseyeModel(model);
  const ids = b.model.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["actor:browser:cluster:web:web", "cluster:scripts:.", "cluster:web:web", HUB, "tool:output_cache/"].sort());
  const actor = b.model.nodes.find((n) => n.kind === "actor");
  assert.equal(actor.label, "Browser");
  assert.ok(actor.notes[0].includes("Not a parsed call"), "the actor says it is an inference");
  const pairs = b.model.edges.map((e) => `${e.from}->${e.to}`);
  assert.equal(new Set(pairs).size, pairs.length, "one arrow per pair");
  // The layout puts the actor in a column of its own, left of the web app.
  const l = buildArchLayout(model, "birdseye");
  const x = (id) => l.nodes.find((n) => n.id === id).position.x;
  assert.ok(x("actor:browser:cluster:web:web") < x("cluster:web:web"));
});
