/**
 * AUTONOMY (ruling:2026-09-12:human-out-of-the-loop) — an orchestrated run
 * with NO human gate, end-to-end with the scripted stub playing all three
 * roles (fake_worker.mjs). The stub's BRIEF marks the LAST packet with an
 * ESCALATE-MARKER in its task (FAKE_ESCALATE_PACKET=last); the WORKER that
 * receives that marker escalates instead of editing.
 *
 * Proves, on disk and on the board:
 *   * the objective gate is confirmed by the SERVER the moment the brief
 *     lands — the human never clicks [data-work-run-ratify];
 *   * the run record carries the ruling, who ratified, and when;
 *   * the escalation is resolved as a FAILED packet whose review names the
 *     ruling and whose escalation reason is KEPT — never approved, never
 *     left waiting for a human;
 *   * every other packet still completes (the worker's marker landed);
 *   * the run ends `failed` (one packet failed), and the summary says both
 *     that the objective was not human-confirmed and that an escalation
 *     was resolved under autonomy.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4291 PORT=4291 \
 *   VG_CLAUDE_BIN="node $PWD/test/fixtures/work_run/fake_worker.mjs" \
 *   FAKE_EDIT_FILE=models.py FAKE_EDIT_NODE=module/list_users.fn FAKE_REQUIRE_HANDOFF=1 FAKE_ESCALATE_PACKET=last \
 *     npx playwright test test/e2e/m-orch-autonomous.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const STUBBED = (process.env.VG_CLAUDE_BIN ?? "").includes("fake_worker") && process.env.FAKE_ESCALATE_PACKET === "last";
const MODELS = join(process.cwd(), FIXTURE, "models.py");
const RUN_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "work-run.json");
const SNAP_DIR = join(process.cwd(), FIXTURE, ".vibegraph", "work-snapshots");
const CONSTRAINTS_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "constraints.json");

test.describe("AUTONOMY — an orchestrated run with no human gate", () => {
  test.skip(!IS_FLASK || !STUBBED, "Requires flask_demo + fake_worker stub with FAKE_ESCALATE_PACKET=last");
  let original = "";
  test.beforeAll(() => {
    original = readFileSync(MODELS, "utf-8");
    rmSync(CONSTRAINTS_FILE, { force: true });
    rmSync(RUN_FILE, { force: true });
    rmSync(SNAP_DIR, { recursive: true, force: true });
  });
  test.afterAll(() => {
    writeFileSync(MODELS, original, "utf-8");
    rmSync(RUN_FILE, { force: true });
    rmSync(SNAP_DIR, { recursive: true, force: true });
    rmSync(CONSTRAINTS_FILE, { force: true });
  });

  test("the server confirms the objective, resolves the escalation as failed with its reason, and the run ends honestly", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    await page.click("[data-work-run-toggle]");
    await page.click("[data-work-run-mode-orchestrated]");
    await expect(page.locator("[data-work-run-mode]")).toHaveAttribute("data-work-run-mode", "orchestrated");
    await page.check("[data-work-run-autonomous]");
    await page.fill("[data-work-run-task]", "tidy `list_users` bookkeeping in models.py");
    await page.click("[data-work-run-start]");

    // No click on the objective gate. The run leaves `draft` on its own.
    await expect(page.locator("[data-work-run-panel]"))
      .toHaveAttribute("data-run-status", /^(done|failed)$/, { timeout: 60_000 });

    const run = JSON.parse(readFileSync(RUN_FILE, "utf-8"));
    expect(run.mode).toBe("orchestrated");
    expect(run.autonomy?.mode).toBe("autonomous");
    expect(run.autonomy?.ruling).toBe("ruling:2026-09-12:human-out-of-the-loop");
    expect(run.autonomy?.ratifiedBy).toBe("orchestrator");
    expect(typeof run.autonomy?.ratifiedAt).toBe("string");
    expect(run.orchestration.status).toBe("ready");

    // Exactly one packet escalated; it ended FAILED, never approved, never waiting.
    const escalated = run.packets.filter((p: any) => p.review?.verdict === "escalate");
    expect(escalated.length).toBe(1);
    const esc = escalated[0];
    expect(esc.status).toBe("failed");
    expect(esc.review.by).toBe("orchestrator");
    expect(esc.review.reason).toContain("ruling:2026-09-12:human-out-of-the-loop");
    expect(esc.escalation?.reason).toBeTruthy();
    expect(run.autonomy.escalationsResolved).toBe(1);

    // FAILED MEANS UNDONE — ON DISK, not just in the run file.
    //
    // The human reject path restores the snapshot before the status flips;
    // the autonomy path set the status and left the bytes. The 2026-09-22
    // local-worker drill ended with a worker's destructive rewrite of three
    // telemetry files still in the tree, under a summary that said "their
    // edits were restored". A claimed floor that did not hold is worse than
    // no floor, because the claim is what gets believed — and the run file
    // alone cannot catch it, which is why this reads the FILE.
    if (process.env.FAKE_ESCALATE_AFTER_EDIT === "1") {
      // The edit LANDED before the escalation, so there is something to undo.
      expect(esc.evidence?.diffs?.length ?? 0).toBeGreaterThan(0);
      for (const d of esc.evidence.diffs) {
        // THIS packet's marker, taken from its own diff — not "no marker
        // anywhere", which would flag the markers APPROVED packets left in
        // the same file and legitimately keep. A failed packet's work is
        // undone; a done packet's is not, and the assertion has to tell
        // them apart or it fails on correct behaviour (it did, first cut).
        const mine = (d.diff ?? "").match(/worker-marker-\d+-\d+/)?.[0];
        expect(mine, `no marker found in ${d.file}'s diff — the stub did not edit`).toBeTruthy();
        const onDisk = readFileSync(join(process.cwd(), FIXTURE, d.file), "utf-8");
        expect(onDisk, `${d.file} still holds the FAILED packet's edit (${mine})`).not.toContain(mine!);
      }
    }
    expect(run.packets.some((p: any) => p.status === "escalated" || p.status === "awaiting-review")).toBe(false);
    // Every other packet completed.
    for (const p of run.packets) {
      if (p.id === esc.id) continue;
      expect(["done", "no-change", "skipped"]).toContain(p.status);
    }
    expect(run.packets.filter((p: any) => p.status === "done").length).toBeGreaterThanOrEqual(1);
    expect(run.status).toBe("failed");

    // The summary says no human confirmed the objective, and names the resolved escalation.
    expect(run.summary.note).toContain("AUTONOMOUS run: the objective was confirmed by the orchestrator under ruling:2026-09-12:human-out-of-the-loop");

    // What the run COST. Every spawn's envelope carries the CLI's own
    // `total_cost_usd`; before this the server parsed the envelope for
    // `.result` and dropped it, so head-to-head #3 could price every plain
    // arm and had to leave the orchestrated one blank. The stub reports
    // 0.25 per spawn (FAKE_COST_USD), so the total is exact and the
    // summary can be asserted rather than eyeballed.
    expect(run.spend.spawns).toBeGreaterThanOrEqual(3);
    expect(run.spend.unpriced).toBe(0);
    expect(run.spend.usd).toBeCloseTo(0.25 * run.spend.spawns, 6);
    expect(Object.keys(run.spend.byKind).sort()).toContain("worker");
    expect(run.summary.note).toMatch(/Cost: \$\d+\.\d\d over \d+ model spawn\(s\)/);
    expect(run.summary.note).not.toContain("floor, not the whole bill");
    expect(run.summary.note).toContain("resolved as FAILED under autonomy");
    await expect(page.locator("[data-work-run-summary]")).toContainText("AUTONOMOUS run");

    // The worker edited (its handoff arrived) in a packet that did not escalate.
    expect(readFileSync(MODELS, "utf-8")).toMatch(/worker-marker-\d+-\d{13}/);
    // The board never showed a ratify button that was clicked: it is gone now.
    await expect(page.locator("[data-work-run-ratify]")).toHaveCount(0);
  });
});
