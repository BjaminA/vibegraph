/**
 * M-NA7 semantic-zoom tiers + M-ZOOM's band below them (PLAN-v5 §5.2).
 *
 * The fork asked for thread and system to be one plane you zoom between
 * rather than two views you switch. M-NA7 built the tiers inside a
 * thread; this pins the LAST band — the one that leaves the thread — and
 * the property that makes it usable rather than startling: it fires on
 * CROSSING, once, not while you sit at the bottom of the range.
 *
 * Run: npm run test:lod
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tierForZoom, crossedToSystem, crossedToThread,
  LOD_COMPACT_BELOW, LOD_OVERVIEW_BELOW, LOD_SYSTEM_BELOW, LOD_THREAD_ABOVE,
  lodLabelFontSize,
} from "../src/webview/threads/lod.ts";

test("the M-NA7 bands are unchanged", () => {
  assert.equal(tierForZoom(1), "full");
  assert.equal(tierForZoom(LOD_COMPACT_BELOW), "full");
  assert.equal(tierForZoom(LOD_COMPACT_BELOW - 0.01), "compact");
  assert.equal(tierForZoom(LOD_OVERVIEW_BELOW), "compact");
  assert.equal(tierForZoom(LOD_OVERVIEW_BELOW - 0.01), "overview");
  assert.equal(tierForZoom(0.01), "overview", "the tier vocabulary stops at overview");
});

test("leaving the thread sits below overview, but ABOVE the canvas's zoom floor", () => {
  assert.ok(LOD_SYSTEM_BELOW < LOD_OVERVIEW_BELOW / 1.8,
    "a view change must not happen while someone is still reading the map");
  // ThreadView sets minZoom={0.1} (M23). A threshold at that floor can
  // never be CROSSED - zoom clamps and stops - so the band would be
  // unreachable and the reader would click a dead control forever.
  assert.ok(LOD_SYSTEM_BELOW > 0.1, "must be reachable above the canvas floor");
});

test("the transition fires on CROSSING, once — not every frame at the bottom", () => {
  // react-flow's onMove is continuous; a predicate on the current zoom
  // alone would re-fire forever once the user got there.
  assert.equal(crossedToSystem(0.2, 0.05), true, "crossed downward");
  assert.equal(crossedToSystem(0.05, 0.04), false, "already below: no repeat");
  assert.equal(crossedToSystem(0.05, 0.2), false, "going back up is not the trigger");
  assert.equal(crossedToSystem(LOD_SYSTEM_BELOW, LOD_SYSTEM_BELOW - 0.001), true, "the edge itself");
  assert.equal(crossedToSystem(0.5, 0.5), false, "no move, no crossing");
});

test("the way back up is the mirror image", () => {
  assert.equal(crossedToThread(1.0, 1.5), true);
  assert.equal(crossedToThread(1.5, 1.6), false, "already above: no repeat");
  assert.equal(crossedToThread(1.5, 1.0), false);
  assert.ok(LOD_THREAD_ABOVE > 1, "descending needs a deliberate zoom IN, past the default");
});

test("inverse-zoom label sizing still caps", () => {
  assert.equal(lodLabelFontSize(11, 22), "min(calc(11px * var(--vg-inv-zoom, 1)), 22px)");
});
