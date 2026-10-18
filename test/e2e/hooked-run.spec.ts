/**
 * The Agent Manager's default path (2026-09-29): one Claude Code session with
 * the VibeGraph hooks, launched from the panel. Driven by a stub Claude
 * (test/fixtures/hooked_run/fake_claude_hooked.mjs) that runs the hook
 * commands it is handed through --settings, as Claude Code does:
 *
 *   1. a task that breaks the stated rule: the injected post-edit hook
 *      blocks, the server-collected evidence names the newly violated rule
 *      and the changed file, and Reject restores the snapshot byte for byte;
 *   2. a clean task: no rule newly violated, and Accept keeps the change;
 *   3. the legacy orchestrated form is one toggle away, untouched;
 *   4. (2026-10-16) the run is a CONVERSATION: the panel says what Claude will
 *      be told, the framing and the denied tools reach the session, a
 *      `QUESTION:` becomes a card, the person's answer goes to the SAME
 *      session, and Finish collects the evidence.
 *
 *   npm run test:e2e-hooked-run
 */
import { test, expect } from "@playwright/test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const ROOT = join(process.cwd(), FIXTURE);
const APP = join(ROOT, "app.py");
let original = "";

test.describe("hooked run", () => {
  test.skip(!FIXTURE.includes("hooked_run/hooked_demo"), "Requires VG_FIXTURE=test/fixtures/hooked_run/hooked_demo");
  test.beforeAll(() => { original = readFileSync(APP, "utf-8"); });
  test.afterAll(() => {
    writeFileSync(APP, original);
    for (const p of ["hooked-run.json", "fake-claude-args.json", "work-snapshots"]) rmSync(join(ROOT, ".vibegraph", p), { recursive: true, force: true });
  });

  async function openAgents(page) {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
    await page.click("[data-work-run-toggle]");
    await expect(page.locator("[data-agent-engine='hooked']")).toHaveAttribute("data-active", "true");
  }

  async function run(page, task: string) {
    await page.locator("[data-work-run-task]").fill(task);
    await page.click("[data-hooked-start]");
    // a turn ends and the session waits for the person; Finish collects the evidence
    await expect(page.locator("[data-hooked-status]")).toHaveAttribute("data-hooked-status", "waiting", { timeout: 60_000 });
    await page.click("[data-hooked-finish]");
    await expect(page.locator("[data-hooked-status]")).toHaveAttribute("data-hooked-status", "awaiting-review", { timeout: 60_000 });
  }

  test("a run that breaks a stated rule is blocked, named, and undone by Reject", async ({ page }) => {
    await openAgents(page);
    await run(page, "add a wipe() to app.py that calls store.purge");

    const args = JSON.parse(readFileSync(join(ROOT, ".vibegraph", "fake-claude-args.json"), "utf-8"));
    expect(args.argv).toContain("--dangerously-skip-permissions");
    expect(Object.keys(args.settings.hooks).sort()).toEqual(["PostToolUse", "SessionStart", "Stop", "UserPromptSubmit"]);
    expect(args.settings.hooks.PostToolUse[0].matcher).toBe("Write|Edit|MultiEdit|NotebookEdit|Bash");

    await expect(page.locator("[data-hooked-event='blocked']")).toContainText("(c1)");
    await expect(page.locator("[data-hooked-introduced]")).toContainText("c1");
    await expect(page.locator("[data-hooked-change='app.py']")).toContainText("modified");
    await expect(page.locator("[data-hooked-self-report]")).toContainText("Added wipe() to app.py.");
    expect(readFileSync(APP, "utf-8")).toContain("def wipe()");

    await page.click("[data-hooked-reject]");
    await expect(page.locator("[data-hooked-status]")).toHaveAttribute("data-hooked-status", "rejected", { timeout: 30_000 });
    expect(readFileSync(APP, "utf-8")).toBe(original);
  });

  test("a clean run keeps every rule, and Accept keeps the change", async ({ page }) => {
    await openAgents(page);
    await run(page, "clarify the create() docstring in app.py");
    await expect(page.locator("[data-hooked-rules-clean]")).toContainText("no stated rule newly violated");
    await expect(page.locator("[data-hooked-event='blocked']")).toHaveCount(0);
    await page.click("[data-hooked-accept]");
    await expect(page.locator("[data-hooked-status]")).toHaveAttribute("data-hooked-status", "accepted", { timeout: 30_000 });
    expect(readFileSync(APP, "utf-8")).toContain("Create one record and return what was stored.");
    // The form is back for the next task; the legacy engine is one toggle away.
    await expect(page.locator("[data-hooked-start]")).toBeVisible();
    await page.click("[data-agent-engine='orchestrated']");
    await expect(page.locator("[data-work-run-start]")).toBeVisible();
  });

  test("a conversation: Claude asks, the person answers in the same session, then finishes for review", async ({ page }) => {
    await openAgents(page);
    const before = readFileSync(APP, "utf-8"); // the previous test accepted its change
    await expect(page.locator("[data-hooked-knows]")).toContainText("Stated rules");
    await page.locator("[data-work-run-task]").fill("ask: clarify the create() docstring in app.py");
    await page.click("[data-hooked-start]");
    await expect(page.locator("[data-hooked-status]")).toHaveAttribute("data-hooked-status", "waiting", { timeout: 60_000 });
    const args = JSON.parse(readFileSync(join(ROOT, ".vibegraph", "fake-claude-args.json"), "utf-8")).argv as string[];
    expect(args).toContain("--input-format");
    expect(args[args.indexOf("--append-system-prompt") + 1]).toContain("QUESTION:");
    expect(args[args.indexOf("--disallowedTools") + 1]).toContain("mcp__vibegraph__vibegraph_propose_architecture");
    await expect(page.locator("[data-hooked-event='question']")).toContainText("duplicate id");
    await expect(page.locator("[data-hooked-reply]")).toHaveAttribute("placeholder", /Answer Claude's question/);
    await page.locator("[data-hooked-reply]").fill("Yes: say it raises KeyError.");
    await page.click("[data-hooked-send]");
    await expect(page.locator("[data-hooked-event='you']").last()).toContainText("raises KeyError");
    await expect(page.locator("[data-hooked-event='text']").last()).toContainText("Understood: Yes: say it raises KeyError.", { timeout: 30_000 });
    await expect(page.locator("[data-hooked-status]")).toHaveAttribute("data-hooked-status", "waiting");
    await expect(page.locator("[data-hooked-status]")).toContainText("2 messages");
    await page.click("[data-hooked-finish]");
    await expect(page.locator("[data-hooked-status]")).toHaveAttribute("data-hooked-status", "awaiting-review", { timeout: 60_000 });
    await expect(page.locator("[data-hooked-change='app.py']")).toContainText("modified");
    expect(readFileSync(APP, "utf-8")).toContain("# answered: Yes: say it raises KeyError.");
    await page.click("[data-hooked-reject]");
    await expect(page.locator("[data-hooked-status]")).toHaveAttribute("data-hooked-status", "rejected", { timeout: 30_000 });
    expect(readFileSync(APP, "utf-8")).toBe(before);
  });
});
