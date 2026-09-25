// M-FLOW (PLAN-M-FLOW.md) — end-to-end flows: from what the user sees to
// the script that ingests. Pinned against test/fixtures/webstack/next_demo.
//
// M-FLOW.1: rendering is calling (a JSX component element is a call node the
// linker resolves, so a page's thread walks its component tree down to the
// boundary that fetches), and a script's body is its main (a shebang script
// with no `main` seeds on the MODULE; a shebang Node script with a top-level
// `main()` seeds on main; a person may name the module in manual_seeds).
//
// VERIFIED RED against the parent commit: the dashboard thread reached
// lib/db.ts and lib/ledger.ts and never components/OrdersChart.tsx;
// bin/orders-cli had no discovered entry; rollup.mjs had none.
//
//   npm run test:flow
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex, toolNameOf } from "../src/server/crossings.ts";
import { nodeScriptRefs, resolveScriptFiles, scriptSuffix } from "../scripts/frontends/script_refs.mjs";
import { discoverProject } from "../scripts/discover_project.mjs";
import { exportKnowledge } from "../scripts/export_knowledge.mjs";
import { readFileSync } from "node:fs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(ROOT, "test/fixtures/webstack/next_demo");

let env, stack, byId, crossings;
before(() => {
  env = buildPolyglotEnvelope(FIXTURE).envelope;
  stack = buildStackIndex(env, FIXTURE);
  byId = Object.fromEntries(env.entryPoints.map((e) => [e.id, e]));
  crossings = buildCrossingIndex(env);
});
const thread = (ep) => env.threads.find((t) => t.entryPointId === ep);

test("rendering is calling: a component element is a call node, an intrinsic element is not", () => {
  const page = env.files["app/dashboard/page.tsx"];
  const jsx = (page.nodes ?? []).filter((n) => n.jsx === true);
  assert.deepEqual(jsx.map((n) => [n.id, n.type, n.funcName, n.args]), [
    ["module/DashboardPage.fn/OrdersChart.call", "call", "OrdersChart", ["rows={rows}", "owed={owed}"]],
    ["module/DashboardPage.fn/ExportButton.call", "call", "ExportButton", ['region="all"']],
    ["module/DashboardPage.fn/Chart.call", "call", "Chart", ['region="all"']],
  ]);
  assert.equal(jsx[0].isEffect, false, "rendering derives no effect of its own");
  // The linker resolved it through the import binding, like any bare call.
  const ref = (page.edges ?? []).find((e) => e.type === "reference" && e.source === jsx[0].id);
  assert.equal(ref?.targetFile, "components/OrdersChart.tsx");
  // Nothing is minted for the DOM: every jsx call in the project names a component.
  for (const ir of Object.values(env.files)) {
    for (const n of ir.nodes ?? []) {
      if (n.jsx) assert.match(n.funcName.split(".").pop(), /^[A-Z]/, `${n.id} is a component tag`);
    }
  }
  const about = env.files["app/(marketing)/about/page.tsx"];
  assert.equal((about.nodes ?? []).filter((n) => n.jsx).length, 0, "a page of intrinsic elements mints no call");
});

test("a page's thread walks its component tree down to the boundary that fetches", () => {
  const t = thread("app/dashboard/page.tsx:DashboardPage");
  for (const f of ["app/dashboard/page.tsx", "components/OrdersChart.tsx", "components/Badge.tsx", "components/ExportButton.tsx", "components/RegionChart.tsx", "lib/volt.ts", "lib/ledger.ts", "lib/db.ts"]) {
    assert.ok(t.filesReached.includes(f), `${f} reached: ${t.filesReached}`);
  }
  assert.equal(t.filesReached.length, 8);
  const labels = t.nodes.map((n) => `${n.kind}:${n.label}`);
  assert.ok(labels.includes("step:OrdersChart") && labels.includes("step:Badge"), labels.join(" | "));
  assert.ok(labels.includes("step:refund") && labels.includes("external:client.command"),
    "the Volt boundary inside the component tree is on the PAGE's thread now");
  // And the stack index says the platform client is CALLED on this thread,
  // where before it was present in 12 files and on zero threads.
  const volt = stack.tools.find((x) => x.tool === "@tdxvolt/volt-client-web");
  assert.ok(volt.threads.includes("app/dashboard/page.tsx:DashboardPage"), volt.threads.join(", "));
});

