/**
 * M-RUN — "run to this node" end-to-end through the thread UI.
 *
 * Unit tests cover the server harness, the pre-gate, the synth chokepoint and
 * the effect floor in isolation — but each feeds an IR node id straight to the
 * core. They never exercise the INTEGRATED click-through, where a rendered
 * thread step node carries the CALLEE's id and the value-of-interest lives on
 * the incoming edge (the gap that made the happy path decline `unsupported-
 * target` until the call-site resolution landed). This spec drives the real
 * surface: hover a thread node → "▷ Run to here" → assert the outcome RENDERS
 * distinctly in the tooltip (not just that the server returned it).
 *
 * Adversarial by construction: the run_demo fixture engineers one honest
 * outcome per entry (calc.py / effects.py / broken.py), so each failure state
 * is forced, not just the happy path.
 *
 * Gated on VG_FIXTURE=run_demo. The SM2 synthesizer is driven by a
 * deterministic stub (VG_CLAUDE_BIN, set by `npm run test:e2e-run`) — automated
 * tests never spawn the real `claude` (auth/cost, M10R.7). Interaction note:
 * clicking a thread node DISMISSES its tooltip (click-to-pin broke in M23/M24);
 * the tooltip opens on hover, so we mouse.move to the node and click the run
 * button directly without re-clicking the node.
 */
import { test, expect, type Page } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_RUN_DEMO = FIXTURE.includes("run_demo");

