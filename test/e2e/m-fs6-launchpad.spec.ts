/**
 * M-FS6 (full-scope review 2026-07, P3) — launchpad rows carry what the
 * user picks BY:
 *   - route rows show "METHOD /path" (the IR has carried this since
 *     M8.2; only the thread seed's badge surfaced it),
 *   - class entry rows show their docstring summary like function rows
 *     always did (parser now emits class_def docstrings, field-additive).
 *
 * Two gates: flask_demo (routes) in test:e2e-flask; receiver_demo
 * (class entry) in test:e2e-receiver.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";

test.describe("M-FS6 — route rows show METHOD + path", () => {
  test.skip(!FIXTURE.includes("flask_demo"), "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("create_user_route reads POST /users on the launchpad", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    const row = page.locator('[data-thread-index-row][data-entry-id="app.py:create_user_route"]');
    await expect(row.locator("[data-entry-route]")).toHaveText("POST /users");
    // A method-less registration still shows its path.
    const list = page.locator('[data-thread-index-row][data-entry-id="app.py:list_users_route"]');
    await expect(list.locator("[data-entry-route]")).toHaveText("/users");
  });
});

test.describe("M-FS6 — class entry rows carry their docstring summary", () => {
  test.skip(!FIXTURE.includes("receiver_demo"), "Requires VG_FIXTURE=test/fixtures/threads/receiver_demo");

  test("the Engine row summarizes from the class docstring", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    const row = page.locator('[data-thread-index-row][data-entry-id="engine.py:Engine"]');
    await expect(row).toContainText("Combustion model with a two-phase ignition sequence.");
  });
});
