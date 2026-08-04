// PLAN-v7 Stage 3b — the architecture-draft contract.
//
// Drives the deterministic json-format Claude stub via VG_CLAUDE_BIN (project
// convention; never the real `claude`). Asserts draftSystemPlan:
//   - assembles + validates a SystemPlan (drafted:true) from the model's JSON;
//   - ENFORCES grounding: a claimed quote that does not appear verbatim in the
//     description is demoted to null/INFERRED (models don't get to manufacture
//     their own evidence — the A3 citation-validation lineage);
//   - declines honestly on non-JSON, invalid shape (kind outside the enum),
//     and an empty architecture — never throws.
//
// Run: npm run test:system-draft

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { draftSystemPlan, enforceGrounding, buildPrompt } from "../src/server/system_draft.ts";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));
const STUB = join(ROOT, "test", "fixtures", "run_effects", "fake_claude_json.mjs");

const DESC = "a flask API with a sqlite store and a redis cache";

async function withStub(response, fn) {
  const prevBin = process.env.VG_CLAUDE_BIN;
  const prevResp = process.env.FAKE_SYNTH_RESPONSE;
  process.env.VG_CLAUDE_BIN = `node ${STUB}`;
  process.env.FAKE_SYNTH_RESPONSE = response;
  try {
    return await fn();
  } finally {
    if (prevBin === undefined) delete process.env.VG_CLAUDE_BIN; else process.env.VG_CLAUDE_BIN = prevBin;
    if (prevResp === undefined) delete process.env.FAKE_SYNTH_RESPONSE; else process.env.FAKE_SYNTH_RESPONSE = prevResp;
  }
}

test("drafts a validated SystemPlan from the model JSON", async () => {
  const arch = {
    subsystems: [
      { id: "backend", kind: "backend", label: "Flask API", groundedIn: "a flask API" },
      { id: "db", kind: "db", label: "SQLite store", groundedIn: "a sqlite store" },
    ],
    edges: [{ from: "backend", to: "db", groundedIn: "a sqlite store" }],
  };
  const r = await withStub(JSON.stringify(arch), () => draftSystemPlan(DESC, ROOT));
  assert.equal(r.error, undefined);
  assert.equal(r.plan.drafted, true);
  assert.equal(r.plan.description, DESC);
  assert.equal(r.plan.subsystems.length, 2);
  assert.equal(r.plan.subsystems[0].groundedIn, "a flask API");
});

test("demotes fabricated quotes to INFERRED (grounding enforcement)", async () => {
  const arch = {
    subsystems: [
      { id: "backend", kind: "backend", label: "API", groundedIn: "a flask API" },
      // The model claims a quote that is NOT in the description — not grounding.
      { id: "cache", kind: "cache", label: "Memcached", groundedIn: "a memcached cluster" },
    ],
    edges: [],
  };
  const r = await withStub(JSON.stringify(arch), () => draftSystemPlan(DESC, ROOT));
  assert.equal(r.plan.subsystems[0].groundedIn, "a flask API"); // real quote survives
  assert.equal(r.plan.subsystems[1].groundedIn, null);          // fabricated → INFERRED
});

test("enforceGrounding is case-insensitive and counts demotions", () => {
  const plan = {
    version: "1", description: DESC, drafted: true,
    subsystems: [{ id: "db", kind: "db", label: "x", groundedIn: "A SQLITE STORE" }],
    edges: [{ from: "db", to: "db", groundedIn: "no such words" }],
  };
  const demoted = enforceGrounding(plan, DESC);
  assert.equal(demoted, 1);
  assert.equal(plan.subsystems[0].groundedIn, "A SQLITE STORE");
  assert.equal(plan.edges[0].groundedIn, null);
});

test("declines on non-JSON, invalid kind, and an empty architecture — never throws", async () => {
  const nonJson = await withStub("here is your architecture!", () => draftSystemPlan(DESC, ROOT));
  assert.equal(nonJson.plan, null);
  assert.match(nonJson.error, /not JSON/);

  const badKind = await withStub(
    JSON.stringify({ subsystems: [{ id: "x", kind: "microservice", label: "x", groundedIn: null }], edges: [] }),
    () => draftSystemPlan(DESC, ROOT),
  );
  assert.equal(badKind.plan, null);
  assert.match(badKind.error, /failed validation/);

  const empty = await withStub(JSON.stringify({ subsystems: [], edges: [] }), () => draftSystemPlan(DESC, ROOT));
  assert.equal(empty.plan, null);
  assert.match(empty.error, /no subsystems/);
});

test("M-GF: the draft prompt teaches kind semantics so ghosts stay solidifiable", () => {
  const prompt = buildPrompt("a pytorch CNN trained from data/signals.csv");
  // The greenfield runs drafted a CNN trainer as `backend`, a CLI as
  // `frontend`, and a csv as `db` — permanent unfulfillable ghosts. The
  // prompt now defines each kind in parse-reconciliation terms.
  assert.match(prompt, /NOT a backend/);
  assert.match(prompt, /NOT a frontend/);
  assert.match(prompt, /NOT a db/);
  assert.match(prompt, /ONE library subsystem/);
});
