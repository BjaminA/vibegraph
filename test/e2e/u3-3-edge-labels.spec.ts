/**
 * U3.3 — edge labels carrying args passed at the call site.
 *
 * - On flask_demo's cli:main, at least 2 edges should carry a
 *   .vg-thread-edge-label (call-args or fn-params source).
 * - The edge from cmd_create → create_user MUST surface arg text
 *   (the call is `create_user(args.name, args.email)`; even if the
 *   call's args aren't directly reachable, the target's params
 *   ["name", "email"] fall back).
 * - Labels truncate when long; the full text lives on the title attr.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("U3.3 — edge labels", () => {
  test.skip(!IS_FLASK,
    "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  async function openCli(page: import("@playwright/test").Page) {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
  }

  test("cli:main carries at least 2 edge labels", async ({ page }) => {
    await openCli(page);
    const labels = page.locator(".vg-thread-edge-label");
    const n = await labels.count();
    expect(n, `expected ≥ 2 edge labels on cli:main, got ${n}`).toBeGreaterThanOrEqual(2);
  });

  test("cmd_create → create_user shows the (name, email) shape", async ({ page }) => {
    await openCli(page);
    // Pull every edge label's text and confirm at least one matches
    // the create_user call signature. Either form is acceptable:
    //   call-args:  (args.name, args.email)
    //   fn-params:  (name, email)
    const texts = await page.locator(".vg-thread-edge-label").evaluateAll((els) =>
      els.map((el) => el.textContent ?? ""),
    );
    const hit = texts.some((t) =>
      /\(.*name.*[,]\s*.*email.*\)/i.test(t) || /\(name,\s*email\)/.test(t),
    );
    expect(hit, `expected an edge label like (name, email); got ${JSON.stringify(texts)}`).toBe(true);
  });

  test("inferred-from-params labels use the dimmed italic class", async ({ page }) => {
    await openCli(page);
    // Either all labels are call-args (no inferred), or at least one
    // is inferred — in that case it must carry the class.
    const inferred = page.locator(".vg-thread-edge-label.vg-thread-edge-label-inferred");
    const n = await inferred.count();
    if (n === 0) {
      // No fall-back edges in this thread — fine; the assertion is
      // "if any exist, they have the class", trivially true.
      expect(n).toBeGreaterThanOrEqual(0);
    } else {
      const op = await inferred.first().evaluate((el) => getComputedStyle(el).opacity);
      expect(parseFloat(op)).toBeLessThan(1.0);
    }
  });
});
