/**
 * File view — the Edges panel tells the truth about what it can draw.
 *
 * Reported 2026-08-04 as "not sure it's working". It was working, but it
 * looked broken: a single-file view CANNOT draw an edge whose target node
 * lives in another file, and react-flow drops those silently. On the pump
 * example that meant predict.py held 7 flow edges in the IR and drew 2, and
 * metrics.py drew nothing at all with no explanation. Toggling a control and
 * seeing nothing happen is indistinguishable from a broken control.
 *
 * The contract pinned here is that the panel's claim MATCHES what is on
 * screen:
 *   - the reported "drawable" count equals the rendered flow-edge count,
 *   - edges leaving the file are reported rather than silently swallowed,
 *   - a file with no flow edges says so.
 *
 * Fixture-agnostic on purpose: the invariant is a relationship between the
 * note and the canvas, not a hard-coded count.
 *
 * Boot (bundled into test:e2e-flask):
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/fileview-edge-toggles.spec.ts
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("file view — edge toggles report what they cannot draw", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  async function openFile(page: import("@playwright/test").Page, file: string) {
    await page.goto("/");
    await page.waitForSelector('[data-side-panel-tab="files"]', { timeout: 15_000 });
    await page.click('[data-side-panel-tab="files"]');
    await page.click(`[data-file-tree-row="${file}"]`);
    await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
    await page.waitForTimeout(900);
  }

  const openPanel = async (page: import("@playwright/test").Page) => {
    await page.locator('button:has-text("Edges")').first().click();
    await expect(page.locator("[data-edge-toggle='showFlowEdges']")).toBeVisible({ timeout: 5_000 });
  };

  test("edges are hidden by default and both families toggle on", async ({ page }) => {
    await openFile(page, "models.py");
    expect(await page.locator(".react-flow__edge").count(),
      "edges are OFF by default — indentation already carries nesting").toBe(0);

    await openPanel(page);
    await page.locator("[data-edge-toggle='showFlowEdges']").click();
    await page.waitForTimeout(500);
    const afterFlow = await page.locator(".react-flow__edge").count();

    await page.locator("[data-edge-toggle='showStructureEdges']").click();
    await page.waitForTimeout(500);
    const afterBoth = await page.locator(".react-flow__edge").count();

    expect(afterBoth, "structure lines must add contains/nesting edges on top of flow")
      .toBeGreaterThan(afterFlow);
  });

  test("the panel's drawable count equals what is actually on the canvas", async ({ page }) => {
    await openFile(page, "models.py");
    await openPanel(page);
    await page.locator("[data-edge-toggle='showFlowEdges']").click();
    await page.waitForTimeout(600);

    const note = page.locator("[data-flow-edge-note]");
    await expect(note, "the file view must report what the flow toggle can draw").toHaveCount(1);
    const text = await note.innerText();
    const rendered = await page.locator(".react-flow__edge").count();

    if (/No flow edges in this file/.test(text)) {
      expect(rendered, "claiming no flow edges while drawing some would be a lie").toBe(0);
    } else {
      const claimed = Number(text.match(/^(\d+) drawable here/)?.[1] ?? NaN);
      expect(Number.isFinite(claimed), `could not parse a drawable count from "${text}"`).toBe(true);
      expect(claimed, `panel claims ${claimed} drawable, canvas shows ${rendered}`).toBe(rendered);
    }
  });

  test("flow edges leaving the file are reported, not silently dropped", async ({ page }) => {
    // models.py calls into db.py, so some of its flow edges cannot be drawn
    // in a single-file view. That omission must be stated.
    await openFile(page, "models.py");
    await openPanel(page);
    await page.locator("[data-edge-toggle='showFlowEdges']").click();
    await page.waitForTimeout(600);

    const text = await page.locator("[data-flow-edge-note]").innerText();
    expect(text, "an off-file count must be named, with somewhere to follow it")
      .toMatch(/leave this file — open the Thread view/);
  });
});
