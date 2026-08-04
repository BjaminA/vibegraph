/**
 * PLAN-v7 Stage 4a (gate) — THE SOLIDIFY MOMENT: a canned build increment
 * flows through the changeset gate on a blank project with a ratified
 * architecture plan, and accepting it turns ghost subsystems SOLID.
 *
 * The whole arc's honesty payoff in one test: the plan was a labelled wish;
 * the changeset writes real code through the chokepoint; the RE-PARSE (not
 * the plan, not the acceptance) is what converts ghosts — parsed reality
 * catching up with the ratified plan via the reconcile rule that has been
 * live since 3a (solid wins on id collision).
 *
 *   1. Boot greenfield_blank with a PRE-SEEDED ratified plan (backend + db)
 *      → the system view is all-ghost (2 PLANNED, 0 solid).
 *   2. PROPOSE — a canned changeset (app.py flask route + db.py sqlite store
 *      + pure validate_title) → the gate renders with a GREEN floor: both
 *      files parse (dry create_file), the behavioural check ran in the
 *      sandbox (scan said confidently pure) and passed. Disk untouched.
 *   3. REJECT — gate gone; still nothing on disk.
 *   4. ACCEPT & BUILD — files land via the chokepoint; the derived refresh
 *      re-links/discovers/rolls-up; backend + db become SOLID subsystem
 *      cards, the ghosts are GONE, and the new route appears as a thread
 *      entry in the side panel.
 *
 * Fixture hygiene: everything this test writes (.vibegraph/, app.py, db.py)
 * is removed in afterAll — greenfield_blank returns to its .gitkeep.
 *
 * Boot (see package.json test:e2e-plan-v7-4a):
 *   VG_FIXTURE=test/fixtures/greenfield_blank VG_PORT=4238 PORT=4238 \
 *     npx playwright test test/e2e/plan-v7-4a-changeset-build.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_BLANK = FIXTURE.includes("greenfield_blank");
const ROOT = join(process.cwd(), FIXTURE);
const SHOT_DIR = "reviews/m-plan-v7-4a";

// The ratified plan (as stage 3 would have persisted it): backend + db,
// grounded in the description. Pre-seeded so this gate tests stage 4 alone.
const PLAN = {
  version: "1",
  description: "a flask API with a sqlite note store",
  subsystems: [
    { id: "backend", kind: "backend", label: "Flask API", groundedIn: "a flask API" },
    { id: "db", kind: "db", label: "SQLite note store", groundedIn: "a sqlite note store" },
  ],
  edges: [{ from: "backend", to: "db", groundedIn: "a sqlite note store" }],
  drafted: false,
  ratifiedAt: "2026-07-02T00:00:00.000Z",
};

// The increment: mirrors flask_demo's proven shapes (route decorator →
// backend; sqlite calls → db + the backend→db effect edge). validate_title
// is deliberately pure (no calls at all) — the behavioural check targets it,
// so the effect-scan floor says "confidently pure" and the check RUNS.
const APP_PY = [
  "from flask import Flask, jsonify",
  "",
  "from db import insert_note",
  "",
  "app = Flask(__name__)",
  "",
  "",
  '@app.route("/notes", methods=["POST"])',
  "def create_note_route():",
  '    note = insert_note("hello")',
  "    return jsonify(note)",
  "",
].join("\n");

const DB_PY = [
  "import sqlite3",
  "",
  'DB_PATH = "notes.sqlite"',
  "",
  "",
  "def validate_title(title):",
  "    if not title:",
  "        return None",
  "    return title",
  "",
  "",
  "def insert_note(title):",
  "    conn = sqlite3.connect(DB_PATH)",
  '    conn.execute("INSERT INTO notes (title) VALUES (?)", (title,))',
  "    conn.commit()",
  "    conn.close()",
  '    return {"title": title}',
  "",
].join("\n");

const CHECK_MODULE = [
  "from db import validate_title",
  "",
  "",
  "def __vg_check__():",
  '    assert validate_title("hello") == "hello"',
  '    assert validate_title("") is None',
  "",
].join("\n");

const CHANGESET = {
  label: "the create-note flow",
  files: [
    { path: "app.py", content: APP_PY },
    { path: "db.py", content: DB_PY },
  ],
  check: {
    module: CHECK_MODULE,
    description: "validate_title accepts a real title and declines an empty one",
  },
  drafted: false,
};

test.use({ video: "on" });

function cleanFixture() {
  rmSync(join(ROOT, ".vibegraph"), { recursive: true, force: true });
  for (const f of ["app.py", "db.py"]) rmSync(join(ROOT, f), { force: true });
}

test.describe("PLAN-v7 4a — changeset build (gate → chokepoint → ghosts solidify)", () => {
  test.skip(!IS_BLANK, "Requires VG_FIXTURE=test/fixtures/greenfield_blank");

  test.beforeAll(() => {
    cleanFixture();
    mkdirSync(join(ROOT, ".vibegraph"), { recursive: true });
    writeFileSync(join(ROOT, ".vibegraph", "system-plan.json"), JSON.stringify(PLAN, null, 2) + "\n", "utf-8");
    mkdirSync(SHOT_DIR, { recursive: true });
  });
  test.afterAll(() => {
    cleanFixture();
  });

  test("green-floor gate; reject leaves disk clean; accept builds through the chokepoint and the ghosts turn solid", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('button:has-text("System")')).toBeVisible({ timeout: 15_000 });

    // All-ghost baseline: the ratified plan renders 2 PLANNED cards, 0 solid.
    await page.click('button:has-text("System")');
    await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator("[data-subsystem-node]")).toHaveCount(0);

    // ── 2. PROPOSE ──────────────────────────────────────────────────────
    await page.evaluate((changeset) => {
      document.dispatchEvent(new CustomEvent("vg-changeset-propose", { detail: { changeset } }));
    }, CHANGESET);

    const gate = page.locator("[data-changeset-gate]");
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect(gate).toContainText("the create-note flow");
    // The floor is green: both files parse, the check RAN (pure) and passed.
    await expect(page.locator('[data-changeset-file="app.py"][data-file-ok="true"]')).toHaveCount(1);
    await expect(page.locator('[data-changeset-file="db.py"][data-file-ok="true"]')).toHaveCount(1);
    await expect(page.locator('[data-changeset-check][data-check-ok="true"]')).toHaveCount(1);
    await expect(page.locator("[data-changeset-accept]")).toBeEnabled();
    // ANTI-POLLUTION: nothing written; the ghosts are still ghosts.
    expect(existsSync(join(ROOT, "app.py"))).toBe(false);
    expect(existsSync(join(ROOT, "db.py"))).toBe(false);
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(2);

    await page.screenshot({ path: join(SHOT_DIR, "changeset-gate.png") });

    // ── 3. REJECT ───────────────────────────────────────────────────────
    await page.click("[data-changeset-reject]");
    await expect(gate).toHaveCount(0, { timeout: 10_000 });
    expect(existsSync(join(ROOT, "app.py"))).toBe(false);
    expect(existsSync(join(ROOT, "db.py"))).toBe(false);

    // ── 4. ACCEPT & BUILD — the solidify moment ─────────────────────────
    await page.evaluate((changeset) => {
      document.dispatchEvent(new CustomEvent("vg-changeset-propose", { detail: { changeset } }));
    }, CHANGESET);
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await page.click("[data-changeset-accept]");

    // Files landed through the chokepoint (black-formatted, real writes).
    await expect.poll(() => existsSync(join(ROOT, "app.py")) && existsSync(join(ROOT, "db.py")), { timeout: 15_000 }).toBe(true);
    expect(readFileSync(join(ROOT, "db.py"), "utf-8")).toContain("def insert_note(");
    await expect(gate).toHaveCount(0, { timeout: 10_000 });

    // THE PAYOFF: parsed reality catches up with the ratified plan — the
    // derived refresh rolls up backend + db as SOLID cards and the ghosts
    // are gone (solid wins on id collision; the reconcile rule).
    await expect(page.locator("[data-subsystem-node]")).toHaveCount(2, { timeout: 30_000 });
    await expect(page.locator("[data-planned-subsystem]")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('[data-subsystem-node][data-subsystem-kind="backend"]')).toHaveCount(1);
    await expect(page.locator('[data-subsystem-node][data-subsystem-kind="db"]')).toHaveCount(1);

    // ...and the increment created a real THREAD: the route is discovered
    // as an entry point in the side panel.
    await expect(page.locator("body")).toContainText("create_note_route", { timeout: 15_000 });

    await page.screenshot({ path: join(SHOT_DIR, "after-build-solid.png") });
  });
});
