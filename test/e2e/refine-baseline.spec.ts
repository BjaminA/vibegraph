/**
 * Phase 0 — refinement-pass baseline capture.
 *
 * Captures two stills of the current canvas state into reviews/before-refine/
 * so Phase 7 can show before/after honestly. Two zoom levels because stills
 * lie about edge routing at a single zoom.
 *
 *   - wide.png  — fitView, whole graph + edges visible (1440×900)
 *   - tight.png — zoomed into one representative node (FunctionDefNode for
 *                 `greet`), filling the frame so padding/rhythm is readable
 *
 * Skipped unless VG_CAPTURE=1 is set, so npm test stays clean. Run with:
 *   VG_CAPTURE=1 npx playwright test refine-baseline.spec.ts
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve("reviews/before-refine");

test.describe("Phase 0 baseline capture", () => {
  test.skip(process.env.VG_CAPTURE !== "1", "Set VG_CAPTURE=1 to capture stills");

  test.beforeAll(() => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
    // Wait for layout + first-paint motion to settle so the still isn't
    // captured mid-animation (node-enter is 240ms, edge-draw is 320ms).
    await page.waitForTimeout(500);
  });

  test("wide — whole graph at fitView", async ({ page }) => {
    // <ReactFlow fitView /> is already set in App.tsx, so on first paint
    // the whole graph fits the viewport. Just give the layout an extra
    // beat to settle past the motion animations.
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(OUT_DIR, "wide.png"),
      fullPage: false,
    });
    // Smoke: the screenshot must show edges. If it's all background,
    // something is wrong with the capture or the canvas didn't paint.
    expect(fs.statSync(path.join(OUT_DIR, "wide.png")).size).toBeGreaterThan(8_000);
  });

  test("tight — zoom into greet function node", async ({ page }) => {
    // Find the FunctionDefNode whose label is `greet`. Scroll into view,
    // then capture the node's bounding box plus a comfortable margin so
    // we see padding/rhythm in context with neighbouring nodes.
    const greet = page.locator(".react-flow__node-functionDefNode", { hasText: "greet" }).first();
    await greet.waitFor({ state: "visible" });
    const box = await greet.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const margin = 80;
    await page.screenshot({
      path: path.join(OUT_DIR, "tight.png"),
      clip: {
        x: Math.max(0, box.x - margin),
        y: Math.max(0, box.y - margin),
        width: box.width + margin * 2,
        height: box.height + margin * 2,
      },
    });
    expect(fs.statSync(path.join(OUT_DIR, "tight.png")).size).toBeGreaterThan(4_000);
  });

  test("expanded — chevron opens NodeExpandedOverlay", async ({ page }) => {
    // Locate the chevron in the greet function's action strip (4th button).
    const greet = page.locator(".react-flow__node-functionDefNode", { hasText: "greet" }).first();
    await greet.waitFor({ state: "visible" });
    const buttons = greet.locator('button[title="Expand node"]');
    await buttons.first().click();
    // Overlay animation is 280ms — wait for it to settle.
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(OUT_DIR, "expanded.png"),
      fullPage: false,
    });
    expect(fs.statSync(path.join(OUT_DIR, "expanded.png")).size).toBeGreaterThan(8_000);
  });

  // Phase 7 — three stills of the expand cycle, taken in sequence so the
  // motion story is visible without recording a video file.
  test("cycle — pre-expand → expanded → post-close", async ({ page }) => {
    const greet = page.locator(".react-flow__node-functionDefNode", { hasText: "greet" }).first();
    await greet.waitFor({ state: "visible" });
    const greetBox = await greet.boundingBox();
    if (!greetBox) return;
    const clip = {
      x: Math.max(0, greetBox.x - 40),
      y: Math.max(0, greetBox.y - 40),
      width: greetBox.width + 80,
      height: greetBox.height + 80,
    };
    const chevron = greet.locator('button[title="Expand node"]').first();

    // 1. Pre-expand — mouse hovers near (but not inside) the greet node so
    //    no child-node interceptor steals the hover. The hover-lift fires
    //    only when the cursor is ON a node; this still shows the resting
    //    state for the before-shot.
    await page.mouse.move(greetBox.x + greetBox.width / 2, greetBox.y - 20);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, "cycle-1-pre.png"), clip });

    // 2. Expanded — click the chevron via the action-strip (which is on
    //    top of any child interceptor) and let the 280ms overlay settle.
    await chevron.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT_DIR, "cycle-2-expanded.png") });

    // 3. Post-close — Esc closes, canvas snaps back to attention-fade default.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT_DIR, "cycle-3-post.png"), clip });
  });
});
