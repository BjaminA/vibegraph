/**
 * M-AGENT3 (PLAN-M-AGENT.md) — real workers, end-to-end: a SCRIPTED
 * stub claude (fake_worker.mjs) receives the true worker spawn shape,
 * reads the vibegraph MCP url from its own --mcp-config argv, and
 * lands edits through vibegraph_rewrite_node — the REAL chokepoint
 * path. The spec then proves the gate semantics on disk:
 *
 *   * evidence cards show SERVER-collected confined diffs + IR delta;
 *   * Approve keeps the packet's marker in models.py;
 *   * Reject RESTORES the pre-packet snapshot — that packet's marker
 *     is gone from disk while the approved one survives.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4282 PORT=4282 \
 *   VG_CLAUDE_BIN="node $PWD/test/fixtures/work_run/fake_worker.mjs" \
 *   FAKE_EDIT_FILE=models.py FAKE_EDIT_NODE=module/list_users.fn \
 *     npx playwright test test/e2e/m-agent3-worker.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const STUBBED = (process.env.VG_CLAUDE_BIN ?? "").includes("fake_worker");
const MODELS = join(process.cwd(), FIXTURE, "models.py");
const RUN_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "work-run.json");
const SNAP_DIR = join(process.cwd(), FIXTURE, ".vibegraph", "work-snapshots");

test.describe("M-AGENT3 — worker sessions with gated, restorable edits", () => {
  test.skip(!IS_FLASK || !STUBBED, "Requires flask_demo + fake_worker stub");

  let original = "";
  test.beforeAll(() => { original = readFileSync(MODELS, "utf-8"); });
  test.afterAll(() => {
    writeFileSync(MODELS, original, "utf-8");
    rmSync(RUN_FILE, { force: true });
    rmSync(SNAP_DIR, { recursive: true, force: true });
  });

  test("approve keeps the chokepoint edit; reject restores the snapshot", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    await page.click("[data-work-run-toggle]");
    await page.fill("[data-work-run-task]", "tidy `list_users` bookkeeping in models.py");
    await page.click("[data-work-run-start]");
    await expect(page.locator("[data-work-run-gate]")).toBeVisible({ timeout: 10_000 });
    await page.click("[data-work-run-ratify]");

    const markers: string[] = [];
    const rejectedMarkers: string[] = [];
    let rejectedPacketId: string | null = null;
    let sawRetryAttempt = false;
    // Walk every review gate as it arrives; the fake worker inserts a
    // UNIQUE marker per packet-ATTEMPT whose thread reaches models.py.
    for (let guard = 0; guard < 25; guard++) {
      const status = await page.locator("[data-work-run-panel]").getAttribute("data-run-status");
      if (status === "done" || status === "failed") break;
      const gate = page.locator('[data-packet-card][data-packet-status="awaiting-review"]');
      try {
        await gate.waitFor({ state: "visible", timeout: 20_000 });
      } catch { continue; }
      const packetId = await gate.getAttribute("data-packet-card");
      const evidenceText = (await gate.textContent()) ?? "";
      // Bounded shape: textContent concatenates nodes WITHOUT separators,
      // so a greedy [\d-]+ swallowed the leading "1" of the adjacent
      // "1 confined diff(s)" chip. pid + 13-digit ms timestamp exactly.
      const m = evidenceText.match(/worker-marker-\d+-\d{13}(?!\d)/);
      if (packetId === rejectedPacketId) {
        // M-AGENT4 — the retried attempt (a FRESH marker: the first was
        // restored). Reject again: the bound makes this one final.
        sawRetryAttempt = evidenceText.includes("attempt 2") || sawRetryAttempt;
        if (m) rejectedMarkers.push(m[0]);
        await page.click("[data-packet-reject]");
      } else if (m && markers.length === 0) {
        // First edited packet: the evidence must show SERVER-collected facts.
        expect(evidenceText).toContain("1 confined diff(s)");
        expect(evidenceText).toContain("IR delta captured");
        expect(readFileSync(MODELS, "utf-8")).toContain(m[0]);
        markers.push(m[0]);
        await page.click("[data-packet-approve]");
      } else if (m && rejectedPacketId === null) {
        // Second edited packet: REJECT — restore removes ONLY its marker,
        // and (M-AGENT4) the packet goes back for one re-draft.
        expect(readFileSync(MODELS, "utf-8")).toContain(m[0]);
        rejectedMarkers.push(m[0]);
        rejectedPacketId = packetId;
        await page.click("[data-packet-reject]");
      } else {
        await page.click("[data-packet-approve]");
      }
      await page.waitForTimeout(400);
    }

    expect(markers.length).toBe(1);
    expect(rejectedMarkers.length).toBeGreaterThanOrEqual(2); // attempt 1 + its retry
    expect(sawRetryAttempt).toBe(true); // the board said "attempt 2"
    const finalBytes = readFileSync(MODELS, "utf-8");
    expect(finalBytes).toContain(markers[0]);
    for (const rejected of rejectedMarkers) {
      expect(finalBytes).not.toContain(rejected); // every rejected attempt was restored
    }

    // The rejected packet makes the whole run honestly failed.
    await expect(page.locator("[data-work-run-panel]"))
      .toHaveAttribute("data-run-status", "failed", { timeout: 30_000 });
  });
});
