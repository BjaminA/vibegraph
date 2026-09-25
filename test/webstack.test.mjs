// M-CMD.1 — everything an internal field review found, pinned against
// test/fixtures/webstack/next_demo, which carries one instance of each shape.
//
// VERIFIED RED: run this file against the pre-M-CMD.1 tree (git worktree at
// the parent commit) and the first six tests fail — that is the whole reason
// to believe it, and it is how test:ir-fidelity earned its keep.
//
//   npm run test:webstack
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { exportKnowledge } from "../scripts/export_knowledge.mjs";
import { languageForShebang } from "../src/shared/languages.ts";
import { isSourceFile, isDeclarationFile, languageForFile } from "../src/server/languages.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(ROOT, "test/fixtures/webstack/next_demo");

let built, env, stack, out, readme;
before(() => {
  built = buildPolyglotEnvelope(FIXTURE);
  env = built.envelope;
  stack = buildStackIndex(env, FIXTURE);
  out = mkdtempSync(join(tmpdir(), "vg-webstack-"));
  exportKnowledge({ root: FIXTURE, out, commit: "test", withIr: true });
  readme = readFileSync(join(out, "README.md"), "utf-8");
});

test("compiled output and type declarations are not source, and the skip is REPORTED", () => {
  const files = Object.keys(env.files);
  assert.ok(!files.some((f) => f.startsWith("build/")), `build/ must not be parsed: ${files.filter((f) => f.startsWith("build/"))}`);
  assert.ok(!files.some((f) => f.endsWith(".d.ts")), "a .d.ts is types with no call bodies");
  assert.equal(isDeclarationFile("ingest.d.ts"), true);
  assert.equal(isSourceFile("ingest.d.ts"), false);
  // Silence is the bug: a project keeping real source in build/ must see it.
  assert.equal(built.skippedDirs["build"], 2, "the skip is counted, not silent");
  assert.match(readme, /\*\*Not read:\*\* `build\/` \(2 file\(s\)\)/);
  assert.match(readme, /If any of that is real source, it is missing/);
});

test(".mjs is registered and .js is still deliberately not", () => {
  assert.ok("scripts/ingest.mjs" in env.files, "the backend work lives in files like this one");
  assert.equal(env.files["scripts/ingest.mjs"].language, "jsts");
  // The M19 text-scan deferral is about BROWSER-SERVED files and still stands.
  assert.equal(isSourceFile("api.js"), false, ".js keeps its recorded deferral");
  assert.equal(isSourceFile("api.jsx"), false, ".jsx is the collision fixture's own shape");
  assert.equal(isSourceFile("worker.mjs"), true);
  assert.equal(isSourceFile("legacy.cjs"), true);
});

test("an extensionless #! executable is found, and an unclaimed interpreter is not guessed at", () => {
  assert.ok("bin/orders-cli" in env.files, "the only command a caller may run had no extension");
  assert.equal(env.files["bin/orders-cli"].language, "bash");
  assert.equal(languageForShebang("#!/bin/bash")?.id, "bash");
  assert.equal(languageForShebang("#!/usr/bin/env python3")?.id, "python");
  assert.equal(languageForShebang("#!/usr/bin/env -S node --flag")?.id, "jsts");
  assert.equal(languageForShebang("#!/usr/bin/env ruby"), null, "no registered language claims ruby");
  assert.equal(languageForShebang("not a shebang"), null);
  // A file WITH an extension is never sniffed: the extension already decided.
  assert.equal(languageForFile("notes.txt", join(FIXTURE, "package.json")), null);
});

test("a partial parse says so IN its own IR, and the export names the file", () => {
  const ir = env.files["lib/degraded.ts"];
  assert.ok(ir, "a file the parser cannot finish still yields what it could read");
  assert.equal(ir.degraded.dropped, 1);
  assert.match(ir.degraded.note, /INCOMPLETE/);
  assert.match(ir.degraded.note, /may still exist in the source/);
  for (const [f, other] of Object.entries(env.files)) {
    if (f !== "lib/degraded.ts") assert.equal(other.degraded, undefined, `${f} parsed whole and says nothing`);
  }
  assert.match(readme, /\*\*Partially read:\*\* `lib\/degraded\.ts` \(1 construct\(s\) dropped\)/);
});

