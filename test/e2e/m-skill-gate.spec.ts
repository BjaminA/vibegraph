/**
 * M-SKILL.5 — the skill lifecycle in the living renderer:
 *
 *   1. Ratification gate: launchpad dot reads draft → thread badge reads
 *      Draft → the card shows the full body → Ratify → badge AND the on-disk
 *      file flip to ratified (renderer and artifact both checked).
 *   2. Routing provenance: from a DIFFERENT thread, a chat question naming
 *      `db.query` renders the muted "routed:" line, and the prompt the
 *      backend actually received carries the ratified skill body.
 *
 * Test 2 depends on test 1's ratification (routing injects authoritative
 * skills only) — run this file with --workers=1, in order.
 *
 * Boot (see package.json test:e2e-skill):
 *   VG_FIXTURE=test/fixtures/threads/flask_demo VG_PORT=4255 PORT=4255 \
 *     VG_CLAUDE_BIN="node $PWD/test/fixtures/chat/fake_claude_stdio.mjs" \
 *     FAKE_PROMPT_LOG=/tmp/vg-skill-e2e-prompts.log \
 *     npx playwright test test/e2e/m-skill-gate.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { sourceHashOf } from "../../src/server/readme_store";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_DEMO = FIXTURE.includes("flask_demo");
const ROOT = join(process.cwd(), FIXTURE);
const PORT = process.env.VG_PORT ?? "4255";
const SHOT_DIR = "reviews/m-skill";
const PROMPT_LOG = process.env.FAKE_PROMPT_LOG ?? "";
const EP = "db.py:query";
const SKILL_FILE = join(ROOT, ".vibegraph", "thread-skills", "db.py_query.md");
const SKILL_BODY =
  "## Purpose\nReads rows for a user.\n\n## Gotchas\nAlways obtain the connection via _get_conn; never open sqlite3 directly. `module/query.fn`";

test.use({ video: "on" });

/** The live thread IR (over the WS envelope, verbatim) → the exact hash the
 *  server stamps skills with, so the seeded draft reads FRESH. */
async function fetchThreadHash(): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const t = setTimeout(() => { ws.close(); reject(new Error("project-update timeout")); }, 20_000);
    ws.on("message", (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "project-update") {
        const thread = (msg.payload.threads ?? []).find((th: any) => th.entryPointId === EP);
        clearTimeout(t);
        ws.close();
        thread ? resolve(sourceHashOf(thread)) : reject(new Error(`no ${EP} thread`));
      }
    });
    ws.on("error", reject);
  });
}

test.describe("M-SKILL — ratification gate + routed provenance", () => {
  test.skip(!IS_DEMO, "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test.beforeAll(async () => {
    const hash = await fetchThreadHash();
    fs.mkdirSync(join(ROOT, ".vibegraph", "thread-skills"), { recursive: true });
    fs.writeFileSync(SKILL_FILE, [
      "---", `key: thread:${EP}`, `entryPointId: ${EP}`, "status: draft",
      `sourceHash: ${hash}`, "generatedAt: 2026-07-20T00:00:00Z", "---", "", SKILL_BODY, "",
    ].join("\n"));
    if (PROMPT_LOG) fs.rmSync(PROMPT_LOG, { force: true });
  });

  test.afterAll(() => {
    // Only what we seeded — .vibegraph/ also holds COMMITTED fixture data
    // (manual_seeds.json), so never remove the whole directory.
    fs.rmSync(join(ROOT, ".vibegraph", "thread-skills"), { recursive: true, force: true });
  });

  test("1. launchpad dot → badge → card → Ratify: renderer and disk both flip", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });

    // Launchpad coverage dot reads draft for the seeded thread.
    const dot = page.locator(`[data-thread-index-row][data-entry-id="${EP}"] [data-skill-state]`);
    await expect(dot).toHaveAttribute("data-skill-state", "draft");
    await page.screenshot({ path: join(SHOT_DIR, "launchpad-dots.png") });

    // Open the thread → the badge reads Draft.
    await page.click(`[data-thread-index-row][data-entry-id="${EP}"]`);
    const badge = page.locator("[data-skill-badge]");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toHaveAttribute("data-skill-state", "draft");

    // The card: full body incl. the citation, explicit draft label.
    await badge.click();
    const card = page.locator("[data-thread-skill-card]");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Draft — not yet ratified");
    await expect(page.locator("[data-skill-card-body]")).toContainText("never open sqlite3 directly");
    await page.screenshot({ path: join(SHOT_DIR, "card-draft.png") });

    // Ratify → badge repaints, card badge flips, DISK file flips; hash intact.
    await page.locator("[data-skill-ratify]").click();
    await expect(badge).toHaveAttribute("data-skill-state", "ratified", { timeout: 10_000 });
    await expect(card).toContainText("Ratified");
    const onDisk = fs.readFileSync(SKILL_FILE, "utf-8");
    expect(onDisk).toMatch(/^status: ratified$/m);
    expect(onDisk).toContain(SKILL_BODY.split("\n")[1]); // body untouched
    await page.screenshot({ path: join(SHOT_DIR, "card-ratified.png") });
  });

  test("2. from another thread, a `db.query` question shows the routed line; the skill rode the prompt", async ({ page }) => {
    test.skip(!PROMPT_LOG, "Requires FAKE_PROMPT_LOG");
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="app.py:create_user_route"]');
    await expect(page.locator("[data-thread-view]")).toBeVisible({ timeout: 10_000 });

    // Open the chat and ask about the OTHER thread's seed symbol.
    await page.click('button[title^="Open Claude chat"]');
    const input = page.locator("[data-chat-panel] textarea");
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill("why does `db.query` sometimes fail?");
    await input.press("Enter");

    // The muted provenance line names the routed thread and the injection.
    const routed = page.locator("[data-chat-routed]");
    await expect(routed).toBeVisible({ timeout: 15_000 });
    await expect(routed).toContainText("db:query");
    await expect(routed).toContainText("`db.query`");
    await expect(routed).toContainText("ratified skill was shared");
    await page.screenshot({ path: join(SHOT_DIR, "chat-routed-line.png") });

    // And the backend really received the skill body + the spawn hint.
    await expect
      .poll(() => (fs.existsSync(PROMPT_LOG) ? fs.readFileSync(PROMPT_LOG, "utf-8") : ""), { timeout: 10_000 })
      .toContain("never open sqlite3 directly");
    const log = fs.readFileSync(PROMPT_LOG, "utf-8");
    expect(log).toContain("Routed context — this question touches threads beyond the active one");
    expect(log).toContain("vibegraph_spawn_thread_agent(entryPointId, task)");
  });
});
