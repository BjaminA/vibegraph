/**
 * W4 — deterministic per-thread colour on the system-canvas thread nodes.
 *
 * In thread-interaction mode each thread node is accented by a pure hash of
 * its entry-point id → one of the 8 `--thread-file-hue-N` palette tokens
 * (colourForThreadId). This distinguishes threads on the multi-thread canvas
 * (the KIND_ICON still carries route/model/cli), and — being a pure function
 * of the id — the same thread keeps its hue across a reload.
 *
 * Living-renderer proof on flask_demo (12 entry points → a rich palette).
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4204 PORT=4204 \
 *     npx playwright test test/e2e/w4-thread-hue.spec.ts \
 *     --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("flask_demo"), "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

const HUE_RE = /^var\(--thread-file-hue-[0-7]\)$/;

async function openThreadsMode(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "System" }).click();
  await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 10_000 });
  await page.locator("[data-system-mode-toggle]").click();
  await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "threads");
  await page.waitForTimeout(400); // settle fitView
}

/** Map every thread node's entry-point id → its data-accent token. */
async function accentByThread(page: import("@playwright/test").Page) {
  return page.locator("[data-thread-interaction-node]").evaluateAll((els) => {
    const out: Record<string, string> = {};
    for (const el of els) {
      const id = el.getAttribute("data-entry-point-id") ?? "";
      out[id] = el.getAttribute("data-accent") ?? "";
    }
    return out;
  });
}

test.describe("W4 — per-thread deterministic hue", () => {
  test("every thread node carries a palette-token accent, and threads differ", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await openThreadsMode(page);

    const accents = await accentByThread(page);
    const ids = Object.keys(accents);
    expect(ids.length, "expected a node per thread").toBeGreaterThan(6);

    // Every accent is one of the 8 --thread-file-hue-N tokens.
    for (const [id, accent] of Object.entries(accents)) {
      expect(accent, `${id} should have a palette-token accent`).toMatch(HUE_RE);
    }

    // With >6 threads spread over 8 hues, at least two distinct hues appear —
    // proving the accent varies per thread rather than a single shared colour.
    const distinct = new Set(Object.values(accents));
    expect(distinct.size, "threads should not all share one hue").toBeGreaterThan(1);

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });

  test("a thread keeps its hue across a reload (pure function of the id)", async ({ page }) => {
    await openThreadsMode(page);
    const before = await accentByThread(page);

    await page.reload();
    await page.getByRole("button", { name: "System" }).click();
    await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 10_000 });
    // Mode preference persists → comes back in threads mode without re-toggling.
    await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "threads");
    await page.waitForTimeout(400);
    const after = await accentByThread(page);

    expect(Object.keys(after).length).toBeGreaterThan(6);
    for (const [id, accent] of Object.entries(after)) {
      expect(before[id], `hue for ${id} should be stable across reload`).toBe(accent);
    }
  });
});