test.describe("M-RUN — run to this node (integrated)", () => {
  test.skip(!IS_RUN_DEMO, "Requires VG_FIXTURE=test/fixtures/threads/run_demo");

  async function openThread(page: Page, entryId: string) {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click(`[data-thread-index-row][data-entry-id="${entryId}"]`);
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1100); // let the node-enter animation settle
  }

  // Hover the node open (click dismisses), then click "Run to here".
  async function runNode(page: Page, nodeId: string) {
    const node = page.locator(`.react-flow__node[data-id="${nodeId}"]`);
    await expect(node).toBeVisible({ timeout: 10_000 });
    const box = await node.boundingBox();
    if (!box) throw new Error(`no bounding box for ${nodeId}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator("[data-thread-tooltip]")).toBeVisible({ timeout: 5_000 });
    const runBtn = page.locator("[data-run-to-here]");
    await expect(runBtn).toBeVisible();
    await runBtn.click();
  }

  test("pure no-arg happy path renders a real captured value", async ({ page }) => {
    await openThread(page, "calc.py:happy");
    await runNode(page, "calc:double");
    const result = page.locator("[data-run-result]");
    await expect(result).toHaveAttribute("data-run-outcome", "ok", { timeout: 15_000 });
    await expect(result).toContainText("captured value");
    await expect(result).toContainText("400"); // result = double(20)
    await expect(result).toContainText("real input"); // provenance, not synthesized
  });

  test("synth path shows the made-up args, then a labelled result", async ({ page }) => {
    await openThread(page, "calc.py:scaled");
    await runNode(page, "calc:double");
    // Phase 1 — the synthesized-args confirm gate (honesty framing, not danger).
    const proposal = page.locator("[data-synth-proposal]");
    await expect(proposal).toBeVisible({ timeout: 15_000 });
    // No effect-gate first (pure path) and not the synth-failure variant —
    // this is the genuine made-up-inputs confirm.
    await expect(page.locator("[data-effect-gate]")).toHaveCount(0);
    await expect(proposal).toContainText("synthesized");
    await expect(page.locator("[data-synth-arg='n']")).toHaveValue("7"); // synthesized value, in the editable field
    // Phase 2 — confirm and read the labelled result.
    await page.locator("[data-synth-confirm]").click();
    const result = page.locator("[data-run-result]");
    await expect(result).toHaveAttribute("data-run-outcome", "ok", { timeout: 15_000 });
    await expect(result).toContainText("49"); // double(7)
    await expect(result).toContainText("synthesized input"); // provenance travels with the value
  });

  test("synth args are editable — an edited literal flows through", async ({ page }) => {
    await openThread(page, "calc.py:scaled");
    await runNode(page, "calc:double");
    const input = page.locator("[data-synth-arg='n']");
    await expect(input).toBeVisible({ timeout: 15_000 });
    await expect(input).toHaveValue("7"); // the stub's synthesized value, pre-filled
    await input.fill("5"); // fix it by hand
    await page.locator("[data-synth-confirm]").click();
    const result = page.locator("[data-run-result]");
    await expect(result).toHaveAttribute("data-run-outcome", "ok", { timeout: 15_000 });
    await expect(result).toContainText("25"); // double(5)
    await expect(result).toContainText("n=5");
  });

  test("an invalid synth edit is rejected honestly at the injection boundary", async ({ page }) => {
    await openThread(page, "calc.py:scaled");
    await runNode(page, "calc:double");
    const input = page.locator("[data-synth-arg='n']");
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill("boom()"); // a call, not a literal — check_literals must reject
    await page.locator("[data-synth-confirm]").click();
    const result = page.locator("[data-run-result]");
    await expect(result).toHaveAttribute("data-run-outcome", "harness-error", { timeout: 15_000 });
    await expect(result).toContainText(/failed validation|non-literal/);
  });

  test("side-effect node surfaces the consent gate, not a silent run", async ({ page }) => {
    await openThread(page, "effects.py:touched");
    await runNode(page, "effects:disk_size");
    // The effect hides one frame down (fs), so the CLIENT allows and the
    // authoritative SERVER floor refuses → the side-effect consent gate.
    const gate = page.locator("[data-effect-gate]");
    await expect(gate).toBeVisible({ timeout: 15_000 });
    await expect(gate).toContainText("side effect");
    await expect(gate).toContainText("getsize"); // the detected fs effect target
    await expect(page.locator("[data-effect-confirm]")).toBeVisible();
    // Sitting-2 — a PROVEN effect is never library/category-trustable: the
    // session-trust affordance must NOT render on an all-effect gate.
    await expect(page.locator("[data-trust-unverified]")).toHaveCount(0);
  });

  // ── Sitting-2 — long consent lists + session trust for unverifiable calls ──
  // One test, deliberately sequential: the session grant is server-process
  // state, so granting on `train` must be observed by `train_more` in the
  // same run — and must NOT leak onto proven-effect gates.
  test("Sitting-2: long gate scrolls with actions reachable; category-trust runs and persists; proven effects still gate", async ({ page }) => {
    // 1. The long unverifiable path gates with EVERY offense listed. The
    //    thread opens seed-anchored (legibility floor), so the far-right
    //    summarize step needs a fit first to be hoverable.
    await openThread(page, "torchy.py:train");
    await page.locator(".react-flow__controls-fitview").click();
    await page.waitForTimeout(500);
    await runNode(page, "torchy:summarize");
    const gate = page.locator("[data-effect-gate]");
    await expect(gate).toBeVisible({ timeout: 15_000 });
    await expect(gate).toContainText("rig.warm");
    await expect(gate).toContainText("rig.rest");
    // 2. The list scrolls instead of pushing the action row off the tooltip:
    //    confirm, Cancel, and the trust affordance all stay actionable.
    const list = page.locator("[data-effect-list]");
    const scrolls = await list.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls).toBe(true);
    await expect(page.locator("[data-effect-confirm]")).toBeInViewport();
    await expect(gate.getByRole("button", { name: "Cancel" })).toBeInViewport();
    const trust = page.locator("[data-trust-unverified]");
    await expect(trust).toBeInViewport();
    // 3. Granting the category-trust re-fires the run; the whole path is
    //    unverifiable-only, so it executes and captures the REAL value.
    await trust.click();
    const result = page.locator("[data-run-result]");
    await expect(result).toHaveAttribute("data-run-outcome", "ok", { timeout: 15_000 });
    await expect(result).toContainText("42"); // x = summarize(21)
    // 4. The grant is session-wide: a DIFFERENT unverifiable path now runs
    //    with no gate at all.
    await openThread(page, "torchy.py:train_more");
    await page.locator(".react-flow__controls-fitview").click();
    await page.waitForTimeout(500);
    await runNode(page, "torchy:summarize");
    await expect(page.locator("[data-run-result]")).toHaveAttribute("data-run-outcome", "ok", { timeout: 15_000 });
    await expect(page.locator("[data-effect-gate]")).toHaveCount(0);
    // 5. Proven effects are NOT covered by the grant: the fs gate still asks.
    await openThread(page, "effects.py:touched");
    await runNode(page, "effects:disk_size");
    await expect(page.locator("[data-effect-gate]")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-trust-unverified]")).toHaveCount(0);
  });

  // The honest-failure matrix — each must RENDER a distinct headline, proving
  // the server's outcome honesty survives into the UI.
  const FAILURES: Array<{ entry: string; node: string; outcome: string; text: RegExp }> = [
    { entry: "broken.py:needs_dep", node: "broken:double", outcome: "import-error", text: /dependency isn't in the environment/ },
    { entry: "calc.py:crashed", node: "calc:double", outcome: "runtime-error", text: /raised before reaching this node/ },
    { entry: "calc.py:not_reached", node: "calc:double", outcome: "probe-not-reached", text: /Probe not reached/ },
    { entry: "calc.py:opaque", node: "calc:passthrough", outcome: "value-opaque", text: /non-deterministic repr/ },
    { entry: "calc.py:swallowed", node: "calc:double", outcome: "stop-not-enforced", text: /swallowed the stop/ },
  ];
  for (const f of FAILURES) {
    test(`honest failure renders distinctly: ${f.outcome}`, async ({ page }) => {
      await openThread(page, f.entry);
      await runNode(page, f.node);
      const result = page.locator("[data-run-result]");
      await expect(result).toHaveAttribute("data-run-outcome", f.outcome, { timeout: 15_000 });
      await expect(result).toContainText(f.text);
    });
  }

  // ── M-RUN3 — capture beyond assignments + affordance honesty ─────────

  test("M-RUN3: a step whose call site is a RETURN captures the returned value", async ({ page }) => {
    await openThread(page, "calc.py:report");
    await runNode(page, "calc:double");
    const result = page.locator("[data-run-result]");
    await expect(result).toHaveAttribute("data-run-outcome", "ok", { timeout: 15_000 });
    await expect(result).toContainText("441"); // return double(21) — the REAL value
    await expect(result).toContainText("real input");
  });

  test("Sitting-2: the RETURN terminal itself offers run-to-here and captures the returned value", async ({ page }) => {
    // A return node is an edit-terminal but not a run-terminal: capture_probe
    // exists to grab a return's value, and a pure-expression return has no
    // call step to run from — the return node is the only handle.
    await openThread(page, "calc.py:report");
    await runNode(page, "calc:report:return@0");
    const result = page.locator("[data-run-result]");
    await expect(result).toHaveAttribute("data-run-outcome", "ok", { timeout: 15_000 });
    await expect(result).toContainText("441"); // return double(21) — the REAL value
  });

  test("M-RUN3: a node with no capturable value shows NO run button (not a decline-after-click)", async ({ page }) => {
    await openThread(page, "calc.py:happy");
    // The SEED node is a function_def — it produces no single value. Before
    // M-RUN3 it offered the button and declined on click; now the affordance
    // matches the operation: tooltip yes, run button no.
    const node = page.locator('.react-flow__node[data-id="calc:happy"]');
    await expect(node).toBeVisible({ timeout: 10_000 });
    const box = await node.boundingBox();
    if (!box) throw new Error("no bounding box for calc:happy");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator("[data-thread-tooltip]")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("[data-run-to-here]")).toHaveCount(0);
  });
});
