/**
 * M16.2 — verify the blank-thread-node + linker primitives.
 *
 * Per PLAN-v4 §4.6 M16.2 "Done":
 *   - Clicking "+ Add Node" in thread mode drops a BlankThreadNode on
 *     the canvas (data-blank-thread-node="true").
 *   - Pointerdown on the handle puts the linker in `linking` state
 *     (document.body[data-thread-linker-state="linking"]).
 *   - Pointerup over another thread node fires `vg-thread-link-drop`
 *     with sourceBlankId + targetNodeId (rejected=false).
 *   - Pointerup over empty canvas fires `vg-thread-link-drop` with
 *     rejected=true.
 *
 * Cross-cutting verification from M12: react-flow's setPointerCapture
 * suppresses compat `mouseup` events, so the linker MUST use
 * `pointerup` not `mouseup`. We exercise that path here by using
 * page.mouse.down/move/up (which fire pointer events) — if a regression
 * ever wires the linker to `mouseup`, this test goes red.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/m16-blank-linker.spec.ts \
 *     --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("M16.2 — blank-thread-node + linker", () => {
  test.skip(!IS_FLASK, "Needs VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("Add Node → blank appears → drag to step → link-drop fires", async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "warning" || msg.type() === "error") {
        console.log(`[webview ${msg.type()}]`, msg.text());
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open cli:main thread (has several step nodes we can land on).
    const cliRow = page.getByText("cli:main").first();
    await cliRow.waitFor({ state: "visible", timeout: 10_000 });
    await cliRow.click();
    await page.waitForTimeout(600);

    // In thread mode, the toolbar Add button reads "Add Node".
    const addBtn = page.getByRole("button", { name: /^Add Node$/ });
    await expect(addBtn).toBeVisible({ timeout: 5_000 });

    // Subscribe to vg-thread-link-drop on the page so we can assert
    // the drop event fires with the expected detail.
    await page.evaluate(() => {
      (window as unknown as { __vgLinkDrops: unknown[] }).__vgLinkDrops = [];
      document.addEventListener("vg-thread-link-drop", (e) => {
        (window as unknown as { __vgLinkDrops: unknown[] }).__vgLinkDrops.push(
          (e as CustomEvent).detail,
        );
      });
    });

    // Click Add Node → blank should appear on the canvas.
    await addBtn.click();
    const blank = page.locator('[data-blank-thread-node="true"]').first();
    await blank.waitFor({ state: "visible", timeout: 5_000 });

    // State should be idle before any drag.
    const initialState = await page.evaluate(
      () => document.body.dataset.threadLinkerState ?? "idle",
    );
    expect(initialState).toBe("idle");

    // Find the handle inside the blank.
    const handle = blank.locator('[data-blank-thread-node-handle="true"]');
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error("blank node handle not found");

    // Pick a thread step to land on. Any .vg-thread-node will do; the
    // first non-seed step is a safe choice.
    const targetNode = page.locator(".vg-thread-node").first();
    await targetNode.waitFor({ state: "visible", timeout: 5_000 });
    const targetBox = await targetNode.boundingBox();
    if (!targetBox) throw new Error("no thread node to land on");

    // Start the drag — pointerdown on the handle.
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(80);

    // State machine should now be `linking`.
    const linkingState = await page.evaluate(
      () => document.body.dataset.threadLinkerState ?? null,
    );
    expect(linkingState, "linker state after pointerdown").toBe("linking");

    // The transient SVG overlay should be mounted while linking.
    await expect(
      page.locator('[data-thread-linker-overlay="true"]'),
    ).toBeVisible({ timeout: 2_000 });

    // Drag toward the target step in two waypoints so the overlay
    // gets at least one mousemove tick rendered.
    await page.mouse.move(
      (handleBox.x + targetBox.x) / 2,
      (handleBox.y + targetBox.y) / 2,
      { steps: 6 },
    );
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 6 },
    );
    await page.waitForTimeout(60);

    // Visual review artefact: capture the blank → target drag mid-flight
    // so the dashed line, the blank's dashed border, and the link handle
    // are all visible in one frame.
    await page.screenshot({
      path: "test-results/m16-blank-linker-midflight.png",
      fullPage: true,
    });

    // Release on the target → linker should fire vg-thread-link-drop.
    await page.mouse.up();
    await page.waitForTimeout(120);

    // After the drop, body state should be back to idle (the linker
    // clears the attribute one tick after firing the event).
    const finalState = await page.evaluate(
      () => document.body.dataset.threadLinkerState ?? "idle",
    );
    expect(finalState, "state returns to idle after drop").toBe("idle");

    // The event must have fired and carry the source blank id + a
    // target node id (rejected=false).
    const drops = await page.evaluate(
      () => (window as unknown as { __vgLinkDrops: unknown[] }).__vgLinkDrops,
    );
    expect(drops, "exactly one link-drop fired").toHaveLength(1);
    const drop = drops[0] as {
      sourceBlankId?: string;
      targetNodeId?: string;
      rejected?: boolean;
    };
    expect(drop.rejected, "drop on a thread node should not be rejected").toBe(false);
    expect(drop.sourceBlankId, "sourceBlankId present").toMatch(/^blank-/);
    expect(drop.targetNodeId, "targetNodeId present").toBeTruthy();
  });

  test("drop on empty canvas → rejected=true (no thread node under cursor)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const cliRow = page.getByText("cli:main").first();
    await cliRow.click();
    await page.waitForTimeout(600);

    await page.evaluate(() => {
      (window as unknown as { __vgLinkDrops: unknown[] }).__vgLinkDrops = [];
      document.addEventListener("vg-thread-link-drop", (e) => {
        (window as unknown as { __vgLinkDrops: unknown[] }).__vgLinkDrops.push(
          (e as CustomEvent).detail,
        );
      });
    });

    await page.getByRole("button", { name: /^Add Node$/ }).click();
    const blank = page.locator('[data-blank-thread-node="true"]').first();
    await blank.waitFor({ state: "visible" });

    const handle = blank.locator('[data-blank-thread-node-handle="true"]');
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error("handle missing");

    // Drag into the top-left corner — guaranteed nothing-droppable area.
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(8, 8, { steps: 6 });
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.waitForTimeout(120);

    const drops = await page.evaluate(
      () => (window as unknown as { __vgLinkDrops: unknown[] }).__vgLinkDrops,
    );
    expect(drops).toHaveLength(1);
    const drop = drops[0] as { rejected?: boolean; reason?: string };
    expect(drop.rejected, "empty-canvas drop is rejected").toBe(true);
    expect(drop.reason).toMatch(/no thread node/i);
  });
});

// ── M16.3: type inference branches ────────────────────────────────────
//
// On drop, ThreadCanvas listens for vg-thread-link-drop, runs the
// target's IR through inferLinkTarget, and stamps the matching blank
// with `resolved` data (or `rejected: true` for ~600ms). The blank's
// data-blank-resolved attribute reflects the outcome:
//   "unresolved" — never linked, or in transient rejection
//   "call" / "instantiation" / "reference" — typed
// Rejected drops add a transient red flash, observable via
// data-blank-rejected="true".

test.describe("M16.3 — type inference on link drop", () => {
  test.skip(!IS_FLASK, "Needs VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("link to a function_def → blank resolves to call + funcName + args", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open the cli:main thread — seed is a function_def, so dropping
    // on it tests the "call" branch with non-empty args.
    await page.getByText("cli:main").first().click();
    await page.waitForTimeout(600);

    // Subscribe to link-drop events so we can also assert detail shape.
    await page.evaluate(() => {
      (window as unknown as { __vgLinkDrops: unknown[] }).__vgLinkDrops = [];
      document.addEventListener("vg-thread-link-drop", (e) => {
        (window as unknown as { __vgLinkDrops: unknown[] }).__vgLinkDrops.push(
          (e as CustomEvent).detail,
        );
      });
    });

    await page.getByRole("button", { name: /^Add Node$/ }).click();
    const blank = page.locator('[data-blank-thread-node="true"]').first();
    await blank.waitFor({ state: "visible" });

    // Before any drop the blank should be unresolved.
    expect(await blank.getAttribute("data-blank-resolved")).toBe("unresolved");

    // The seed `main` is a function_def IR. Pick it by its label.
    const seedNode = page.locator('.vg-thread-node').filter({ hasText: /main/ }).first();
    const seedBox = await seedNode.boundingBox();
    if (!seedBox) throw new Error("seed node not visible");

    const handle = blank.locator('[data-blank-thread-node-handle="true"]');
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error("blank handle missing");

    // Drag from handle to the seed node.
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      (handleBox.x + seedBox.x) / 2,
      (handleBox.y + seedBox.y) / 2,
      { steps: 6 },
    );
    await page.mouse.move(
      seedBox.x + seedBox.width / 2,
      seedBox.y + seedBox.height / 2,
      { steps: 6 },
    );
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Capture a visual artefact of the resolved state.
    await page.screenshot({
      path: "test-results/m16-blank-resolved-call.png",
      fullPage: true,
    });

    // Blank's data attribute should now read "call".
    const resolved = await blank.getAttribute("data-blank-resolved");
    expect(resolved, "blank resolves to call after dropping on function_def").toBe("call");

    // The funcName surfaced as data-blank-funcname should be `main`.
    const funcSpan = blank.locator("[data-blank-funcname]");
    await expect(funcSpan).toBeVisible();
    expect(await funcSpan.getAttribute("data-blank-funcname")).toBe("main");

    // The link-drop event itself fired with rejected=false.
    const drops = await page.evaluate(
      () => (window as unknown as { __vgLinkDrops: unknown[] }).__vgLinkDrops,
    );
    expect(drops).toHaveLength(1);
    expect((drops[0] as { rejected?: boolean }).rejected).toBe(false);
  });

  test("link to a non-callable (external, no IR) → rejected flash, blank stays unresolved", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByText("cli:main").first().click();
    await page.waitForTimeout(600);

    await page.getByRole("button", { name: /^Add Node$/ }).click();
    const blank = page.locator('[data-blank-thread-node="true"]').first();
    await blank.waitFor({ state: "visible" });

    // An external thread node (library call terminal) has file=null,
    // so the BlankThreadNodeLinker resolves targetIrNodeId=null, which
    // inferLinkTarget rejects with "target has no IR node id".
    // PLAN-v4 §4.2 step 4 groups this with the "non-callable" branch;
    // user-visible behaviour is the same: red flash, blank stays.
    // External nodes carry data-ir-type="" (empty) on .vg-thread-node;
    // use page.evaluate to pick the FIRST such node by index so the
    // locator query stays predictable.
    const externalIdx = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll(".vg-thread-node"));
      return all.findIndex((el) => !(el as HTMLElement).dataset.irType);
    });
    if (externalIdx < 0) {
      test.skip(true, "no external (no-IR) thread node in cli:main fixture");
      return;
    }
    const callStep = page.locator(".vg-thread-node").nth(externalIdx);
    const stepBox = await callStep.boundingBox();
    if (!stepBox) throw new Error("external step box missing");

    const handle = blank.locator('[data-blank-thread-node-handle="true"]');
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error("blank handle missing");

    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      stepBox.x + stepBox.width / 2,
      stepBox.y + stepBox.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.waitForTimeout(80);

    // While the rejection flash is on, the blank carries
    // data-blank-rejected="true" AND stays data-blank-resolved="unresolved".
    expect(await blank.getAttribute("data-blank-rejected")).toBe("true");
    expect(await blank.getAttribute("data-blank-resolved")).toBe("unresolved");

    await page.screenshot({
      path: "test-results/m16-blank-rejected-flash.png",
      fullPage: true,
    });

    // After the flash window (600ms in ThreadCanvas) the rejected
    // attribute should clear, but the blank stays unresolved.
    await page.waitForTimeout(750);
    expect(await blank.getAttribute("data-blank-rejected")).toBe("false");
    expect(await blank.getAttribute("data-blank-resolved")).toBe("unresolved");
  });
});
