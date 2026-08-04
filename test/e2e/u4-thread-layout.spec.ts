/**
 * U4 — top-down thread layout invariants (VERTICAL orientation).
 *
 * Written for the layered top-down model; since M23 the DEFAULT thread
 * orientation is horizontal L-R, so this spec now toggles to the
 * vertical column (one click away) before measuring — the top-down
 * invariants belong to that orientation. (M-NA6: it previously ran
 * against the default and only held because the pre-flat-spine L-R
 * staircase made y monotonic by accident.)
 *
 * These assertions pin the invariant the user actually cares about:
 *   - The seed sits above every other thread node (smallest y).
 *   - For every direct edge from→to in the rendered thread, parent.y
 *     < child.y.
 *   - No two nodes share the same (x, y) — the layout is unambiguous.
 *
 * Gated on VG_FIXTURE=flask_demo so we can exercise the multi-layer
 * cli:main fan-out in one shot.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

interface NodePos {
  id: string;
  x: number;
  y: number;
}

async function readNodePositions(page: import("@playwright/test").Page): Promise<NodePos[]> {
  // React Flow renders nodes inside .react-flow__node with
  // `transform: translate(x, y)`. data-id is the node's id.
  return await page.evaluate(() => {
    const out: { id: string; x: number; y: number }[] = [];
    const els = document.querySelectorAll<HTMLElement>(".react-flow__node");
    for (const el of Array.from(els)) {
      const id = el.getAttribute("data-id");
      if (!id) continue;
      // The transform is "translate(Xpx, Ypx)" — parse it.
      const t = el.style.transform;
      const m = t.match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/);
      if (!m) continue;
      out.push({ id, x: parseFloat(m[1]), y: parseFloat(m[2]) });
    }
    return out;
  });
}

test.describe("U4 — top-down thread layout", () => {
  test.skip(!IS_FLASK,
    "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");
  // PARKED 2026-08-04 — every assertion below is a VERTICAL-column invariant,
  // and the vertical layout is currently unreachable: its toggle was unmounted
  // while the styling is unfinished, and orientation is pinned horizontal. The
  // layout code itself is untouched, so these come back with the toggle. Left
  // in place rather than deleted so the invariants aren't re-derived later.
  test.skip(true,
    "Vertical layout parked with its toggle (ThreadView.tsx, 2026-08-04) — un-skip when remounted");

  async function openCliMainThread(page: import("@playwright/test").Page) {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    // M-NA6 — the default orientation is horizontal (M23); these are
    // vertical-column invariants, so flip the toggle first.
    const toggle = page.locator("[data-thread-orientation-toggle]");
    if ((await toggle.getAttribute("data-orientation")) === "horizontal") {
      await toggle.click();
    }
    // Settle relayout + fitView before measuring.
    await page.waitForTimeout(800);
  }

  test("seed has the smallest y in the thread (sits at the top)", async ({ page }) => {
    await openCliMainThread(page);
    const positions = await readNodePositions(page);
    expect(positions.length).toBeGreaterThan(1);
    // Thread node ids are `<module>:<name>` (extract_thread.py); cli:main
    // is the seed for the cli entry-point thread.
    const seed = positions.find((p) => p.id === "cli:main");
    expect(seed, "expected a cli:main seed node").toBeDefined();
    const seedY = seed!.y;
    for (const p of positions) {
      if (p.id === seed!.id) continue;
      expect(
        p.y,
        `node ${p.id} should sit below the seed (seed.y=${seedY}, this.y=${p.y})`,
      ).toBeGreaterThan(seedY - 0.5);
    }
  });

  test("every direct edge has parent.y < child.y", async ({ page }) => {
    await openCliMainThread(page);
    const positions = await readNodePositions(page);
    const yOf = new Map<string, number>(positions.map((p) => [p.id, p.y]));

    // React Flow doesn't expose data-source / data-target attributes on
    // the edge group, but it always sets an aria-label of the form
    // "Edge from <sourceId> to <targetId>" which we can parse.
    const edges = await page.evaluate(() => {
      const out: { source: string; target: string }[] = [];
      const els = document.querySelectorAll<HTMLElement>(".react-flow__edge");
      for (const el of Array.from(els)) {
        const aria = el.getAttribute("aria-label") ?? "";
        const m = aria.match(/^Edge from (.+) to (.+)$/);
        if (m) out.push({ source: m[1], target: m[2] });
      }
      return out;
    });
    expect(edges.length).toBeGreaterThan(0);

    for (const e of edges) {
      const yS = yOf.get(e.source);
      const yT = yOf.get(e.target);
      if (yS === undefined || yT === undefined) continue; // shouldn't happen
      expect(
        yT,
        `edge ${e.source} → ${e.target}: child should sit below parent (parent.y=${yS}, child.y=${yT})`,
      ).toBeGreaterThan(yS - 0.5);
    }
  });

  test("no two nodes share the same (x, y)", async ({ page }) => {
    await openCliMainThread(page);
    const positions = await readNodePositions(page);
    const seen = new Set<string>();
    for (const p of positions) {
      // Round to integer px — sub-pixel jitter from d3-force is fine.
      const key = `${Math.round(p.x)},${Math.round(p.y)}`;
      expect(seen.has(key), `duplicate position ${key} on node ${p.id}`).toBe(false);
      seen.add(key);
    }
  });
});
