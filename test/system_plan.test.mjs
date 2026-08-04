// PLAN-v7 Stage 3 — the SystemPlan store contract.
//
// validate: shape-pins the plan (version / non-empty description / kind enum /
//   unique ids / groundedIn string|null) and produces honest reasons.
// persist: refuses invalid plans, stamps ratifiedAt, writes
//   .vibegraph/system-plan.json under the given root.
// load: missing → null; corrupt JSON or invalid shape → null + ignored
//   (never half-loaded); valid → the plan.
//
// Run: npm run test:system-plan

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSystemPlan, loadSystemPlan, persistSystemPlan, PLAN_RELPATH } from "../src/server/system_plan.ts";

const goodPlan = () => ({
  version: "1",
  description: "a flask API with a sqlite store and a redis cache",
  subsystems: [
    { id: "backend", kind: "backend", label: "Flask API", groundedIn: "a flask API" },
    { id: "cache", kind: "cache", label: "Redis cache", groundedIn: "a redis cache" },
    { id: "external_http:api.stripe.com", kind: "external_http", label: "Stripe", groundedIn: null },
  ],
  edges: [
    { from: "backend", to: "cache", groundedIn: "a redis cache" },
    { from: "backend", to: "external_http:api.stripe.com", groundedIn: null },
  ],
  drafted: false,
});

test("validate: accepts a well-formed plan", () => {
  assert.equal(validateSystemPlan(goodPlan()), null);
});

test("validate: rejects empty description, bad kind, duplicate ids, bad groundedIn", () => {
  assert.match(validateSystemPlan({ ...goodPlan(), description: "  " }), /description/);
  const badKind = goodPlan();
  badKind.subsystems[0].kind = "microservice";
  assert.match(validateSystemPlan(badKind), /kind must be one of/);
  const dup = goodPlan();
  dup.subsystems.push({ ...dup.subsystems[0] });
  assert.match(validateSystemPlan(dup), /duplicate id/);
  const badGround = goodPlan();
  badGround.subsystems[1].groundedIn = 42;
  assert.match(validateSystemPlan(badGround), /groundedIn/);
  assert.match(validateSystemPlan("nope"), /must be an object/);
  assert.match(validateSystemPlan({ ...goodPlan(), version: "2" }), /unknown plan version/);
});

test("persist: refuses an invalid plan; stamps + writes a valid one; load round-trips", () => {
  const root = mkdtempSync(join(tmpdir(), "vg-plan-"));
  try {
    const bad = persistSystemPlan(root, { nope: true });
    assert.ok(bad.error);
    assert.equal(existsSync(join(root, PLAN_RELPATH)), false, "invalid plan must not be written");

    const ok = persistSystemPlan(root, goodPlan());
    assert.equal(ok.error, undefined);
    assert.ok(ok.plan.ratifiedAt, "acceptance stamps ratifiedAt");
    assert.equal(ok.path, join(root, PLAN_RELPATH));

    const onDisk = JSON.parse(readFileSync(join(root, PLAN_RELPATH), "utf-8"));
    assert.equal(onDisk.description, goodPlan().description);

    const loaded = loadSystemPlan(root);
    assert.deepEqual(loaded, ok.plan);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("load: missing → null; corrupt JSON → null; invalid shape → null (ignored, never half-loaded)", () => {
  const root = mkdtempSync(join(tmpdir(), "vg-plan-"));
  try {
    assert.equal(loadSystemPlan(root), null);

    mkdirSync(join(root, ".vibegraph"), { recursive: true });
    writeFileSync(join(root, PLAN_RELPATH), "{ not json", "utf-8");
    assert.equal(loadSystemPlan(root), null);

    writeFileSync(join(root, PLAN_RELPATH), JSON.stringify({ version: "1" }), "utf-8");
    assert.equal(loadSystemPlan(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
