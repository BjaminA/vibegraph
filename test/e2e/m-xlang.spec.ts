/**
 * M-XLANG.2 (PLAN-M-V5FORKS.md, PLAN-v5 §5.1) — walking a crossing.
 *
 * PLAN-v5 called cross-language tracing the HEAVY fork. This is the proof
 * that it works as a thing you can USE, not only a fact in a contract:
 * open the TypeScript gateway's thread, click the `fetch` terminal, and
 * the tooltip names the Flask route that serves the path and opens that
 * thread on click. Two languages, one walk.
 *
 * The honesty half matters as much: the shop_demo gateway calls
 * `/orders/${id}`, which NO route in that project serves, so the same
 * surface says so instead of offering a dead button.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/polyglot/shop_demo VG_PORT=4302 PORT=4302 \
 *     npx playwright test test/e2e/m-xlang.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_POLYGLOT = FIXTURE.includes("shop_demo");

async function openThreadAndPin(page: import("@playwright/test").Page, thread: string, terminalId: string) {
  const row = page.getByRole("button", { name: thread, exact: true }).first();
  await row.waitFor({ state: "visible", timeout: 15_000 });
  await row.click();
  await page.waitForTimeout(700);
  await page.locator(".react-flow__controls-fitview").click();
  await page.waitForTimeout(500);
  const node = page.locator(`.react-flow__node[data-id="${terminalId}"]`).first();
  await node.waitFor({ state: "visible", timeout: 10_000 });
  await node.scrollIntoViewIfNeeded();
  await node.click();
  const tooltip = page.locator("[data-thread-tooltip]");
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  return tooltip;
}

test.describe("M-XLANG — a thread's HTTP hop can be walked into another language", () => {
  test.skip(!IS_POLYGLOT, "Requires the polyglot shop_demo fixture");

  test("the TS gateway's fetch names the Python route that serves it, and opens it", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 20_000 });

    // createOrder POSTs /orders; api/app.py:create_order serves POST /orders.
    // The gateway serves POST /orders itself, and same-service exclusion is
    // what keeps this to ONE target.
    const tooltip = await openThreadAndPin(page, "POST /orders", "external:fetch");
    const crossing = tooltip.locator("[data-crossing]");
    await expect(crossing).toBeVisible();
    await expect(crossing).toHaveAttribute("data-crossing-path", "/orders");
    await expect(crossing).toHaveAttribute("data-crossing-confidence", "path+method");
    await expect(crossing).toContainText("Leaves this language: POST /orders");
    // The note always says what the match could not establish.
    await expect(crossing).toContainText("base URL is not resolved");

    const target = crossing.locator('[data-crossing-target="api/app.py:create_order"]');
    await expect(target).toBeVisible();
    await expect(target).toContainText("POST");

    // Walk it: the Python thread opens.
    await target.click();
    await page.waitForTimeout(1200);
    await expect(page.locator('.react-flow__node[data-id="api/app:create_order"]').first())
      .toBeVisible({ timeout: 10_000 });
  });

  test("a path no route serves offers no button, and says why", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 20_000 });

    // getOrders calls BOTH /orders (served, terminal external:fetch@1) and
    // /orders/${id} (served by NOTHING in this project, terminal
    // external:fetch). Pin the unmatched one.
    const tooltip = await openThreadAndPin(page, "GET /orders", "external:fetch");
    const crossing = tooltip.locator("[data-crossing]");
    await expect(crossing).toHaveAttribute("data-crossing-confidence", "unmatched");
    await expect(crossing).toContainText("No route in this project serves that path.");
    await expect(crossing.locator("[data-crossing-target]")).toHaveCount(0);
  });
});
