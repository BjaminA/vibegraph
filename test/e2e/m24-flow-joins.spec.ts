/**
 * M24 — container logic-joins, living-renderer proof.
 *
 * The extractor emits explicit control-flow joins between sibling
 * containers (try → finally, kind "flow", label "always") and fork
 * arrows from an if's predecessor into its arm containers (kind
 * "conditional", dashed). This spec pins the VISUAL CONTRACT on the
 * painted view:
 *
 *   1. The try→finally join renders SOLID (vg-thread-edge-flow, never
 *      the conditional dashed class) with its "always" label visible,
 *      and its path lands on the two container bounds: the start point
 *      inside the TRY rect, the end point inside the FINALLY rect.
 *   2. Fork arrows render DASHED (vg-thread-edge-conditional) and land
 *      on the arm container bounds (cli:main's outer if arms).
 *   3. Edge endpoints anchor on container BORDERS via real handles —
 *      not on some unrelated node — so the arrows don't cut across the
 *      contains regions.
 *
 * Grammar under test (review-pinned): SOLID = always joins, DASHED =
 * conditional entry.
 *
 * Gated on flask_demo.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/m24-flow-joins.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const REVIEW_DIR = join(process.cwd(), "reviews", "m24-flow-joins");

// Screen-space start/end points of a rendered thread edge, resolved
// through the SVG CTM so they're comparable with boundingBox() rects.
async function edgeEndpoints(page, source: string, target: string) {
  const sel = `g.vg-thread-edge[data-source="${source}"][data-target="${target}"] path`;
  // state: "attached" — a stroke-only SVG path between two container
  // borders can report a degenerate bounding box and fail Playwright's
  // default visibility wait even while it paints fine.
  await page.waitForSelector(sel, { timeout: 10_000, state: "attached" });
  return page.$eval(sel, (el) => {
    const path = el as SVGPathElement;
    const ctm = path.getScreenCTM()!;
    const at = (len: number) => {
      const p = path.getPointAtLength(len).matrixTransform(ctm);
      return { x: p.x, y: p.y };
    };
    return { start: at(0), end: at(path.getTotalLength()) };
  });
}

function inside(pt: { x: number; y: number }, box: { x: number; y: number; width: number; height: number }, pad = 6) {
  return pt.x >= box.x - pad && pt.x <= box.x + box.width + pad
    && pt.y >= box.y - pad && pt.y <= box.y + box.height + pad;
}

test.describe("M24 — flow joins + fork arrows", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("try→finally renders a solid 'always' join landing on both containers", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="db.py:insert"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);

    // Solid grammar: the flow class present, the dashed class absent.
    const flowEdge = page.locator(
      'g.vg-thread-edge[data-source="db:insert.fn/try@0"][data-target="db:insert.fn/finally@0"]',
    );
    await expect(flowEdge).toHaveCount(1);
    const cls = await flowEdge.getAttribute("class");
    expect(cls).toContain("vg-thread-edge-flow");
    expect(cls).not.toContain("vg-thread-edge-conditional");

    // The "always" label paints.
    await expect(page.locator(".vg-thread-edge-label", { hasText: "always" }))
      .toBeVisible();

    // Endpoints land on the container bounds.
    const tryBox = await page.locator(".vg-thread-container-try").first().boundingBox();
    const finBox = await page.locator(".vg-thread-container-finally").first().boundingBox();
    expect(tryBox).not.toBeNull();
    expect(finBox).not.toBeNull();
    const pts = await edgeEndpoints(page, "db:insert.fn/try@0", "db:insert.fn/finally@0");
    expect(inside(pts.start, tryBox!),
      `flow start ${JSON.stringify(pts.start)} must touch TRY ${JSON.stringify(tryBox)}`).toBe(true);
    expect(inside(pts.end, finBox!),
      `flow end ${JSON.stringify(pts.end)} must touch FINALLY ${JSON.stringify(finBox)}`).toBe(true);

    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "insert-try-finally.png"), fullPage: false });

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });

  test("if forks render dashed arrows landing on the arm containers", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);

    const pred = "external:argparse.ArgumentParser.parse_args";
    for (const arm of ["cli:main.fn/if@0#then", "cli:main.fn/if@0#else"]) {
      const fork = page.locator(
        `g.vg-thread-edge[data-source="${pred}"][data-target="${arm}"]`,
      );
      await expect(fork, `fork into ${arm} missing`).toHaveCount(1);
      const cls = await fork.getAttribute("class");
      expect(cls, `fork into ${arm} must be dashed`).toContain("vg-thread-edge-conditional");
      expect(cls).not.toContain("vg-thread-edge-flow");
    }

    // The nested-elif fork: else container → nested then arm.
    const nested = page.locator(
      'g.vg-thread-edge[data-source="cli:main.fn/if@0#else"][data-target="cli:main.fn/if@0/if@0#then"]',
    );
    await expect(nested, "nested elif fork missing").toHaveCount(1);
    expect(await nested.getAttribute("class")).toContain("vg-thread-edge-conditional");

    // Fork endpoints land on the then-arm container bounds.
    const thenBox = await page.locator('[data-container-kind="if_then"]').first().boundingBox();
    expect(thenBox).not.toBeNull();
    const pts = await edgeEndpoints(page, pred, "cli:main.fn/if@0#then");
    expect(inside(pts.end, thenBox!),
      `fork end ${JSON.stringify(pts.end)} must touch IF arm ${JSON.stringify(thenBox)}`).toBe(true);

    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "cli-main-forks.png"), fullPage: false });

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