test("a script's body is its main: a shebang script without `main` seeds on the module and walks what runs", () => {
  const ep = byId["bin/orders-cli:module"];
  assert.ok(ep, "discovered, not manually seeded");
  assert.equal(ep.kind, "cli");
  assert.equal(ep.framework, "shell");
  assert.equal(ep.irNodeId, "module");
  assert.deepEqual(ep.metadata, { seed: "module" });
  const t = thread("bin/orders-cli:module");
  const labels = t.nodes.map((n) => `${n.kind}:${n.label}`);
  assert.equal(labels[0], "seed:orders-cli");
  assert.ok(labels.includes("step:dispatch"), "the top-level `dispatch \"$@\"` steps into the function it calls");
  assert.ok(labels.includes("external:exec"), labels.join(" | "));
  // A definition is not executed by being defined: a sourced LIBRARY with
  // no top-level statement is not an entry, shebang or not.
  assert.equal(byId["scripts/lib/log.sh:module"], undefined);
  // A script WITH the main pattern keeps its richer entry and gets no second one.
  assert.ok(byId["scripts/run.sh:main"]);
  assert.equal(byId["scripts/run.sh:module"], undefined);
});

test("a shebang Node script seeds on its top-level main, with the interpreter as its framework", () => {
  const ep = byId["scripts/backend/rollup.mjs:main"];
  assert.ok(ep, Object.keys(byId).join(", "));
  assert.equal(ep.kind, "cli");
  assert.equal(ep.framework, "node");
  assert.equal(env.files["scripts/backend/rollup.mjs"].shebang, "#!/usr/bin/env node");
  const t = thread("scripts/backend/rollup.mjs:main");
  assert.ok(t.nodes.some((n) => n.kind === "external" && n.label === "pool.query"), "its boundary is on the thread");
  // A Node module with no shebang and no caller is not an entry (M-FLOW.2 names the invoked ones).
  assert.equal(byId["lib/db.ts:module"], undefined);
});

