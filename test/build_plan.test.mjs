// PLAN-v7 Stage 5 — the BuildPlan store contract.
//
// validate: shape + kebab ids + unique + FOUNDATION-FIRST STRUCTURAL rule
//   (needs[] may only reference EARLIER items — build order = declared order,
//   DAG by construction).
// persist/load: ratifiedAt stamped, round-trips, corrupt/invalid ignored.
// setItemStatus: transitions persist immediately (the artifact IS run state).
// nextBuildableItem: first pending item with all needs built; items whose
//   needs failed/skipped are BLOCKED with the missing ids surfaced.
//
// Run: npm run test:build-plan

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateBuildPlan, loadBuildPlan, persistBuildPlan,
  setItemStatus, nextBuildableItem, BUILD_PLAN_RELPATH,
} from "../src/server/build_plan.ts";

const goodPlan = () => ({
  version: "1",
  description: "a flask API with a sqlite note store",
  items: [
    { id: "validation", capability: "pure note validation", needs: [], groundedIn: "a flask API", status: "pending" },
    { id: "store", capability: "sqlite note store", needs: ["validation"], groundedIn: "a sqlite note store", status: "pending" },
    { id: "post-route", capability: "POST /notes route", needs: ["validation", "store"], groundedIn: null, status: "pending" },
  ],
  drafted: false,
});

test("validate: accepts a well-formed plan; rejects forward/unknown needs, dup ids, bad slug", () => {
  assert.equal(validateBuildPlan(goodPlan()), null);

  const forward = goodPlan();
  forward.items[0].needs = ["store"]; // declared LATER — order is build order
  assert.match(validateBuildPlan(forward), /not declared earlier/);

  const unknown = goodPlan();
  unknown.items[1].needs = ["nope"];
  assert.match(validateBuildPlan(unknown), /not declared earlier/);

  const dup = goodPlan();
  dup.items.push({ ...dup.items[0] });
  assert.match(validateBuildPlan(dup), /duplicate id/);

  const badSlug = goodPlan();
  badSlug.items[0].id = "Not A Slug";
  assert.match(validateBuildPlan(badSlug), /kebab-case/);
});

test("persist stamps ratifiedAt + round-trips; setItemStatus persists immediately", () => {
  const root = mkdtempSync(join(tmpdir(), "vg-bp-"));
  try {
    const ok = persistBuildPlan(root, goodPlan());
    assert.ok(ok.plan.ratifiedAt);
    assert.deepEqual(loadBuildPlan(root), ok.plan);

    const t = setItemStatus(root, ok.plan, "validation", "built");
    assert.equal(t.error, undefined);
    // The artifact on disk reflects the transition — run state IS the file.
    const onDisk = JSON.parse(readFileSync(join(root, BUILD_PLAN_RELPATH), "utf-8"));
    assert.equal(onDisk.items[0].status, "built");

    const f = setItemStatus(root, t.plan, "store", "failed", "floor red: impure check");
    assert.equal(loadBuildPlan(root).items[1].failReason, "floor red: impure check");
    assert.ok(f.plan);

    assert.match(setItemStatus(root, f.plan, "ghost", "built").error, /no such item/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("nextBuildableItem: declared order, needs-built gating, blocked surfacing", () => {
  const p = goodPlan();
  // Fresh plan: validation (no needs) is first.
  assert.equal(nextBuildableItem(p).item.id, "validation");

  p.items[0].status = "built";
  assert.equal(nextBuildableItem(p).item.id, "store");

  // store FAILED → post-route is blocked (missing store), nothing buildable.
  p.items[1].status = "failed";
  const r = nextBuildableItem(p);
  assert.equal(r.item, null);
  assert.deepEqual(r.blocked, [{ id: "post-route", missing: ["store"] }]);

  // store skipped behaves the same — dependents build on a hole otherwise.
  p.items[1].status = "skipped";
  assert.equal(nextBuildableItem(p).item, null);

  // all built → done.
  p.items[1].status = "built";
  p.items[2].status = "built";
  const done = nextBuildableItem(p);
  assert.equal(done.item, null);
  assert.equal(done.blocked.length, 0);
});

test("load: missing/corrupt/invalid → null, never half-loaded", () => {
  const root = mkdtempSync(join(tmpdir(), "vg-bp-"));
  try {
    assert.equal(loadBuildPlan(root), null);
    const bad = persistBuildPlan(root, { version: "1" });
    assert.ok(bad.error);
    assert.equal(existsSync(join(root, BUILD_PLAN_RELPATH)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Rehearsal-3 (pump-lab-3) surfaced this: `target-stats` sat at status
// "built" in build-plan.json while STILL carrying
// failReason: "check failed (exit 1)" from an earlier attempt. The old
// merge only overwrote failReason when a new one was supplied, so a
// retried-and-succeeded stage kept its stale failure forever.
test("a retried stage that succeeds drops its old failure", () => {
  const root = mkdtempSync(join(tmpdir(), "vg-bp-retry-"));
  try {
    const ok = persistBuildPlan(root, goodPlan());
    const failed = setItemStatus(root, ok.plan, "store", "failed", "check failed (exit 1)", "AssertionError: 21.84 != 21.87");
    assert.equal(loadBuildPlan(root).items[1].failReason, "check failed (exit 1)");
    assert.match(loadBuildPlan(root).items[1].failOutput, /AssertionError/);

    // Retry succeeds: both the reason AND the diagnostic must go.
    setItemStatus(root, failed.plan, "store", "built");
    const after = loadBuildPlan(root).items[1];
    assert.equal(after.status, "built");
    assert.equal(after.failReason, undefined, "a built stage must not claim it failed");
    assert.equal(after.failOutput, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The whole point of persisting failOutput: "check failed (exit 1)" names an
// exit code and nothing a human can act on.
test("a failed stage keeps the check's own output for triage", () => {
  const root = mkdtempSync(join(tmpdir(), "vg-bp-out-"));
  try {
    const ok = persistBuildPlan(root, goodPlan());
    setItemStatus(root, ok.plan, "store", "failed", "check failed (exit 1)", "Traceback...\nAssertionError: std mismatch");
    const it = loadBuildPlan(root).items[1];
    assert.match(it.failOutput, /std mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
