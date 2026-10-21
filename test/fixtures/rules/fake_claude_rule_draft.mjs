#!/usr/bin/env node
/**
 * Stub `claude -p --output-format json` for PLAN-M-RULES M2 (rules proposed
 * from the architecture), answering against examples/fleet-telemetry with a
 * reply DELIBERATELY MIXED so the gate has work to do:
 *
 *   1. good       — cites funnel:telemetry.storage and a harvested sentence,
 *                   scope is a real folder plus one invented file, check
 *                   import-only sqlite3 in telemetry/storage.py (passes) →
 *                   stored, the invented file dropped, the sentence its cite;
 *   2. fabricated — cites only ids it was never shown → refused, listed as
 *                   without evidence;
 *   3. duplicate  — the same check as the stated c1 (import-only requests in
 *                   telemetry/http_client.py), reworded → refused, restates c1;
 *   4. undecidable— a callers-only check on a function that does not exist →
 *                   stored as prose, the check removed and said;
 *   5. nowhere    — a scope naming only things the project does not have →
 *                   refused.
 *
 * Any other prompt gets an empty result. Automated tests never spawn the real `claude`.
 */
import { readFileSync } from "node:fs";
const dash = process.argv.indexOf("--");
const prompt = dash >= 0 ? process.argv[dash + 1] ?? "" : (() => { try { return readFileSync(0, "utf-8"); } catch { return ""; } })();
const denied = (process.argv[process.argv.indexOf("--disallowedTools") + 1] ?? "").split(",");
if (!process.argv.includes("--disallowedTools") || !denied.includes("Bash")) {
  process.stdout.write(JSON.stringify({ result: "STUB REFUSES: a reasoning spawn arrived able to run Bash", is_error: true }));
  process.exit(1);
}
if (!prompt.includes("You are proposing the RULES a codebase must keep")) {
  process.stdout.write(JSON.stringify({ result: "" }));
  process.exit(0);
}
const REPLY = {
  rules: [
    {
      kind: "invariant",
      text: "Only telemetry/storage.py opens sqlite3 connections; every other module goes through its functions.",
      why: "storage.py is the funnel for sqlite3 and the census finds no direct use elsewhere",
      scope: { files: ["telemetry/", "telemetry/nonexistent.py"] },
      cites: ["funnel:telemetry.storage", "direction:funnel:sqlite3", "harvest:README.md:14"],
      check: { rule: "import-only", tool: "sqlite3", files: ["telemetry/storage.py"] },
    },
    {
      kind: "invariant",
      text: "Every gateway route rate-limits callers to ten requests a second per token.",
      why: "the operators said so",
      scope: { files: ["gateway/"] },
      cites: ["ops:runbook:9", "slack:2026-01-03"],
    },
    {
      kind: "proxy",
      text: "The requests library is imported by telemetry/http_client.py and by nothing else in the Python service.",
      why: "it is the one egress path",
      scope: { files: ["telemetry/"] },
      cites: ["funnel:telemetry.http_client"],
      check: { rule: "import-only", tool: "requests", files: ["telemetry/http_client.py"] },
    },
    {
      kind: "invariant",
      text: "Readings reach storage only through ingest.store_batch, which validates them first.",
      why: "the ingest pipeline validates before storing",
      scope: { entryPointIds: ["telemetry/app.py:ingest_route"] },
      cites: ["boundary:sqlite3"],
      check: { rule: "callers-only", target: "store_batch", files: ["telemetry/ingest.py"] },
    },
    {
      kind: "backend-call",
      text: "The billing worker never calls the payments API without an idempotency key.",
      why: "duplicate charges",
      scope: { files: ["billing/"], entryPointIds: ["billing/worker.py:main"] },
      cites: ["crossing:1"],
    },
  ],
  withoutEvidence: ["The C++ codec should never allocate on the decode path."],
};
const final = JSON.stringify({ type: "result", result: JSON.stringify(REPLY), is_error: false });
if (!process.argv.includes("stream-json")) {
  process.stdout.write(final);
} else {
  // 2026-10-21 — as the CLI streams when the app shows the work (src/server/
  // llm_stream.ts): init, thinking, the reply in pieces, then the result,
  // over about three seconds so a test can close the panel mid-run
  const text = JSON.stringify(REPLY);
  const chunks = [0, 1, 2, 3].map((i) => text.slice((i * text.length) / 4, ((i + 1) * text.length) / 4));
  const events = [
    { type: "system", subtype: "init", model: "stub-rules" },
    { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking" } } },
    { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Reading the facts…" } } },
    { type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "text" } } },
    ...chunks.map((c) => ({ type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: c } } })),
  ];
  for (const e of events) {
    process.stdout.write(JSON.stringify(e) + "\n");
    await new Promise((r) => setTimeout(r, 400));
  }
  process.stdout.write(final + "\n");
}
