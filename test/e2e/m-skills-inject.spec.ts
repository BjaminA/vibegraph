/**
 * M-SKILLS.2 — generic direction reaches the worker prompt, and only when a
 * human enabled it.
 *
 * Boot (package.json test:e2e-skills-inject):
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4293 PORT=4293
 *   VG_CLAUDE_BIN="node $PWD/test/fixtures/work_run/fake_worker.mjs"
 *   FAKE_EDIT_FILE=models.py FAKE_EDIT_NODE=module/list_users.fn FAKE_REQUIRE_HANDOFF=1
 *   FAKE_PROMPT_LOG=/tmp/vg-skills-inject-prompts.log
 *
 * What it proves, in order, against one server:
 *   1. the panel opens, lists the six shipped skills with their breadth
 *      MEASURED on this project, and shows every one OFF (the default);
 *   2. ticking boundary-integrity round-trips through the server: the echo
 *      turns the row on with who/when, and .vibegraph/skills.json on disk
 *      carries the name (the enable act is the human's, and it persists);
 *   3. an orchestrated run's worker on a route thread (flask_demo's routes
 *      call sqlite through db.py, so the skill's applies_when fires) gets
 *      the skill in its prompt — after the thread-skill slot, with the
 *      provenance line naming who enabled it and why it applies — and a
 *      skill that was NOT enabled never appears.
 *
 * The prompt is read from FAKE_PROMPT_LOG, which the worker stub appends to
 * verbatim, because the run file cannot see what a prompt contained (the
 * autonomy-restore lesson: assert on the artefact, not the bookkeeping).
 */
import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");
const STUBBED = (process.env.VG_CLAUDE_BIN ?? "").includes("fake_worker");
const PROMPT_LOG = process.env.FAKE_PROMPT_LOG ?? "";
const MODELS = join(process.cwd(), FIXTURE, "models.py");
const RUN_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "work-run.json");
const SNAP_DIR = join(process.cwd(), FIXTURE, ".vibegraph", "work-snapshots");
const SKILLS_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "skills.json");
// The stub brief states a global constraint on every orchestrated run; it
// lands in the fixture's constraints.json and must not outlive the spec.
const CONSTRAINTS_FILE = join(process.cwd(), FIXTURE, ".vibegraph", "constraints.json");

const SHIPPED = ["boundary-integrity", "change-coupling", "failure-visibility", "repetition-cost", "resolvability", "retry-root-cause"];
// The panel shows each skill's REAL evidence standing, so the expectation
// is read from the shipped files rather than hardcoded. It said
// "unvalidated" for every row until M-SKILLS.3 drilled `repetition-cost`
// — a census of that day, not the contract, and a drill that validates a
// skill must not read as a UI regression. What IS the contract: the panel
// says what the file says.
const EVIDENCE = Object.fromEntries(SHIPPED.map((name) => [
  name,
  /^evidence:\s*(\S+)/m.exec(readFileSync(join(process.cwd(), "skills", name, "SKILL.md"), "utf-8"))?.[1] ?? "unvalidated",
]));

