/**
 * M-ARCH.2 (PLAN-M-ARCH.md) — the architecture map: clusters, boundary
 * tools and the protocol on every edge, derived from the IR, under three
 * lenses, with an inspector that says WHY a protocol reads as it does and
 * opens the threads behind an edge.
 *
 * next_demo carries every shape: a Next app running a backend script
 * through the Volt web client, an MCP server and client, pg behind a
 * funnel, a private SDK with a stated role, an unclassified tool.
 *
 * M-ARCH.4 — the proposal gate, driven by a stub model
 * (test/fixtures/arch/fake_claude_arch.mjs) whose reply is deliberately
 * mixed: grounded, partly-grounded, INFERRED and invented items.
 *
 * Boot:
 *   VG_FIXTURE=test/fixtures/webstack/next_demo VG_PORT=4331 PORT=4331 \
 *     VG_CLAUDE_BIN="node $PWD/test/fixtures/arch/fake_claude_arch.mjs" \
 *     npx playwright test test/e2e/m-arch-map.spec.ts --reporter=list --workers=1
 */
import { test, expect, type Page } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("next_demo"), "Requires VG_FIXTURE=test/fixtures/webstack/next_demo");

const REVIEW_DIR = join(process.cwd(), "reviews", "m-arch");
const CMD_EDGE = "cluster:web:.->cluster:scripts:.:command:Volt · WebSocket · command";
const STORE = join(process.cwd(), FIXTURE, ".vibegraph", "architecture.json");
const KNOWLEDGE = join(process.cwd(), FIXTURE, ".vibegraph", "knowledge");
const clearStore = () => { if (existsSync(STORE)) rmSync(STORE); rmSync(KNOWLEDGE, { recursive: true, force: true }); };

function assert(cond: unknown, msg?: string): asserts cond {
  if (!cond) throw new Error(msg ?? "assertion failed");
}

/** Edges whose drawn path passes THROUGH a card that is not one of its ends
 *  (reviews/m-arch/COMPARE.md measured 8 of 13 here before routing). */
async function edgesThroughCards(page: Page, pathSel: string, cardSel: string): Promise<string[]> {
  return page.evaluate(([ps, cs]) => {
    const cards = [...document.querySelectorAll(cs)].map((c) => (c.querySelector("rect") ?? c).getBoundingClientRect());
    const inside = (p: DOMPoint, r: DOMRect, pad: number) => p.x > r.left + pad && p.x < r.right - pad && p.y > r.top + pad && p.y < r.bottom - pad;
    const bad: string[] = [];
    const paths = [...document.querySelectorAll(ps)] as SVGPathElement[];
    // An instrument that matched nothing would report a clean zero.
    if (!paths.length || !cards.length) return [`<matched ${paths.length} paths, ${cards.length} cards>`];
    for (const path of paths) {
      const len = path.getTotalLength(), ctm = path.getScreenCTM();
      if (!len || !ctm) continue;
      const pts = Array.from({ length: 61 }, (_, i) => { const q = path.getPointAtLength((len * i) / 60); return new DOMPoint(q.x, q.y).matrixTransform(ctm); });
      const ends = cards.filter((r) => inside(pts[0], r, -6) || inside(pts[60], r, -6));
      if (cards.some((r) => !ends.includes(r) && pts.slice(2, -2).some((q) => inside(q, r, 3)))) {
        bad.push((path.closest("[data-id]") as HTMLElement | null)?.dataset.id ?? "?");
      }
    }
    return bad;
  }, [pathSel, cardSel] as const);
}

async function openMap(page: Page) {
  await page.addInitScript(() => { try { localStorage.removeItem("vg-system-mode"); localStorage.removeItem("vg-arch-lens"); } catch { /* */ } });
  await page.goto("/");
  await page.waitForSelector("[data-thread-index]", { timeout: 30_000 });
  // The test server has no `claude` on PATH, so the KeyBanner shows; it
  // overlaps the canvas controls and every other spec dismisses it first.
  const banner = page.locator("[data-key-banner]");
  if (await banner.count() > 0) await banner.locator("button").click();
  await page.getByRole("button", { name: "System" }).click();
  await expect(page.locator("[data-system-view]")).toBeVisible({ timeout: 10_000 });
  await page.locator("[data-system-arch-toggle]").click();
  await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "map");
  await page.waitForTimeout(500);
}

