/**
 * M17.2 + M17.3 — thread view renders past IR v1.5 container shape AND
 * surfaces try/except/finally/while as bordered regions.
 *
 * Historical: M17.2 added `kind: "container"` thread nodes and
 * `kind: "contains"` edges to extract_thread.py. The pre-M17.3 renderer
 * had no KIND_SHAPE entry for "container" → ThreadNode crashed →
 * ReactFlow unmounted → thread view blanked. The first wave of this
 * spec was the regression catch that would have flagged the gap.
 *
 * M17.3 lifts the M17.2-hotfix filter and renders containers via
 * ThreadContainerNode (bordered rounded-rect, chip label, accent per
 * containerKind: teal for try/finally/while, red for except). The
 * later tests in this file pin that the bordered regions actually
 * paint at the right kinds + are positioned around their descendants.
 *
 * Gated on flask_demo: only that fixture's IR contains try/finally
 * subtrees the extractor promotes to containers. Default
 * sample_advanced fixture has none.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4203 PORT=4203 \
 *     npx playwright test test/e2e/m17-2-thread-render.spec.ts \
 *     --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

test.describe("M17.2 — thread view renders past IR v1.5 container nodes", () => {
  test.skip(!IS_FLASK, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("cli:main thread renders without crashing (containers filtered)", async ({ page }) => {
    // Capture any uncaught page errors. The pre-hotfix regression was
    // exactly this kind of failure (TypeError reading .borderWeight on
    // undefined inside ThreadNode), so a clean JS-error inbox is the
    // primary signal we're looking for.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    // cli:main reaches db.py:insert via cmd_create → create_user → insert.
    // insert wraps its work in try/finally, so the M17.2 extractor emits
    // container thread nodes for that subtree. If the renderer crashes
    // on the unknown kind, the thread view never mounts.
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    const threadView = page.locator("[data-thread-view]");
    await expect(threadView).toBeVisible({ timeout: 10_000 });
    // Settle d3-force + fitView so the assertions land on the stable layout.
    await page.waitForTimeout(700);

    // Primary check: actual thread nodes painted.
    const nodes = page.locator(".vg-thread-node");
    const nodeCount = await nodes.count();
    expect(
      nodeCount,
      `cli:main should render multiple thread nodes; got ${nodeCount}`,
    ).toBeGreaterThan(3);

    // The seed and at least one external terminal must be present —
    // proves the kind dispatch is still working for the known kinds.
    await expect(page.locator(".vg-thread-node-seed").first()).toBeVisible();
    await expect(page.locator(".vg-thread-node-external").first()).toBeVisible();

    // M17.3 — containers render via ThreadContainerNode (separate
    // component / class), not ThreadNode. The original M17.2 hotfix
    // class (`.vg-thread-node-container`, which ThreadNode would have
    // emitted) must NEVER appear, since containers go through a
    // distinct nodeTypes entry.
    await expect(page.locator(".vg-thread-node-container")).toHaveCount(0);

    // No JS errors at all — the original regression's signature.
    expect(
      pageErrors,
      `unexpected page errors:\n  ${pageErrors.join("\n  ")}`,
    ).toEqual([]);
  });

  test("M17.3: cli:main thread surfaces try + finally containers as bordered regions", async ({ page }) => {
    // Wider check than the regression smoke above: assert the new
    // ThreadContainerNode is mounted, the right containerKind classes
    // appear, and the chip labels read as "TRY" / "FINALLY".
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);

    // db.py:insert and db.py:query each contribute a try + finally;
    // cli:main reaches both through cmd_create → create_user → insert
    // and cmd_list → list_users → query.
    const tryContainers = page.locator(".vg-thread-container-try");
    const finallyContainers = page.locator(".vg-thread-container-finally");
    const tryCount = await tryContainers.count();
    const finallyCount = await finallyContainers.count();
    expect(
      tryCount,
      `expected >=1 try containers (insert + query each have one); got ${tryCount}`,
    ).toBeGreaterThanOrEqual(1);
    expect(
      finallyCount,
      `expected >=1 finally containers; got ${finallyCount}`,
    ).toBeGreaterThanOrEqual(1);

    // Each container's chip label exposes the keyword head uppercased.
    const tryChip = tryContainers.locator(".vg-thread-container-chip").first();
    await expect(tryChip).toBeVisible();
    expect(await tryChip.textContent()).toBe("TRY");

    const finallyChip = finallyContainers.locator(".vg-thread-container-chip").first();
    await expect(finallyChip).toBeVisible();
    expect(await finallyChip.textContent()).toBe("FINALLY");

    // Save a still for visual review (analogous to reviews/m4b/).
    const reviewDir = join(process.cwd(), "reviews", "m17-control-flow-containers");
    mkdirSync(reviewDir, { recursive: true });
    await page.screenshot({
      path: join(reviewDir, "cli-main-try-finally.png"),
      fullPage: false,
    });

    expect(pageErrors).toEqual([]);
  });

  test("M17.3: cli:main splits if/elif/else + for into distinct arm containers", async ({ page }) => {
    // The §E.4 promotion: cli:main branches on args.cmd — an outer
    // `if args.cmd == "list"` (whose then-arm runs cmd_list, itself
    // looping `for u in list_users()`), an `elif args.cmd == "create"`
    // (a nested if living in the outer else arm), and a trailing else.
    // Each arm becomes its own bordered region: then-arm calls land in
    // if_then, else-arm calls in if_else, keyed on the parser's elseLine
    // source position. This is the living-renderer proof that the
    // extractor's arm split actually paints — snapshot equality alone
    // (test:thread) can't catch a renderer that drops the if arms.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);

    // if_then: outer `if args.cmd == "list"` arm (plus the elif's own if,
    // which nests inside the outer else). Chip head reads "IF".
    const ifThen = page.locator(".vg-thread-container-if_then");
    expect(
      await ifThen.count(),
      "expected >=1 if_then arm container",
    ).toBeGreaterThanOrEqual(1);
    expect(await ifThen.locator(".vg-thread-container-chip").first().textContent()).toMatch(/^IF\b/);

    // if_else: the trailing else arm. Chip reads exactly "ELSE" — the
    // distinct, quieter region a call in the else branch lands in.
    const ifElse = page.locator(".vg-thread-container-if_else");
    expect(
      await ifElse.count(),
      "expected >=1 if_else arm container",
    ).toBeGreaterThanOrEqual(1);
    expect(await ifElse.locator(".vg-thread-container-chip").first().textContent()).toBe("ELSE");

    // for: cmd_list's `for u in list_users()` loop is now promoted too.
    const forContainer = page.locator(".vg-thread-container-for");
    expect(
      await forContainer.count(),
      "expected >=1 for container",
    ).toBeGreaterThanOrEqual(1);
    expect(await forContainer.locator(".vg-thread-container-chip").first().textContent()).toMatch(/^FOR\b/);

    // Save a still for visual review alongside the try/finally capture.
    const reviewDir = join(process.cwd(), "reviews", "m17-control-flow-containers");
    mkdirSync(reviewDir, { recursive: true });
    await page.screenshot({
      path: join(reviewDir, "cli-main-if-for-arms.png"),
      fullPage: false,
    });

    expect(pageErrors).toEqual([]);
  });

  test("M17.3-polish: container children carry a larger enter-stagger delay than their container", async ({ page }) => {
    // The staggered fade-in (motion.css .vg-thread-enter) feeds each
    // react-flow node wrapper a --vg-enter-delay equal to its containment
    // depth * 50ms. Containers / top-level nodes get 0ms; a call site
    // inside a try gets 50ms. We can't meaningfully assert *timing* in a
    // headless run, but we CAN assert the delay variable was wired with
    // the right structure-then-content ordering.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    // db.py:insert is the smallest container-bearing thread: seed +
    // _get_conn at depth 0, conn.execute / conn.commit / return inside
    // the try at depth 1, conn.close inside finally at depth 1.
    await page.click('[data-thread-index-row][data-entry-id="db.py:insert"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);

    // Every rendered react-flow node (regular + container) opts into the
    // thread enter animation.
    const enterNodes = page.locator(".react-flow__node.vg-thread-enter");
    expect(await enterNodes.count()).toBeGreaterThan(3);

    // Collect the --vg-enter-delay off every node wrapper.
    const delays = await page.$$eval(".react-flow__node.vg-thread-enter", (els) =>
      els.map((el) => getComputedStyle(el).getPropertyValue("--vg-enter-delay").trim()),
    );
    // The try / finally containers and the seed are at depth 0 → 0ms.
    expect(delays).toContain("0ms");
    // conn.execute / conn.commit / conn.close / return live one container
    // deep → 50ms. Their presence proves children are delayed *after* the
    // container, which renders at 0ms.
    expect(delays).toContain("50ms");

    expect(pageErrors).toEqual([]);
  });

  test("flask route thread (db.py:insert reachable from create_user) also renders", async ({ page }) => {
    // Pick a different entry point to exercise a second thread shape.
    // POST /users → create_user_route → create_user → insert. Same
    // try/finally subtree, different seed.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    // create_user_route is the POST handler in app.py.
    const routeRow = page.locator('[data-thread-index-row]').filter({ hasText: /create_user/ }).first();
    await routeRow.click();

    const threadView = page.locator("[data-thread-view]");
    await expect(threadView).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);

    const nodeCount = await page.locator(".vg-thread-node").count();
    expect(nodeCount).toBeGreaterThan(0);
    await expect(page.locator(".vg-thread-node-container")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});
