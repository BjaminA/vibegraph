/**
 * W1 — code/args never silently truncated.
 *
 * Node-card code text (arch glyph args, thread node labels/previews,
 * file-view node bodies) previously clipped with `text-overflow: ellipsis;
 * white-space: nowrap`, hiding args (the information) off the right edge.
 * W1 replaces that with the shared `.vg-node-code` rule (wrap + clamp, full
 * text on `title` for hover reveal).
 *
 * Contract asserted on the painted view:
 *   1. No `.vg-node-code` element is a single-line clip (computed
 *      white-space ≠ nowrap).
 *   2. The visible text equals the full `title` — i.e. what's shown is the
 *      complete string, never a truncated prefix.
 *
 * Gated on cnn_demo (exercises BOTH the arch glyph and, via the model
 * forward thread, the thread-node surfaces).
 *
 * Boot: VG_FIXTURE=test/fixtures/architecture/cnn_demo VG_PORT=4215 PORT=4215
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("cnn_demo"), "Requires VG_FIXTURE=test/fixtures/architecture/cnn_demo");

async function assertNoSilentClip(page: import("@playwright/test").Page, scope: string) {
  const els = page.locator(`${scope} .vg-node-code`);
  const n = await els.count();
  expect(n, `${scope} should have code elements`).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const probe = await els.nth(i).evaluate((e) => ({
      whiteSpace: getComputedStyle(e).whiteSpace,
      text: (e.textContent ?? "").trim(),
      title: (e as HTMLElement).title.trim(),
    }));
    expect(probe.whiteSpace, "code text must wrap, not single-line clip").not.toBe("nowrap");
    // Full text is shown — what's painted equals the full title (no
    // truncated prefix). (title is "" for elements that don't set one.)
    if (probe.title) {
      expect(probe.text, "visible text must be the complete string, not a clipped prefix").toBe(probe.title);
    }
  }
}

test.describe("W1 — no silent code/arg truncation", () => {
  test("arch glyph args wrap and show full text", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Arch" }).click();
    await expect(page.locator("[data-architecture-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await assertNoSilentClip(page, "[data-architecture-view]");
  });

  test("thread node code wraps and shows full text", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="model.py:SmallCNN.forward"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await assertNoSilentClip(page, "[data-thread-view]");
  });
});
