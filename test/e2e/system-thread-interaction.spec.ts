/**
 * M-SI — System view thread-interaction mode.
 *
 * A persisted toggle on the System view swaps the subsystem cards for a
 * thread-to-thread graph: one node per thread (entry point), a DIRECTED edge
 * wherever one thread reaches another thread's entry-point head. Clicking a
 * thread node opens that thread.
 *
 * Living-renderer proof on flask_demo, whose entry points form a rich
 * cross-thread call graph (e.g. the create_user route thread reaches
 * db.py:insert and models.py:create_user, both public_api entry points).
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/system-thread-interaction.spec.ts \
 *     --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("flask_demo"), "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

const REVIEW_DIR = join(process.cwd(), "reviews", "system-thread-interaction");

async function openSystemView(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "System" }).click();
  await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400); // settle fitView
}

test.describe("M-SI — system view thread-interaction mode", () => {
  test("defaults to subsystems; toggle reveals the thread-to-thread graph", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await openSystemView(page);

    // Default mode is subsystems.
    await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "subsystems");
    await expect(page.locator("[data-subsystem-node]").first()).toBeVisible();

    // Flip to thread-interaction mode.
    await page.locator("[data-system-mode-toggle]").click();
    await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "threads");
    await page.waitForTimeout(400);

    // One node per thread/entry point. flask_demo has 12 entry points.
    const threadNodes = page.locator("[data-thread-interaction-node]");
    expect(await threadNodes.count(), "expected a node per thread").toBeGreaterThan(6);

    // The two endpoints of a known cross-thread call both render.
    await expect(page.locator('[data-entry-point-id="app.py:create_user_route"]')).toBeVisible();
    await expect(page.locator('[data-entry-point-id="db.py:insert"]')).toBeVisible();

    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "threads-mode.png"), fullPage: false });

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });

  test("renders the directed cross-thread call edges", async ({ page }) => {
    await openSystemView(page);
    await page.locator("[data-system-mode-toggle]").click();
    await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "threads");
    await page.waitForTimeout(400);

    // Plenty of head-reach edges in flask_demo.
    const edges = page.locator(".react-flow__edge");
    expect(await edges.count(), "expected cross-thread call edges").toBeGreaterThan(5);

    // A specific directed edge: create_user_route -> db.py:insert.
    await expect(
      page.locator('.react-flow__edge[data-id="tcall:app.py:create_user_route->db.py:insert"]'),
    ).toHaveCount(1);
  });

  test("clicking a thread node opens that thread", async ({ page }) => {
    await openSystemView(page);
    await page.locator("[data-system-mode-toggle]").click();
    await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "threads");
    await page.waitForTimeout(400);

    await page.locator('[data-entry-point-id="app.py:create_user_route"]').click();

    // Drill-down lands in the thread view (threads ARE the system).
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    expect(await page.locator(".vg-thread-node").count()).toBeGreaterThan(1);
  });

  test("the mode preference persists across a reload", async ({ page }) => {
    await openSystemView(page);
    await page.locator("[data-system-mode-toggle]").click();
    await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "threads");

    await page.reload();
    await page.getByRole("button", { name: "System" }).click();
    await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 10_000 });

    // Persisted: it comes back in threads mode without re-toggling.
    await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "threads");
    await expect(page.locator("[data-thread-interaction-node]").first()).toBeVisible();
  });
});
