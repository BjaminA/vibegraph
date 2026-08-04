/**
 * M-FS3 (full-scope review 2026-07, P2) — edge labels fanning out of one
 * source stagger along their paths instead of overprinting at the shared
 * bezier midpoint (the review's "garbled strip" next to the seed).
 *
 * Gated on receiver_demo (main fans three labelled calls); runs in test:e2e-receiver.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("receiver_demo"), "Requires VG_FIXTURE=test/fixtures/threads/receiver_demo");

test.describe("M-FS3 — sibling edge labels don't overprint", () => {
  test("labels sharing a source keep clear of each other", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="main.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1200);

    const labels = await page.locator(".vg-thread-edge-label").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          source: el.getAttribute("data-edge-label-source"),
          left: r.left, right: r.right, top: r.top, bottom: r.bottom,
        };
      }),
    );
    expect(labels.length).toBeGreaterThan(1);

    // Pairwise within each shared-source group: overlap area must be a
    // sliver at most (they can touch corners as paths cross; they must
    // not overprint).
    const bySource = new Map<string, typeof labels>();
    for (const l of labels) {
      if (!l.source) continue;
      const g = bySource.get(l.source) ?? [];
      g.push(l);
      bySource.set(l.source, g);
    }
    let sharedGroups = 0;
    for (const [source, group] of bySource) {
      if (group.length < 2) continue;
      sharedGroups++;
      for (let a = 0; a < group.length; a++) {
        for (let b = a + 1; b < group.length; b++) {
          const A = group[a], B = group[b];
          const ow = Math.max(0, Math.min(A.right, B.right) - Math.max(A.left, B.left));
          const oh = Math.max(0, Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top));
          const overlap = ow * oh;
          const smaller = Math.min(
            (A.right - A.left) * (A.bottom - A.top),
            (B.right - B.left) * (B.bottom - B.top),
          );
          expect(
            overlap / Math.max(smaller, 1),
            `labels from ${source} overprint (${Math.round(overlap)}px² of ${Math.round(smaller)}px²)`,
          ).toBeLessThan(0.25);
        }
      }
    }
    expect(sharedGroups, "fixture must exercise at least one shared-source label fan").toBeGreaterThan(0);
  });
});
