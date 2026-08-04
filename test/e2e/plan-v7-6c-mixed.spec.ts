/**
 * PLAN-v7 6c (gate) — MIXED create+edit changesets through the chokepoint.
 *
 * Increment 1 creates db.py (the 4a create path, unchanged). Increment 2 is
 * the new thing: ONE reviewable unit that CREATES routes.py, APPENDS a
 * registration to app.py, and REPLACES db.py's insert_note with a version
 * that validates first — every op running through cst_rewrite with its
 * format-and-diff confinement, dry at propose, wet at accept.
 *
 * Honesty assertions:
 *   - the gate labels each op distinctly (+ create, +» append, ~ replace);
 *   - per-op existence guards: an edit op on a MISSING file is a red floor
 *     with the honest reason (and a create on an existing file likewise);
 *   - the REPLACE touched ONLY its target node — sibling code in db.py is
 *     byte-identical after accept (the chokepoint confinement, observed);
 *   - reject leaves every file untouched.
 *
 * Boot (see package.json test:e2e-plan-v7-6c):
 *   VG_FIXTURE=test/fixtures/greenfield_blank VG_PORT=4242 PORT=4242 \
 *     npx playwright test test/e2e/plan-v7-6c-mixed.spec.ts --reporter=list --workers=1
 */
import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
const IS_BLANK = FIXTURE.includes("greenfield_blank");
const ROOT = join(process.cwd(), FIXTURE);
const SHOT_DIR = "reviews/m-plan-v7-6c";

const SYSTEM_PLAN = {
  version: "1",
  description: "a flask API with a sqlite note store",
  subsystems: [
    { id: "backend", kind: "backend", label: "Flask API", groundedIn: "a flask API" },
    { id: "db", kind: "db", label: "SQLite note store", groundedIn: "a sqlite note store" },
  ],
  edges: [{ from: "backend", to: "db", groundedIn: "a sqlite note store" }],
  drafted: false,
  ratifiedAt: "2026-07-03T00:00:00.000Z",
};

// ── increment 1: plain creates (the proven 4a path) ──
const DB_PY = [
  "def validate_title(title):",
  "    if not title:",
  "        return None",
  "    return title",
  "",
  "",
  "def insert_note(title):",
  '    return {"title": title}',
  "",
].join("\n");

const APP_PY = [
  "routes = []",
  "",
  "",
  "def register(route):",
  "    routes.append(route)",
  "    return routes",
  "",
].join("\n");

const CREATE_CHANGESET = {
  label: "the note store foundation",
  files: [
    { path: "db.py", content: DB_PY },
    { path: "app.py", content: APP_PY },
  ],
  check: {
    module: [
      "from db import validate_title",
      "",
      "",
      "def __vg_check__():",
      '    assert validate_title("hello") == "hello"',
      "",
    ].join("\n"),
    description: "validate_title accepts a real title",
  },
  drafted: false,
};

// ── increment 2: MIXED — create + append + replace in one unit ──
const MIXED_CHANGESET = {
  label: "register the notes route",
  files: [
    {
      path: "routes.py",
      content: [
        "def notes_route():",
        '    return {"route": "/notes"}',
        "",
      ].join("\n"),
    },
    {
      path: "app.py",
      op: "append_end",
      content: [
        "from routes import notes_route",
        "",
        "",
        "def register_notes():",
        "    return register(notes_route)",
        "",
      ].join("\n"),
    },
    {
      path: "db.py",
      op: "replace_node",
      nodeId: "module/insert_note.fn",
      content: [
        "def insert_note(title):",
        "    if validate_title(title) is None:",
        "        return None",
        '    return {"title": title}',
        "",
      ].join("\n"),
    },
  ],
  check: {
    module: [
      "from db import insert_note",
      "",
      "",
      "def __vg_check__():",
      '    assert insert_note("") is None',
      '    assert insert_note("hello") == {"title": "hello"}',
      "",
    ].join("\n"),
    description: "insert_note now declines an empty title and stores a real one",
  },
  drafted: false,
};

test.use({ video: "on" });

function cleanFixture() {
  rmSync(join(ROOT, ".vibegraph"), { recursive: true, force: true });
  for (const f of ["db.py", "app.py", "routes.py"]) rmSync(join(ROOT, f), { force: true });
}

async function propose(page: any, changeset: object) {
  await page.evaluate((cs: object) => {
    document.dispatchEvent(new CustomEvent("vg-changeset-propose", { detail: { changeset: cs } }));
  }, changeset);
}

