/**
 * M-SKILL.7 — the stale-skill lifecycle in the living renderer, end to end:
 * a ratified skill goes stale when its thread's code changes, and every
 * message along the way is honest WITHOUT nagging:
 *
 *   1. Ratified badge → edit db.py (a new `_audit` step inside query) → the
 *      watcher re-parse flips badge + launchpad dot to stale; the card shows
 *      the callout AND the concrete diff (+ _audit). No popup, no toast —
 *      the only unprompted surface is the chip recolour.
 *   2. From ANOTHER thread, a `db.query` question routes but the stale skill
 *      is WITHHELD — the muted line says so, and the prompt the backend
 *      received carries the honest withheld reason (never "no skill exists"),
 *      not the body.
 *   3. Auto-reaffirm ON → the same question now injects the skill WITH the
 *      stated caveat riding the prompt.
 *   4. Re-affirm → badge back to ratified; the disk file is re-stamped to the
 *      CURRENT thread hash (body untouched).
 *
 * Tests share mutated state — run with --workers=1, in order.
 *
 * Boot (see package.json test:e2e-skill-stale):
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4256 PORT=4256 \
 *     VG_CLAUDE_BIN="node $PWD/test/fixtures/chat/fake_claude_stdio.mjs" \
 *     FAKE_PROMPT_LOG=/tmp/vg-skill-stale-e2e-prompts.log \
 *     npx playwright test test/e2e/m-skill-stale.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { sourceHashOf } from "../../src/server/readme_store";
import { makeThreadSnapshot, AUTO_REAFFIRM_CAVEAT } from "../../src/server/thread_skill_store";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_DEMO = FIXTURE.includes("flask_demo");
const ROOT = join(process.cwd(), FIXTURE);
const PORT = process.env.VG_PORT ?? "4256";
const SHOT_DIR = "reviews/m-skill-stale";
const PROMPT_LOG = process.env.FAKE_PROMPT_LOG ?? "";
const EP = "db.py:query";
const DB_PY = join(ROOT, "db.py");
const SKILL_FILE = join(ROOT, ".vibegraph", "thread-skills", "db.py_query.md");
const SKILL_BODY =
  "## Purpose\nReads rows for a user.\n\n## Gotchas\nAlways obtain the connection via _get_conn; never open sqlite3 directly. `module/query.fn`";

test.use({ video: "on" });

// Playwright restarts the worker after any failure, re-running beforeAll —
// a naive "read db.py as the original" would then capture the EDITED file
// and the suite would leave the committed fixture dirty. The pristine copy
// lives OUTSIDE the fixture and survives restarts.
const DB_PY_BACKUP = join(os.tmpdir(), "vg-skill-stale-db.py.pristine");

let originalDbPy = "";

/** Live thread IR off the WS envelope → the exact hash+snapshot the server
 *  stamps skills with. */
async function fetchThread(): Promise<{ hash: string; snapshot: unknown[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const t = setTimeout(() => { ws.close(); reject(new Error("project-update timeout")); }, 20_000);
    ws.on("message", (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "project-update") {
        const thread = (msg.payload.threads ?? []).find((th: any) => th.entryPointId === EP);
        clearTimeout(t);
        ws.close();
        thread
          ? resolve({ hash: sourceHashOf(thread), snapshot: makeThreadSnapshot(thread) })
          : reject(new Error(`no ${EP} thread`));
      }
    });
    ws.on("error", reject);
  });
}

/** Ask about the other thread's seed from app.py:create_user_route, return
 *  the routed provenance line's locator. */
async function askAboutDbQuery(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
  await page.click('[data-thread-index-row][data-entry-id="app.py:create_user_route"]');
  await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });
  await page.click('button[title^="Open Claude chat"]');
  const input = page.locator("[data-chat-panel] textarea");
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill("why does `db.query` sometimes fail?");
  await input.press("Enter");
  const routed = page.locator("[data-chat-routed]");
  await expect(routed).toBeVisible({ timeout: 15_000 });
  return routed;
}

