/**
 * M-XLANG.3 (PLAN-M-V5FORKS.md, PLAN-v5 §5.1) — the thread call graph and
 * the cross-language hops it carries.
 *
 * PLAN-v5 §5.1 wanted "a thread traced button-click → fetch() → route →
 * DB across the language boundary". This pins the honesty of the graph: a
 * CROSSING is kept apart from a resolved call, and an AMBIGUOUS one goes to
 * every candidate rather than picking. (The System view's thread-interaction
 * drawing of it was removed on 2026-10-20; the graph feeds the contracts, the
 * export, plan_work and the system map.)
 *
 * The system tier's own `edges` are untouched — `test:polyglot`'s named
 * limit ("only effect edges, never a guessed call across languages")
 * still holds, because this is a DIFFERENT and better-evidenced channel:
 * the crossings, matched over parsed data on both sides.
 *
 * Run: npm run test:thread-interaction
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { deriveThreadCalls } from "../src/webview/system/threadInteraction.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const env = buildPolyglotEnvelope(join(ROOT, "examples", "fleet-telemetry")).envelope;
const crossings = buildCrossingIndex(env);

test("without a crossing index the graph is exactly what it was", () => {
  const g = deriveThreadCalls(env.threads, env.entryPoints);
  assert.deepEqual(g.crossings, [], "additive: no index, no crossing edges");
  assert.ok(g.nodes.length > 0 && g.edges.length > 0, "the tcall graph is unchanged");
});

test("a crossing edge joins the TS gateway thread to the Python route thread", () => {
  const g = deriveThreadCalls(env.threads, env.entryPoints, crossings);
  const ingest = g.crossings.find(
    (e) => e.from === "gateway/server.ts:postIngestRoute" && e.to === "telemetry/app.py:ingest_route");
  assert.ok(ingest, `not found in ${JSON.stringify(g.crossings.map((e) => `${e.from}->${e.to}`))}`);
  assert.equal(ingest.method, "POST");
  assert.equal(ingest.path, "/ingest");
  assert.equal(ingest.confidence, "path+method");

  // A crossing is NOT a tcall: the two channels stay separate, because one
  // is a call this project can follow and the other is a claim it weighs.
  assert.equal(g.edges.some((e) => e.from === ingest.from && e.to === ingest.to), false);
});

test("an AMBIGUOUS crossing draws to EVERY candidate, never one", () => {
  const g = deriveThreadCalls(env.threads, env.entryPoints, crossings);
  const health = g.crossings.filter((e) => e.from === "ops/deploy.sh:main" && e.path === "/health");
  assert.equal(health.length, 2, "the shell script's curl could hit either service");
  assert.deepEqual(health.map((e) => e.to).sort(),
    ["gateway/server.ts:getHealth", "telemetry/app.py:health"]);
  for (const e of health) assert.equal(e.confidence, "ambiguous");
});
