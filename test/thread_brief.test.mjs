// The thread brief (2026-09-29): one call — a thread's contract, then the
// verbatim source of its functions, ranked as the thread view ranks them.
// Driven through the CLI's `brief`, which the MCP tool vibegraph_thread_brief
// shares its builder with (src/server/thread_brief.ts).
//
//   npm run test:thread-brief
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBrief } from "../scripts/cli/brief.mjs";

const FLEET = "examples/fleet-telemetry";
let cache;
before(() => { cache = mkdtempSync(join(tmpdir(), "vg-brief-")); process.env.VG_CACHE_DIR = cache; });
after(() => { rmSync(cache, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

test("the brief is the contract, then primary source, then the project's helpers", () => {
  const r = runBrief({ root: FLEET, entryPointId: "telemetry/alerts.py:evaluate", pipeline: {} });
  assert.equal(r.exitCode, 0);
  const t = r.text;
  assert.match(t, /^# Thread brief: telemetry\/alerts:evaluate/);
  assert.match(t, /## Thread contract \(IR fact/);
  const primaryAt = t.indexOf("## Primary functions, verbatim");
  const secondaryAt = t.indexOf("## Secondary functions");
  assert.ok(primaryAt > 0 && secondaryAt > primaryAt, "primary before secondary");
  assert.match(t.slice(primaryAt, secondaryAt), /### evaluate — telemetry\/alerts\.py:36-58/);
  assert.match(t.slice(primaryAt, secondaryAt), /def evaluate\(reading: dict\) -> dict \| None:/, "verbatim source");
  assert.match(t.slice(secondaryAt), /### notify — telemetry\/alerts\.py/);
  assert.match(t.slice(secondaryAt), /### post_json — telemetry\/http_client\.py/);
  assert.equal((t.match(/### should_notify /g) ?? []).length, 1, "each function once");
});

test("a small budget names what it left out and how to fetch it", () => {
  const r = runBrief({ root: FLEET, entryPointId: "telemetry/alerts.py:evaluate", maxChars: 3000, pipeline: {} });
  assert.ok(r.text.length <= 3400);
  assert.match(r.text, /Not included \(over the 3000-character budget or unreadable\): .*vibegraph_get_node_source/);
  assert.ok(r.brief.omitted.length > 0);
});

test("the contract itself is ranked: a primary path first, the rest counted, tertiary hops not listed", async () => {
  const { buildPolyglotEnvelope } = await import("../scripts/regen_polyglot.mjs");
  const { threadContexts } = await import("../scripts/thread_context.mjs");
  const { formatContractBlock } = await import("../src/server/thread_contract.ts");
  const env = buildPolyglotEnvelope(FLEET, { skipSystem: true }).envelope;
  const c = threadContexts(env, FLEET, [], { only: new Set(["telemetry/app.py:ingest_route"]) }).byEntry.get("telemetry/app.py:ingest_route").contract;
  const block = formatContractBlock(c);
  assert.match(block, /^Path \(primary — what this thread does, in walk order\): ingest_route → ingest_batch → insert_readings/m);
  assert.match(block, /^Also on this thread: \d+ secondary \(.*helpers.*\), \d+ tertiary \(.*local ops/m);
  assert.match(block, /^Untraceable hops: .*; \+\d+ tertiary \(local data work, runtime, logging\)$/m);
  assert.doesNotMatch(block.split("\n").find((l) => l.startsWith("Untraceable hops")), /problems\.append/, "local list appends are counted, not listed");
});

test("an unknown entry point is refused with near matches", () => {
  const r = runBrief({ root: FLEET, entryPointId: "telemetry/alerts.py:evaluat", pipeline: {} });
  assert.equal(r.exitCode, 1);
  assert.match(r.text, /No thread for telemetry\/alerts\.py:evaluat/);
});