test("a tsconfig `paths` alias is the project's OWN code, not a third-party dependency", () => {
  const toolNames = (stack.tools ?? []).map((t) => t.tool);
  for (const alias of ["@/lib", "@/components", "@/app"]) {
    assert.ok(!toolNames.includes(alias), `${alias} is this project's own directory, never a dependency`);
  }
  // M-CMD.3 — and so is an alias the parser could NOT resolve (a CSS
  // module): `@/` is a path alias by construction, npm forbids the scope.
  assert.ok(!toolNames.includes("@/styles"), "an unresolved alias is a resolution gap, not a third-party tool");
  // A shell function the project defines is project code wherever it is
  // called, even when the file defining it was sourced through a variable.
  assert.ok("scripts/lib/log.sh" in env.files);
  assert.ok(!toolNames.includes("log_step"), "a function this project defines is never a dependency");
  // And the import RESOLVES, so the call chain crosses the alias.
  const route = env.files["app/api/orders/route.ts"];
  const imp = (route.nodes ?? []).find((n) => n.module === "@/lib/db");
  assert.equal(imp.aliasTarget, "lib/db.ts", "the PARSER resolved and probed it (M-RUST's ruling)");
  const refs = (route.edges ?? []).filter((e) => e.type === "reference" && e.targetFile === "lib/db.ts");
  assert.ok(refs.length >= 1, "the linker read that one fact rather than re-deriving it");
});

test("the funnel rule keeps every roled boundary, drops the noise, and takes a STATED role for a tool no table knows", () => {
  const funnels = (stack.tools ?? []).filter((t) => t.wraps);
  const byName = Object.fromEntries(funnels.map((f) => [f.tool, f]));
  assert.ok(byName["lib.db"], "a module wrapping a roled tool (pg) IS the path out");

  // `frontend` is not wrappable: importing react is not funnelling react.
  // Censused first — 14 funnels across every polyglot fixture, none of that
  // role — then confirmed on a real codebase, where it was 58 of 100.
  assert.ok(!funnels.some((f) => f.role === "frontend"),
    `a component wrapping react is not a funnel: ${funnels.filter((f) => f.role === "frontend").map((f) => f.tool)}`);
  assert.ok(!byName["components.OrdersChart"]);

  // `unknown` is not wrappable. Widening the set to catch an unclassified
  // transport was argued for and shipped, then measured on the codebase it
  // was argued from: 210 funnels whose commonest wraps were clsx,
  // lucide-react and zod, and NOT ONE of the three cases it existed for.
  // Badge wraps clsx, which no table and no person has classified: out.
  assert.ok(!byName["components.Badge"], "an unclassified utility does not make its importer a funnel");
  assert.ok(!funnels.some((f) => f.role === "unknown"),
    `unclassified wraps stay out: ${funnels.filter((f) => f.role === "unknown").map((f) => f.tool)}`);
  assert.equal((stack.tools ?? []).find((t) => t.tool === "clsx").role, "unknown", "named, never guessed");

  // M-CMD.2 — the CLASS the taxonomy predated: a hosted-model client and an
  // agent-protocol SDK now have roles, so their wrappers are the path out.
  assert.equal(byName["lib.llm"]?.role, "model-api");
  assert.deepEqual(byName["lib.llm"].wraps, ["openai"]);
  assert.equal(byName["mcp.server"]?.role, "agent-protocol");
  assert.equal(byName["mcp.client"]?.role, "agent-protocol");
  assert.deepEqual(byName["mcp.client"].wraps, ["@modelcontextprotocol/sdk"], "a subpath import keys on the package");

  // M-CMD.2 — and a tool NO public table can know is classified by the person
  // who runs it: the fixture's constraints.json states @acme/ledger-client as
  // `platform` (c1, rule `describe`). The record carries the provenance, the
  // funnel forms, and it does not invent an origin.
  const ledger = (stack.tools ?? []).find((t) => t.tool === "@acme/ledger-client");
  assert.equal(ledger.role, "platform");
  assert.equal(ledger.roleSource, "stated");
  assert.equal(ledger.roleStatedBy, "c1");
  assert.equal(ledger.roleStatedSource, "human");
  assert.equal(ledger.origin, "third-party");
  assert.equal(byName["lib.ledger"]?.role, "platform");
  assert.deepEqual(byName["lib.ledger"].wraps, ["@acme/ledger-client"]);
  // M-CMD.3 — the TDX Volt client the previous fixture had to STATE is now a
  // table fact (`@tdxvolt` scope family → platform), so the funnel forms
  // with no policy at all and the record carries no stated provenance.
  const volt = (stack.tools ?? []).find((t) => t.tool === "@tdxvolt/volt-client-web");
  assert.equal(volt.role, "platform");
  assert.equal(volt.roleSource, undefined);
  assert.equal(byName["lib.volt"]?.role, "platform");
  assert.deepEqual(byName["lib.volt"].wraps, ["@tdxvolt/volt-client-web"]);
});

