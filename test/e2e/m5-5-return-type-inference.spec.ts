/**
 * §5.5 — one-hop return-type inference, living-renderer proof.
 *
 * The exact inverse of r4-conn-honesty.spec.ts. There, `conn = _get_conn()`
 * with an UNANNOTATED `_get_conn` renders honest `dynamic` (we can't know
 * the type, so we don't guess). Here `_get_conn` carries an explicit
 * `-> sqlite3.Connection` return annotation, so §5.5 resolves one hop
 * through it: `conn.execute` becomes honest-external
 * `sqlite3.Connection.execute` — kind `external`, not `dynamic`.
 *
 * Together the two specs pin BOTH sides of the §5.5 honesty boundary:
 * annotation present → resolve; annotation absent → stay dynamic, never
 * guess. If §5.5 regressed, this node would paint dynamic (amber Shuffle)
 * and every assertion below would fail.
 *
 * Asserts on the painted view:
 *   1. Classification — the conn.execute terminal renders `external`
 *      (DB, blue --accent-io, Database icon), never `dynamic`.
 *   2. The dynamic receiver-binding line ("local binding from _get_conn()")
 *      and the old import-failure lie are both absent from the tooltip.
 *
 * Gated on conn_demo.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/conn_demo VG_PORT=4211 PORT=4211 \
 *     npx playwright test test/e2e/m5-5-return-type-inference.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_CONN = FIXTURE.includes("conn_demo");

test.describe("§5.5 — annotated factory resolves conn.execute to honest external", () => {
  test.skip(!IS_CONN, "Requires VG_FIXTURE=test/fixtures/threads/conn_demo");

  test("external (DB) classification + no dynamic/import lie in tooltip", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="db.py:load_row"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // 1 — classification on the painted node: external/DB marker channels.
    const connNode = page
      .locator(".vg-thread-node")
      .filter({ hasText: "conn.execute" })
      .first();
    await connNode.waitFor({ state: "visible", timeout: 10_000 });
    const marker = await connNode.evaluate((el) => ({
      className: el.className,
      kindLabel: el.getAttribute("data-kind-label"),
      iconName: el.getAttribute("data-icon-name"),
      accentVar: el.getAttribute("data-accent-var"),
    }));
    // The §5.5 win: external, NOT dynamic. (Unannotated factory → dynamic.)
    expect(marker.className).toContain("vg-thread-node-external");
    expect(marker.className).not.toContain("vg-thread-node-dynamic");
    expect(marker.kindLabel).toBe("DB");
    expect(marker.iconName).toBe("Database");
    expect(marker.accentVar).toBe("--accent-io");

    // 2 — the tooltip must not carry the dynamic-receiver line (that's the
    // unannotated-factory path) nor the old failed-import lie.
    await connNode.click();
    const tooltip = page.locator("[data-thread-tooltip]");
    await tooltip.waitFor({ state: "visible", timeout: 5_000 });
    await expect(tooltip).not.toContainText(/local binding from/);
    await expect(tooltip).not.toContainText(/not importable/);
    await expect(tooltip).not.toContainText(/No module named/);

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });

  test("cross-file: factory imported from another module also resolves external DB", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    // load_via_repo's `conn` is bound from `get_conn`, imported from repo.py —
    // the §5.5 project-wide return-type map resolves it across the file boundary.
    await page.click('[data-thread-index-row][data-entry-id="db.py:load_via_repo"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    const connNode = page
      .locator(".vg-thread-node")
      .filter({ hasText: "conn.execute" })
      .first();
    await connNode.waitFor({ state: "visible", timeout: 10_000 });
    const marker = await connNode.evaluate((el) => ({
      className: el.className,
      kindLabel: el.getAttribute("data-kind-label"),
      accentVar: el.getAttribute("data-accent-var"),
    }));
    expect(marker.className).toContain("vg-thread-node-external");
    expect(marker.className).not.toContain("vg-thread-node-dynamic");
    expect(marker.kindLabel).toBe("DB");
    expect(marker.accentVar).toBe("--accent-io");

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
