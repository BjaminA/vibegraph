/**
 * File view — a function card's docstring must be legible AND must not push
 * the card's own chrome through its body. Found 2026-07-30 on a live project:
 * `prepare_tensors`' param ports (`rows`, `train_frac`) sat underneath its
 * first `if not rows` container, and the docstring was 9px --text-muted over
 * an accent-washed band.
 *
 * One root cause, three symptoms (see src/webview/util/docSummary.ts):
 * buildLayout reserved a CONSTANT header height for a band that measured
 * 43px→112px depending on how far the docstring wrapped, the constant was
 * consumed in two places that could disagree, and an inline `display: block`
 * disabled the clamp that was supposed to bound the wrap.
 *
 * Asserted on the painted view, in flow units (zoom-independent):
 *   1. no function card's first body statement overlaps its last param row,
 *   2. the docstring paints ≥ 11px in a near-white colour,
 *   3. the summary paints WHOLE — no clamp cuts it (2026-09-25, Ben: cards
 *      fit all their text; the band is sized from the wrapped line count at
 *      the card width, which is what test 1 guards),
 *   4. a summarised docstring keeps the FULL text reachable on hover.
 *
 * big_demo is the fixture because its docstrings span the range that matters:
 * summaries of 79 to 544 characters, so one-line, two-line and clamped cases
 * all render in a single pass.
 *
 * Boot (see package.json test:e2e-big):
 *   VG_FIXTURE=test/fixtures/threads/big_demo VG_PORT=4211 PORT=4211 \
 *     npx playwright test test/e2e/fileview-docstring-header.spec.ts \
 *     --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_BIG = FIXTURE.includes("big_demo");

test.describe("file view — docstring legibility + header height", () => {
  test.skip(!IS_BIG, "Requires VG_FIXTURE=test/fixtures/threads/big_demo");

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click("text=Files");
    await page.waitForTimeout(300);
    await page.click("text=login_manager.py");
    await page.waitForSelector('.react-flow__node[data-id$=".fn"]', { timeout: 15_000 });
    await page.waitForTimeout(1500);
  });

  test("no function card's body statements overlap its param rows", async ({ page }) => {
    const cards = await page.evaluate(() => {
      const vp = document.querySelector(".react-flow__viewport") as HTMLElement | null;
      const m = /scale\(([0-9.]+)\)/.exec(vp?.style.transform ?? "");
      const s = m ? parseFloat(m[1]) : 1;
      const all = [...document.querySelectorAll(".react-flow__node")];
      const out: Array<{ id: string; paramsBottom: number; firstChildTop: number; docLen: number }> = [];
      for (const n of all) {
        const id = n.getAttribute("data-id") ?? "";
        if (!id.endsWith(".fn")) continue;
        const params = [...n.querySelectorAll("[data-fn-param]")];
        if (params.length === 0) continue;
        const paramsBottom = Math.max(...params.map((p) => p.getBoundingClientRect().bottom)) / s;
        const kids = all
          .filter((k) => (k.getAttribute("data-id") ?? "").startsWith(id + "/"))
          .map((k) => k.getBoundingClientRect().top / s);
        if (kids.length === 0) continue;
        out.push({
          id,
          paramsBottom,
          firstChildTop: Math.min(...kids),
          docLen: (n.querySelector(".vg-node-code")?.getAttribute("title") ?? "").length,
        });
      }
      return out;
    });

    expect(cards.length, "fixture must paint function cards with params + a body").toBeGreaterThan(3);
    const overlaps = cards
      .filter((c) => c.firstChildTop < c.paramsBottom)
      .map((c) => `${c.id}: first statement ${(c.paramsBottom - c.firstChildTop).toFixed(1)}px inside the param rows (docstring ${c.docLen} chars)`);
    expect(overlaps, "a card's body must start below its param rows").toEqual([]);
    // At least one card must carry a docstring long enough to have caused the
    // bug — otherwise this passes for the wrong reason.
    expect(Math.max(...cards.map((c) => c.docLen)), "need a long docstring in range").toBeGreaterThan(200);
  });

  test("the docstring is legible, painted whole, and keeps its full text on hover", async ({ page }) => {
    const docs = await page.evaluate(() => {
      return [...document.querySelectorAll('.react-flow__node[data-id$=".fn"] .vg-node-code')].map((el) => {
        const cs = getComputedStyle(el);
        const rgb = (cs.color.match(/\d+/g) ?? []).map(Number);
        const lineH = parseFloat(cs.fontSize) * 1.25;
        return {
          fontSize: parseFloat(cs.fontSize),
          minChannel: rgb.length >= 3 ? Math.min(rgb[0], rgb[1], rgb[2]) : 0,
          shown: (el.textContent ?? "").length,
          full: (el.getAttribute("title") ?? "").length,
          // VISIBLE lines (the painted box) vs CONTENT lines (what the clamp
          // hides). The distinction is the whole point: content may be long,
          // the box may not grow.
          visibleLines: Math.round(el.clientHeight / lineH),
          clamped: el.scrollHeight > el.clientHeight + 1,
        };
      });
    });

    expect(docs.length).toBeGreaterThan(3);
    for (const d of docs) {
      // 11px is the type-scale floor; 9px was the bug.
      expect(d.fontSize, "docstring font size").toBeGreaterThanOrEqual(11);
      // Near-white: --text-primary is rgb(232,234,237); --text-muted (the old
      // value) has a min channel around 103.
      expect(d.minChannel, "docstring must be near-white, not muted").toBeGreaterThan(180);
      // The summary is painted whole: the layout reserved the lines it wraps
      // to, so nothing is hidden behind a clamp (test 1 proves the reserved
      // band does not push the params into the body).
      expect(d.clamped, "a docstring summary may not be cut").toBe(false);
      // Whatever the card cuts stays reachable.
      expect(d.full).toBeGreaterThanOrEqual(d.shown);
    }
    // At least one summary must genuinely wrap past the old 2-line cap, so
    // this is not passing because every summary happens to be short.
    expect(docs.some((d) => d.visibleLines > 2), "a summary longer than two lines must exist here").toBe(true);
    // ...and at least one shows a SUMMARY of a longer docstring, so the hover
    // reveal isn't vacuous.
    expect(docs.some((d) => d.full > d.shown), "a summarised docstring must exist here").toBe(true);
  });
});
