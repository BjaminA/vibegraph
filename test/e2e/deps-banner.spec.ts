/**
 * Missing-deps banner (NEXT-ACTIONS §2 — project-env awareness).
 *
 * deps_demo declares `import vg_absent_dep_zz`, which is not installed
 * in .pydeps. The server's post-parse dep check must surface it as a
 * `project-warnings` message and the webview must paint the dismissible
 * banner naming the module and the pip --target fix. stdlib + local
 * imports must never be named.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/deps_demo VG_PORT=4245 PORT=4245 \
 *     npx playwright test test/e2e/deps-banner.spec.ts --reporter=list
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_DEPS = FIXTURE.includes("deps_demo");

test.describe("missing-deps banner", () => {
  test.skip(!IS_DEPS, "Requires VG_FIXTURE=test/fixtures/threads/deps_demo");

  test("names the absent module + the pip fix; dismisses; never names stdlib/local", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator("[data-deps-banner]");
    await expect(banner).toBeVisible({ timeout: 15_000 });

    await expect(banner).toContainText("vg_absent_dep_zz");
    await expect(banner).toContainText("pip install --target .pydeps");

    // stdlib and project-local imports are never flagged.
    for (const clean of ["json", "helpers"]) {
      await expect(banner, `"${clean}" wrongly flagged as missing`).not.toContainText(
        new RegExp(`\\b${clean}\\b`),
      );
    }

    // Dismissible, like the key banner.
    await banner.locator("button").click();
    await expect(banner).toHaveCount(0);
  });
});
