/**
 * M19.2 — the system view paints (PLAN-v5 §1, §F).
 *
 * Living-renderer proof for the discrete 4th view: clicking the System
 * toolbar button shows subsystem cards on an L-R canvas
 * (Frontend -> Backend -> Cache/DB/external), Backend expands to reveal
 * its route endpoints, and the layout reads left-to-right as data flow.
 *
 * Gated on system_demo: only that fixture has a frontend (web/) + the
 * full db/cache/external_http spread.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/system/system_demo VG_PORT=4205 PORT=4205 \
 *     npx playwright test test/e2e/m19-system-view.spec.ts \
 *     --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_SYSTEM = FIXTURE.includes("system_demo");
const REVIEW_DIR = join(process.cwd(), "reviews", "m19-system-view");

test.describe("M19.2 — system view", () => {
  test.skip(!IS_SYSTEM, "Requires VG_FIXTURE=test/fixtures/system/system_demo");

  async function openSystemView(page) {
    await page.goto("/");
    // Directory mode boots into the thread index; the toolbar is present.
    await page.getByRole("button", { name: "System" }).click();
    await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 10_000 });
    // Settle fitView so cards land on their stable L-R positions.
    await page.waitForTimeout(600);
  }

  test("paints the subsystem cards, with the external host", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await openSystemView(page);

    // All six derived subsystem kinds render as cards.
    for (const kind of ["frontend", "backend", "cache", "db", "external_http", "library"]) {
      await expect(
        page.locator(`[data-subsystem-node][data-subsystem-kind="${kind}"]`).first(),
        `missing subsystem card kind=${kind}`,
      ).toBeVisible();
    }

    // The external host card carries the parsed host id.
    await expect(
      page.locator('[data-subsystem-id="external_http:api.stripe.com"]'),
    ).toBeVisible();

    // Edges painted between subsystems (calls + effect).
    const edges = page.locator(".react-flow__edge");
    expect(await edges.count(), "expected cross-subsystem edges").toBeGreaterThan(3);

    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "system-overview.png"), fullPage: false });

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });

  test("card evidence reads as human language, not IR vocabulary", async ({ page }) => {
    await openSystemView(page);

    // The detection line answers "how was this found?" in plain words;
    // raw IR evidence strings never reach the card (NEXT-ACTIONS §2).
    const db = page.locator('[data-subsystem-node][data-subsystem-kind="db"]').first();
    await expect(db).toContainText("detected from database calls");
    const cache = page.locator('[data-subsystem-node][data-subsystem-kind="cache"]').first();
    await expect(cache).toContainText("matched by name");
    const http = page.locator('[data-subsystem-node][data-subsystem-kind="external_http"]').first();
    await expect(http).toContainText("detected from HTTP calls");

    for (const leaked of ["effectKind:db", "effectKind:http", "name-match"]) {
      await expect(
        page.locator("[data-subsystem-node]", { hasText: leaked }),
        `IR string "${leaked}" leaked onto a card`,
      ).toHaveCount(0);
    }
  });

  test("Backend expands to reveal its route endpoints", async ({ page }) => {
    await openSystemView(page);

    const backend = page.locator('[data-subsystem-node][data-subsystem-kind="backend"]').first();
    // Endpoints are hidden at rest (progressive disclosure).
    await expect(backend.locator("[data-subsystem-endpoint]")).toHaveCount(0);

    await backend.locator("[data-subsystem-expand]").click();

    const endpoints = backend.locator("[data-subsystem-endpoint]");
    await expect(endpoints.first()).toBeVisible();
    // system_demo has three route handlers.
    expect(await endpoints.count(), "expected the 3 route endpoints").toBe(3);
    await expect(endpoints.filter({ hasText: "get_user_route" })).toHaveCount(1);

    await page.screenshot({ path: join(REVIEW_DIR, "backend-expanded.png"), fullPage: false });
  });

  test("M19.3: clicking a route endpoint drills into its thread", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await openSystemView(page);

    const backend = page.locator('[data-subsystem-node][data-subsystem-kind="backend"]').first();
    await backend.locator("[data-subsystem-expand]").click();

    // get_user_route reaches the cache + db — clicking it opens that thread.
    await backend.locator('[data-subsystem-endpoint][data-entry-id="app.py:get_user_route"]').click();

    // Drill-down lands in the thread view (threads ARE the system, §1.4).
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    expect(await page.locator(".vg-thread-node").count()).toBeGreaterThan(1);

    const drillDir = join(process.cwd(), "reviews", "m19-drilldown");
    mkdirSync(drillDir, { recursive: true });
    await page.screenshot({ path: join(drillDir, "endpoint-to-thread.png"), fullPage: false });

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });

  test("M19.3: clicking a derived subsystem card drills to its code in the diagram", async ({ page }) => {
    await openSystemView(page);

    // The db card's first effect ref is in store.py — clicking it should
    // leave the system view for the diagram.
    await page.locator('[data-subsystem-node][data-subsystem-kind="db"]').first().click();

    await expect(page.locator("[data-system-view]")).toHaveCount(0, { timeout: 10_000 });
    // Diagram canvas (react-flow) is now the active surface.
    await expect(page.locator(".react-flow").first()).toBeVisible();
  });

  test("layout reads left-to-right: frontend < backend < db/external", async ({ page }) => {
    await openSystemView(page);

    const box = async (sel: string) => {
      const b = await page.locator(sel).first().boundingBox();
      if (!b) throw new Error(`no bounding box for ${sel}`);
      return b;
    };
    const frontend = await box('[data-subsystem-kind="frontend"]');
    const backend = await box('[data-subsystem-kind="backend"]');
    const db = await box('[data-subsystem-kind="db"]');

    // Data flows rightward: frontend column is left of backend, which is
    // left of the I/O boundary column.
    expect(frontend.x, "frontend should sit left of backend").toBeLessThan(backend.x);
    expect(backend.x, "backend should sit left of db").toBeLessThan(db.x);
  });
});