test("a person may seed the module of any file in manual_seeds.json", () => {
  const tmp = mkdtempSync(join(tmpdir(), "vg-flow-"));
  try {
    cpSync(FIXTURE, tmp, { recursive: true });
    writeFileSync(join(tmp, ".vibegraph", "manual_seeds.json"), JSON.stringify({
      seeds: [{ file: "scripts/lib/log.sh", irNodeId: "module" }],
    }));
    const built = buildPolyglotEnvelope(tmp);
    const ep = built.envelope.entryPoints.find((e) => e.id === "scripts/lib/log.sh:module");
    assert.equal(ep?.kind, "manual");
    assert.equal(ep.irNodeId, "module");
    assert.equal(built.unresolvedSeeds.length, 0);
    const t = built.envelope.threads.find((x) => x.entryPointId === "scripts/lib/log.sh:module");
    assert.ok(t, "a thread is built even for a file that only defines functions");
    assert.equal(t.nodes[0].label, "log.sh");
    assert.ok(!t.nodes.some((n) => n.label === "echo"), "the function body is DEFINED there, not executed: the module walk does not enter it");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── M-FLOW.2 / .3 ────────────────────────────────────────────────────────

test("a script reference is a path SUFFIX read from IR args, never from source", () => {
  assert.equal(scriptSuffix('accounts/get_accounts_financials.sh'), "accounts/get_accounts_financials.sh");
  assert.equal(scriptSuffix('${SCRIPT_DIR}/lib/log.sh'), "lib/log.sh", "a variable prefix is unknown; the tail is not");
  assert.equal(scriptSuffix('$(dirname "$0")/../scripts/run.sh'), "scripts/run.sh");
  assert.equal(scriptSuffix("./ingest.mjs"), "ingest.mjs");
  assert.equal(scriptSuffix("/opt/app/bin/ops-run"), "opt/app/bin/ops-run", "extensionless, multi-segment: matched as a suffix of a parsed path");
  assert.equal(scriptSuffix("N/A"), "N/A".includes("/") ? "N/A" : null, "a bare word with a slash is path-shaped; only a parsed file makes it a hop");
  assert.equal(scriptSuffix("see utils.py for"), null, "spaces: prose");
  assert.equal(scriptSuffix("https://api.exchangerate.host/latest"), null, "a URL is the http kind's business");
  assert.equal(scriptSuffix("/tmp/orders-${REGION}.csv"), null, "an unresolved interpolation in the tail is not a name");
  assert.equal(scriptSuffix("list_orders"), null, "a bare word is a command name or a key; the tables own those");
  assert.equal(scriptSuffix(".sh"), null, "a bare extension names nothing");
  assert.equal(scriptSuffix("duckduckgo.com/y.js"), null, "a host path is a URL's tail");
  // A caller may spell the path as DEPLOYED: the tail shared with a parsed file is the match.
  const keys = ["ops-scripts/src/bash-scripts/company/job_orchestrator.sh", "ops-scripts/src/bash-scripts/company/infoApi/search.sh", "a/index.mjs", "b/index.mjs"];
  assert.deepEqual(resolveScriptFiles(keys, "srv/app/src/bash-scripts/company/job_orchestrator.sh"), { files: [keys[0]], matched: "src/bash-scripts/company/job_orchestrator.sh" });
  assert.deepEqual(resolveScriptFiles(keys, "srv/app/get_names.sh"), { files: [], matched: "srv/app/get_names.sh" }, "nothing here holds that basename");
  assert.deepEqual(resolveScriptFiles(keys, "opt/other/search.sh").files, [keys[1]], "a unique basename, reached from a path");
  assert.equal(resolveScriptFiles(keys, "index.mjs").files.length, 2, "a bare basename two files carry is AMBIGUOUS: both named, neither claimed");
  assert.deepEqual(resolveScriptFiles(keys, "x/y/index.mjs").files, [], "two files carry the basename: no claim from a path either");
  // A bash word with NESTED quotes is read whole.
  const refs = nodeScriptRefs({ type: "call", funcName: "exec", args: ['"$(dirname "$0")/../scripts/run.sh"', '"$2"'] });
  assert.deepEqual(refs.map((r) => [r.suffix, r.scriptShaped]), [["scripts/run.sh", true]]);
  // An array literal's elements are read like a call's args.
  const arr = nodeScriptRefs({ type: "assignment", name: "args", args: ["ORCH", "id", '"accounts/x.sh"'], preview: "[ORCH, id, \"accounts/x.sh\"]" });
  assert.deepEqual(arr.map((r) => r.suffix), ["accounts/x.sh"]);
  // A data path is recorded as a candidate but not script-shaped: it makes a hop only when a parsed file answers to it.
  assert.deepEqual(nodeScriptRefs({ type: "call", funcName: "psql", args: ['"/tmp/orders.csv"'] }).map((r) => r.scriptShaped), [false]);
});

test("a `command` crossing joins the literal a thread hands over to the script's entry, both ways along the chain", () => {
  const dash = crossings.byThread["app/dashboard/page.tsx:DashboardPage"] ?? [];
  const cmd = dash.filter((c) => c.kind === "command");
  const exp = cmd.find((c) => c.path === "orders/export_orders.sh");
  assert.ok(exp, JSON.stringify(cmd.map((c) => c.path)));
  assert.equal(exp.callee, "client.command");
  assert.equal(exp.file, "lib/volt.ts", "the literal sits in the funnel the component tree reaches");
  assert.equal(exp.confidence, "path");
  assert.deepEqual(exp.targets, [{ entryPointId: "scripts/backend/orders/export_orders.sh:module", route: "scripts/backend/orders/export_orders.sh", method: "command", framework: "shell" }]);
  assert.match(exp.note, /attributed on the boundary node, not here/);
  // The script's own thread crosses again: bash → node, by the literal it hands `node`.
  const sh = crossings.byThread["scripts/backend/orders/export_orders.sh:module"] ?? [];
  const rates = sh.find((c) => c.kind === "command" && c.path.endsWith("lib/rates.mjs"));
  assert.ok(rates, JSON.stringify(sh));
  assert.equal(rates.callee, "node");
  assert.deepEqual(rates.targets.map((t) => t.entryPointId), ["scripts/backend/lib/rates.mjs:module"]);
  // A literal naming nothing this project parses is unmatched, and says why —
  // and it sits in a `??` composite at module level, the env-fallback idiom
  // whose preview cut it before M-FLOW.5.
  const night = dash.find((c) => c.kind === "command" && c.path === "orders/nightly_rollup.sh");
  assert.equal(night?.confidence, "unmatched");
  assert.equal(night.callee, "NIGHTLY_SCRIPT =");
  assert.match(night.note, /no parsed file's path ends with that literal/);
  assert.match(night.note, /module level of a file this thread reaches/);
  // A module-level constant in a reached file counts: run.sh's MJS_SCRIPT names ingest.mjs above main.
  const run = crossings.byThread["scripts/run.sh:main"] ?? [];
  const ing = run.find((c) => c.kind === "command" && c.path.endsWith("ingest.mjs"));
  assert.ok(ing, JSON.stringify(run));
  assert.equal(ing.targets[0].entryPointId, "scripts/ingest.mjs:main", "the discovered main outranks the manual seed as the file's entry");
  assert.match(ing.note, /module level of a file this thread reaches/);
  // bin/orders-cli execs scripts/run.sh through a nested-quoted bash word.
  const cli = crossings.byThread["bin/orders-cli:module"] ?? [];
  assert.equal(cli.find((c) => c.kind === "command")?.targets[0]?.entryPointId, "scripts/run.sh:main");
  // Nothing widened: the page's thread is still one language.
  assert.ok(!thread("app/dashboard/page.tsx:DashboardPage").filesReached.some((f) => f.endsWith(".sh")));
});

test("a default import binds to the target's DEFAULT export, whatever its function is called", () => {
  const page = env.files["app/dashboard/page.tsx"];
  const imp = (page.nodes ?? []).find((n) => n.type === "import_from" && n.module === "@/components/RegionChart");
  assert.deepEqual(imp.names, ["default as Chart"], "spelled like `* as X`, so every reader splits it the same way");
  const ref = (page.edges ?? []).find((e) => e.type === "reference" && e.source === "module/DashboardPage.fn/Chart.call");
  assert.equal(ref?.targetFile, "components/RegionChart.tsx");
  assert.match(ref.qualifiedTarget, /:default$/);
  const fn = (env.files["components/RegionChart.tsx"].nodes ?? []).find((n) => n.type === "function_def" && n.name === "RegionChartView");
  assert.equal(fn.isDefaultExport, true, "`export default X;` after the definition marks the function it names");
  const labels = thread("app/dashboard/page.tsx:DashboardPage").nodes.map((n) => `${n.kind}:${n.label}`);
  assert.ok(labels.includes("step:RegionChartView"), labels.join(" | "));
});

test("a composite value's string literals are recorded, and a parameter default's too", () => {
  const volt = env.files["lib/volt.ts"];
  const night = (volt.nodes ?? []).find((n) => n.type === "assignment" && n.name === "NIGHTLY_SCRIPT");
  assert.equal(night.valueKind, "other");
  assert.deepEqual(night.literals, ["orders/nightly_rollup.sh"]);
  // A `??` composite records its default however short (`process.argv[2] ?? "all"` in rates.mjs);
  // a plain short string keeps its preview and gains nothing.
  const region = (env.files["scripts/backend/lib/rates.mjs"].nodes ?? []).find((n) => n.type === "assignment" && n.name === "region");
  assert.deepEqual(region.literals, ["all"]);
  const plain = (env.files["scripts/run.sh"].nodes ?? []).find((n) => n.type === "assignment" && n.name === "NODE_BIN");
  assert.equal(plain?.literals, undefined, "bash assignments carry their value in preview; no literals field");
  // The join reads them, and a function_def's defaults count only when that function is a step.
  assert.deepEqual(nodeScriptRefs({ type: "assignment", name: "REL", preview: "process.env.X ?? \"accounts/get_accounts_fi", literals: ["accounts/get_accounts_financials.sh"] }).map((r) => r.suffix), ["accounts/get_accounts_financials.sh"]);
  assert.deepEqual(nodeScriptRefs({ type: "function_def", name: "run", literals: ["orders/export_orders.sh"] }).map((r) => r.suffix), ["orders/export_orders.sh"]);
});

test("a module load is not a command hop", () => {
  const files = {
    "web/page.ts": { language: "jsts", nodes: [
      { id: "module/Page.fn", type: "function_def", name: "Page", parentId: null },
      { id: "module/Page.fn/import.call", type: "call", funcName: "import", args: ['"./legacy/index.js"'], parentId: "module/Page.fn", line: 3 },
      { id: "module/Page.fn/require.call", type: "call", funcName: "require", args: ['"../tools/run.mjs"'], parentId: "module/Page.fn", line: 4 },
      { id: "module/Page.fn/spawn.call", type: "call", funcName: "spawn", args: ['"node"', '["../tools/run.mjs"]'], parentId: "module/Page.fn", line: 5 },
    ] },
    "tools/run.mjs": { language: "jsts", nodes: [{ id: "module/go.call", type: "call", funcName: "go", args: [], parentId: null }] },
  };
  const eps = [{ id: "web/page.ts:Page", kind: "route", file: "web/page.ts", irNodeId: "module/Page.fn" }, { id: "tools/run.mjs:module", kind: "cli", file: "tools/run.mjs", irNodeId: "module", framework: "command" }];
  const threads = [{ entryPointId: "web/page.ts:Page", filesReached: ["web/page.ts"], nodes: [{ kind: "seed", file: "web/page.ts", irNodeId: "module/Page.fn" }] }];
  const idx = buildCrossingIndex({ files, entryPoints: eps, threads });
  const cmd = idx.all.filter((c) => c.kind === "command");
  assert.deepEqual(cmd.map((c) => [c.callee, c.path, c.confidence]), [["spawn", "../tools/run.mjs", "path"]], "import() and require() load modules; spawn runs one");
  assert.deepEqual(discoverProject(files, []).map((e) => e.id), ["tools/run.mjs:module"], "and the discoverer agrees");
});

test("a script another file names is an entry point even with no shebang and no main; a target key is not", () => {
  const rates = byId["scripts/backend/lib/rates.mjs:module"];
  assert.ok(rates, Object.keys(byId).join(", "));
  assert.equal(rates.kind, "cli");
  assert.equal(rates.framework, "command");
  assert.equal(rates.metadata.seed, "module");
  assert.deepEqual(rates.metadata.invokedFrom.map((c) => c.file), ["scripts/backend/orders/export_orders.sh"]);
  assert.match(rates.summary, /named by 1 call site/);
  const ing = byId["scripts/ingest.mjs:main"];
  assert.equal(ing?.framework, "command");
  assert.equal(ing.metadata.seed, "main", "a top-level main() is the richer seed");
  // The discoverer itself, over a map where the caller names a file twice-shared suffix: no entry (a claim needs one file).
  const extra = discoverProject({
    "a/x.sh": { language: "bash", nodes: [{ id: "module/run.call", type: "call", funcName: "bash", args: ['"lib/t.sh"'], parentId: null }] },
    "p/lib/t.sh": { language: "bash", nodes: [{ id: "module/echo.call", type: "call", funcName: "echo", args: [], parentId: null }] },
    "q/lib/t.sh": { language: "bash", nodes: [{ id: "module/echo.call", type: "call", funcName: "echo", args: [], parentId: null }] },
  }, []);
  assert.deepEqual(extra, [], "two files share the suffix: the crossing says ambiguous, the discoverer claims nothing");
  // A thread exists for the named script, and its boundary is on it.
  const t = thread("scripts/backend/lib/rates.mjs:module");
  assert.ok(t.nodes.some((n) => n.kind === "external" && n.label === "fetch"), t.nodes.map((n) => n.label).join(" | "));
});

test("an MCP tool registered with an inline handler is an entry point, and a client calling it by name crosses to it", () => {
  const ep = byId["mcp/server.ts:list_orders"];
  assert.ok(ep, Object.keys(byId).join(", "));
  assert.equal(ep.kind, "route");
  assert.equal(ep.framework, "mcp");
  assert.deepEqual(ep.metadata, { tool: "list_orders", protocol: "mcp" });
  const fn = (env.files["mcp/server.ts"].nodes ?? []).find((n) => n.id === ep.irNodeId);
  assert.equal(fn.type, "function_def");
  assert.equal(fn.mcpTool, "list_orders", "the builder minted the arrow as a function named for the tool");
  const t = thread("mcp/server.ts:list_orders");
  assert.ok(t.filesReached.includes("lib/db.ts"), "the handler's own thread walks to the db funnel");
  // The client side: the tools route reaches mcp/client.ts, whose callTool names the tool.
  assert.equal(toolNameOf({ funcName: "client.callTool", args: ['{ name: "list_orders", arguments: { region } }'] }), "list_orders");
  assert.equal(toolNameOf({ funcName: "client.callTool", args: ['"ping"'] }), "ping");
  assert.equal(toolNameOf({ funcName: "client.connect", args: ['"x"'] }), null);
  const route = crossings.byThread["app/api/tools/route.ts:GET"] ?? [];
  const hop = route.find((c) => c.kind === "tool");
  assert.ok(hop, JSON.stringify(route));
  assert.equal(hop.path, "list_orders");
  assert.equal(hop.confidence, "path");
  assert.deepEqual(hop.targets.map((t) => t.entryPointId), ["mcp/server.ts:list_orders"]);
  assert.match(hop.note, /tool name alone/);
});

test("flows.md reads terminal to terminal, and the reverse index reads back", () => {
  const out = mkdtempSync(join(tmpdir(), "vg-flows-"));
  try {
    exportKnowledge({ root: FIXTURE, out, commit: "test" });
    const flows = readFileSync(join(out, "flows.md"), "utf-8");
    assert.match(flows, /## Commands — a thread runs a script/);
    assert.match(flows, /`app\/dashboard\/page\.tsx:DashboardPage` — PAGE \/dashboard \(next\) → client\.command `orders\/export_orders\.sh` \(lib\/volt\.ts\) → `scripts\/backend\/orders\/export_orders\.sh:module` — export_orders\.sh \(shell\) \[path\]/);
    assert.match(flows, /the target leaves through: [^\n]*psql[^\n]*/);
    assert.match(flows, /`orders\/nightly_rollup\.sh` \(lib\/volt\.ts\) → \*\*unmatched\*\*/);
    assert.match(flows, /## Tools — a thread calls an MCP tool/);
    assert.match(flows, /## Reverse index — what runs each target\n\n[^]*`scripts\/backend\/orders\/export_orders\.sh:module`[^\n]*← `app\/dashboard\/page\.tsx:DashboardPage` \(command: orders\/export_orders\.sh\)/);
    // The contract says the same thing, in its own words.
    const dash = readFileSync(join(out, "threads", "app_dashboard_page.tsx_DashboardPage.md"), "utf-8");
    assert.match(dash, /runs `orders\/export_orders\.sh` -> scripts\/backend\/orders\/export_orders\.sh:module \[command, shell\] \(path\)/);
    assert.match(dash, /Cross-thread: reaches [^\n]*scripts\/backend\/orders\/export_orders\.sh:module/);
    const sh = readFileSync(join(out, "threads", "scripts_backend_orders_export_orders.sh_module.md"), "utf-8");
    assert.match(sh, /reached by [^\n]*app\/dashboard\/page\.tsx:DashboardPage/, "the reverse trace: the script's contract names the page that runs it");
    const index = readFileSync(join(out, "threads", "INDEX.md"), "utf-8");
    assert.match(index, /`scripts\/backend\/lib\/rates\.mjs:module` \| cli\/command \|/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
