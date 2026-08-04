/**
 * M21 toggle + M23 proper L-R layout (the parked R2 fork, landed).
 *
 * M21 shipped the orientation toggle but its L-R was a shallow main-axis
 * transpose: the cross axis stayed pinned to centre, so containers and
 * branches collapsed onto one row, the layout overflowed the viewport
 * (fitView clamped at react-flow's default minZoom), and edges left the
 * bottom of one card and curled into the top of the next. M23 replaces
 * that with branch-stacked lanes (cross axis = call-tree depth, main
 * axis = per-lane execution order), orientation-aware handles, and an
 * actually-fitting fitView.
 *
 * This spec carries the assertions the M21 probe said to grow ("stronger
 * than 'wider than tall'"):
 *   1. wider-than-tall (kept from M21)
 *   2. branch-stacking — ≥3 distinct cross-axis lanes in L-R
 *   3. no two cards overlap in L-R
 *   4. fitView really fits — every card inside the thread-view viewport
 *   5. edges flow with the main axis — Left/Right handles in L-R,
 *      and the cmd_create → create_user → insert chain is strictly
 *      left-to-right
 *   6. containers wrap their children — conn.execute sits inside the
 *      TRY container's rect
 *
 * The .thread.json is layout-independent (orientation is a render
 * concern), so the gate is this painting test, not a JSON snapshot.
 *
 * Gated on flask_demo.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/m21-lr-thread.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const REVIEW_DIR = join(process.cwd(), "reviews", "m21-lr-thread");

// Spread of all thread-node cards along each axis (max edge - min edge).
async function spreads(page) {
  return page.$$eval(".vg-thread-node", (els) => {
    const r = els.map((e) => e.getBoundingClientRect());
    const xs = r.map((b) => b.x), xe = r.map((b) => b.x + b.width);
    const ys = r.map((b) => b.y), ye = r.map((b) => b.y + b.height);
    return {
      x: Math.max(...xe) - Math.min(...xs),
      y: Math.max(...ye) - Math.min(...ys),
      n: r.length,
    };
  });
}

// Card rects keyed by thread-node id (M-NA7: semantic zoom hides
// non-landmark label TEXT at overview zoom by design, so text is no
// longer a stable card identifier — the react-flow data-id is).
async function cardRects(page) {
  return page.$$eval(".vg-thread-node", (els) =>
    els.map((e) => {
      const b = e.getBoundingClientRect();
      return {
        label: e.closest(".react-flow__node")?.getAttribute("data-id") ?? "",
        x: b.x, y: b.y, w: b.width, h: b.height,
      };
    }),
  );
}

test.describe("M21 toggle + M23 branch-stacked L-R", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("the control-flow thread paints branch-stacked in L-R", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    // M23.4 — branch-stacked L-R is the default orientation. Read off the
    // VIEW: the orientation toggle was unmounted 2026-08-04 while the vertical
    // layout gets its styling pass, so the view's own attribute is the invariant.
    await expect(page.locator("[data-thread-view]"))
      .toHaveAttribute("data-thread-orientation", "horizontal");
    await expect(page.locator("[data-thread-orientation-toggle]")).toHaveCount(0);

    // Legibility floor (2026-07-04): long threads open seed-anchored at a
    // readable zoom, so the full extent starts off-viewport by design. The
    // geometry assertions below are about the FIT itself, so do what a
    // user does — click the Controls fit button — then measure.
    await page.locator(".react-flow__controls-fitview").click();
    await page.waitForTimeout(700);

    // 1 — wider than tall (the M21 assertion, kept).
    const h = await spreads(page);
    expect(h.n, "expected several thread nodes").toBeGreaterThan(3);
    expect(h.x, `L-R layout should read wider than tall (got x=${h.x} y=${h.y})`)
      .toBeGreaterThan(h.y);
    // Containers (try/finally) render in L-R.
    expect(await page.locator(".vg-thread-container-try, .vg-thread-container-finally").count())
      .toBeGreaterThan(0);
    mkdirSync(REVIEW_DIR, { recursive: true });

    const rects = await cardRects(page);

    // 2 — branch-stacking: cards occupy ≥3 distinct cross-axis lanes
    // (M21's shallow transpose collapsed every card onto ONE row).
    const laneYs: number[] = [];
    for (const r of rects) {
      const cy = r.y + r.h / 2;
      if (!laneYs.some((y) => Math.abs(y - cy) < 8)) laneYs.push(cy);
    }
    expect(laneYs.length, `expected ≥3 lanes, got centres ${laneYs.map(Math.round).join(",")}`)
      .toBeGreaterThanOrEqual(3);

    // 3 — no two cards overlap.
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const overlaps =
          a.x < b.x + b.w && b.x < a.x + a.w &&
          a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlaps, `cards overlap: "${a.label}" and "${b.label}"`).toBe(false);
      }
    }

    // 4 — fitView really fits: every card inside the thread view's box
    // (M21 overflowed both edges — react-flow's default minZoom clamped
    // the fit). 2px tolerance for rounding.
    const view = await page.locator("[data-thread-view]").boundingBox();
    expect(view).not.toBeNull();
    for (const r of rects) {
      expect(r.x >= view!.x - 2 && r.x + r.w <= view!.x + view!.width + 2,
        `card "${r.label}" overflows horizontally (x=${Math.round(r.x)} w=${Math.round(r.w)})`)
        .toBe(true);
      expect(r.y >= view!.y - 2 && r.y + r.h <= view!.y + view!.height + 2,
        `card "${r.label}" overflows vertically (y=${Math.round(r.y)} h=${Math.round(r.h)})`)
        .toBe(true);
    }

    // 5 — edges flow with the main axis: handles flipped to Left/Right,
    // and the call cascade reads strictly left-to-right.
    expect(await page.locator(".vg-thread-node .react-flow__handle-right").count())
      .toBe(h.n);
    expect(await page.locator(".vg-thread-node .react-flow__handle-bottom").count())
      .toBe(0);
    const cx = (label: string) => {
      const r = rects.find((c) => c.label.includes(label));
      expect(r, `missing card ${label}`).toBeTruthy();
      return r!.x + r!.w / 2;
    };
    expect(cx("cli:cmd_create"), "cmd_create should sit left of create_user")
      .toBeLessThan(cx("models:create_user"));
    expect(cx("models:create_user"), "create_user should sit left of insert")
      .toBeLessThan(cx("db:insert"));
    expect(cx("db:insert"), "insert should sit left of conn.execute")
      .toBeLessThan(cx("dynamic:conn.execute"));

    // 6 — containers wrap their children: conn.execute inside TRY.
    const tryBox = await page.locator(".vg-thread-container-try").first().boundingBox();
    expect(tryBox).not.toBeNull();
    const exec = rects.find((c) => c.label.includes("conn.execute"))!;
    expect(
      exec.x >= tryBox!.x && exec.x + exec.w <= tryBox!.x + tryBox!.width &&
      exec.y >= tryBox!.y && exec.y + exec.h <= tryBox!.y + tryBox!.height,
      "conn.execute card should sit inside the TRY container",
    ).toBe(true);

    await page.screenshot({ path: join(REVIEW_DIR, "horizontal.png"), fullPage: false });

    // The vertical half of this test (column norm: taller than wide, single
    // column, handles on top/bottom) is PARKED with the toggle — the layout is
    // unreachable while its styling is unfinished, so there is nothing to flip
    // to. Restore it together with the toggle; the assertions were correct.

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });

  // PARKED 2026-08-04 alongside the toggle itself: the vertical layout is not
  // styled correctly yet, so the control that reaches it was unmounted (the
  // state, the persistence key and the layout code all remain — see
  // ThreadView.tsx). Un-skip when the toggle is remounted; the assertions are
  // still the right ones for the behaviour.
  test.skip("the orientation preference persists across a reload", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });

    const toggle = page.locator("[data-thread-orientation-toggle]");
    const start = await toggle.getAttribute("data-orientation");
    await toggle.click();
    const flipped = start === "vertical" ? "horizontal" : "vertical";
    await expect(toggle).toHaveAttribute("data-orientation", flipped);

    // Reload → the preference is restored from localStorage.
    await page.reload();
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-orientation-toggle]"))
      .toHaveAttribute("data-orientation", flipped, { timeout: 10_000 });

    // Reset to the horizontal default so the preference doesn't leak
    // into other specs sharing this browser profile.
    if (flipped === "vertical") await page.locator("[data-thread-orientation-toggle]").click();
  });

  test("M-NA6 flat spine: a linear call chain stays in ONE lane; nested containers visibly nest", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);

    // Layout-space positions from the node transforms (zoom-independent).
    const posOf = (sel: string) =>
      page.locator(sel).evaluate((el: HTMLElement) => {
        const m = el.style.transform.match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/);
        return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
      });

    // db.insert's body is a linear continuation (insert → _get_conn →
    // sqlite3.connect, then execute/commit/close in insert's band). Pre-
    // NA6 the _get_conn → connect hop dropped a lane per call, staircasing
    // down-right; now the whole rail shares one y.
    const rail = [
      "db:_get_conn",
      "external:sqlite3.connect",
      "dynamic:conn.execute",
      "dynamic:conn.commit",
      "dynamic:conn.close",
    ];
    const ys = new Set<number>();
    for (const id of rail) {
      const p = await posOf(`.react-flow__node[data-id="${id}"]`);
      expect(p, `no position for ${id}`).not.toBeNull();
      ys.add(Math.round(p!.y));
    }
    expect(ys.size, `db rail should read as one lane, got ys ${[...ys]}`).toBe(1);

    // Nested containers: the outer else arm wraps a nested if whose then
    // arm holds the same single call — the outer box must WRAP the inner
    // (pre-NA6 sizing derived from leaves only, so they coincided exactly).
    const outer = await posOf('.react-flow__node[data-id="cli:main.fn/if@0#else"]');
    const inner = await posOf('.react-flow__node[data-id="cli:main.fn/if@0/if@0#then"]');
    expect(outer).not.toBeNull();
    expect(inner).not.toBeNull();
    expect(outer!.x, "outer else must start left of the nested then").toBeLessThan(inner!.x);
    expect(outer!.y, "outer else must start above the nested then").toBeLessThan(inner!.y);
  });
});