test.describe("PLAN-v7 6c — mixed create+edit changesets", () => {
  test.skip(!IS_BLANK, "Requires VG_FIXTURE=test/fixtures/greenfield_blank");

  test.beforeAll(() => {
    cleanFixture();
    mkdirSync(join(ROOT, ".vibegraph"), { recursive: true });
    writeFileSync(join(ROOT, ".vibegraph", "system-plan.json"), JSON.stringify(SYSTEM_PLAN, null, 2) + "\n", "utf-8");
    mkdirSync(SHOT_DIR, { recursive: true });
  });
  test.afterAll(() => {
    cleanFixture();
  });

  test("per-op existence guards give honest red floors", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('button:has-text("System")')).toBeVisible({ timeout: 15_000 });

    // An edit op on a file that doesn't exist yet → honest red, per file.
    await propose(page, MIXED_CHANGESET);
    const gate = page.locator("[data-changeset-gate]");
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-changeset-file="app.py"][data-file-ok="false"]')).toHaveCount(1);
    await expect(page.locator('[data-changeset-file="db.py"][data-file-ok="false"]')).toHaveCount(1);
    await expect(gate).toContainText("append_end targets an existing file");
    await expect(page.locator("[data-changeset-accept]")).toBeDisabled();
    await page.click("[data-changeset-reject]");
    await expect(gate).toHaveCount(0, { timeout: 10_000 });
    expect(existsSync(join(ROOT, "routes.py"))).toBe(false);
  });

  test("mixed increment: create + append + replace land through the chokepoint; replace is confined", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('button:has-text("System")')).toBeVisible({ timeout: 15_000 });

    // ── increment 1: the foundation lands (4a path) ──
    await propose(page, CREATE_CHANGESET);
    const gate = page.locator("[data-changeset-gate]");
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-changeset-check][data-check-ok="true"]')).toHaveCount(1);
    await page.click("[data-changeset-accept]");
    await expect.poll(() => existsSync(join(ROOT, "db.py")) && existsSync(join(ROOT, "app.py")), { timeout: 15_000 }).toBe(true);
    await expect(gate).toHaveCount(0, { timeout: 10_000 });

    const dbBefore = readFileSync(join(ROOT, "db.py"), "utf-8");
    const appBefore = readFileSync(join(ROOT, "app.py"), "utf-8");

    // ── increment 2: the MIXED changeset gates with per-op honesty ──
    await propose(page, MIXED_CHANGESET);
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-changeset-file="routes.py"][data-file-op="create_file"][data-file-ok="true"]')).toHaveCount(1);
    await expect(page.locator('[data-changeset-file="app.py"][data-file-op="append_end"][data-file-ok="true"]')).toHaveCount(1);
    await expect(page.locator('[data-changeset-file="db.py"][data-file-op="replace_node"][data-file-ok="true"]')).toHaveCount(1);
    await expect(gate).toContainText("~ db.py");
    await expect(gate).toContainText("replaces module/insert_note.fn");
    await expect(gate).toContainText("+» app.py");
    await expect(page.locator('[data-changeset-check][data-check-ok="true"]')).toHaveCount(1);
    // Nothing written at propose time — the floor ran dry + sandboxed.
    expect(readFileSync(join(ROOT, "db.py"), "utf-8")).toBe(dbBefore);
    expect(existsSync(join(ROOT, "routes.py"))).toBe(false);

    await page.screenshot({ path: join(SHOT_DIR, "mixed-gate.png") });

    // ── accept: every op runs WET through the chokepoint ──
    await page.click("[data-changeset-accept]");
    await expect.poll(() => existsSync(join(ROOT, "routes.py")), { timeout: 15_000 }).toBe(true);
    await expect(gate).toHaveCount(0, { timeout: 10_000 });

    const dbAfter = readFileSync(join(ROOT, "db.py"), "utf-8");
    const appAfter = readFileSync(join(ROOT, "app.py"), "utf-8");
    // The replace landed…
    expect(dbAfter).toContain("if validate_title(title) is None:");
    // …CONFINED: the sibling validate_title is byte-identical.
    const validateBlock = dbBefore.slice(0, dbBefore.indexOf("def insert_note"));
    expect(dbAfter.startsWith(validateBlock)).toBe(true);
    // The append extended app.py without disturbing the existing code.
    expect(appAfter.startsWith(appBefore.trimEnd())).toBe(true);
    expect(appAfter).toContain("def register_notes():");

    // A create on a NOW-existing file is an honest red floor ("same op
    // twice" would silently overwrite otherwise).
    await propose(page, CREATE_CHANGESET);
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect(gate).toContainText("file already exists");
    await expect(page.locator("[data-changeset-accept]")).toBeDisabled();
    await page.click("[data-changeset-reject]");
  });
});
