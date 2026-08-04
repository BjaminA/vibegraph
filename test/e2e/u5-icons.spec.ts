/**
 * U5 — semantic icons + cross-file halo + HTTP route decoration.
 *
 * Pins specific lucide icon names against representative nodes from
 * flask_demo's cli + route + test threads. Icons are exposed via the
 * data-icon-name attribute ThreadNode emits.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

interface NodeMeta {
  id: string;
  icon: string;
  method: string;
  crossFile: boolean;
}

async function readMeta(page: import("@playwright/test").Page): Promise<NodeMeta[]> {
  return await page.evaluate(() => {
    const out: { id: string; icon: string; method: string; crossFile: boolean }[] = [];
    document.querySelectorAll<HTMLElement>(".vg-thread-node").forEach((el) => {
      const wrap = el.closest<HTMLElement>(".react-flow__node");
      const id = wrap?.getAttribute("data-id") ?? "";
      if (!id) return;
      out.push({
        id,
        icon: el.getAttribute("data-icon-name") ?? "",
        method: el.getAttribute("data-route-method") ?? "",
        crossFile: el.classList.contains("vg-thread-node-cross-file"),
      });
    });
    return out;
  });
}

test.describe("U5 — semantic icons + decorations", () => {
  test.skip(!IS_FLASK,
    "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("cli:main thread icons match the colour family", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    const meta = await readMeta(page);
    const by = new Map(meta.map((n) => [n.id, n]));

    // Family 1 — logic
    expect(by.get("cli:main")?.icon).toBe("Terminal");          // CLI entry
    expect(by.get("cli:cmd_create")?.icon).toBe("Play");        // generic FN
    expect(by.get("cli:cmd_list")?.icon).toBe("Play");
    expect(by.get("models:create_user")?.icon).toBe("Plug");    // public_api

    // Family 2 — I/O
    expect(by.get("db:insert")?.icon).toBe("Plus");             // DB WRITE
    expect(by.get("db:_get_conn")?.icon).toBe("Database");      // DB
    expect(by.get("external:conn.commit")?.icon).toBe("Plus");  // DB WRITE
    expect(by.get("external:conn.execute")?.icon).toBe("Database");
    expect(by.get("external:conn.close")?.icon).toBe("Database");
    expect(by.get("external:print")?.icon).toBe("Printer");     // I/O sink

    // Family 3 — config
    expect(by.get("external:parser.parse_args")?.icon).toBe("Settings");
    expect(by.get("external:argparse.ArgumentParser")?.icon).toBe("Settings");
  });

  test("cross-file thread steps carry the halo class", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    const meta = await readMeta(page);
    const by = new Map(meta.map((n) => [n.id, n]));
    // Seed sits in cli.py; any step in db.py / models.py is cross-file.
    expect(by.get("cli:main")?.crossFile).toBe(false);
    expect(by.get("cli:cmd_create")?.crossFile).toBe(false);
    expect(by.get("db:insert")?.crossFile).toBe(true);
    expect(by.get("db:_get_conn")?.crossFile).toBe(true);
    expect(by.get("models:create_user")?.crossFile).toBe(true);
  });

  test("POST route handler gets a POST method pill", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="app.py:create_user_route"]');
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    const meta = await readMeta(page);
    const by = new Map(meta.map((n) => [n.id, n]));
    expect(by.get("app:create_user_route")?.method).toBe("POST");
    expect(by.get("app:create_user_route")?.icon).toBe("Globe");
    // The pill itself is rendered as a separate div with data-method.
    const pill = page.locator('[data-method="POST"]');
    await expect(pill).toBeVisible();
  });

  test("GET route handler gets a GET pill", async ({ page }) => {
    // get_user_route has explicit methods=["GET"] so the metadata
    // picks up the verb. list_users_route uses bare @app.route(...)
    // which Flask defaults to GET, but discover_entry_points.py
    // doesn't infer that default — flagged for a follow-up.
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="app.py:get_user_route"]');
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    const meta = await readMeta(page);
    const by = new Map(meta.map((n) => [n.id, n]));
    expect(by.get("app:get_user_route")?.method).toBe("GET");
    const pill = page.locator('[data-method="GET"]');
    await expect(pill).toBeVisible();
  });

  test("test entry point gets the FlaskConical icon", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="test_flow.py:test_create_then_find"]');
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    const meta = await readMeta(page);
    const by = new Map(meta.map((n) => [n.id, n]));
    expect(by.get("test_flow:test_create_then_find")?.icon).toBe("FlaskConical");
  });
});