test("Next.js App Router entry points, with the URL the file actually serves", () => {
  const routes = Object.fromEntries(env.entryPoints.filter((e) => e.framework === "next").map((e) => [e.id, e]));
  const label = (id) => routes[id]?.label;
  assert.equal(label("app/api/orders/route.ts:GET"), "GET /api/orders");
  assert.equal(label("app/api/orders/route.ts:POST"), "POST /api/orders");
  assert.equal(label("app/dashboard/page.tsx:DashboardPage"), "PAGE /dashboard");
  // A route GROUP organises files and is not a URL segment.
  assert.equal(label("app/(marketing)/about/page.tsx:AboutPage"), "PAGE /about");
  // A DYNAMIC segment is a parameter, not a literal.
  assert.equal(label("app/api/orders/[id]/route.ts:GET"), "GET /api/orders/:id");
  assert.equal(routes["app/api/orders/[id]/route.ts:GET"].metadata.route, "/api/orders/:id");
  // EXPORTED is the contract: a local helper named like a verb is not a handler.
  assert.equal(routes["app/api/orders/[id]/route.ts:POST"], undefined);
  const helper = (env.files["app/api/orders/[id]/route.ts"].nodes ?? []).find((n) => n.name === "POST");
  assert.equal(helper.isExported, undefined, "and the IR is why the rule can tell");
  const get = (env.files["app/api/orders/route.ts"].nodes ?? []).find((n) => n.name === "GET");
  assert.equal(get.isExported, true);
  assert.equal((env.files["app/dashboard/page.tsx"].nodes ?? []).find((n) => n.name === "DashboardPage").isDefaultExport, true);
});

test("manual seeds work in EVERY language, and one that does not resolve is reported, not dropped", () => {
  const manual = env.entryPoints.filter((e) => e.kind === "manual");
  const ids = manual.map((e) => e.id).sort();
  assert.deepEqual(ids, ["bin/orders-cli:dispatch", "scripts/ingest.mjs:ingest"],
    "bash and js — the Python-only path could seed neither");
  assert.ok(env.threads.some((t) => t.entryPointId === "bin/orders-cli:dispatch"), "and a thread is built for it");
  // A human typed it, so its absence is a finding.
  assert.equal(built.unresolvedSeeds.length, 1);
  assert.equal(built.unresolvedSeeds[0].seed, "lib/nope.ts:module/gone.fn");
  assert.match(built.unresolvedSeeds[0].reason, /no such file in the parsed project/);
  assert.match(readme, /\*\*Named but not found:\*\* `lib\/nope\.ts:module\/gone\.fn`/);
});

