/**
 * M-NA7 semantic-zoom tiers (PLAN-v5 §5.2), and the rule that replaced
 * M-ZOOM's band below them (2026-10-20): a zoom is a RENDERING change, never
 * a view change. The band that left the thread for the system plane was
 * crossed by fits the view made itself — switching a big thread to "All", a
 * small thread's automatic re-fit, a nest opening — and the reader was dropped
 * into the thread-interaction view (removed with it) mid-read.
 *
 * Run: npm run test:lod
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as lod from "../src/webview/threads/lod.ts";

const { tierForZoom, LOD_COMPACT_BELOW, LOD_OVERVIEW_BELOW, lodLabelFontSize } = lod;

test("the M-NA7 bands are unchanged", () => {
  assert.equal(tierForZoom(1), "full");
  assert.equal(tierForZoom(LOD_COMPACT_BELOW), "full");
  assert.equal(tierForZoom(LOD_COMPACT_BELOW - 0.01), "compact");
  assert.equal(tierForZoom(LOD_OVERVIEW_BELOW), "compact");
  assert.equal(tierForZoom(LOD_OVERVIEW_BELOW - 0.01), "overview");
  assert.equal(tierForZoom(0.01), "overview", "the tier vocabulary stops at overview");
});

test("no zoom changes view: the thread view dispatches no view change, and nothing listens for one", () => {
  assert.equal("crossedToSystem" in lod, false);
  assert.equal("LOD_SYSTEM_BELOW" in lod, false);
  const thread = readFileSync("src/webview/threads/ThreadView.tsx", "utf-8");
  const app = readFileSync("src/webview/App.tsx", "utf-8");
  const system = readFileSync("src/webview/system/SystemView.tsx", "utf-8");
  assert.doesNotMatch(thread, /dispatchEvent\(new CustomEvent\("vg-zoom-to-system"/);
  assert.doesNotMatch(app, /addEventListener\("vg-zoom-to-system"/);
  assert.doesNotMatch(system, /crossedToThread|focusEntryPointId/, "and the system view opens no thread on a zoom");
});

test("inverse-zoom label sizing still caps", () => {
  assert.equal(lodLabelFontSize(11, 22), "min(calc(11px * var(--vg-inv-zoom, 1)), 22px)");
});
