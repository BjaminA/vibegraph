/**
 * R3 — dynamic vs unresolved: the thread view must NEVER flatten
 * "runtime-determined" and "couldn't statically find it" into one marker.
 *
 * Living-renderer proof (not just an extractor snapshot): paints the
 * aero_demo `compute_drag` thread and asserts the two terminals render
 * with DISTINCT markers:
 *
 *   - `model(...)`     — genuine runtime dispatch (a local var invoked at
 *     runtime). kind=dynamic → amber --accent-warning, Shuffle icon,
 *     SOLID (a confident call with a runtime target).
 *   - `audit_drag(...)` — a resolution gap (bare name, not a local, not
 *     resolvable). kind=unresolved → recessive --text-muted, HelpCircle
 *     "?" icon, GHOSTED (lower opacity — reads "couldn't find this").
 *
 * The core assertion is that the two differ on every channel: accent,
 * icon, and opacity. If a future change collapses them, this fails.
 *
 * Gated on aero_demo.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/aero_demo VG_PORT=4207 PORT=4207 \
 *     npx playwright test test/e2e/r3-dynamic-unresolved.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_AERO = FIXTURE.includes("aero_demo");
const REVIEW_DIR = join(process.cwd(), "reviews", "r3-dynamic-unresolved");

async function marker(page, kind: "dynamic" | "unresolved") {
  const sel = `.vg-thread-node-${kind}`;
  await page.waitForSelector(sel, { timeout: 10_000 });
  return page.$eval(sel, (el) => ({
    kindLabel: el.getAttribute("data-kind-label"),
    iconName: el.getAttribute("data-icon-name"),
    accentVar: el.getAttribute("data-accent-var"),
    opacity: parseFloat(getComputedStyle(el).opacity),
  }));
}

test.describe("R3 — dynamic vs unresolved markers", () => {
  test.skip(!IS_AERO, "Requires VG_FIXTURE=test/fixtures/threads/aero_demo");

  test("genuine dynamic and resolution-gap render as distinct markers", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="main.py:compute_drag"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    const dyn = await marker(page, "dynamic");
    const unres = await marker(page, "unresolved");

    // dynamic = genuine runtime dispatch: amber, Shuffle, solid.
    expect(dyn.kindLabel).toBe("DYNAMIC");
    expect(dyn.iconName).toBe("Shuffle");
    expect(dyn.accentVar).toBe("--accent-warning");
    expect(dyn.opacity).toBeCloseTo(1, 1);

    // unresolved = resolution gap: muted, HelpCircle "?", ghosted.
    // (lucide renamed HelpCircle → CircleQuestionMark; HelpCircle is now
    // an import alias, so match the question-mark family version-robustly.)
    expect(unres.kindLabel).toBe("UNRESOLVED");
    expect(unres.iconName).toMatch(/help|question/i);
    expect(unres.accentVar).toBe("--text-muted");
    expect(unres.opacity).toBeLessThan(0.95);

    // The honesty invariant: the two never collapse — they differ on
    // accent, icon, AND opacity.
    expect(dyn.accentVar).not.toBe(unres.accentVar);
    expect(dyn.iconName).not.toBe(unres.iconName);
    expect(unres.opacity).toBeLessThan(dyn.opacity);

    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "compute_drag.png"), fullPage: false });

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
