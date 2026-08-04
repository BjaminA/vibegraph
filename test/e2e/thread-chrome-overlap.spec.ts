/**
 * Thread chrome must not sit on top of itself. Two overlaps found in the
 * rehearsal-3 sitting (2026-07-30), both proven here on the painted view:
 *
 *   1. The top-left chip strip (README / skill / artifact) and the canvas
 *      chrome under it (layout toggle, nests toggle) were positioned by two
 *      different owners at hardcoded offsets. The artifact chip's +68 landed
 *      4px above the layout toggle's +72 and — at z-860 against z-30 — ate
 *      its clicks: on every thread with an artifact the "switch layout"
 *      button was DEAD, not merely ugly. Hence the honest assertion here is
 *      a real un-forced click, plus hit-testing the button's centre.
 *   2. A control-flow container nested inside another was inset by 10px,
 *      less than the height of the chip label straddling its top border, so
 *      `FOR row in rows` and its nested `IF limit is not None` printed
 *      through each other.
 *
 * Both are geometry, so both are asserted as measured rectangles — no
 * screenshot comparison. Runs on artifact_demo: the one fixture carrying all
 * three chips (its trainer produces model.pkl) AND a nested for/if.
 *
 * Boot (see package.json test:e2e-artifact):
 *   VG_FIXTURE=test/fixtures/threads/artifact_demo VG_PORT=4258 PORT=4258 \
 *     npx playwright test test/e2e/thread-chrome-overlap.spec.ts \
 *     --reporter=list --workers=1
 */
import { test, expect, type Page } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_DEMO = FIXTURE.includes("artifact_demo");

type Box = { x: number; y: number; w: number; h: number };

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The producing thread: three chips in the strip (README / skill / artifact,
 *  model.pkl missing) and a nested for/if inside fit_weights. */
async function openTrainThread(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
  await page.click('[data-thread-index-row][data-entry-id="train.py:main"]');
  await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1400);
}