test.describe("M-SKILLS.2 — generic direction, enabled per project, injected after the thread skill", () => {
  test.skip(!IS_FLASK || !STUBBED || !PROMPT_LOG, "Requires flask_demo + fake_worker stub + FAKE_PROMPT_LOG");
  test.describe.configure({ mode: "serial" });
  let original = "";
  test.beforeAll(() => {
    original = readFileSync(MODELS, "utf-8");
    rmSync(PROMPT_LOG, { force: true });
    rmSync(RUN_FILE, { force: true });
    rmSync(SNAP_DIR, { recursive: true, force: true });
    rmSync(CONSTRAINTS_FILE, { force: true });
    // The server read the enable file at BOOT; the panel's toggle is what
    // enables, and test 1 asserts the SERVER's view of "all off".
  });
  test.afterAll(() => {
    writeFileSync(MODELS, original, "utf-8");
    rmSync(RUN_FILE, { force: true });
    rmSync(SNAP_DIR, { recursive: true, force: true });
    rmSync(SKILLS_FILE, { force: true });
    rmSync(CONSTRAINTS_FILE, { force: true });
    rmSync(PROMPT_LOG, { force: true });
  });

  test("1. the panel lists the shipped skills with measured breadth, all off by default", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click("[data-skills-toggle]");
    const panel = page.locator("[data-skills-panel]");
    await expect(panel).toBeVisible();
    for (const name of SHIPPED) {
      const row = panel.locator(`[data-skill-row="${name}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(row).toHaveAttribute("data-skill-enabled", "false");
      await expect(row.locator("[data-skill-evidence]")).toHaveText(EVIDENCE[name]);
      // Breadth is measured on THIS project, not asserted: "N of M threads".
      await expect(row.locator("[data-skill-breadth]")).toContainText(/applies to \d+ of \d+ threads here/);
    }
    // boundary-integrity fires on flask_demo's threads: every route reaches
    // the db through db.py, and a thread inherits the project's rolesCalled
    // when it carries none of its own (predicate.ts). On THIS fixture that
    // is all 12 — a regime, not an `always` — so the assertion is "measured
    // and non-zero", never "fewer than all" (the first cut asserted that and
    // was wrong here; the fleet profile is where breadth splits).
    const bi = await panel.locator('[data-skill-row="boundary-integrity"] [data-skill-breadth]').textContent();
    const m = bi?.match(/applies to (\d+) of (\d+) threads/);
    expect(m, bi ?? "").toBeTruthy();
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(Number(m![2])).toBeGreaterThanOrEqual(Number(m![1]));
    // retry-root-cause is measured with the retry fact on (every thread can
    // be retried), so its breadth equals the thread count — pinned so the
    // catalogue's task handling cannot silently regress to zero.
    const rr = await panel.locator('[data-skill-row="retry-root-cause"] [data-skill-breadth]').textContent();
    expect(rr).toContain(`applies to ${m![2]} of ${m![2]} threads`);
    // 2026-10-20 — no page-wide drop-down: every row carries the two switches, both off
    await expect(panel.locator("select")).toHaveCount(0);
    await expect(panel.locator("[data-direction-explainer]")).toContainText("Tell Claude up front");
    await expect(panel.locator("[data-direction-explainer]")).toContainText("Explain when an edit breaks it");
    for (const name of SHIPPED) {
      const sw = panel.locator(`[data-skill-row="${name}"] [role="switch"]`);
      await expect(sw).toHaveCount(2);
      await expect(sw.nth(0)).toHaveAttribute("aria-checked", "false");
      await expect(sw.nth(1)).toHaveAttribute("aria-checked", "false");
    }
  });

  test("2. a switch flips at once, round-trips through the server, and persists with who and when", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click("[data-skills-toggle]");
    const row = page.locator('[data-skills-panel] [data-skill-row="resolvability"]');
    await expect(row).toBeVisible({ timeout: 10_000 });
    const up = row.locator('[data-delivery="upfront"]');
    const broken = row.locator('[data-delivery="oncheck"]');
    const disk = () => (existsSync(SKILLS_FILE) ? JSON.parse(readFileSync(SKILLS_FILE, "utf-8")) : {});
    // 2026-10-20 — the switch shows the press at once (it used to wait for the
    // server's echo, which rebuilt the whole catalogue first): 250 ms is a
    // budget no server round trip on a busy machine is promised.
    await up.click();
    await expect(up).toHaveAttribute("aria-checked", "true", { timeout: 250 });
    await expect(row).toHaveAttribute("data-skill-enabled", "true", { timeout: 250 });
    await expect.poll(() => disk().delivery?.resolvability, { timeout: 10_000 }).toEqual({ upfront: true, onCheck: false });
    await expect(row).toContainText("in use since 20");
    expect(disk().enabled).toEqual(["resolvability"]);
    expect(disk().enabledBy.resolvability.source).toBe("human");
    // the second switch alone, then neither: not in use
    await broken.click();
    await expect(broken).toHaveAttribute("aria-checked", "true", { timeout: 250 });
    await up.click();
    await expect.poll(() => disk().delivery?.resolvability, { timeout: 10_000 }).toEqual({ upfront: false, onCheck: true });
    await page.reload();
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click("[data-skills-toggle]");
    await expect(page.locator('[data-skill-row="resolvability"] [data-delivery="oncheck"]')).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });
    await expect(page.locator('[data-skill-row="resolvability"] [data-delivery="upfront"]')).toHaveAttribute("aria-checked", "false");
    await page.locator('[data-skill-row="resolvability"] [data-delivery="oncheck"]').click();
    await expect.poll(() => disk().enabled, { timeout: 10_000 }).toEqual([]);
    await expect(page.locator('[data-skills-panel] [data-skill-row="resolvability"]')).toHaveAttribute("data-skill-enabled", "false");
    // the one the worker test needs: boundary-integrity up front
    await page.locator('[data-skill-row="boundary-integrity"] [data-delivery="upfront"]').click();
    await expect.poll(() => disk().enabled, { timeout: 10_000 }).toEqual(["boundary-integrity"]);
    for (const name of SHIPPED.filter((n) => n !== "boundary-integrity")) {
      await expect(page.locator(`[data-skills-panel] [data-skill-row="${name}"]`)).toHaveAttribute("data-skill-enabled", "false");
    }
  });

  test("3. a worker on a route thread receives the enabled skill with its provenance line; unenabled skills never appear", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    await page.click("[data-work-run-toggle]");
    await page.click("[data-work-run-mode-orchestrated]");
    await expect(page.locator("[data-work-run-mode]")).toHaveAttribute("data-work-run-mode", "orchestrated");
    await page.check("[data-work-run-autonomous]");
    await page.fill("[data-work-run-task]", "tidy `list_users` bookkeeping in models.py");
    await page.click("[data-work-run-start]");
    await expect(page.locator("[data-work-run-panel]"))
      .toHaveAttribute("data-run-status", /^(done|failed)$/, { timeout: 60_000 });

    const log = readFileSync(PROMPT_LOG, "utf-8");
    // Worker prompts only: the brief and the review are text-only spawns
    // through the gen runner and carry no generic direction.
    const workers = log.split("--- spawn ").filter((s) => s.includes("You are a WORKER AGENT"));
    expect(workers.length).toBeGreaterThan(0);
    const withSkill = workers.filter((w) => w.includes("[generic skill boundary-integrity v"));
    expect(withSkill.length, "at least one worker sat on a thread the skill applies to").toBeGreaterThan(0);
    for (const w of withSkill) {
      // The section header, the provenance line, and a rule from the skill body.
      expect(w).toContain("Generic direction (enabled for this project by a human; ADVISORY — never a gate");
      expect(w).toMatch(/\[generic skill boundary-integrity v1\.0; enabled by human on 20\d\d-\d\d-\d\d; unvalidated — direction, never a gate; applies because: /);
      expect(w).toContain('Start from the contract\'s "Leaves the project through" section');
      // It rides AFTER the thread-skill slot and BEFORE the contract.
      const at = w.indexOf("Generic direction (enabled");
      const contractAt = w.search(/\n(Thread contract|Data in|## Contract|Leaves the project through)/);
      if (contractAt > 0) expect(at).toBeLessThan(contractAt);
    }
    // Nothing a human did not enable ever reaches a prompt.
    for (const name of SHIPPED.filter((n) => n !== "boundary-integrity")) {
      expect(log).not.toContain(`[generic skill ${name} v`);
    }
  });
});
