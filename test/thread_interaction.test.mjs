/**
 * M-XLANG.3 (PLAN-M-V5FORKS.md, PLAN-v5 §5.1) — the system view's
 * thread-interaction graph, and the cross-language hops it now draws.
 *
 * PLAN-v5 §5.1 wanted "a thread traced button-click → fetch() → route →
 * DB across the language boundary". The thread graph is where that
 * picture lives, and this pins the honesty of it: a CROSSING is drawn
 * apart from a resolved call, an AMBIGUOUS one draws to every candidate
 * rather than picking, and the layering puts the receiver downstream of
 * its caller so the reading order is the request's order.
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
import { deriveThreadCalls, buildThreadInteractionLayout } from "../src/webview/system/threadInteraction.ts";

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

test("the layout draws crossings dashed, labelled by method + path, and downstream", () => {
  const { nodes, edges } = buildThreadInteractionLayout(env.threads, env.entryPoints, crossings);
  const cross = edges.filter((e) => e.data?.crossing);
  assert.ok(cross.length >= 4, `expected the fleet crossings, got ${cross.length}`);

  const ingest = cross.find((e) => e.id.startsWith("crossing:gateway/server.ts:postIngestRoute->telemetry/app.py:ingest_route"));
  assert.ok(ingest);
  assert.equal(ingest.label, "POST /ingest");
  assert.ok(ingest.style.strokeDasharray, "a weighed hop is dashed; a resolved call is solid");
  assert.notEqual(ingest.style.stroke, edges.find((e) => e.id.startsWith("tcall:"))?.style.stroke,
    "a crossing gets its own hue - confidence is visible");

  // Ambiguity is said on the edge itself, not only in a tooltip.
  const amb = cross.find((e) => e.label?.includes("ambiguous"));
  assert.ok(amb, "the /health pair is marked on the canvas");

  // Layering: the receiving thread sits to the RIGHT of its caller, so the
  // canvas reads in the request's direction.
  const at = (id) => nodes.find((n) => n.id === id)?.position?.x ?? 0;
  assert.ok(at("telemetry/app.py:ingest_route") > at("gateway/server.ts:postIngestRoute"),
    "the Python route is downstream of the gateway that calls it");
});

test("a project with no crossings renders the same graph as before", () => {
  const empty = { all: [], byThread: {} };
  const a = buildThreadInteractionLayout(env.threads, env.entryPoints, empty);
  const b = buildThreadInteractionLayout(env.threads, env.entryPoints);
  assert.deepEqual(a.edges.map((e) => e.id), b.edges.map((e) => e.id));
});
