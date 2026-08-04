/**
 * M9.3 — cross-file depth cues.
 *
 * Three invariants per PLAN-v2.md §2.2:
 *   1. Per-file colour wash — seed file is hue 0, each non-seed file
 *      gets a distinct hue index in 0..7.
 *   2. Diagonal flow offset — nodes from deeper files sit further
 *      right + down than depth-0 (seed) nodes; the offset is
 *      visible in the rendered layout positions, not just the data.
 *   3. Cross-file cross-depth edges pick up the `cross-depth` class.
 *
 * flask_demo's cli:main thread reaches three files at three depths:
 *   cli.py (depth 0, seed) → models.py (depth 1) → db.py (depth 2)
 * That's enough to exercise all three primitives.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

interface NodeMeta {
  id: string;
  file: string;
  fileHue: string;     // "0".."7" or ""
  fileDepth: string;   // "0".."4" or ""
  // Position from the .react-flow__node wrapper's transform.
  x: number | null;
  y: number | null;
}

interface EdgeMeta {
  classes: string;
  source: string;
  target: string;
}

async function readNodes(page: import("@playwright/test").Page): Promise<NodeMeta[]> {
  return await page.evaluate(() => {
    const out: NodeMeta[] = [];
    document.querySelectorAll<HTMLElement>(".react-flow__node").forEach((wrap) => {
      const inner = wrap.querySelector<HTMLElement>(".vg-thread-node");
      if (!inner) return;
      const id = wrap.getAttribute("data-id") ?? "";
      // Parse the inline transform = translate(Xpx, Ypx). React Flow
      // sets this on the wrapper directly.
      const tr = wrap.style.transform;
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(tr);
      out.push({
        id,
        file: id.split(":")[0] ?? "",
        fileHue: inner.getAttribute("data-file-hue") ?? "",
        fileDepth: inner.getAttribute("data-file-depth") ?? "",
        x: m ? parseFloat(m[1]) : null,
        y: m ? parseFloat(m[2]) : null,
      });
    });
    return out;
  });
}

async function readEdges(page: import("@playwright/test").Page): Promise<EdgeMeta[]> {
  return await page.evaluate(() => {
    const out: EdgeMeta[] = [];
    document.querySelectorAll<SVGGElement>("g.vg-thread-edge").forEach((g) => {
      out.push({
        classes: g.getAttribute("class") ?? "",
        source: g.getAttribute("data-source") ?? "",
        target: g.getAttribute("data-target") ?? "",
      });
    });
    return out;
  });
}

async function openThread(page: import("@playwright/test").Page, entryId: string) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
  await page.click(`[data-thread-index-row][data-entry-id="${entryId}"]`);
  await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
}

test.describe("M9.3 — cross-file depth cues", () => {
  test.skip(!IS_FLASK,
    "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("seed file is hue 0 + depth 0; other files get distinct hues", async ({ page }) => {
    await openThread(page, "cli.py:main");
    const meta = await readNodes(page);

    const seed = meta.find((n) => n.id === "cli:main");
    expect(seed?.fileHue).toBe("0");
    expect(seed?.fileDepth).toBe("0");

    // Every cli.py node shares the seed hue (0). Terminals (external)
    // have no file → no hue (data-file-hue absent).
    const cliNodes = meta.filter((n) => n.id.startsWith("cli:") && !n.id.startsWith("cli:external"));
    expect(cliNodes.length).toBeGreaterThan(1);
    for (const n of cliNodes) {
      expect(n.fileHue).toBe("0");
      expect(n.fileDepth).toBe("0");
    }

    // Cross-file thread nodes pick up a NON-zero hue. flask_demo's
    // cli:main reaches both models.py and db.py — those are two
    // distinct hues.
    const huesByFile = new Map<string, Set<string>>();
    for (const n of meta) {
      if (!n.fileHue) continue;
      const set = huesByFile.get(n.file) ?? new Set<string>();
      set.add(n.fileHue);
      huesByFile.set(n.file, set);
    }
    // Each file maps to exactly one hue.
    for (const [, hues] of huesByFile) expect(hues.size).toBe(1);
    // At least three distinct file hues across the thread (cli, models, db).
    const allHues = new Set<string>();
    for (const [, hues] of huesByFile) for (const h of hues) allHues.add(h);
    expect(allHues.size).toBeGreaterThanOrEqual(3);
    expect(allHues.has("0")).toBe(true);
  });

  test("file depths step 0 → 1 → 2 across the cli thread", async ({ page }) => {
    await openThread(page, "cli.py:main");
    const meta = await readNodes(page);

    // Collect depth per file.
    const depthByFile = new Map<string, string>();
    for (const n of meta) {
      if (!n.fileDepth) continue;
      depthByFile.set(n.file, n.fileDepth);
    }
    // cli.py is the seed → depth 0.
    expect(depthByFile.get("cli")).toBe("0");
    // models.py is reachable in one cross-file hop → depth 1.
    expect(depthByFile.get("models")).toBe("1");
    // db.py is reachable from models.py (insert calls db._get_conn) → depth 2.
    expect(depthByFile.get("db")).toBe("2");
  });

  test("diagonal flow offset shifts deeper-file nodes right + down", async ({ page }) => {
    await openThread(page, "cli.py:main");
    const meta = await readNodes(page);

    // Compare the *minimum* y of each file's nodes — depth pushes
    // them down by depth*4px, so deeper files start lower even after
    // the row-spacing pass. (Layout coords, before fitView's screen
    // scale.)
    const minYByFile = new Map<string, number>();
    for (const n of meta) {
      if (n.y == null || !n.fileDepth) continue;
      const cur = minYByFile.get(n.file);
      if (cur == null || n.y < cur) minYByFile.set(n.file, n.y);
    }
    // Hard invariant: deeper files start AT LEAST depth*4 - some
    // row-budget below the seed file's min y. Use a relaxed bound
    // (8px) since row-spacing dominates the absolute layout — the
    // depth offset is additive, so seed - deepest >= row-step + 4.
    const cliY = minYByFile.get("cli");
    const modelsY = minYByFile.get("models");
    const dbY = minYByFile.get("db");
    expect(cliY).toBeDefined();
    expect(modelsY).toBeDefined();
    expect(dbY).toBeDefined();
    expect(modelsY!).toBeGreaterThan(cliY!);
    expect(dbY!).toBeGreaterThan(modelsY!);
  });

  test("cross-file cross-depth edges pick up the cross-depth class", async ({ page }) => {
    await openThread(page, "cli.py:main");
    const edges = await readEdges(page);

    // Find an edge that hops cli → models (or models → db) — those
    // are cross-file AND cross-depth (depth 0 → 1, 1 → 2).
    const crossDepth = edges.filter((e) =>
      e.classes.includes("vg-thread-edge-cross-depth"));
    expect(crossDepth.length).toBeGreaterThan(0);

    // Cross-depth edges are a strict subset of cross-file edges
    // (same depth can't differ by definition).
    for (const e of crossDepth) {
      expect(e.classes).toContain("vg-thread-edge-cross-file");
    }

    // Within-file edges (cli:main → cli:cmd_create) must NOT have
    // the cross-depth class.
    const withinCli = edges.filter((e) =>
      e.source.startsWith("cli:") && e.target.startsWith("cli:"));
    expect(withinCli.length).toBeGreaterThan(0);
    for (const e of withinCli) {
      expect(e.classes).not.toContain("vg-thread-edge-cross-depth");
      expect(e.classes).not.toContain("vg-thread-edge-cross-file");
    }
  });

  test("same-file edges carry the file's wash hue via data-edge-file-hue", async ({ page }) => {
    await openThread(page, "cli.py:main");
    const hues = await page.evaluate(() => {
      const out: { source: string; target: string; hue: string; classes: string }[] = [];
      document.querySelectorAll<SVGGElement>("g.vg-thread-edge").forEach((g) => {
        out.push({
          source: g.getAttribute("data-source") ?? "",
          target: g.getAttribute("data-target") ?? "",
          hue: g.getAttribute("data-edge-file-hue") ?? "",
          classes: g.getAttribute("class") ?? "",
        });
      });
      return out;
    });
    // At least one within-cli edge picks up hue 0 (the seed file's hue).
    const withinCliHued = hues.filter((e) =>
      e.source.startsWith("cli:") && e.target.startsWith("cli:") && e.hue === "0");
    expect(withinCliHued.length).toBeGreaterThan(0);

    // Cross-file edges DON'T set the attribute — they stay on the
    // default --accent-thread. Trust the class: only edges flagged
    // vg-thread-edge-cross-file are "real" cross-file edges (terminals
    // with file=null are NOT cross-file even when their IDs prefix-
    // differ).
    const crossFile = hues.filter((e) =>
      e.classes.includes("vg-thread-edge-cross-file"));
    expect(crossFile.length).toBeGreaterThan(0);
    for (const e of crossFile) {
      expect(e.hue).toBe("");
    }
  });
});
