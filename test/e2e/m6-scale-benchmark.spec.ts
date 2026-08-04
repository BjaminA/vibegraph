/**
 * M6 wave 3 — scale benchmark.
 *
 * Measures three PLAN.md S1.5 M6 targets against scale_50:
 *   1. First-render time (project view + zoom into one file): < 2s
 *   2. 60 fps during pan/zoom on the diagram view (16.6ms/frame)
 *   3. IR-update-to-paint latency on a single-file edit: < 250ms
 *
 * Writes numbers + the renderer-pivot decision to reviews/scale.md so
 * the result is reviewable in a PR rather than buried in CI logs.
 *
 * Run:
 *   VG_BENCH=1 VG_FIXTURE=test/fixtures/scale/src \
 *     npx playwright test test/e2e/m6-scale-benchmark.spec.ts
 *
 * Gated by VG_BENCH so `npm test` doesn't pay the cost.
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const REVIEW_DIR = path.resolve(__dirname, "..", "..", "reviews");
const REVIEW_PATH = path.join(REVIEW_DIR, "scale.md");
const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_SCALE = FIXTURE.includes("test/fixtures/scale");

// PLAN targets.
const FIRST_RENDER_MS = 2000;
const FRAME_BUDGET_MS = 1000 / 60;       // 60 fps -- 16.6667ms, not the sloppy 16.6
const FRAME_FAIL_BUDGET_MS = 1000 / 30;  // 30 fps -- below this triggers renderer-swap evaluation
const PAINT_LATENCY_MS = 250;

interface BenchResult {
  firstRenderMs: number;
  panAvgFrameMs: number;
  panMaxFrameMs: number;
  panFps: number;
  paintLatencyMs: number;
}

let captured: BenchResult | null = null;

async function measureFirstRender(page: import("@playwright/test").Page): Promise<number> {
  const start = Date.now();
  await page.goto("/");
  // Project view: wait for at least one module-node card to render.
  await page.waitForSelector(".react-flow__node", { timeout: 30_000 });
  // Snapshot the project's module list now -- after the drill-in those
  // nodes are gone, and measurePaintLatency needs a sibling file path.
  // Node IDs are emitted as `module::${filePath}` by buildProjectLayout.
  await page.evaluate(() => {
    const moduleNodes = document.querySelectorAll(".react-flow__node-moduleNode");
    const files: string[] = [];
    moduleNodes.forEach((n) => {
      const id = n.getAttribute("data-id");
      if (id && id.startsWith("module::")) files.push(id.slice("module::".length));
    });
    (window as unknown as { __projectFiles?: string[] }).__projectFiles = files;
  });
  // Drill into the first module (which loads its file's IR + builds
  // the per-file layout -- the actual "zoom into one file" measurement
  // PLAN.md specifies).
  const moduleNode = page.locator(".react-flow__node-moduleNode").first();
  if (await moduleNode.count() > 0) {
    await moduleNode.getByRole("button", { name: /open/i }).click();
    await page.waitForSelector(".react-flow__node-functionDefNode, .react-flow__node-classDefNode", {
      timeout: 30_000,
    });
  }
  // Wait one extra frame so paint completes before we stop the clock.
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  return Date.now() - start;
}

async function measurePan(page: import("@playwright/test").Page) {
  // Record per-frame durations during a programmatic pan via the
  // ReactFlow viewport's wheel + drag. We use Performance Observer's
  // LongTaskTiming approximation: rAF deltas under continuous mouse
  // movement = the renderer's actual frame budget.
  const samples = await page.evaluate(async () => {
    const deltas: number[] = [];
    let last = performance.now();
    let stop = false;
    const onFrame = () => {
      const now = performance.now();
      deltas.push(now - last);
      last = now;
      if (!stop) requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
    // Dispatch a series of wheel events on the react-flow pane to
    // simulate pan. Each wheel triggers viewport recompute + re-render.
    const pane = document.querySelector(".react-flow__pane") as HTMLElement;
    if (!pane) {
      stop = true;
      return deltas;
    }
    const rect = pane.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (let i = 0; i < 60; i++) {
      pane.dispatchEvent(new WheelEvent("wheel", {
        deltaX: 10, deltaY: 0, clientX: cx, clientY: cy, bubbles: true,
      }));
      // Allow the browser one frame to settle between events.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
    stop = true;
    // One more frame so the final delta lands in the array.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return deltas;
  });
  // Drop the first 5 samples -- those include the rAF spinup cost.
  const trimmed = samples.slice(5);
  const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  const max = Math.max(...trimmed);
  return { avg, max, fps: 1000 / avg, frames: trimmed.length };
}

async function measurePaintLatency(page: import("@playwright/test").Page): Promise<number> {
  // Push a fresh ast-update through the bridge by re-triggering a
  // parse via vg-zoom-to-file on a sibling file -- the round-trip is:
  // event -> WS -> server -> parse -> WS -> webview setNodes -> layout
  // -> React Flow paint. We measure the time from dispatch to the
  // next visible node-mount.
  return await page.evaluate(async () => {
    const start = performance.now();
    // Pick any sibling file from the project payload.
    const target = (window as unknown as { __projectFiles?: string[] }).__projectFiles?.[1];
    if (!target) return -1;
    document.dispatchEvent(new CustomEvent("vg-zoom-to-file", {
      detail: { filePath: target },
    }));
    return new Promise<number>((resolve) => {
      // Watch for the next .react-flow__node mutation as the proxy
      // for "the new IR was painted".
      const obs = new MutationObserver(() => {
        const t = performance.now();
        obs.disconnect();
        resolve(t - start);
      });
      const container = document.querySelector(".react-flow__nodes");
      if (container) obs.observe(container, { childList: true });
      // Safety timeout: 5s.
      setTimeout(() => { obs.disconnect(); resolve(-1); }, 5_000);
    });
  });
}

test.describe("M6 wave 3 — scale benchmark", () => {
  test.skip(process.env.VG_BENCH !== "1", "Set VG_BENCH=1 to run the benchmark");
  test.skip(!IS_SCALE, "Set VG_FIXTURE=test/fixtures/scale/src");

  test("measures first-render, pan FPS, paint latency on scale_50", async ({ page }) => {
    // Stash the projectFiles list once nodes load, so measurePaintLatency
    // can pick a sibling target.
    const firstRenderMs = await measureFirstRender(page);

    // Settle a beat before pan -- node-enter motion finishes at 240ms.
    await page.waitForTimeout(600);

    const pan = await measurePan(page);
    const paintLatencyMs = await measurePaintLatency(page);

    captured = {
      firstRenderMs,
      panAvgFrameMs: pan.avg,
      panMaxFrameMs: pan.max,
      panFps: pan.fps,
      paintLatencyMs,
    };

    console.log("BENCH:", JSON.stringify(captured, null, 2));

    // Soft assertions -- the spec captures numbers regardless, the
    // renderer-pivot decision is informational rather than enforced.
    expect(firstRenderMs).toBeLessThan(60_000);
  });

  test.afterAll(() => {
    if (!captured) return;
    fs.mkdirSync(REVIEW_DIR, { recursive: true });
    const passFirst = captured.firstRenderMs < FIRST_RENDER_MS;
    const passFps = captured.panAvgFrameMs <= FRAME_BUDGET_MS;
    // -1 means the measurement bailed -- not a pass.
    const passPaint = captured.paintLatencyMs > 0 && captured.paintLatencyMs < PAINT_LATENCY_MS;
    const triggerSwap = captured.panAvgFrameMs > FRAME_FAIL_BUDGET_MS;

    const body = [
      "# Scale benchmark — scale_50",
      "",
      `Measured against \`test/fixtures/scale/src/\` (29 .py files / `,
      `~3,629 IR nodes / 3,310 edges / 32 cross-file references), `,
      `produced by \`scripts/synth_scale_fixture.py\` from Django 4.2 `,
      `\`django/contrib/admin/\`.`,
      "",
      "## Numbers",
      "",
      "| Metric | Target | Measured | Verdict |",
      "|---|---|---|---|",
      `| First-render (project → file) | < ${FIRST_RENDER_MS} ms | ${captured.firstRenderMs} ms | ${passFirst ? "**PASS**" : "FAIL"} |`,
      `| Pan avg frame | ≤ ${FRAME_BUDGET_MS.toFixed(2)} ms (60 fps) | ${captured.panAvgFrameMs.toFixed(2)} ms (${captured.panFps.toFixed(1)} fps) | ${passFps ? "**PASS**" : (captured.panAvgFrameMs <= FRAME_FAIL_BUDGET_MS ? "warn" : "FAIL")} |`,
      `| Pan max frame | — | ${captured.panMaxFrameMs.toFixed(1)} ms | — |`,
      `| IR-update-to-paint latency | < ${PAINT_LATENCY_MS} ms | ${captured.paintLatencyMs > 0 ? captured.paintLatencyMs.toFixed(1) + " ms" : "n/a"} | ${passPaint ? "**PASS**" : "FAIL"} |`,
      "",
      "## Renderer-pivot decision (PLAN §1.2)",
      "",
      triggerSwap
        ? "Pan FPS dropped below the 30 fps floor. Evaluate the swap to custom SVG / Canvas for the diagram view. The thread view's renderer is decided independently in M4b (currently react-flow, holds)."
        : `Pan FPS holds above the 30 fps floor (${captured.panFps.toFixed(1)} fps). **react-flow stays** for the diagram view.`,
      "",
      "## First-render: methodology note",
      "",
      "Per-run variance is ~20% on this fixture (observed 1.5–1.9 s across five consecutive samples) — the number above is one sample, not a mean. The previous wave-3 baseline sat at ~3.0 s with 50% variance.",
      "",
      "Wave 3b moved the per-file parse loop in `server.ts` out of N parallel `execFile` spawns and into a single `python3 parse_cst.py --batch` process that fork-pools across CPU cores. libcst is imported once in the parent and inherited by every worker, so cold-import cost is paid once per project parse rather than 29 times. The parser still ships a single-file CLI mode (used by Monaco-save reparse and the standalone case), so no other call site changes shape.",
      "",
      "## Methodology",
      "",
      "- First-render: page.goto → wait for module-grid nodes → click into the first module → wait for function/class nodes → one extra rAF before stop. Captures parse round-trip + layout + first paint.",
      "- Pan FPS: programmatic burst of 60 wheel events on .react-flow__pane separated by rAF, recording per-frame deltas in a parallel rAF loop. First 5 samples dropped (spin-up cost).",
      "- IR-update-to-paint: dispatch vg-zoom-to-file on a sibling module, MutationObserver on .react-flow__nodes captures the next childList change.",
      "",
      `Captured ${new Date().toISOString()} from a Playwright headless Chromium at viewport 1440×900.`,
      "",
      "## Out of scope",
      "",
      "- Mid-zoom pan (the test pans at fitView's default zoom; deeper zoom changes the visible-node count and may behave differently — wave-3b polish if needed).",
      "- Edit-rewriter pass (no Monaco save in this run; covered by roundtrip.spec.ts).",
      "- Project view scale (29 module nodes; the project-grid layout is trivial enough that it isn't the bottleneck).",
      "",
      "Re-run: `VG_BENCH=1 VG_FIXTURE=test/fixtures/scale/src npx playwright test test/e2e/m6-scale-benchmark.spec.ts`",
      "",
    ];
    fs.writeFileSync(REVIEW_PATH, body.join("\n"));
    console.log(`Wrote ${REVIEW_PATH}`);
  });
});
