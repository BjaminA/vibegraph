// Navigation hops + the Journeys lens (2026-09-29, TODO "Navigation hops").
// `<Link href>`, `router.push` and `redirect` LITERALS in a page's thread are
// joined to the page that serves the path (src/server/crossings.ts), kept
// apart from the execution hops, rendered in flows.md, and drawn by the
// GUI-only Journeys lens (src/webview/system/arch_journeys.ts).
//
//   npm run test:journeys
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildCrossingIndex, navPath } from "../src/server/crossings.ts";
import { journeysModel } from "../src/webview/system/arch_journeys.ts";
import { exportKnowledge } from "../scripts/export_knowledge.mjs";

const ROOT = "test/fixtures/journeys/journeys_demo";
const env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
const idx = buildCrossingIndex(env);
const nav = idx.navigation ?? [];
const hop = (from, path) => nav.find((h) => h.entryPointId === from && h.path === path);
const HOME = "app/page.tsx:HomePage", ORDERS = "app/orders/page.tsx:OrdersPage";
const ORDER = "app/orders/[id]/page.tsx:OrderPage", NEW = "app/orders/new/page.tsx:NewOrderPage", LOGIN = "app/login/page.tsx:LoginPage";

const out = mkdtempSync(join(tmpdir(), "vg-journeys-"));
after(() => rmSync(out, { recursive: true, force: true }));

test("only a literal app path is a navigation", () => {
  assert.equal(navPath('"/orders"'), "/orders");
  assert.equal(navPath('{"/orders"}'), "/orders");
  assert.equal(navPath("{`/orders/${id}`}"), "/orders/*");
  assert.equal(navPath('"/orders?page=2#top"'), "/orders");
  assert.equal(navPath("next"), null, "a variable is computed");
  assert.equal(navPath("{url}"), null);
  assert.equal(navPath('"https://example.invalid/help"'), null, "leaves the app");
  assert.equal(navPath('"//cdn.example/x"'), null);
  assert.equal(navPath('"#top"'), null);
});

test("links, pushes and redirects join to the page that serves the path", () => {
  assert.deepEqual(hop(HOME, "/orders")?.targets.map((t) => t.entryPointId), [ORDERS]);
  assert.equal(hop(HOME, "/orders")?.callee, "<Link>");
  assert.deepEqual(hop(HOME, "/login")?.targets.map((t) => t.entryPointId), [LOGIN], "a rendered component's link is on the page's thread");
  assert.deepEqual(hop(ORDERS, "/orders/new")?.targets.map((t) => t.entryPointId), [NEW], "static outranks dynamic");
  assert.match(hop(ORDERS, "/orders/new").note, /\/orders\/:id also fits the shape; a static segment outranks a dynamic one/);
  assert.deepEqual(hop(HOME, "/orders/*")?.targets.map((t) => t.entryPointId), [ORDER], "an interpolated value is the dynamic page's");
  assert.equal(hop(ORDER, "/login")?.callee, "redirect");
  assert.equal(hop(ORDERS, "/archive")?.confidence, "unmatched");
  assert.ok(nav.every((h) => h.kind === "navigation" && h.method === null));
});

test("computed targets, external URLs and self-links are not hops", () => {
  assert.equal(nav.filter((h) => h.entryPointId === ORDERS).length, 2, "push /orders/new + link /archive; not router.push(next), not the self-link");
  assert.ok(!nav.some((h) => /example\.invalid|help/.test(h.path)));
  assert.equal(nav.length, 6);
});

test("navigation is kept apart from the execution hops", () => {
  assert.equal(idx.all.length, 0);
  assert.deepEqual(idx.byThread, {});
});

test("the Journeys lens draws pages and the links between them", () => {
  const m = journeysModel(env.entryPoints, idx);
  assert.equal(m.nodes.length, 5);
  const edge = (a, b) => m.edges.find((e) => e.from === `page:${a}` && e.to === `page:${b}`);
  assert.deepEqual(edge(HOME, ORDERS)?.details, ["link"]);
  assert.deepEqual(edge(ORDERS, NEW)?.details, ["router"]);
  assert.deepEqual(edge(ORDER, LOGIN)?.details, ["redirect"]);
  assert.equal(m.edges.length, 5);
  const orders = m.nodes.find((n) => n.id === `page:${ORDERS}`);
  assert.match(orders.sublabel, /1 link to no page/);
  assert.equal(m.unplaced.unmatchedHops, 1);
});

test("flows.md lists the navigation, apart from the hops", () => {
  exportKnowledge({ root: ROOT, out, commit: "test" });
  const flows = readFileSync(join(out, "flows.md"), "utf-8");
  assert.match(flows, /## Navigation — a page sends the user to a page/);
  assert.match(flows, /- `app\/page\.tsx:HomePage` → <Link> `\/orders` → `app\/orders\/page\.tsx:OrdersPage`/);
  assert.match(flows, /`\/archive` → \*\*unmatched\*\*/);
  assert.doesNotMatch(flows, /## Reverse index/, "a link does not run its target");
});
