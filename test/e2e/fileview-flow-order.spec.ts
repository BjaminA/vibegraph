/**
 * M-FV.6 (W2b) — flow-aware ordering of the definitions band.
 *
 * Within the definitions band, a definition is now followed by the
 * definitions it calls, so a caller and its callees sit adjacent and the
 * column reads as a call flow (rather than raw source order).
 *
 * Boot with VG_FIXTURE=test/fixtures/threads/big_demo. utils.py defines its
 * helpers BEFORE their callers (Python convention):
 *   L43  decode_cookie        (callee of login_remembered)
 *   L66  make_next_param      (callee of login_url)
 *   L86  expand_login_view    (callee of login_url)
 *   L100 login_url            → make_next_param, expand_login_view
 *   L142 login_remembered     → decode_cookie
 * So in pure source order each callee sits ABOVE its caller.
 *
 * 2026-09-24 — the definitions region reads LEFT TO RIGHT (defs_layout.ts:
 * Ben asked for the file view to use its width). The flow is now a
 * direction, not an order in one column: a callee sits RIGHT of its caller,
 * level with it (so the flow line between them is short and flat). These
 * tests pinned "below the caller" while the band was one column.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("big_demo"), "Requires VG_FIXTURE=test/fixtures/threads/big_demo");

const LOGIN_URL = "module/login_url.fn";
const MAKE_NEXT = "module/make_next_param.fn";
const EXPAND = "module/expand_login_view.fn";
const LOGIN_REMEMBERED = "module/login_remembered.fn";
const DECODE = "module/decode_cookie.fn";

async function flowPos(page: import("@playwright/test").Page, id: string) {
  return page.evaluate((id) => {
    const vp = document.querySelector(".react-flow__viewport") as HTMLElement | null;
    const m = (vp?.style.transform ?? "").match(/scale\(([-\d.]+)\)/);
    const z = m ? parseFloat(m[1]) : 1;
    const el = document.querySelector(`.react-flow__node[data-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left / z, y: r.top / z, right: r.right / z };
  }, id);
}

test.describe("file view — flow-aware definition order (W2b)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.waitForSelector("[data-thread-index],.react-flow__node", { timeout: 15_000 });
    await page.click('[data-side-panel-tab="files"]');
    await page.click('[data-file-tree-row="utils.py"]');
    await page.waitForSelector(`.react-flow__node[data-id="${LOGIN_URL}"]`, { timeout: 15_000 });
  });

  test("callees sit right of their caller (the flow reads left to right)", async ({ page }) => {
    const loginUrl = (await flowPos(page, LOGIN_URL))!;
    const makeNext = (await flowPos(page, MAKE_NEXT))!;
    const expand = (await flowPos(page, EXPAND))!;
    for (const v of [loginUrl, makeNext, expand]) expect(v).not.toBeNull();
    // Both callees were defined ABOVE login_url in source; the flow puts
    // them to its RIGHT, so the caller leads its callees.
    expect(makeNext.x).toBeGreaterThan(loginUrl.right);
    expect(expand.x).toBeGreaterThan(loginUrl.right);
    // The first callee is level with its caller (a flat, short flow line);
    // the second stacks below it in the callee column.
    expect(Math.abs(makeNext.y - loginUrl.y)).toBeLessThan(2);
    expect(expand.y).toBeGreaterThan(makeNext.y);
  });

  test("a callee defined far earlier is relocated beside its caller", async ({ page }) => {
    const remembered = (await flowPos(page, LOGIN_REMEMBERED))!;
    const decode = (await flowPos(page, DECODE))!;
    expect(remembered).not.toBeNull();
    expect(decode).not.toBeNull();
    // decode_cookie (L43) is the 2nd definition in source — in source order
    // it sits near the top, far from login_remembered (L142). The flow puts
    // it right beside its caller, level with it.
    expect(decode.x).toBeGreaterThan(remembered.right);
    expect(Math.abs(decode.y - remembered.y)).toBeLessThan(2);
  });
});