test.describe("M-SKILL.7 — stale lifecycle: honest, never nagging", () => {
  test.skip(!IS_DEMO, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test.beforeAll(async () => {
    if (fs.existsSync(DB_PY_BACKUP)) {
      // A previous worker (or a crashed run) already edited the fixture —
      // restore before reading, and let the watcher re-parse settle.
      fs.copyFileSync(DB_PY_BACKUP, DB_PY);
    } else {
      fs.copyFileSync(DB_PY, DB_PY_BACKUP);
    }
    originalDbPy = fs.readFileSync(DB_PY_BACKUP, "utf-8");
    // Poll until the server's thread reflects the PRISTINE fixture (no
    // _audit step) so the seeded hash is never computed off a mid-restore
    // envelope.
    let settled: { hash: string; snapshot: unknown[] } | null = null;
    for (let i = 0; i < 20 && !settled; i++) {
      const t = await fetchThread();
      if (JSON.stringify(t.snapshot).includes("_audit")) {
        await new Promise((r) => setTimeout(r, 500));
      } else {
        settled = t;
      }
    }
    if (!settled) throw new Error("thread never settled back to the pristine fixture");
    const { hash, snapshot } = settled;
    fs.mkdirSync(join(ROOT, ".vibegraph", "thread-skills"), { recursive: true });
    fs.writeFileSync(SKILL_FILE, [
      "---", `key: thread:${EP}`, `entryPointId: ${EP}`, "status: ratified",
      `sourceHash: ${hash}`, "generatedAt: 2026-07-21T00:00:00Z",
      `snapshot: ${JSON.stringify(snapshot)}`, "---", "", SKILL_BODY, "",
    ].join("\n"));
    if (PROMPT_LOG) fs.rmSync(PROMPT_LOG, { force: true });
  });

  test.afterAll(() => {
    fs.writeFileSync(DB_PY, originalDbPy);
    fs.rmSync(DB_PY_BACKUP, { force: true });
    // Only what we seeded — .vibegraph/ also holds committed fixture data.
    fs.rmSync(join(ROOT, ".vibegraph", "thread-skills"), { recursive: true, force: true });
  });

  test("1. thread edit flips badge to stale; the card shows callout + concrete diff; nothing pops unprompted", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click(`[data-thread-index-row][data-entry-id="${EP}"]`);
    const badge = page.locator("[data-skill-badge]");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toHaveAttribute("data-skill-state", "ratified");

    // Modify the logic thread: query() gains a real local step (_audit).
    fs.writeFileSync(
      DB_PY,
      originalDbPy.replace(
        "        cursor = conn.execute(sql, params)\n        return cursor.fetchall()",
        "        cursor = conn.execute(sql, params)\n        return _audit(cursor.fetchall())",
      ) + "\n\ndef _audit(rows):\n    return list(rows)\n",
    );

    // Watcher → re-parse → refreshDerived → the badge repaints stale. That
    // chip recolour is the ONLY unprompted signal — assert no dialog/card
    // opened itself.
    await expect(badge).toHaveAttribute("data-skill-state", "stale", { timeout: 20_000 });
    await expect(page.locator("[data-thread-skill-card]")).toHaveCount(0);
    await page.screenshot({ path: join(SHOT_DIR, "badge-stale.png") });

    // The card (on demand): callout + the informed diff naming the new step.
    await badge.click();
    const card = page.locator("[data-thread-skill-card]");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Ratified · stale");
    await expect(card).toContainText("Ratified against an older version of this thread.");
    await expect(card).toContainText("Agents no longer receive it automatically.");
    const diff = page.locator("[data-skill-card-diff]");
    await expect(diff).toContainText("_audit", { timeout: 10_000 });
    await page.screenshot({ path: join(SHOT_DIR, "card-stale-diff.png") });
  });

  test("2. routed question: the stale skill is WITHHELD — muted line + honest prompt reason, body absent", async ({ page }) => {
    test.skip(!PROMPT_LOG, "Requires FAKE_PROMPT_LOG");
    const before = fs.existsSync(PROMPT_LOG) ? fs.readFileSync(PROMPT_LOG, "utf-8") : "";
    const routed = await askAboutDbQuery(page);
    await expect(routed).toContainText("db:query");
    await expect(routed).toContainText("stale");
    await expect(routed).toContainText("withheld");
    await expect(routed).not.toContainText("ratified skill was shared");
    await page.screenshot({ path: join(SHOT_DIR, "chat-routed-stale.png") });

    await expect
      .poll(() => (fs.existsSync(PROMPT_LOG) ? fs.readFileSync(PROMPT_LOG, "utf-8").slice(before.length) : ""), { timeout: 10_000 })
      .toContain("its ratified skill was withheld: the thread's code changed after ratification");
    const turn = fs.readFileSync(PROMPT_LOG, "utf-8").slice(before.length);
    expect(turn).not.toContain("never open sqlite3 directly"); // body must NOT ride
    // The db:query entry itself must never deny the skill's existence (other
    // co-routed threads genuinely have none — their lines are honest too).
    const dbQueryEntry = turn.split("- Thread ").find((s) => s.startsWith("db:query")) ?? "";
    expect(dbQueryEntry).toContain("was withheld");
    expect(dbQueryEntry).not.toContain("no ratified skill exists");
  });

  test("3. auto-reaffirm ON: the skill injects again, ALWAYS with the stated caveat", async ({ page }) => {
    test.skip(!PROMPT_LOG, "Requires FAKE_PROMPT_LOG");
    // Opt in from the card.
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click(`[data-thread-index-row][data-entry-id="${EP}"]`);
    const badge = page.locator("[data-skill-badge]");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await badge.click();
    // Controlled checkbox: the DOM state only flips after the server
    // round-trip re-renders the record — click, then wait for the check.
    const checkbox = page.locator("[data-skill-auto-reaffirm] input");
    await checkbox.click();
    await expect(checkbox).toBeChecked({ timeout: 5_000 });
    await expect
      .poll(() => fs.readFileSync(SKILL_FILE, "utf-8"))
      .toContain("autoReaffirm: true");
    await page.screenshot({ path: join(SHOT_DIR, "card-auto-reaffirm.png") });

    const before = fs.readFileSync(PROMPT_LOG, "utf-8");
    const routed = await askAboutDbQuery(page);
    await expect(routed).toContainText("ratified skill was shared");
    await expect
      .poll(() => fs.readFileSync(PROMPT_LOG, "utf-8").slice(before.length), { timeout: 10_000 })
      .toContain("never open sqlite3 directly");
    const log = fs.readFileSync(PROMPT_LOG, "utf-8").slice(before.length);
    expect(log).toContain(AUTO_REAFFIRM_CAVEAT);
  });

  test("4. Re-affirm re-stamps hash+snapshot on disk; badge returns to ratified; body untouched", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click(`[data-thread-index-row][data-entry-id="${EP}"]`);
    const badge = page.locator("[data-skill-badge]");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toHaveAttribute("data-skill-state", "stale");
    await badge.click();
    await page.locator("[data-skill-reaffirm]").click();
    await expect(badge).toHaveAttribute("data-skill-state", "ratified", { timeout: 10_000 });
    await page.screenshot({ path: join(SHOT_DIR, "badge-reaffirmed.png") });

    const { hash } = await fetchThread(); // CURRENT (edited) thread hash
    const onDisk = fs.readFileSync(SKILL_FILE, "utf-8");
    expect(onDisk).toContain(`sourceHash: ${hash}`);
    expect(onDisk).toContain("never open sqlite3 directly"); // body untouched
    expect(onDisk).toMatch(/snapshot: .*_audit/); // snapshot re-stamped to the edited thread
  });
});
