/**
 * M-BOUNDARY.4 (PLAN-M-BOUNDARY.md) — the thread view names the TOOL each
 * boundary leaves the project through.
 *
 * The thread view is where these threads are actually read, so a relation
 * the view cannot show is half shipped. The tooltip attributes through the
 * SAME pure rule the server's contract uses (src/shared/stack_attribution.ts),
 * which is why the view and the prompts cannot disagree.
 *
 * Pinned on the polyglot shop_demo, whose `api.db` funnel wraps sqlite3:
 *   * `conn.commit` — the linker resolved the receiver, so the tooltip names
 *     sqlite3 AND the project funnel the call lives inside;
 *   * `requests.post` — resolved from app.py's import binding, no funnel;
 *   * `print` — no rule reaches it, so NO tool is named and the honest
 *     "no source available" line stands alone. Guessing from a receiver
 *     name is the M17.1 lie this refuses.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/polyglot/shop_demo VG_PORT=4300 PORT=4300 \
 *     npx playwright test test/e2e/m-boundary.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_POLYGLOT = FIXTURE.includes("shop_demo");

/**
 * Open a thread from the launchpad and pin ONE terminal's tooltip.
 *
 * Terminals are addressed by their react-flow node id, not by text: a
 * thread this deep lays its externals well outside the initial viewport,
 * so a text filter finds nothing until the canvas is fitted.
 */
async function pinTerminal(page: import("@playwright/test").Page, thread: string, terminalId: string) {
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

test.describe("M-BOUNDARY.4 — a boundary's tooltip names the tool it leaves through", () => {
  test.skip(!IS_POLYGLOT, "Requires the polyglot shop_demo fixture");

  test("a resolved receiver names its tool AND the funnel; an unattributed one names nothing", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 20_000 });

    // ── the linker resolved this receiver: sqlite3, through the api.db funnel
    let tooltip = await pinTerminal(page, "create_order", "external:sqlite3.Connection.commit");
    const dbLine = tooltip.locator("[data-boundary-tool]");
    await expect(dbLine).toBeVisible();
    await expect(dbLine).toHaveAttribute("data-boundary-tool", "sqlite3");
    await expect(dbLine).toHaveAttribute("data-boundary-via", "api.db");
    await expect(dbLine).toHaveAttribute("data-boundary-how", "qualified");
    await expect(dbLine).toContainText("Leaves the project through sqlite3");
    await expect(dbLine).toContainText("via the api.db funnel");
    await page.keyboard.press("Escape");

    // ── an import binding in the calling file: requests, no funnel
    tooltip = await pinTerminal(page, "create_order", "external:requests.post");
    const httpLine = tooltip.locator("[data-boundary-tool]");
    await expect(httpLine).toHaveAttribute("data-boundary-tool", "requests");
    await expect(httpLine).toHaveAttribute("data-boundary-how", "binding");
    await expect(httpLine).not.toHaveAttribute("data-boundary-via", /.*/);
    await page.keyboard.press("Escape");

    // ── nothing reached it: NO tool is invented. `print` is a builtin the
    // stack index has no row for, so the tooltip keeps its ordinary
    // external-call body and says nothing about a project tool. Guessing
    // one from the receiver name is the M17.1 lie this refuses.
    tooltip = await pinTerminal(page, "main", "external:print");
    await expect(tooltip).toContainText("print");
    await expect(tooltip.locator("[data-boundary-tool]")).toHaveCount(0);
    await expect(tooltip).not.toContainText("Leaves the project through");
    await expect(tooltip).not.toContainText("Leaves through");
  });
});
