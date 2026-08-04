/**
 * M-ARCH integration — adversarial honesty: a DYNAMIC forward().
 *
 * BranchyNet's forward() has a runtime if/else (self.attn vs self.pool) and a
 * functional op (F.relu). The view must stay honest, never flattening to a
 * fake linear stack:
 *  - the schematic surfaces a "branches" marker (the linear stack can't
 *    represent the branched data path);
 *  - the forward thread renders BOTH arms (if_then + if_else containers) with
 *    the arm-specific layers, and shows F.relu as an external terminal.
 *
 * Boot: VG_FIXTURE=test/fixtures/architecture/adversarial.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("adversarial"), "Requires VG_FIXTURE=test/fixtures/architecture/adversarial");

const REVIEW_DIR = join(process.cwd(), "reviews", "architecture");

async function openArch(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Arch" }).click();
  await expect(page.locator("[data-architecture-view]")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
}

test.describe("M-ARCH — adversarial dynamic forward()", () => {
  test("the schematic surfaces a branch marker (no fake linear stack)", async ({ page }) => {
    await openArch(page);
    const h = page.locator('[data-model-header][data-model-name="BranchyNet"]');
    await expect(h).toHaveCount(1);
    await expect(h.locator("[data-forward-branches]")).toBeVisible();
    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "adversarial-schematic.png"), fullPage: false });
  });

  test("the forward thread shows both arms + the functional op", async ({ page }) => {
    await openArch(page);
    await page.locator('[data-model-header][data-model-name="BranchyNet"]').click();
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);

    // Both control-flow arms render as containers (M17.3 if_then / if_else).
    const containers = page.locator("[data-thread-container]");
    expect(await containers.count(), "expected both if arms as containers").toBeGreaterThanOrEqual(2);

    // The arm-specific layers both appear (not collapsed to one path), and the
    // functional op shows honestly.
    await expect(page.locator(".vg-thread-node", { hasText: "self.attn" }).first()).toBeVisible();
    await expect(page.locator(".vg-thread-node", { hasText: "self.pool" }).first()).toBeVisible();
    await expect(page.locator(".vg-thread-node", { hasText: "F.relu" }).first()).toBeVisible();

    await page.screenshot({ path: join(REVIEW_DIR, "adversarial-forward-thread.png"), fullPage: false });
  });
});
