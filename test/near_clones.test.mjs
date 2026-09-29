// Near-clones (2026-09-29): functions of the same call shape, so a contract
// can say "a fix here probably applies there". The rule and its census are in
// src/shared/near_clones.ts (a private production codebase: 303 pairs, 98% judged real).
//
//   npm run test:near-clones
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { threadContexts } from "../scripts/thread_context.mjs";
import { computeNearClones, normaliseCallee } from "../src/shared/near_clones.ts";
import { formatContractBlock } from "../src/server/thread_contract.ts";

let env;
before(() => { env = buildPolyglotEnvelope("test/fixtures/near_clones/clone_demo", { skipSystem: true }).envelope; });

test("callees normalise to their last name segment", () => {
  assert.equal(normaliseCallee("await client.users.get(x)"), "get");
  assert.equal(normaliseCallee("new Foo<Bar>(1).baz?.qux"), "qux");
  assert.equal(normaliseCallee("String(s).normalize().replace(a, b).toLowerCase"), "toLowerCase");
  assert.equal(normaliseCallee("requests.get"), "get");
});

test("copy-paste siblings are near-clones; low-variety boilerplate is not measured", () => {
  const clones = computeNearClones(env.files);
  const details = clones.get("charity.py::module/fetch_details.fn");
  assert.deepEqual(details?.map((c) => [c.name, c.score]), [["fetch_overview", 1]]);
  assert.equal(clones.get("charity.py::module/register_all.fn"), undefined, "one distinct callee: not eligible, so no line");
  assert.equal(clones.get("registry.py::module/register_more.fn"), undefined);
});

test("the contract names the sibling, with the score and what it does not claim", () => {
  const ep = env.entryPoints.find((e) => e.irNodeId === "module/fetch_details.fn");
  assert.ok(ep, "fetch_details is an entry point (public_api or manual)" );
  const ctx = threadContexts(env, "test/fixtures/near_clones/clone_demo", []);
  const block = formatContractBlock(ctx.byEntry.get(ep.id).contract);
  assert.match(block, /Shaped like \(same call sequence elsewhere — 3-gram Jaccard >= 0\.7; a fix here probably applies there; structural, not verified\):/);
  assert.match(block, /- `fetch_details` is shaped like charity\.py:fetch_overview \(1\.00, identical call sequence\)/);
});

test("the fleet example has no copy-paste, and the rule says so: zero pairs", () => {
  const cache = mkdtempSync(join(tmpdir(), "vg-nc-"));
  try {
    const fleet = buildPolyglotEnvelope("examples/fleet-telemetry", { skipSystem: true }).envelope;
    assert.equal(computeNearClones(fleet.files).size, 0);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});
