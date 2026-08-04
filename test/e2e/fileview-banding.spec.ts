/**
 * M-FV.5 (W2a) — macro-layout banding.
 *
 * The file view now lays top-level nodes into three explicit left-to-right
 * bands (was five type-buckets that scattered defs across two columns):
 *   imports < module-state (assignments) < definitions + flow
 * Within a band nodes follow source order. This test pins the ordering,
 * containment (no overlap), and source order — not "renders" (the M21
 * 'wider than tall' failure is the anti-pattern).
 *
 * Boot with VG_FIXTURE=test/fixtures/threads/big_demo. signals.py has all
 * three families at top level: an import, module-level signal assignments,
 * and a __getattr__ function.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("big_demo"), "Requires VG_FIXTURE=test/fixtures/threads/big_demo");

const IMPORT = "module/flask_signals.import_from";
const ASSIGN_EARLY = "module/user_logged_in.assign"; // L7
const ASSIGN_LATE = "module/session_protected.assign"; // L45
const FUNC = "module/__getattr__.fn";

// Flow-space rect (screen rect ÷ viewport zoom): independent of pan/zoom.
async function rect(page: import("@playwright/test").Page, id: string) {
  return page.evaluate((id) => {
    const vp = document.querySelector(".react-flow__viewport") as HTMLElement | null;
    const m = (vp?.style.transform ?? "").match(/scale\(([-\d.]+)\)/);
    const z = m ? parseFloat(m[1]) : 1;
    const el = document.querySelector(`.react-flow__node[data-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left / z, right: r.right / z, top: r.top / z, bottom: r.bottom / z };
  }, id);
}

test.describe("file view — macro banding (W2a)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("[data-thread-index],.react-flow__node", { timeout: 15_000 });
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="signals.py"]');
    await page.waitForSelector(`.react-flow__node[data-id="${FUNC}"]`, { timeout: 15_000 });
  });

  test("three bands ordered left→right: imports < state < definitions", async ({ page }) => {
    const imp = (await rect(page, IMPORT))!;
    const asn = (await rect(page, ASSIGN_EARLY))!;
    const fn = (await rect(page, FUNC))!;
    expect(imp).not.toBeNull();
    expect(asn).not.toBeNull();
    expect(fn).not.toBeNull();
    // Each band starts strictly to the right of the previous band's left edge,
    // and the bands don't overlap horizontally (import.right ≤ state.left, …).
    expect(imp.right).toBeLessThanOrEqual(asn.left + 1);
    expect(asn.right).toBeLessThanOrEqual(fn.left + 1);
  });

  test("source order within the state band (earlier line → higher up)", async ({ page }) => {
    const early = (await rect(page, ASSIGN_EARLY))!; // L7
    const late = (await rect(page, ASSIGN_LATE))!; //  L45
    expect(early.top).toBeLessThan(late.top);
  });

  test("no bounding-box overlap across the three bands", async ({ page }) => {
    const boxes = await Promise.all([IMPORT, ASSIGN_EARLY, FUNC].map((id) => rect(page, id)));
    const overlaps = (a: any, b: any) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i], boxes[j])).toBe(false);
      }
    }
  });
});
