/**
 * W3 — the "Show hidden (N)" reveal control renders ABOVE the map.
 *
 * It previously sat at z-940 in the bottom-right corner, sharing space with
 * the react-flow minimap, and could be obscured. W3 lifts it above any
 * react-flow panel (z 1001) and clear of the minimap corner.
 *
 * Contract: with a hidden node present, the reveal button is the top element
 * at its own centre point — not overdrawn by a node/edge/minimap.
 *
 * Gated on flask_demo (file/diagram view, where node-hide + minimap live).
 * Boot: VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("flask_demo"), "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

test.describe("W3 — hidden-reveal overlay z-order", () => {
  test("reveal button is the top element at its centre, not obscured by the map", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    // Open the file/diagram view (where node-hide + the minimap live).
    await page.waitForSelector('[data-side-panel-tab="files"]', { timeout: 15_000 });
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="models.py"]');
    await page.waitForSelector(".react-flow__node", { timeout: 15_000 });
    await page.waitForTimeout(400);

    // Hide a node → the "Show hidden (N)" control appears.
    await page.evaluate(() =>
      document.dispatchEvent(new CustomEvent("vg-hide-node", { detail: { nodeId: "w3-probe" } })),
    );
    const btn = page.locator('button[title="Restore hidden nodes"]');
    await expect(btn).toBeVisible({ timeout: 5_000 });

    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      let cur: Element | null = el;
      let onButton = false;
      while (cur) {
        if ((cur as HTMLElement).matches?.('button[title="Restore hidden nodes"]')) { onButton = true; break; }
        cur = cur.parentElement;
      }
      return { onButton, tag: el?.tagName ?? "", cls: String((el as HTMLElement)?.className ?? "") };
    }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });

    expect(hit.onButton,
      `top element at reveal-button centre should be the button, got <${hit.tag} class="${hit.cls}">`).toBe(true);

    expect(pageErrors, `page errors:\n  ${pageErrors.join("\n  ")}`).toEqual([]);
  });
});