test("the system spec written to a FILE is whole, and points at something the reader has", () => {
  const spec = readFileSync(join(out, "system_spec.md"), "utf-8");
  assert.ok(!spec.includes("spec truncated"), "a prompt budget is not a file budget");
  assert.ok(!spec.includes("vibegraph_stack"), "a plain reader has no MCP tools");
  assert.match(spec, /lib\.db \(project funnel wrapping pg/);
  // M-CMD.2 — the new roles have their own sections, in the architecture order.
  assert.match(spec, /model API \(LLM \/ embedding \/ vision service\): lib\.llm \(project funnel wrapping openai/);
  assert.match(spec, /agent protocol \(MCP\): mcp\.client \(project funnel wrapping @modelcontextprotocol\/sdk/);
  // A stated role renders under its role WITH its provenance, beside the fact;
  // a table role (the Volt client, M-CMD.3) renders under the same role with none.
  assert.match(spec, /platform SDK[^\n]*: [^\n]*lib\.ledger \(project funnel wrapping @acme\/ledger-client/);
  assert.match(spec, /platform SDK[^\n]*: [^\n]*lib\.volt \(project funnel wrapping @tdxvolt\/volt-client-web/);
  assert.match(spec, /@acme\/ledger-client \([^)]*role stated by c1/);
  assert.ok(!/@tdxvolt\/volt-client-web \([^)]*role stated/.test(spec), "a table fact carries no stated provenance");
  // M-CMD.3 — the DEFINITION rides the spec: what the boundary IS, not just its bucket.
  assert.match(spec, /Definitions \(from the taxonomy's notes/);
  assert.match(spec, /- @tdxvolt\/volt-client-web: TDX Volt browser client/);
  // What no table and no person classified is still a FACT, under its own heading.
  assert.match(spec, /unclassified \(no taxonomy entry — named, never guessed\): clsx/);
  assert.ok(!/unclassified[^\n]*@tdxvolt/.test(spec), "the table-known tool left the unclassified list");
  assert.ok(!/unclassified[^\n]*@acme/.test(spec), "the stated tool left the unclassified list");
  // The boundary in a thread contract says the same thing the spec does.
  const orders = readFileSync(join(out, "threads", "app_api_orders_route.ts_GET.md"), "utf-8");
  assert.match(orders, /openai/, "the GET thread reaches the model client through lib/llm");
  const post = readFileSync(join(out, "threads", "app_api_orders_route.ts_POST.md"), "utf-8");
  assert.match(post, /@acme\/ledger-client \[platform[^\]]*role stated by c1/, "the boundary carries the stated role and its provenance");
  assert.match(post, /@tdxvolt\/volt-client-web \[platform/, "and the table-known one carries its role with no provenance");
});

test("the whole recovery, end to end: what this fixture yielded before and after", () => {
  // Before M-CMD.1, measured on this same fixture: 8 files (one of them a
  // .d.ts, with ingest.mjs and orders-cli missing), 1 entry point, 1 thread,
  // 0 funnels, and no record of any of it.
  assert.equal(Object.keys(env.files).length, 23);
  // M-FLOW.1 — two more: bin/orders-cli seeded on its module (a script whose
  // body is its main) and scripts/backend/rollup.mjs seeded on the `main`
  // its shebang and top-level call make an entry. M-FLOW.2/3 — four more:
  // export_orders.sh (shebang, no main), rates.mjs and ingest.mjs (named by
  // another file's literal), and the MCP tool list_orders (test/flow.test.mjs).
  assert.equal(env.entryPoints.length, 15);
  assert.equal(env.threads.length, 15);
  assert.equal((stack.tools ?? []).filter((t) => t.wraps).length, 6, "db, model-api, two agent-protocol halves, the table-known platform client and the stated private one — no noise beside them");
  assert.equal(Object.keys(built.parseErrors).length, 1, "and the one genuinely broken file is still named");
});
