/**
 * M-FV.2 (W1) — syntax-faithful vertical rhythm in the file view.
 *
 * Vertical placement now mirrors source rhythm: contiguous statements get a
 * fixed BASELINE_GAP, a blank (or comment) line in source becomes a larger
 * GROUP_GAP, and nesting depth maps to a fixed INDENT_STEP left inset
 * (cumulative through the container chain). Constants (buildLayout.ts):
 * BASELINE_GAP=16, GROUP_GAP=32, INDENT_STEP=24.
 *
 * Boot with VG_FIXTURE=test/fixtures/threads/big_demo. LoginManager.init_app
 * has a clean spine:
 *   L136 app.login_manager = self          (assignment)
 *   L137 app.after_request(...)            (call)      ← contiguous, +1 line
 *   L139 if request.blueprint ...          (if_stmt)   ← +2 lines = blank break
 *
 * Measurements are taken in FLOW units: screen rects divided by the viewport
 * zoom, so they're independent of pan/zoom and of react-flow's DOM nesting.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("big_demo"), "Requires VG_FIXTURE=test/fixtures/threads/big_demo");

const BASELINE_GAP = 16;
const GROUP_GAP = 32;
const INDENT_STEP = 24;

const CLASS = "module/LoginManager.class";
const METHOD = "module/LoginManager.class/init_app.fn";
const ASSIGN = "module/LoginManager.class/init_app.fn/app_login_manager.assign";
const CALL = "module/LoginManager.class/init_app.fn/app_after_request.call";
const IF = "module/LoginManager.class/init_app.fn/if@0";

async function metrics(page: import("@playwright/test").Page, id: string) {
  return page.evaluate((id) => {
    const vp = document.querySelector(".react-flow__viewport") as HTMLElement | null;
    const m = (vp?.style.transform ?? "").match(/scale\(([-\d.]+)\)/);
    const z = m ? parseFloat(m[1]) : 1;
    const el = document.querySelector(`.react-flow__node[data-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // Convert screen px → flow units (all nodes share the viewport zoom).
    return { left: r.left / z, top: r.top / z, bottom: r.bottom / z };
  }, id);
}

test.describe("file view — vertical rhythm (W1)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("[data-thread-index],.react-flow__node", { timeout: 15_000 });
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="login_manager.py"]');
    await page.waitForSelector(`.react-flow__node[data-id="${IF}"]`, { timeout: 15_000 });
  });

  test("contiguous siblings get BASELINE_GAP, blank-line breaks get GROUP_GAP", async ({ page }) => {
    const assign = (await metrics(page, ASSIGN))!;
    const call = (await metrics(page, CALL))!;
    const ifn = (await metrics(page, IF))!;
    expect(assign).not.toBeNull();
    expect(call).not.toBeNull();
    expect(ifn).not.toBeNull();

    // Gap between vertically-stacked siblings = next.top − prev.bottom.
    const baselineGap = call.top - assign.bottom; // L136 → L137 (contiguous)
    const groupGap = ifn.top - call.bottom; //        L137 → L139 (blank line)

    expect(baselineGap).toBeGreaterThan(BASELINE_GAP - 3);
    expect(baselineGap).toBeLessThan(BASELINE_GAP + 3);
    expect(groupGap).toBeGreaterThan(GROUP_GAP - 3);
    expect(groupGap).toBeLessThan(GROUP_GAP + 3);
    // And the blank-line break is strictly larger than the baseline.
    expect(groupGap).toBeGreaterThan(baselineGap + 8);
  });

  test("nesting depth maps to a fixed INDENT_STEP inset", async ({ page }) => {
    const cls = (await metrics(page, CLASS))!;
    const method = (await metrics(page, METHOD))!;
    const assign = (await metrics(page, ASSIGN))!;

    const methodInset = method.left - cls.left; // class → method (1 level)
    const assignInset = assign.left - method.left; // method → statement (1 level)

    for (const inset of [methodInset, assignInset]) {
      expect(inset).toBeGreaterThan(INDENT_STEP - 3);
      expect(inset).toBeLessThan(INDENT_STEP + 3);
    }
    // The statement is two levels deep → cumulatively two indent steps in.
    const cumulative = assign.left - cls.left;
    expect(cumulative).toBeGreaterThan(2 * INDENT_STEP - 4);
    expect(cumulative).toBeLessThan(2 * INDENT_STEP + 4);
  });
});
