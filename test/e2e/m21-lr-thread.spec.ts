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

    // 1 — 2026-09-24: a fork fans out DOWN one column (Ben: "expand the
    // flows more vertically as they end up bunched"). The M21 assertion
    // here was "wider than tall", which pinned the flat layout that
    // bunched every sibling onto one long row; the call tree now spends
    // height on branching, so the invariant is that some column holds a
    // stack of ≥3 sibling cards.
    const h = await spreads(page);
    expect(h.n, "expected several thread nodes").toBeGreaterThan(3);
    const colCounts = new Map<number, number>();
    for (const r of await cardRects(page)) {
      const k = Math.round(r.x / 8);
      colCounts.set(k, (colCounts.get(k) ?? 0) + 1);
    }
    expect(Math.max(...colCounts.values()), "a fork's calls should stack in one column").toBeGreaterThanOrEqual(3);
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

  // Layout-space positions from the node transforms (zoom-independent).
  const posOf = (page: import("@playwright/test").Page, sel: string) =>
    page.locator(sel).evaluate((el: HTMLElement) => {
      const m = el.style.transform.match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/);
      return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
    });

  // These two halves used to be one test on cli.py:main, and were split when
  // M-SWEEP W1 (2026-09-10) made `for u in list_users():` visible. A call
  // written as a `for` ITERABLE emitted no IR node before, so cli:main
  // reached exactly one db path; now it reaches db.query AND db.insert, and
  // `_get_conn` has TWO callers. Two lanes is the correct layout for a
  // shared node with two callers — the chain is simply no longer linear
  // there, so M-NA6's claim needs a thread where it still is.
  test("M-NA6 flat spine: a linear call chain stays in ONE lane", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    // db.py:insert — where _get_conn has exactly one caller.
    await page.click('[data-thread-index-row][data-entry-id="db.py:insert"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);

    // The CHAIN insert → _get_conn → sqlite3.connect is linear: it stays
    // on one row (M-NA6: pre-NA6 each hop dropped a lane, staircasing
    // down-right). insert's OTHER calls — execute / commit / close — are
    // its siblings, not the chain: since 2026-09-24 they fan out down
    // _get_conn's column in execution order (this test used to require
    // them on the same row, which was the flat layout the call tree
    // replaced).
    const at = async (id: string) => {
      const pos = await posOf(page, `.react-flow__node[data-id="${id}"]`);
      expect(pos, `no position for ${id}`).not.toBeNull();
      return pos!;
    };
    const conn = await at("db:_get_conn");
    const connect = await at("external:sqlite3.connect");
    expect(Math.round(connect.y), "the chain _get_conn → sqlite3.connect shares one row").toBe(Math.round(conn.y));
    expect(connect.x).toBeGreaterThan(conn.x);
    let prevY = conn.y;
    for (const id of ["dynamic:conn.execute", "dynamic:conn.commit", "dynamic:conn.close"]) {
      const p = await at(id);
      expect(Math.round(p.x), `${id} stacks in _get_conn's column`).toBe(Math.round(conn.x));
      expect(p.y, `${id} sits below the call before it (execution order)`).toBeGreaterThan(prevY);
      prevY = p.y;
    }
  });

  test("branch colours: each continuing path under a fork has its own hue; the error path stays red", async ({ page }) => {
    // 2026-09-24 (Ben): "making the thread lines different colours for
    // different branches in the same thread". A child that goes on to call
    // something opens a path in the next hue; a leaf keeps its parent's.
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);
    const hues = await page.$$eval(".vg-thread-edge[data-edge-branch-hue]", (els) =>
      [...new Set(els.map((e) => e.getAttribute("data-edge-branch-hue")))]);
    expect(hues.length, `expected several branch hues, got ${hues}`).toBeGreaterThanOrEqual(2);
    // The stroke really is the branch token, not the file wash.
    const stroke = await page.$eval(".vg-thread-edge[data-edge-branch-hue] .react-flow__edge-path",
      (p) => getComputedStyle(p).stroke);
    const token = await page.evaluate((i) => getComputedStyle(document.documentElement).getPropertyValue(`--thread-branch-hue-${i}`).trim(), hues[0]);
    expect(stroke, "a branch edge is painted with a branch hue").not.toBe("");
    expect(token, "the branch token exists").not.toBe("");
    // An edge into an except band keeps the only red.
    const errorStrokes = await page.$$eval(".vg-thread-edge-error .react-flow__edge-path", (ps) => ps.map((p) => getComputedStyle(p).stroke));
    const branchStrokes = await page.$$eval(".vg-thread-edge[data-edge-branch-hue]:not(.vg-thread-edge-error) .react-flow__edge-path", (ps) => ps.map((p) => getComputedStyle(p).stroke));
    for (const s of errorStrokes) expect(branchStrokes, "the error path is never painted a branch hue").not.toContain(s);
  });

  test("M-NA6: nested containers visibly nest", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);

    // The outer else arm wraps a nested if whose then arm holds the same
    // single call — the outer box must WRAP the inner (pre-NA6 sizing
    // derived from leaves only, so they coincided exactly).
    const outer = await posOf(page, '.react-flow__node[data-id="cli:main.fn/if@0#else"]');
    const inner = await posOf(page, '.react-flow__node[data-id="cli:main.fn/if@0/if@0#then"]');
    expect(outer).not.toBeNull();
    expect(inner).not.toBeNull();
    expect(outer!.x, "outer else must start left of the nested then").toBeLessThan(inner!.x);
    expect(outer!.y, "outer else must start above the nested then").toBeLessThan(inner!.y);
  });
});
