// Rung 1 of the run-time ladder (2026-10-08): WHICH inboxes exist is decided
// at run time, their SHAPE is not. On test/fixtures/declared/feed_ts — a
// registry method returns `inbox_${role}__${user}` names, a feed function is
// handed that array and watches each element's meta in a `.map` callback and
// reads each in a `for … of` — the watch and the read resolve to the declared
// family's zone, charged to the process that wires them, for zero tokens.
//
//   npm run test:shape-tracking
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { deriveDataArchitecture } from "../src/server/data_arch.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIX = join(ROOT, "test/fixtures/declared/feed_ts");
const derive = (root) => {
  const env = buildPolyglotEnvelope(root).envelope;
  return deriveDataArchitecture(env.files, buildStackIndex(env, root), env.threads);
};
const ops = (da) => da.operations.filter((o) => o.file === "src/feed.ts").map((o) => `${o.op} ${o.family} by ${o.entries.join(",")}`).sort();

test("a watch over a run-time list of names resolves to the declared family's zone", () => {
  const da = derive(FIX);
  assert.deepEqual(ops(da), ["read inbox by bin/decider.ts", "watch inbox by bin/decider.ts"], JSON.stringify(da.operations, null, 1));
  const w = da.operations.find((o) => o.file === "src/feed.ts" && o.op === "watch");
  assert.ok(w.via.some((v) => /^Registry\.inboxes \(src\/registry\.ts:\d+\)$/.test(v) || /inboxes \(src\/registry\.ts:\d+\)/.test(v)), `the name's route is kept: ${w.via}`);
});

test("callers that disagree make the feed a funnel: each call site's family is charged at that call, the funnel names none", () => {
  const tmp = mkdtempSync(join(tmpdir(), "vg-shape-"));
  after(() => rmSync(tmp, { recursive: true, force: true }));
  cpSync(FIX, tmp, { recursive: true });
  writeFileSync(join(tmp, "bin/audit.ts"), [
    "#!/usr/bin/env node",
    'import { Registry, type Client } from "../src/registry.ts";',
    'import { inboxFeed } from "../src/feed.ts";',
    "declare const client: Client;",
    'await inboxFeed(new Registry(client), ["status"]).readAll();',
    "",
  ].join("\n"));
  const da = derive(tmp);
  assert.deepEqual(ops(da), [], "one caller passes inboxes, another a literal list: the feed serves both, so it names neither");
  const at = da.operations.filter((o) => o.file.startsWith("bin/")).map((o) => `${o.file}:${o.line} ${o.op} ${o.family} by ${o.entries.join(",")}`).sort();
  // the audit's literal zone name is charged by the rule that already reads a
  // zone's literal passed to a function that operates on it
  assert.deepEqual(at, ["bin/audit.ts:5 watch status by bin/audit.ts", "bin/decider.ts:9 read inbox by bin/decider.ts", "bin/decider.ts:9 watch inbox by bin/decider.ts"],
    "each caller's own names: the decider's inboxes, the audit's literal status — charged where the feed is made");
});

test("a run-time name may be the ZONE's (one channel per zone), not a document path's", () => {
  const tmp = mkdtempSync(join(tmpdir(), "vg-shape-"));
  after(() => rmSync(tmp, { recursive: true, force: true }));
  cpSync(FIX, tmp, { recursive: true });
  writeFileSync(join(tmp, "src/catalogue.ts"), [
    "export const RESOURCES = [",
    '  { key: "/inbox/{Role}/{User}/{id}", owners: ["owner-of-inbox"], readers: ["decider"] },',
    '  { key: "/status/{id}", owners: ["decider"], readers: ["clerk"] },',
    "];",
    'export const ZONE_OF: Record<string, string> = { "/inbox/{Role}/{User}/{id}": "inbox_{Role}__{User}", "/status/{id}": "status" };',
    "",
  ].join("\n"));
  assert.deepEqual(ops(derive(tmp)), ["read inbox_{Role}__{User} by bin/decider.ts", "watch inbox_{Role}__{User} by bin/decider.ts"]);
});

test("a name routed through a project function that maps it (`idFor(name)`) keeps its zone; a joined list is not a collection", () => {
  const tmp = mkdtempSync(join(tmpdir(), "vg-shape-"));
  after(() => rmSync(tmp, { recursive: true, force: true }));
  cpSync(FIX, tmp, { recursive: true });
  writeFileSync(join(tmp, "src/ids.ts"), [
    'import { ZONE_OF } from "./catalogue.ts";',
    "/** The channel id of a resource name: looked up in the zone table. */",
    "export function channelIdFor(name: string): string {",
    "  for (const [pattern, zone] of Object.entries(ZONE_OF)) {",
    "    const holes: string[] = [];",
    "    if (name !== pattern) continue;",
    "    return [zone, ...holes.filter((h) => !zone.includes(`{${h}}`))].join(\"-\");",
    "  }",
    "  throw new Error(`no zone for ${name}`);",
    "}",
    "",
  ].join("\n"));
  writeFileSync(join(tmp, "bin/watcher.ts"), [
    "#!/usr/bin/env node",
    'import { Registry, type Client } from "../src/registry.ts";',
    'import { channelIdFor } from "../src/ids.ts";',
    "declare const client: Client;",
    "const registry = new Registry(client);",
    'const name = "status";',
    'await (await registry.meta(channelIdFor(name))).watch("__meta", "idx", () => {});',
    "",
  ].join("\n"));
  const at = derive(tmp).operations.filter((o) => o.file === "bin/watcher.ts").map((o) => `${o.op} ${o.family} via ${(o.via ?? []).join(" > ")}`);
  assert.deepEqual(at.map((s) => s.split(" via ")[0]), ["watch status"], JSON.stringify(at));
  assert.match(at[0], /channelIdFor \(src\/ids\.ts:3\)/, "the function the name passed through is kept");
});

test("a test's call is not a caller that disagrees", () => {
  const tmp = mkdtempSync(join(tmpdir(), "vg-shape-"));
  after(() => rmSync(tmp, { recursive: true, force: true }));
  cpSync(FIX, tmp, { recursive: true });
  mkdirSync(join(tmp, "test"), { recursive: true });
  writeFileSync(join(tmp, "test/feed.test.ts"),'import { inboxFeed } from "../src/feed.ts";\ninboxFeed({} as never, ["x"]);\n');
  assert.deepEqual(ops(derive(tmp)), ["read inbox by bin/decider.ts", "watch inbox by bin/decider.ts"]);
});
