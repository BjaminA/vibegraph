/**
 * M-FV.3 (W3) — file-view logic-flow edges: off by default, toggleable,
 * thread-parity styling.
 *
 * The file view drew every edge (mostly `contains` nesting lines, redundant
 * with the M-FV.2 indentation) by default — noisy lines crossing the code.
 * Now edges are OFF by default and revealed per family via the Edges panel (named "Filters" until
 * 2026-08-03 — renamed to what it is actually reached for):
 *   Flow lines      = call / reference (the logic flow), thread-styled
 *   Structure lines = contains / nesting
 * plus an all-on/all-off master. (The file view has no thread extraction, so
 * the brief's "per-thread" toggle is realised as per-family.)
 *
 * Boot with VG_FIXTURE=test/fixtures/threads/big_demo. signals.py has
 * module-level functions that call each other → 10 intra-file flow edges.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("big_demo"), "Requires VG_FIXTURE=test/fixtures/threads/big_demo");

async function openFile(page: import("@playwright/test").Page, file: string) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index],.react-flow__node", { timeout: 15_000 });
  await page.click('[data-side-panel-tab="files"]');
  await page.click(`[data-file-tree-row="${file}"]`);
  await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
}

const edgeCount = (page: import("@playwright/test").Page) =>
  page.locator(".react-flow__edge").count();

test.describe("file view — flow edges (W3)", () => {
  test("edges are hidden by default", async ({ page }) => {
    await openFile(page, "signals.py");
    // Give react-flow a beat to paint any edges it would draw.
    await page.waitForTimeout(300);
    expect(await edgeCount(page)).toBe(0);
  });

  test("Flow toggle reveals thread-styled flow edges", async ({ page }) => {
    await openFile(page, "signals.py");
    await page.click('button:has-text("Edges")');
    await page.click('[data-edge-toggle="showFlowEdges"]');
    // Flow edges now render…
    await expect.poll(() => edgeCount(page)).toBeGreaterThan(0);
    // …and carry the shared thread-parity class (luminous accent + glow).
    await expect.poll(() => page.locator(".vg-flow-edge").count()).toBeGreaterThan(0);
  });

  test("master all-on / all-off toggles every edge", async ({ page }) => {
    await openFile(page, "signals.py");
    await page.click('button:has-text("Edges")');
    expect(await edgeCount(page)).toBe(0);

    await page.click("[data-edges-master]"); // all on (flow + structure)
    await expect.poll(() => edgeCount(page)).toBeGreaterThan(0);

    await page.click("[data-edges-master]"); // all off
    await expect.poll(() => edgeCount(page)).toBe(0);
  });
});
