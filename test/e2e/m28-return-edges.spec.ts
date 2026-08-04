/**
 * §5.6a — return edges: execution-order sourcing + curved-terminal style.
 *
 * flask `insert` returns INSIDE its try, right after `conn.commit()`:
 *
 *     conn = _get_conn()
 *     try:
 *         cursor = conn.execute(sql, params)
 *         conn.commit()
 *         return cursor.lastrowid   <- predecessor is conn.commit, NOT insert
 *     finally:
 *         conn.close()
 *
 * Asserts on the painted view:
 *   1. The return edge SOURCES from the last-executed predecessor
 *      (dynamic:conn.commit), not the bare function head (db:insert).
 *   2. It carries the distinct return treatment (vg-thread-edge-return)
 *      and its arrowhead lands inside the return node — a curved
 *      function-exit terminal, never an orthogonal L-bend.
 *
 * Gated on flask_demo.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/m28-return-edges.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

const RETURN_EDGE =
  'g.vg-thread-edge[data-source="dynamic:conn.commit"][data-target="db:insert:return@0"]';

test.describe("§5.6a — return edges flow from the predecessor, styled as exits", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("return edge sources from conn.commit and renders the return treatment", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="db.py:insert"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);
    // Legibility floor (2026-07-04): first paint may be seed-anchored and
    // the two fit passes animate until ~680ms, so screen-space geometry
    // sampled around then can straddle the motion. Fit like a user
    // (Controls button) and let the viewport settle before measuring.
    await page.locator(".react-flow__controls-fitview").click();
    await page.waitForTimeout(700);

    // 1 — the edge into the return exists and sources from the last call,
    //     NOT from the function head. The OLD head-sourced edge is gone.
    const fromCommit = page.locator(RETURN_EDGE);
    await fromCommit.waitFor({ state: "attached", timeout: 10_000 });
    await expect(fromCommit).toHaveCount(1);
    await expect(
      page.locator('g.vg-thread-edge[data-source="db:insert"][data-target="db:insert:return@0"]'),
    ).toHaveCount(0);

    // 2 — the distinct return treatment, and the arrow lands in the node.
    const cls = await fromCommit.getAttribute("class");
    expect(cls).toContain("vg-thread-edge-return");
    expect(cls).not.toContain("vg-thread-edge-conditional"); // not dashed
    expect(cls).not.toContain("vg-thread-edge-flow");

    const path = page.locator(`${RETURN_EDGE} path.react-flow__edge-path`);
    await path.waitFor({ state: "attached", timeout: 5_000 });
    const end = await path.evaluate((el) => {
      const p = el as SVGPathElement;
      const ctm = p.getScreenCTM()!;
      const pt = p.getPointAtLength(p.getTotalLength()).matrixTransform(ctm);
      return { x: pt.x, y: pt.y };
    });
    const retBox = await page
      .locator('.react-flow__node[data-id="db:insert:return@0"]')
      .boundingBox();
    expect(retBox, "return node must be present").not.toBeNull();
    const pad = 8;
    const lands =
      end.x >= retBox!.x - pad && end.x <= retBox!.x + retBox!.width + pad &&
      end.y >= retBox!.y - pad && end.y <= retBox!.y + retBox!.height + pad;
    expect(lands, `return edge end ${JSON.stringify(end)} must touch the return node ${JSON.stringify(retBox)}`)
      .toBe(true);

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