test.describe("M-ARCH — the architecture map", () => {
  test("overview: clusters, tools, protocol labels read from the facts, a legend", async ({ page }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openMap(page);

    // The Overview folds tools into one box per category (the Tools lens
    // draws each): pg + psql are one database box, the two platform SDKs one
    // platform box; a single-member category stays itself; the unclassified
    // tool is counted in the legend, not drawn.
    for (const id of ["cluster:web:.", "cluster:scripts:.", "cluster:mcp:.", "tools:database", "tools:platform", "tool:openai"]) {
      await expect(page.locator(`[data-arch-id="${id}"]`), id).toBeVisible();
    }
    await expect(page.locator('[data-arch-id="tools:database"] [data-arch-chip="2 tools"]')).toBeVisible();
    await expect(page.locator('[data-arch-id="tools:database"] [data-arch-sublabel]')).toHaveText("pg, psql");
    await expect(page.locator('[data-arch-id="tool:pg"]')).toHaveCount(0);
    await expect(page.locator('[data-arch-id="tool:clsx"]')).toHaveCount(0);
    await expect(page.locator('[data-arch-id="cluster:web:."] [data-arch-label]')).toHaveText("Next.js app");

    const cmd = page.locator(`.react-flow__edge[data-id="${CMD_EDGE}"]`);
    await expect(cmd).toHaveCount(1);
    await expect(cmd).toContainText("Volt · WebSocket · command");
    await expect(page.locator('.react-flow__edge[data-id="cluster:web:.->tools:database:uses"]')).toContainText("SQL");
    await expect(page.locator('.react-flow__edge[data-id="cluster:web:.->cluster:mcp:.:tool:MCP"]')).toContainText("list_orders");

    const legend = page.locator("[data-arch-legend]");
    // Collapsed by default so it does not cover the map (overlap pass).
    await expect(legend.locator("[data-arch-legend-item]").first()).toBeHidden();
    await legend.locator("[data-arch-legend-toggle]").click();
    for (const c of ["frontend", "scripts", "database", "platform", "unknown"]) {
      await expect(legend.locator(`[data-arch-legend-item="${c}"]`), c).toBeVisible();
    }
    await expect(legend.locator("[data-arch-unplaced]")).toContainText("unmatched hops");
    await expect(legend.locator("[data-arch-unplaced]")).toContainText("1 unclassified tool (Tools lens)");

    // Routed: no edge passes through a card that is not one of its ends,
    // in every lens.
    for (const l of ["overview", "tools", "flows", "payloads"]) {
      await page.locator(`[data-arch-lens="${l}"]`).click();
      await page.waitForTimeout(300);
      expect(await edgesThroughCards(page, ".react-flow__edge path.react-flow__edge-path", "[data-arch-node]"), l).toEqual([]);
    }
    await page.locator('[data-arch-lens="overview"]').click();
    await page.waitForTimeout(300);
    // Keyboard: a card takes focus, carries its name, and Enter opens it.
    const web = page.locator('.react-flow__node[data-id="cluster:web:."]');
    await expect(web).toHaveAttribute("tabindex", "0");
    await expect(web).toHaveAttribute("aria-label", /^Next\.js app, /);
    await web.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-arch-inspector]")).toContainText("Next.js app");
    await page.locator("[data-arch-inspector-close]").click();
    // The first view is readable: card labels render at 11px or more.
    const heights = await page.locator("[data-arch-label]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(11);

    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.waitForTimeout(800); // the cards' enter motion settles
    await page.screenshot({ path: join(REVIEW_DIR, "overview.png") });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the inspector says why an edge's protocol reads as it does, and opens the threads behind it", async ({ page }) => {
    test.setTimeout(90_000);
    await openMap(page);
    // Edges leaving one port overlap near it, so a coordinate click can land
    // on a neighbour; the click is dispatched on the intended edge element.
    await page.locator(`.react-flow__edge[data-id="${CMD_EDGE}"]`).dispatchEvent("click");
    const insp = page.locator("[data-arch-inspector]");
    await expect(insp).toBeVisible();
    await expect(insp.locator("[data-arch-inspector-protocol]")).toContainText("Volt · WebSocket · command");
    await expect(insp.locator("[data-arch-inspector-basis]")).toContainText("calls @tdxvolt/volt-client-web");
    await expect(insp.locator('[data-arch-ref="lib/volt.ts"]').first()).toBeVisible();
    await page.screenshot({ path: join(REVIEW_DIR, "inspector.png") });

    await insp.locator('[data-arch-open-thread="app/dashboard/page.tsx:DashboardPage"]').click();
    await expect(page.locator("[data-system-view]")).toBeHidden({ timeout: 10_000 });
  });

  test("lenses select what is drawn: flows are hops between clusters, tools are calls into tools", async ({ page }) => {
    test.setTimeout(90_000);
    await openMap(page);
    await page.locator('[data-arch-lens="flows"]').click();
    await expect(page.locator('[data-arch-lens="flows"]')).toHaveAttribute("data-active", "true");
    await expect(page.locator('[data-arch-kind="tool"]')).toHaveCount(0);
    await expect(page.locator(`.react-flow__edge[data-id="${CMD_EDGE}"]`)).toHaveCount(1);
    await page.screenshot({ path: join(REVIEW_DIR, "flows.png") });

    await page.locator('[data-arch-lens="tools"]').click();
    await expect(page.locator(`.react-flow__edge[data-id="${CMD_EDGE}"]`)).toHaveCount(0);
    await expect(page.locator('.react-flow__edge[data-id="cluster:web:.->tool:pg:uses:SQL"]')).toHaveCount(1);
    await expect(page.locator('[data-arch-id="tool:pg"]')).toBeVisible();
    await expect(page.locator('[data-arch-id="tool:clsx"]')).toBeVisible();
    // A stated role is a chip on the card that carries it (the Tools lens draws each tool).
    await expect(page.locator('[data-arch-id="tool:@acme/ledger-client"] [data-arch-chip="role · c1"]')).toBeVisible();

    // M-ARCH.3 — the Payloads lens labels each edge with what crosses it,
    // and the inspector shows sends / accepts / stated with their sources.
    await page.locator('[data-arch-lens="payloads"]').click();
    await expect(page.locator('.react-flow__edge[data-id="cluster:web:.->cluster:mcp:.:tool:MCP"]')).toContainText("{ name, arguments, arguments.region }");
    await page.locator(`.react-flow__edge[data-id="${CMD_EDGE}"]`).dispatchEvent("click");
    const pay = page.locator("[data-arch-inspector] [data-arch-payloads]");
    await expect(pay.locator('[data-arch-payload="callee"]')).toContainText("argv: REGION ← ${1:-all}");
    await expect(pay.locator('[data-arch-payload="stated"][data-arch-payload-source="stated"]')).toContainText("c2 · human-stated");
    await page.screenshot({ path: join(REVIEW_DIR, "payloads.png") });
    await page.locator("[data-arch-inspector-close]").click();
    await page.locator('[data-arch-lens="tools"]').click();

    // The lens persists across a reload of the view.
    await page.locator("[data-system-arch-toggle]").click();
    await expect(page.locator("[data-system-view]")).toHaveAttribute("data-system-mode", "subsystems");
    await page.locator("[data-system-arch-toggle]").click();
    await expect(page.locator('[data-arch-lens="tools"]')).toHaveAttribute("data-active", "true");
  });
  test("trace: downstream reach lights what a box reaches; a route between two boxes, or an honest none", async ({ page }) => {
    test.setTimeout(90_000);
    await openMap(page);
    await page.locator('[data-arch-id="cluster:scripts:."]').click();
    await page.locator("[data-arch-inspector] [data-arch-reach=\"down\"]").click();
    const bar = page.locator("[data-arch-trace]");
    await expect(bar).toContainText("Downstream of Scripts");
    await expect(page.locator('[data-arch-id="cluster:web:."]')).toHaveAttribute("data-arch-dim", "true");
    await expect(page.locator('[data-arch-id="tools:database"]')).not.toHaveAttribute("data-arch-dim", "true");
    await page.locator("[data-arch-trace-clear]").click();
    await expect(bar).toHaveCount(0);

    await page.locator('[data-arch-id="cluster:web:."]').click();
    await page.locator("[data-arch-inspector] [data-arch-route-from]").click();
    await expect(bar).toContainText("click the box to route to");
    await page.locator('[data-arch-id="tools:database"]').click();
    await expect(bar).toContainText("Route Next.js app → database · 2: 1 hop");
    await page.screenshot({ path: join(REVIEW_DIR, "trace.png") });
    await page.keyboard.press("Escape");
    // Arrows run one way: nothing routes out of a tool.
    await page.locator('[data-arch-id="tool:openai"]').click();
    await page.locator("[data-arch-inspector] [data-arch-route-from]").click();
    await page.locator('[data-arch-id="cluster:web:."]').click();
    await expect(bar).toContainText("No directed route from openai to Next.js app");
  });

  test("M-ARCH.4 — propose: groups arrive ghosted with their evidence, invented items refused; ratify makes them stated; reject drops them", async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!process.env.VG_CLAUDE_BIN?.includes("fake_claude_arch"), "Requires the stub model (see package.json test:e2e-arch-map)");
    clearStore();
    // An earlier export: the page a plain Claude reads. A decision made here
    // must reach it without anyone re-running the export.
    mkdirSync(KNOWLEDGE, { recursive: true });
    writeFileSync(join(KNOWLEDGE, "architecture.md"), "stale: written before any decision\n");
    try {
      await openMap(page);
      await expect(page.locator("[data-arch-group]")).toHaveCount(0);
      await page.locator('[data-arch-lens="trust"]').click();
      await expect(page.locator(".react-flow__edge")).toHaveCount(0);

      // Propose — one stub spawn; the model's reply is grounded server-side.
      await page.locator("[data-arch-propose]").click();
      const bar = page.locator("[data-arch-proposal-bar]");
      // While the model drafts (the stub waits FAKE_ARCH_DELAY_MS): the
      // working card says so and counts, and the processes breathe.
      const card = page.locator('[data-arch-proposing-card="propose"]');
      await expect(card).toBeVisible();
      await expect(card).toContainText("Proposing groups");
      await expect(page.locator("[data-arch-proposing]")).toHaveCount(1);
      const breathing = await page.locator('[data-arch-proposing] [data-arch-node][data-arch-kind="cluster"]').first()
        .evaluate((el) => getComputedStyle(el).animationName);
      expect(breathing).toBe("vg-drafting-breathe-kf");
      await page.screenshot({ path: join(REVIEW_DIR, "proposing.png") });
      await expect(bar).toHaveAttribute("data-arch-proposal-state", "pending", { timeout: 30_000 });
      // ...and all of it goes the moment the proposal arrives.
      await expect(card).toHaveCount(0);
      await expect(page.locator("[data-arch-proposing]")).toHaveCount(0);
      await expect(bar.locator("[data-arch-proposal-summary]")).toContainText("3 groups · 1 names");
      await expect(bar.locator("[data-arch-proposal-summary]")).toContainText("refused");
      await expect(page.locator('[data-arch-group="g-public"]')).toHaveAttribute("data-arch-group-source", "proposed");
      await expect(page.locator('[data-arch-group="g-volt"]')).toHaveAttribute("data-arch-group-inferred", "true");
      await expect(page.locator('[data-arch-group="g-invented"]')).toHaveCount(0);
      await expect(page.locator('[data-arch-id="cluster:scripts:."] [data-arch-label]')).toHaveText("Volt host scripts");
      await expect(page.locator('[data-arch-id="cluster:scripts:."] [data-arch-chip="named · proposed"]')).toBeVisible();

      // Trust: only the edges that cross a boundary. web → scripts leaves the
      // public network for the Volt host; web → mcp stays inside it.
      await expect(page.locator(`.react-flow__edge[data-id="${CMD_EDGE}"]`)).toHaveCount(1);
      await expect(page.locator('.react-flow__edge[data-id="cluster:web:.->cluster:mcp:.:tool:MCP"]')).toHaveCount(0);
      await expect(page.locator('.react-flow__edge[data-id="cluster:web:.->tool:pg:uses:SQL"]')).toHaveCount(1);
      await page.screenshot({ path: join(REVIEW_DIR, "proposal.png") });

      // A box's inspector shows the evidence that survived grounding.
      await page.locator('[data-arch-group="g-private"] [data-arch-group-label]').click();
      const insp = page.locator('[data-arch-inspector-group="g-private"]');
      await expect(insp.locator("[data-arch-group-evidence]")).toContainText("docker-compose.yml:13");
      await expect(insp.locator("[data-arch-group-evidence]")).not.toContainText("k8s/db.yaml");
      await insp.locator("[data-arch-inspector-close]").click();

      // Modify — the person's words go back to the model; the same grounding
      // applies, and the revision is visibly a revision (the stub marks it).
      await bar.locator("[data-arch-modify]").click();
      await bar.locator("[data-arch-modify-input]").fill("call the public side the operator network");
      await bar.locator("[data-arch-modify-send]").click();
      await expect(page.locator('[data-arch-proposing-card="revise"]')).toContainText("Revising the proposal");
      await expect(page.locator('[data-arch-group="g-public"] [data-arch-group-label]')).toHaveText("public network (revised)", { timeout: 30_000 });
      await expect(bar).toHaveAttribute("data-arch-proposal-state", "pending");

      // Ratify — the human's act; the file now holds them as stated.
      await bar.locator("[data-arch-ratify]").click();
      await expect(page.locator('[data-arch-group="g-public"]')).toHaveAttribute("data-arch-group-source", "stated", { timeout: 15_000 });
      await expect(bar).toHaveAttribute("data-arch-proposal-state", "none");
      const stored = JSON.parse(readFileSync(STORE, "utf-8"));
      assert(stored.proposal === undefined, "ratify clears the pending proposal");
      const page_md = readFileSync(join(KNOWLEDGE, "architecture.md"), "utf-8");
      assert(page_md.includes("**public network (revised)** (network) — **stated**"), "the exported page follows the ratification");
      assert(!existsSync(join(KNOWLEDGE, "architecture.vibegraph.json")), "a refresh rewrites what was exported, never adds to it");
      assert(stored.names["cluster:scripts:."] === "Volt host scripts");
      assert(/INFERRED/.test(stored.groups.find((g: { id: string }) => g.id === "g-volt").note));
      await expect(page.locator('[data-arch-legend] [data-arch-primary-path="stated"]')).toContainText("app/dashboard/page.tsx:DashboardPage");
      await page.screenshot({ path: join(REVIEW_DIR, "ratified.png") });

      // The stated start-here path plays as a story: the owning cluster, then
      // each edge that entry point's thread takes, with the fact behind it.
      await page.locator('[data-arch-lens="overview"]').click();
      await page.locator("[data-arch-story]").click();
      const story = page.locator('[data-arch-trace="story"]');
      await expect(story.locator("[data-arch-story-title]")).toContainText("Start: app/dashboard/page.tsx:DashboardPage");
      await story.locator("[data-arch-story-next]").click();
      await expect(story.locator("[data-arch-story-title]")).toContainText("Next.js app →");
      await expect(story.locator("[data-arch-story-caption]")).toContainText("—");
      await page.screenshot({ path: join(REVIEW_DIR, "story.png") });
      await story.locator("[data-arch-trace-clear]").click();
      await page.locator('[data-arch-lens="trust"]').click();

      // Propose again, then reject: the proposal goes, the stated half stays.
      await page.locator("[data-arch-propose]").click();
      await expect(bar).toHaveAttribute("data-arch-proposal-state", "pending", { timeout: 30_000 });
      await bar.locator("[data-arch-reject]").click();
      await expect(bar).toHaveAttribute("data-arch-proposal-state", "none", { timeout: 15_000 });
      await expect(page.locator('[data-arch-group][data-arch-group-source="proposed"]')).toHaveCount(0);
      await expect(page.locator('[data-arch-group][data-arch-group-source="stated"]')).toHaveCount(3);
    } finally {
      clearStore();
    }
  });
  test("M-ARCH.5 — the self-contained architecture.html: lenses, find, a box's inspector, no network, no page errors", async ({ page }) => {
    test.setTimeout(120_000);
    const tmp = mkdtempSync(join(tmpdir(), "vg-arch-html-"));
    try {
      const root = join(tmp, "nd");
      cpSync(join(process.cwd(), FIXTURE), root, { recursive: true });
      rmSync(join(root, ".vibegraph", "architecture.json"), { force: true });
      // A stated start-here path, so the story has something to play.
      writeFileSync(join(root, ".vibegraph", "architecture.json"), JSON.stringify({ version: "1", groups: [], names: {}, primaryPath: ["app/dashboard/page.tsx:DashboardPage"] }));
      execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(process.cwd(), "scripts/cli/main.mjs"), "architecture", root], { encoding: "utf-8" });
      const file = join(root, ".vibegraph", "architecture-map", "architecture.html");
      const errors: string[] = [];
      const requests: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => { if (!r.url().startsWith("file:")) requests.push(r.url()); });
      await page.goto("file://" + file);
      await expect(page.locator('#map .n[data-id="cluster:web:."]')).toBeVisible();
      await expect(page.locator(`#map .e[data-id="${CMD_EDGE}"]`)).toContainText("Volt · WebSocket · command");
      await page.screenshot({ path: join(REVIEW_DIR, "artifact.png") });

      await page.locator('[data-lens="flows"]').click();
      await expect(page.locator('#map .n[data-id="tool:pg"]')).toHaveCount(0);
      await page.locator('[data-lens="payloads"]').click();
      await expect(page.locator('#map .e[data-id="cluster:web:.->cluster:mcp:.:tool:MCP"]')).toContainText("{ name, arguments, arguments.region }");
      await page.locator('[data-lens="trust"]').click();
      await expect(page.locator("#empty")).toBeVisible();
      await page.locator('[data-lens="overview"]').click();

      // Routed, and readable at first paint, in the file too.
      expect(await edgesThroughCards(page, "#map .e path", "#map .n")).toEqual([]);
      const hs = await page.locator("#map .n text:not(.sub):not(.chip)").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(Math.min(...hs)).toBeGreaterThanOrEqual(11);
      await expect(page.locator("#hidden")).toContainText("1 unclassified tool not drawn here (Tools lens): clsx");

      await page.locator("#find").fill("pg");
      await expect(page.locator('#map .n[data-id="tools:database"]')).toHaveClass(/hit/);
      await expect(page.locator('#map .n[data-id="cluster:mcp:."]')).toHaveClass(/dim/);
      await page.locator("#find").fill("");

      await page.locator(`#map .e[data-id="${CMD_EDGE}"]`).dispatchEvent("click");
      await expect(page.locator("#panel")).toContainText("why: the source thread calls @tdxvolt/volt-client-web");
      await expect(page.locator("#panel")).toContainText("argv: REGION");
      await page.keyboard.press("Escape");

      // Keyboard: a box takes focus and Enter opens it.
      await page.locator('#map .n[data-id="cluster:scripts:."]').focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#panel h2")).toHaveText("Scripts");
      // Reach and route.
      await page.locator('#panel [data-act="down"]').click();
      await expect(page.locator("#trace")).toContainText("Downstream of Scripts");
      await expect(page.locator('#map .n[data-id="cluster:web:."]')).toHaveClass(/dim/);
      await page.keyboard.press("Escape");
      await page.locator('#map .n[data-id="cluster:web:."]').dispatchEvent("click");
      await page.locator('#panel [data-act="route"]').click();
      await page.locator('#map .n[data-id="tools:database"]').dispatchEvent("click");
      await expect(page.locator("#trace")).toContainText("Route Next.js app → database · 2: 1 hop");
      await page.keyboard.press("Escape");
      // The story.
      await page.locator("#story").click();
      await expect(page.locator("#trace [data-story-title]")).toContainText("Start: app/dashboard/page.tsx:DashboardPage");
      await page.locator("#snext").click();
      await expect(page.locator("#trace [data-story-title]")).toContainText("Next.js app →");
      expect(errors, errors.join("\n")).toEqual([]);
      expect(requests, requests.join("\n")).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
