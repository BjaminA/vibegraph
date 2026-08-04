/**
 * R4 step 1 — capture-only probe (observation harness, no hard assertions
 * on the fix itself; runs identically pre- and post-fix so the stills are
 * comparable).
 *
 * Boots the db.py:insert thread, screenshots the thread, then clicks the
 * `conn.execute` terminal to pin its tooltip and screenshots that too.
 * Logs the node's kind class + the tooltip text so the dishonest
 * "module 'conn' is not importable" message is on record.
 *
 * Stills land in reviews/r4-conn-honesty/, prefixed by R4_TAG
 * (default "before").
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/r4-conn-capture.spec.ts --reporter=list --workers=1
 */
import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const TAG = process.env.R4_TAG ?? "before";
const REVIEW_DIR = join(process.cwd(), "reviews", "r4-conn-honesty");

test.describe("R4 — conn.execute honesty capture", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("insert thread + conn.execute tooltip", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    // Prefer the direct db.py:insert entry; fall back to any insert row.
    const rows = await page.$$eval("[data-thread-index-row]", (els) =>
      els.map((e) => e.getAttribute("data-entry-id")),
    );
    console.log(`[R4] entry rows: ${rows.join(" | ")}`);
    const entry = rows.includes("db.py:insert")
      ? "db.py:insert"
      : rows.find((r) => r?.includes("insert"));
    if (!entry) throw new Error("no insert entry row found");
    await page.click(`[data-thread-index-row][data-entry-id="${entry}"]`);
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    await page.waitForTimeout(800);

    mkdirSync(REVIEW_DIR, { recursive: true });

    const connNode = page.locator(".vg-thread-node").filter({ hasText: "conn.execute" }).first();
    await connNode.waitFor({ state: "visible", timeout: 10_000 });
    const kindClass = await connNode.evaluate((el) => el.className);
    console.log(`[R4] conn.execute node class: ${kindClass}`);
    await page.screenshot({ path: join(REVIEW_DIR, `step-1-${TAG}-thread.png`), fullPage: false });

    // Click to pin the tooltip; give the external resolver round-trip a beat.
    await connNode.click();
    const tooltip = page.locator("[data-thread-tooltip]");
    await tooltip.waitFor({ state: "visible", timeout: 5_000 });
    await page.waitForTimeout(1_500);
    const tooltipText = (await tooltip.textContent())?.replace(/\s+/g, " ").trim();
    console.log(`[R4] tooltip text: ${tooltipText?.substring(0, 300)}`);
    await page.screenshot({ path: join(REVIEW_DIR, `step-1-${TAG}-tooltip.png`), fullPage: false });

    console.log(`[R4] pageErrors=${pageErrors.length ? pageErrors.join("; ") : "none"}`);
  });
});