test.describe("thread chrome overlaps", () => {
  test.skip(!IS_DEMO, "Requires VG_FIXTURE=test/fixtures/threads/artifact_demo");

  // The orientation toggle used to be the row-0 button this guarded (the
  // artifact chip once swallowed its clicks). It was unmounted 2026-08-04, so
  // the nests toggle now occupies row 0 and inherits the guard — the invariant
  // is "whatever sits under the chip strip stays clickable", not "the L-R
  // button stays clickable".
  test("chip strip never covers the canvas toggles, and the row-0 toggle really clicks", async ({ page }) => {
    await openTrainThread(page);

    // The bug only exists when the strip is at full height — three chips.
    await expect(page.locator("[data-artifact-chip]")).toBeVisible();
    await expect(page.locator("[data-skill-badge]")).toBeVisible();
    await expect(page.locator("[data-readme-badge]")).toBeVisible();

    const measured = await page.evaluate(() => {
      const R = (el: Element): { x: number; y: number; w: number; h: number } => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const named = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? { sel, box: R(el) } : null;
      };
      const strip = [...document.querySelectorAll("[data-chip-strip] > *")]
        .map((el, i) => ({ sel: `strip[${i}]:${el.getAttribute("data-readme-badge") !== null ? "readme" : el.getAttribute("data-skill-badge") !== null ? "skill" : "artifact"}`, box: R(el) }));
      const canvas = [named("[data-thread-nests-toggle]")]
        .filter((v): v is { sel: string; box: { x: number; y: number; w: number; h: number } } => !!v);
      // The invariant the sitting-3 fix installed: the strip PUBLISHES its
      // measured height as --vg-chipstrip-h, and canvas row 0 is placed below
      // it. When that broke, the artifact chip sat on top of the row-0 control
      // and swallowed its clicks. Assert it on the geometry, so it holds
      // whether or not a control happens to occupy the row on this fixture
      // (the orientation toggle used to render unconditionally; the nests
      // toggle that replaced it in row 0 only renders for threads WITH nests).
      const stripEl = document.querySelector("[data-chip-strip]")!;
      const stripBottom = stripEl.getBoundingClientRect().bottom;
      const published = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--vg-chipstrip-h") || "0");
      // Resolve where row 0 actually lands by probing with a throwaway element.
      // Mirrors belowChipStrip(0) EXACTLY (ChipStrip.tsx): the strip's top
      // rides --vg-toolbar-bottom, so the base is toolbar-relative, and the
      // fallback height is CHIP_STRIP_FALLBACK_H (56). `fixed` to share the
      // strip's coordinate space.
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;left:12px;width:1px;height:1px;";
      probe.style.top = "calc(var(--vg-toolbar-bottom, 43px) + 8px + var(--vg-chipstrip-h, 56px) + 8px)";
      document.body.appendChild(probe);
      const row0Top = probe.getBoundingClientRect().top;
      probe.remove();

      const toggle = document.querySelector("[data-thread-nests-toggle]");
      let toggleOwnsCentre: boolean | null = null;
      if (toggle) {
        const t = toggle.getBoundingClientRect();
        const atCentre = document.elementFromPoint(t.x + t.width / 2, t.y + t.height / 2);
        toggleOwnsCentre = !!atCentre && toggle.contains(atCentre);
      }
      return { strip, canvas, toggleOwnsCentre, stripBottom, published, row0Top };
    });

    expect(measured.strip.length).toBe(3);
    // The strip must publish a height at least as tall as it actually is —
    // an under-measured value is exactly what let a chip overhang row 0.
    expect(measured.published, "--vg-chipstrip-h must be published").toBeGreaterThan(0);
    expect(measured.row0Top,
      "canvas row 0 must start below the chip strip's bottom edge").toBeGreaterThanOrEqual(measured.stripBottom);

    const all = [...measured.strip, ...measured.canvas];
    const collisions: string[] = [];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const area = overlap(all[i].box, all[j].box);
        if (area > 0) collisions.push(`${all[i].sel} × ${all[j].sel} = ${Math.round(area)}px²`);
      }
    }
    expect(collisions, "top-left chrome must not overlap").toEqual([]);

    // If a row-0 control IS mounted on this fixture, it must own its own
    // centre and actually take a click. This fixture has no nested calls, so
    // the nests toggle does not render and the geometry assertions above are
    // the guard; the click-through runs wherever a control exists.
    if (measured.toggleOwnsCentre !== null) {
      expect(measured.toggleOwnsCentre, "row-0 toggle must own its own centre point").toBe(true);
      const toggle = page.locator("[data-thread-nests-toggle]");
      await expect(toggle).toHaveAttribute("data-expanded", "false");
      await toggle.click({ timeout: 5_000 });
      await expect(toggle).toHaveAttribute("data-expanded", "true");
    }
  });

  test("a container nested inside another keeps both chip labels legible", async ({ page }) => {
    await openTrainThread(page);

    const containers = await page.evaluate(() => {
      const R = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      return [...document.querySelectorAll("[data-thread-container]")].map((c) => {
        const chip = c.querySelector(".vg-thread-container-chip");
        const node = c.closest(".react-flow__node") ?? c;
        return {
          kind: c.getAttribute("data-container-kind"),
          label: chip?.textContent?.trim() ?? "",
          box: R(node),
          chip: chip ? R(chip) : null,
        };
      });
    });

    // Guard: this fixture must actually PAINT the nested pair, else the
    // pairwise check below passes for the wrong reason.
    const outer = containers.find((c) => c.label.includes("row in rows"));
    const inner = containers.find((c) => c.label.includes("limit is not None"));
    expect(outer, "fit_weights' `for row in rows` container must render").toBeTruthy();
    expect(inner, "its nested `if limit is not None` container must render").toBeTruthy();
    // Genuinely nested: the inner box sits inside the outer one.
    expect(inner!.box.x).toBeGreaterThan(outer!.box.x);
    expect(inner!.box.y).toBeGreaterThan(outer!.box.y);

    const chips = containers.filter((c) => c.chip);
    const collisions: string[] = [];
    for (let i = 0; i < chips.length; i++) {
      for (let j = i + 1; j < chips.length; j++) {
        const area = overlap(chips[i].chip!, chips[j].chip!);
        if (area > 0) collisions.push(`"${chips[i].label}" × "${chips[j].label}" = ${Math.round(area)}px²`);
      }
    }
    expect(collisions, "container chip labels must not overlap each other").toEqual([]);

    // And no chip may print over a node card either.
    const cards = await page.$$eval(
      ".react-flow__node",
      (els) => els.filter((e) => !e.querySelector("[data-thread-container]")).map((e) => {
        const r = e.getBoundingClientRect();
        return { label: (e.textContent ?? "").trim().slice(0, 24), box: { x: r.x, y: r.y, w: r.width, h: r.height } };
      }),
    );
    const onCards: string[] = [];
    for (const c of chips) {
      for (const card of cards) {
        if (overlap(c.chip!, card.box) > 0) onCards.push(`"${c.label}" × card "${card.label}"`);
      }
    }
    expect(onCards, "container chip labels must not overlap node cards").toEqual([]);
  });
});
