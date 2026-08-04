/**
 * U3.2 — per-kind colour coding.
 *
 * Pins the accent-var picked by accentForThreadNode for representative
 * nodes across flask_demo's cli:main + create_user_route threads.
 * Every thread node carries data-accent-var (e.g. "--accent-thread")
 * and data-kind-label (e.g. "DB WRITE") so we can assert without
 * pixel sampling.
 *
 * The expectations are the docs — if the heuristic in
 * colour_for_node.ts changes, this spec breaks loudly.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_FLASK = FIXTURE.includes("flask_demo");

interface NodeMeta {
  id: string;
  accent: string;
  label: string;
}

async function readNodes(page: import("@playwright/test").Page): Promise<NodeMeta[]> {
  return await page.evaluate(() => {
    const out: { id: string; accent: string; label: string }[] = [];
    document.querySelectorAll<HTMLElement>(".vg-thread-node").forEach((el) => {
      // The react-flow wrapper carries the node id; the .vg-thread-node
      // is one level in, with the accent/kind data attrs.
      const wrap = el.closest<HTMLElement>(".react-flow__node");
      const id = wrap?.getAttribute("data-id") ?? "";
      const accent = el.getAttribute("data-accent-var") ?? "";
      const label = el.getAttribute("data-kind-label") ?? "";
      if (id) out.push({ id, accent, label });
    });
    return out;
  });
}

test.describe("U3.2 — per-kind colour coding", () => {
  test.skip(!IS_FLASK,
    "Requires VG_FIXTURE=test/fixtures/threads/flask_demo");

  test("cli:main thread — three-family palette lights the DB column + fades config", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    await page.waitForTimeout(700);
    const nodes = await readNodes(page);
    const by = new Map(nodes.map((n) => [n.id, n]));

    // ── Family 1 (logic) — teal trunk ───────────────────────────────────
    // Seed main is a CLI entry point — function_def → --accent-thread.
    expect(by.get("cli:main")?.accent).toBe("--accent-thread");
    expect(by.get("cli:main")?.label).toBe("CLI");
    // Domain function_defs stay teal — name doesn't match a DB primitive.
    expect(by.get("cli:cmd_create")?.accent).toBe("--accent-thread");
    expect(by.get("cli:cmd_list")?.accent).toBe("--accent-thread");
    expect(by.get("models:create_user")?.accent).toBe("--accent-thread");

    // ── Family 2 (I/O) — blue DB column ─────────────────────────────────
    // db:insert is a function_def with name "insert" — DB write.
    expect(by.get("db:insert")?.accent).toBe("--accent-io-write");
    expect(by.get("db:insert")?.label).toBe("DB WRITE");
    // db:_get_conn ends in _conn → DB receiver.
    expect(by.get("db:_get_conn")?.accent).toBe("--accent-io");
    expect(by.get("db:_get_conn")?.label).toBe("DB");
    // external:conn.execute — "execute" tail → DB neutral.
    expect(by.get("external:conn.execute")?.accent).toBe("--accent-io");
    expect(by.get("external:conn.execute")?.label).toBe("DB");
    // external:conn.commit — "commit" matches DB write tails → brightest.
    expect(by.get("external:conn.commit")?.accent).toBe("--accent-io-write");
    expect(by.get("external:conn.commit")?.label).toBe("DB WRITE");
    // external:conn.close — neutral DB primitive.
    expect(by.get("external:conn.close")?.accent).toBe("--accent-io");
    // external:print → I/O muted.
    expect(by.get("external:print")?.accent).toBe("--accent-io-muted");
    expect(by.get("external:print")?.label).toBe("I/O");

    // ── Family 3 (config) — warm muted argparse setup ───────────────────
    expect(by.get("external:parser.parse_args")?.accent).toBe("--accent-config");
    expect(by.get("external:parser.parse_args")?.label).toBe("CONFIG");
    expect(by.get("external:argparse.ArgumentParser")?.accent).toBe("--accent-config");
    expect(by.get("external:argparse.ArgumentParser")?.label).toBe("CONFIG");
    expect(by.get("external:sub.add_parser")?.accent).toBe("--accent-config");
    expect(by.get("external:create.add_argument")?.accent).toBe("--accent-config");
    expect(by.get("external:parser.add_subparsers")?.accent).toBe("--accent-config");

    // ── --accent-warning is NOT used for mutation any more ───────────────
    for (const n of nodes) {
      expect(
        n.accent,
        `${n.id} should not use --accent-warning (mutation now lives on --accent-io-write)`,
      ).not.toBe("--accent-warning");
    }
  });

  test("every step node has a non-empty accent var and label", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="cli.py:main"]');
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    await page.waitForTimeout(700);
    const nodes = await readNodes(page);
    for (const n of nodes) {
      expect(n.accent.startsWith("--"), `${n.id} accent should be a CSS var, got: ${n.accent}`).toBe(true);
      expect(n.label.length, `${n.id} should have a non-empty kind label`).toBeGreaterThan(0);
    }
  });

  test("flask route handler is tagged ROUTE", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="app.py:create_user_route"]');
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    await page.waitForTimeout(700);
    const nodes = await readNodes(page);
    const by = new Map(nodes.map((n) => [n.id, n]));
    expect(by.get("app:create_user_route")?.accent).toBe("--accent-thread");
    expect(by.get("app:create_user_route")?.label).toBe("ROUTE");
  });

  test("test entry point is tagged TEST", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-thread-index]", { timeout: 15_000 });
    await page.click('[data-thread-index-row][data-entry-id="test_flow.py:test_create_then_find"]');
    await page.waitForSelector("[data-thread-view]", { timeout: 10_000 });
    await page.waitForTimeout(700);
    const nodes = await readNodes(page);
    const by = new Map(nodes.map((n) => [n.id, n]));
    expect(by.get("test_flow:test_create_then_find")?.accent).toBe("--accent-thread");
    expect(by.get("test_flow:test_create_then_find")?.label).toBe("TEST");
  });
});
