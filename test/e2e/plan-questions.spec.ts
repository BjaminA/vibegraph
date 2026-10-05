/**
 * The Plan panel's open questions (2026-10-05, a field report: the close
 * control read as a status badge, dropped questions vanished, long questions
 * were clipped to two lines, and in "Everything" they sat 10,000 px down).
 * Fixture: nine open questions, one ~640 characters, several "ANSWERED …".
 *
 *   VG_FIXTURE=test/fixtures/plan/questions_demo VG_PORT=4310 PORT=4310 \
 *     npx playwright test test/e2e/plan-questions.spec.ts --workers=1
 */
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const ROOT = resolve(FIXTURE || ".");
const PLAN = join(ROOT, ".vibegraph", "plan.json");
const readPlan = () => JSON.parse(readFileSync(PLAN, "utf-8"));
const cli = (...args: string[]) => execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", resolve("scripts/cli/main.mjs"), ...args], { cwd: ROOT, encoding: "utf-8", env: { ...process.env, CLAUDECODE: "" } });

async function openPlan(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-top-toolbar]", { timeout: 30_000 });
  const banner = page.locator("[data-key-banner]");
  if (await banner.count()) await banner.locator("button").click();
  await page.locator("[data-plan-toggle]").click();
  await expect(page.locator('[data-question="q1"]')).toBeVisible({ timeout: 15_000 });
}

for (const vp of [{ width: 1600, height: 1000 }, { width: 1024, height: 700 }]) {
  test.describe(`plan questions at ${vp.width}×${vp.height}`, () => {
    test.skip(!FIXTURE.includes("questions_demo"), "Requires VG_FIXTURE=test/fixtures/plan/questions_demo");
    test.use({ viewport: vp });
    let saved = "";
    test.beforeAll(() => { saved = readFileSync(PLAN, "utf-8"); });
    test.afterEach(() => { writeFileSync(PLAN, saved); });

    test("every question is shown in full; a long one is several lines and grows with its text", async ({ page }) => {
      await openPlan(page);
      const texts = page.locator("[data-question-text]");
      const want = readPlan().open.map((q: { text: string }) => q.text);
      const got = await texts.evaluateAll((els) => els.map((e) => ({
        text: (e as HTMLElement).innerText, clamp: getComputedStyle(e).getPropertyValue("-webkit-line-clamp"),
        fits: e.scrollHeight <= e.clientHeight + 1,
      })));
      expect(got.map((g) => g.text)).toEqual(want);
      for (const g of got) { expect(g.fits).toBe(true); expect(["none", ""]).toContain(g.clamp); }
      const q1 = page.locator('[data-question="q1"] [data-question-text]');
      const lines = await q1.evaluate((e) => e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight));
      if (vp.width === 1024) expect(lines).toBeGreaterThanOrEqual(5);
      const before = (await page.locator('[data-question="q1"]').boundingBox())!.height;
      // Double its text through the plan, as an edit would.
      const doubled = `${want[0]} ${want[0]}`.slice(0, 1200);
      cli("plan", "edit", JSON.stringify({ op: "update", section: "open", id: "q1", fields: { text: doubled } }));
      await expect(q1).toHaveText(doubled, { timeout: 15_000 });
      expect((await page.locator('[data-question="q1"]').boundingBox())!.height).toBeGreaterThan(before);
      const sheet = page.locator("[data-sheet-content]");
      expect(await sheet.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    });

    test("Close is a labelled, confirmed person's step; the question moves to Closed and dropped and the history says so", async ({ page }) => {
      await openPlan(page);
      const card = page.locator('[data-question="q3"]');
      await expect(card.getByRole("button", { name: /Close/ })).toBeVisible();
      await expect(card.getByRole("button", { name: /Drop/ })).toBeVisible();
      await card.getByRole("button", { name: /Close/ }).click();
      await expect(card.locator('[data-question-confirm="close"]')).toBeVisible();
      await card.locator("[data-question-note]").fill("ids are never reused");
      await card.locator("[data-question-confirm-go]").click();
      await expect(page.locator('[data-question="q3"]')).toHaveCount(0, { timeout: 10_000 });
      const group = page.locator("[data-questions-resolved]");
      await group.locator("summary").click();
      await expect(group.locator('[data-resolved-question="q3"]')).toHaveAttribute("data-resolved-state", "closed");
      await expect(group.locator('[data-resolved-question="q3"] [data-resolved-note]')).toContainText("ids are never reused");
      const last = readPlan().changelog.at(-1);
      expect(last).toMatchObject({ by: "human", change: "close open q3 — ids are never reused" });
      // Reopen brings it back.
      await group.locator('[data-resolved-question="q3"] [data-question-reopen]').click();
      await expect(page.locator('[data-question="q3"]')).toBeVisible({ timeout: 10_000 });
    });

    test("a question dropped from the CLI shows under Closed and dropped with 'dropped', its revision and who", async ({ page }) => {
      cli("plan", "drop", "open", "q10");
      await openPlan(page);
      await page.locator("[data-questions-resolved] summary").click();
      const row = page.locator('[data-resolved-question="q10"]');
      await expect(row).toHaveAttribute("data-resolved-state", "dropped");
      await expect(row.locator("[data-resolved-meta]")).toContainText(`rev ${readPlan().revision} · human`);
    });

    test("in Everything, the open questions are summarised without scrolling, and the summary jumps to them", async ({ page }) => {
      await openPlan(page);
      const summary = page.locator("[data-questions-summary]");
      await expect(summary).toBeInViewport();
      await expect(summary).toContainText("9 open questions");
      await expect(summary).toContainText("(cap 10) · 4 look answered");
      await summary.click();
      await expect(page.locator('[data-plan-section="open"] h3')).toBeInViewport({ timeout: 5_000 });
    });

    test("at the cap, adding one more lists the answered questions and closes them in one confirmed step", async ({ page }) => {
      cli("plan", "edit", JSON.stringify({ op: "add", section: "open", item: { text: "Do we support partial deliveries?" } }));
      await openPlan(page);
      const cap = page.locator("[data-question-cap]");
      await expect(cap).toBeVisible();
      await expect(page.locator("[data-question-add-go]")).toBeDisabled();
      await expect(cap).toContainText("q1, q2, q5, q8");
      await cap.locator("[data-question-close-answered]").click();
      await expect(cap.locator("[data-question-close-answered-confirm]")).toContainText("Close q1, q2, q5, q8 as answered?");
      await cap.locator("[data-question-close-answered-go]").click();
      await expect(cap).toHaveCount(0, { timeout: 10_000 });
      const p = readPlan();
      expect(p.open.map((q: { id: string }) => q.id)).not.toContain("q1");
      expect(p.resolved.map((q: { id: string; state: string }) => `${q.id}:${q.state}`)).toEqual(["q1:closed", "q2:closed", "q5:closed", "q8:closed"]);
      await page.locator("[data-question-add-input]").fill("Do we support split payments?");
      await page.locator("[data-question-add-go]").click();
      await expect.poll(() => readPlan().open.length, { timeout: 10_000 }).toBe(7);
    });
  });
}
