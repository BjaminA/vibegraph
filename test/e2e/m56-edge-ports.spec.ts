/**
 * §5.6 — container edge-routing ports, living-renderer proof.
 *
 * Before §5.6 every flow/fork edge landing on a container collapsed onto a
 * single centre handle, so multiple converging edges shared one anchor and
 * crossed heavily at fit-zoom. §5.6 spreads N target ports along the entry
 * border; ThreadView assigns each converging edge a distinct port, sorted
 * by source cross-axis so they fan in monotonically (no crossing).
 *
 * The genuine convergence case is a try/except/finally: the FINALLY band is
 * the join target of BOTH try→finally and except→finally (two solid `flow`
 * edges). exc_demo's `run_job` carries exactly that. This spec asserts on
 * the painted view that the two edges:
 *   1. land on DISTINCT border anchors (no shared entry point), and
 *   2. each anchor still sits inside the FINALLY container rect, and
 *   3. fan in MONOTONICALLY — sources ordered top→bottom map to ports
 *      ordered top→bottom (the real "they don't cross" proof).
 *
 * Pre-§5.6 this fails: both edges share the centre anchor → set size 1.
 *
 * Gated on exc_demo (horizontal/L-R default → cross-axis is Y).
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/exc_demo VG_PORT=4209 PORT=4209 \
 *     npx playwright test test/e2e/m56-edge-ports.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_EXC = FIXTURE.includes("exc_demo");
const REVIEW_DIR = join(process.cwd(), "reviews", "m56-edge-ports");

const FINALLY_ID = "jobs:run_job.fn/finally@0";

function inside(pt: { x: number; y: number }, box: { x: number; y: number; width: number; height: number }, pad = 6) {
  return pt.x >= box.x - pad && pt.x <= box.x + box.width + pad
    && pt.y >= box.y - pad && pt.y <= box.y + box.height + pad;
}

test.describe("§5.6 — converging container edges hit distinct, ordered ports", () => {
  test.skip(!IS_EXC, "Requires VG_FIXTURE=test/fixtures/threads/exc_demo");

  test("try→finally + except→finally land on distinct, in-rect, monotonic ports", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="jobs.py:run_job"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);

    // Every rendered edge whose target is the FINALLY band, with start/end
    // points resolved through the SVG CTM (mirrors m24's edgeEndpoints).
    // `.react-flow__edge-path` = the visible stroke (react-flow also renders
    // a wider invisible interaction path per edge; selecting both would
    // double-count each edge).
    const sel = `g.vg-thread-edge[data-target="${FINALLY_ID}"] path.react-flow__edge-path`;
    await page.waitForSelector(sel, { timeout: 10_000, state: "attached" });
    const edges = await page.$$eval(sel, (els) =>
      els.map((el) => {
        const path = el as SVGPathElement;
        const ctm = path.getScreenCTM()!;
        const at = (len: number) => {
          const p = path.getPointAtLength(len).matrixTransform(ctm);
          return { x: p.x, y: p.y };
        };
        return { start: at(0), end: at(path.getTotalLength()) };
      }),
    );

    // Pre-condition: the convergence must be real (≥2 edges) or the test is
    // vacuous — fail loudly so a fixture change can't silently neuter it.
    expect(edges.length, "FINALLY band must have ≥2 converging edges").toBeGreaterThanOrEqual(2);

    // 1 — DISTINCT anchors: no two edges share an entry point.
    const endKeys = edges.map((e) => `${Math.round(e.end.x)},${Math.round(e.end.y)}`);
    expect(new Set(endKeys).size, `converging edges must hit distinct ports (got ${endKeys.join(" | ")})`)
      .toBe(edges.length);

    // 2 — still inside the FINALLY rect (ports on the border, not flung out).
    const finBox = await page.locator(".vg-thread-container-finally").first().boundingBox();
    expect(finBox).not.toBeNull();
    for (const e of edges) {
      expect(inside(e.end, finBox!),
        `port ${JSON.stringify(e.end)} must sit inside FINALLY ${JSON.stringify(finBox)}`).toBe(true);
    }

    // 3 — MONOTONIC fan (the anti-crossing proof): sort by source cross-axis
    // (Y in the L-R default), assert target-port Y is non-decreasing.
    const sorted = [...edges].sort((a, b) => a.start.y - b.start.y);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].end.y, "ports must fan monotonically with their sources (no crossing)")
        .toBeGreaterThanOrEqual(sorted[i - 1].end.y - 1);
    }

    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: join(REVIEW_DIR, "run_job-finally-ports.png"), fullPage: false });

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
