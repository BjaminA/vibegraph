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
 * So in pure source order each callee sits ABOVE its caller. Flow-ordering
 * pulls each callee down to just below its caller — the y-order FLIPS, which
 * is what this test pins.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = process.env.VG_FIXTURE ?? "";
test.skip(!FIXTURE.includes("big_demo"), "Requires VG_FIXTURE=test/fixtures/threads/big_demo");

const LOGIN_URL = "module/login_url.fn";
const MAKE_NEXT = "module/make_next_param.fn";
const EXPAND = "module/expand_login_view.fn";
const LOGIN_REMEMBERED = "module/login_remembered.fn";
const DECODE = "module/decode_cookie.fn";

async function flowY(page: import("@playwright/test").Page, id: string) {
  return page.evaluate((id) => {
    const vp = document.querySelector(".react-flow__viewport") as HTMLElement | null;
    const m = (vp?.style.transform ?? "").match(/scale\(([-\d.]+)\)/);
    const z = m ? parseFloat(m[1]) : 1;
    const el = document.querySelector(`.react-flow__node[data-id="${id}"]`);
    if (!el) return null;
    return el.getBoundingClientRect().top / z;
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

  test("callees are pulled below their caller (source order flips)", async ({ page }) => {
    const loginUrl = (await flowY(page, LOGIN_URL))!;
    const makeNext = (await flowY(page, MAKE_NEXT))!;
    const expand = (await flowY(page, EXPAND))!;
    for (const v of [loginUrl, makeNext, expand]) expect(v).not.toBeNull();
    // Both callees were defined ABOVE login_url in source; flow-ordering puts
    // them BELOW it (adjacent), so the caller now leads its callees.
    expect(loginUrl).toBeLessThan(makeNext);
    expect(loginUrl).toBeLessThan(expand);
  });

  test("a callee defined far earlier is relocated under its caller", async ({ page }) => {
    const remembered = (await flowY(page, LOGIN_REMEMBERED))!;
    const decode = (await flowY(page, DECODE))!;
    expect(remembered).not.toBeNull();
    expect(decode).not.toBeNull();
    // decode_cookie (L43) is the 2nd definition in source — without flow
    // ordering it sits near the top, far above login_remembered (L142).
    // Flow-ordering relocates it to just below its caller.
    expect(remembered).toBeLessThan(decode);
  });
});
