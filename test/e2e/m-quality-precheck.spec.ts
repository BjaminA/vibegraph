/**
 * Quality layer, wired (reviews/quality-layer/RUN3.md §9/§10) — the
 * ADVISORY path through the live pre-checks, end-to-end with the scripted
 * stub (fake_worker.mjs) on an AUTONOMOUS run.
 *
 * A human-stated constraint carries a Run 1 verb whose calibration record
 * reads DEMOTE (`co-changes`: a change to models.py must ship with a change
 * to test_flow.py). The stub's worker edits models.py and no test, so the
 * check is VIOLATED — and because the verb may not gate, the violation is
 * an ADVISORY line in the evidence, the packet is still approved by the
 * pre-checks alone, and no reviewer is spawned for it. `tests-touched`
 * lands beside it. The closing bar was computed at the objective gate and
 * lists the check as advisory with the constraint as its basis.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4293 PORT=4293 \
 *   VG_CLAUDE_BIN="node $PWD/test/fixtures/work_run/fake_worker.mjs" \
 *   FAKE_EDIT_FILE=models.py FAKE_EDIT_NODE=module/list_users.fn FAKE_REQUIRE_HANDOFF=1 \
 *     npx playwright test test/e2e/m-quality-precheck.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const STUBBED = (process.env.VG_CLAUDE_BIN ?? "").includes("fake_worker") && !!process.env.FAKE_REQUIRE_HANDOFF;
const MODELS = join(process.cwd(), FIXTURE, "models.py");
const VG_DIR = join(process.cwd(), FIXTURE, ".vibegraph");
const RUN_FILE = join(VG_DIR, "work-run.json");
const SNAP_DIR = join(VG_DIR, "work-snapshots");
const CONSTRAINTS_FILE = join(VG_DIR, "constraints.json");

test.describe("Quality layer — a demoted verb's violation is advisory: recorded, never rejecting, never a reviewer spawn", () => {
  test.skip(!IS_FLASK || !STUBBED, "Requires flask_demo + fake_worker stub with FAKE_REQUIRE_HANDOFF");
  let original = "";
  test.beforeAll(() => {
    original = readFileSync(MODELS, "utf-8");
    rmSync(RUN_FILE, { force: true });
    rmSync(SNAP_DIR, { recursive: true, force: true });
    mkdirSync(VG_DIR, { recursive: true });
    writeFileSync(CONSTRAINTS_FILE, JSON.stringify({
      version: "1",
      constraints: [{
        id: "q1", kind: "invariant", source: "human", createdAt: "2026-09-12T00:00:00.000Z",
        text: "A change to models.py ships with a change to test_flow.py (e2e: the advisory path of a demoted verb).",
        scope: { files: ["models.py"] },
        check: { rule: "co-changes", when: "models.py", require: "test_flow.py" },
      }, {
        id: "q2", kind: "invariant", source: "human", createdAt: "2026-09-21T00:00:00.000Z",
        text: "Every caller of _helper_not_a_test calls query first (e2e: a MAY-GATE verb gates in the BUILT server; nothing calls the target, so it passes).",
        scope: { files: ["models.py"] },
        check: { rule: "guards", target: "_helper_not_a_test", guard: "query" },
      }],
    }, null, 2) + "\n");
  });
  test.afterAll(() => {
    writeFileSync(MODELS, original, "utf-8");
    rmSync(RUN_FILE, { force: true });
    rmSync(SNAP_DIR, { recursive: true, force: true });
    rmSync(CONSTRAINTS_FILE, { force: true });
  });

  test("the violated co-changes check lands as an advisory line, the packet is approved by pre-checks, the closing bar named it", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    // The stated constraint is on the board before the run starts.
    await page.click("[data-work-run-toggle]");
    await expect(page.locator('[data-constraint-row][data-constraint-source="human"]').first()).toBeVisible({ timeout: 10_000 });
    await page.click("[data-work-run-mode-orchestrated]");
    await page.check("[data-work-run-autonomous]");
    await page.fill("[data-work-run-task]", "tidy `list_users` bookkeeping in models.py");
    await page.click("[data-work-run-start]");
    await expect(page.locator("[data-work-run-panel]"))
      .toHaveAttribute("data-run-status", /^(done|failed)$/, { timeout: 60_000 });

    const run = JSON.parse(readFileSync(RUN_FILE, "utf-8"));
    expect(run.status).toBe("done");
    // The packet whose worker edited models.py.
    const edited = run.packets.filter((p: any) => (p.evidence?.diffs ?? []).some((d: any) => d.file === "models.py"));
    expect(edited.length).toBeGreaterThanOrEqual(1);
    const p = edited[0];
    expect(p.status).toBe("done");
    // Approved by the pre-checks alone: the advisory did not reject and did not spawn a reviewer.
    expect(p.review?.by).toBe("pre-checks");
    expect(p.review?.verdict).toBe("approve");
    const advisories: string[] = p.evidence?.preCheck?.advisories ?? [];
    // `violated` once every packet has run, `unverifiable (not-yet)` while
    // another lane could still ship the required change: both are the
    // advisory path, and neither rejected.
    const q1Line = advisories.find((a) => /: q1 (violated|unverifiable) — /.test(a));
    expect(q1Line, `advisories were: ${JSON.stringify(advisories)}`).toBeTruthy();
    expect(q1Line).toMatch(/models\.py/);
    expect(q1Line).toMatch(/never rejects/);
    expect(advisories.some((a) => /^tests-touched:/.test(a))).toBe(true);
    expect((p.evidence?.preCheck?.needsEyes ?? []).length).toBe(0);
    expect(p.review?.reason).toMatch(/^pre-checks passed/);
    // The closing bar was computed at the objective gate and names the check as advisory with q1 as its basis.
    expect(p.acceptance?.version).toBe("1.0");
    expect(typeof p.acceptance?.closingBar).toBe("string");
    const q1 = (p.acceptance?.checks ?? []).find((c: any) => c.basis?.constraintId === "q1");
    expect(q1?.check?.rule).toBe("co-changes");
    expect(q1?.mode).toBe("advisory");
    // q2's verb is MAY-GATE at this commit: in the acceptance it is gate-blocking,
    // in the pre-check text it is a gating pass, and it never appears as an
    // advisory. (The bundle used to lose the standings — dist/server.js has no
    // import.meta.url — and every Run 1 verb read as advisory here.)
    const q2 = (p.acceptance?.checks ?? []).find((c: any) => c.basis?.constraintId === "q2");
    expect(q2?.check?.rule).toBe("guards");
    expect(q2?.mode).toBe("gate-blocking");
    expect(p.review?.reason).toMatch(/constraint q2 holds/);
    expect(advisories.some((a) => /q2/.test(a))).toBe(false);
    expect((p.acceptance?.advisories ?? []).some((a: any) => a.kind === "uncalibrated-check")).toBe(true);
    // The autonomous run confirmed itself; the worker's marker landed.
    expect(run.autonomy?.mode).toBe("autonomous");
    expect(readFileSync(MODELS, "utf-8")).toMatch(/worker-marker-\d+-\d{13}/);
  });
});
