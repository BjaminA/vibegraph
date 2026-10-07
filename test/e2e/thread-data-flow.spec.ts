/**
 * What an arrow carries, in the thread view (2026-10-07). `xs, ys =
 * load(...)`, `model = build(len(xs))`, `train(model, xs, ys)`: the call
 * edge labels say what comes back (`→ xs, ys`), and amber dashed data-flow
 * lines run load ⇢ build (xs), load ⇢ train (xs, ys), build ⇢ train (model).
 *
 *   VG_FIXTURE=test/fixtures/threads/dataflow_demo VG_PORT=4311 PORT=4311 \
 *     npx playwright test test/e2e/thread-data-flow.spec.ts --workers=1
 */
import { test, expect } from "@playwright/test";

const IS_DEMO = (process.env.VG_FIXTURE ?? "").includes("dataflow_demo");

test.describe("thread data flow", () => {
  test.skip(!IS_DEMO, "Requires VG_FIXTURE=test/fixtures/threads/dataflow_demo");
  test.use({ viewport: { width: 1600, height: 1000 } });

  test("call labels say what comes back; data-flow lines join producer to consumer", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
    await page.locator('[data-thread-index-row][data-entry-id*="main"]').first().click();
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 15_000 });
    await page.locator("[data-rank-level='3']").first().click();
    await page.waitForTimeout(1500);

    // the call edge into load says what goes in and what comes back (the
    // label itself is drawn only where it covers no card; the edge carries it)
    const carries = await page.locator(".vg-thread-edge[data-edge-carries]").evaluateAll((gs) =>
      Object.fromEntries(gs.map((g) => [`${g.getAttribute("data-source")}->${g.getAttribute("data-target")}`, g.getAttribute("data-edge-carries")])));
    const intoLoad = Object.entries(carries).find(([k]) => /main->.*load$/.test(k));
    expect(intoLoad?.[1], JSON.stringify(carries)).toBe('("data.csv") → xs, ys');

    // the data-flow lines, by endpoint, and the names each carries
    const flows = await page.locator(".vg-thread-edge-dataflow").evaluateAll((gs) =>
      gs.map((g) => `${(g.getAttribute("data-source") ?? "").split(":").pop()}->${(g.getAttribute("data-target") ?? "").split(":").pop()} ${g.getAttribute("data-edge-carries")}`));
    expect(flows.sort()).toEqual([
      "build->train its result reaches this call as model",
      "load->build its result reaches this call as xs",
      "load->len its result reaches this call as xs",
      "load->train its result reaches this call as xs, ys",
    ]);
    // the labels that found room are amber
    const flowLabel = page.locator("[data-edge-dataflow]").first();
    await expect(flowLabel).toBeVisible();
    expect(await flowLabel.evaluate((el) => getComputedStyle(el).color))
      .toBe(await page.evaluate(() => { const d = document.createElement("div"); d.style.color = "var(--accent-warning)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }));
    // drawn in the data colour, dashed
    const dash = await page.locator(".vg-thread-edge-dataflow .react-flow__edge-path").first()
      .evaluate((p) => getComputedStyle(p).strokeDasharray);
    expect(dash).not.toBe("none");
  });
});
