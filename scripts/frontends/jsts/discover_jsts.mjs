#!/usr/bin/env node
// M-LANG3 (PLAN-M-LANG.md) — JS/TS entry-point discovery. Contract:
//   stdin {files: {path: IR}} → stdout {entryPoints: [...]}
//
// Two evidence-based rules (framework names ride the open string the
// M-LANG1 envelope change made possible):
//   1. ROUTES — a call `X.get|post|put|delete|patch|all("/path", handler)`
//      where `handler` is an IDENTIFIER naming a function in the SAME
//      file → kind "route", metadata {route, method}; framework
//      "express"/"fastify" only when that module is actually imported
//      in the file, else null (no guessing).
//   2. TESTS — in *.test.* / *.spec.* files, `test("...", fn)` /
//      `it("...", fn)` with an IDENTIFIER callback → kind "test" on
//      that function; framework from the imported runner when named.
//
// NAMED LIMITS (v1): inline arrow handlers aren't seedable function
// nodes (use named handlers); package.json bin/main entries need
// non-IR input and wait for a deliberate decision; cross-file handler
// identifiers don't resolve here.

const ROUTE_RE = /^[A-Za-z_$][\w$]*\.(get|post|put|delete|patch|all)$/;
const TEST_FILE_RE = /\.(test|spec)\.[jt]sx?$/;
const TEST_CALLEES = new Set(["test", "it"]);

// M-FLOW.3 — the MCP SDK is imported by SUBPATH (`…/sdk/server/mcp.js`), so
// the framework is read from the package prefix, not an exact specifier.
function mcpFramework(ir) {
  for (const n of ir.nodes ?? []) {
    if (n.type !== "import_from") continue;
    const mod = n.module ?? "";
    if (mod === "fastmcp" || mod.startsWith("@modelcontextprotocol/sdk")) return "mcp";
  }
  return null;
}

function frameworkFromImports(ir, candidates) {
  for (const n of ir.nodes ?? []) {
    if (n.type !== "import_from") continue;
    const mod = (n.module ?? "").replace(/^node:/, "");
    if (candidates.includes(mod)) return mod;
  }
  return null;
}

// ── M-CMD.1 — Next.js App Router ──────────────────────────────────────
// The third evidence rule, and the one a real codebase needed: 35 handler
// nodes across 32 files and 21 pages sat in the IR, correct and
// unclassified, because the detector knew express and nothing else
// (an internal field review B3).
//
// The evidence is the App Router's own contract, which nothing else uses:
// a file named `route.*` under an `app/` tree exporting a function named
// for an HTTP VERB is that path's handler, and a `page.*` exporting a
// component is that path's page. Convention-based, like C++'s header
// linking and bash's shebang entries.
//
// NAMED LIMIT: the presence of `next` as a dependency is NOT checked — the
// discoverer is handed IR, not package.json — so the path convention alone
// carries it. A non-Next project that puts a function called `GET` in a
// file called `route.ts` under `app/` would be read as a route, which is
// the same bet the express rule makes on `.get("/x", handler)`.
const NEXT_VERBS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const NEXT_ROUTE_FILE = /(?:^|\/)route\.[jt]sx?$|(?:^|\/)route\.[cm]js$/;
const NEXT_PAGE_FILE = /(?:^|\/)page\.[jt]sx?$|(?:^|\/)page\.[cm]js$/;

/** An authored doc comment's first line, matching the express rule's summary. */
function firstLine(doc) {
  return typeof doc === "string" && doc.trim() ? doc.split(/\r?\n/)[0] : null;
}

/** The URL a Next App Router file serves, or null when it is not under `app/`. */
function nextUrlPath(rel) {
  const m = rel.match(/(?:^|\/)app\/(.*)$/);
  if (!m) return null;
  const withoutFile = m[1].replace(/(?:^|\/)(?:route|page)\.[a-z]+$/, "");
  const segments = [];
  for (const seg of withoutFile.split("/")) {
    if (!seg) continue;
    // (marketing) is a ROUTE GROUP: it organises files and is not in the URL.
    if (seg.startsWith("(") && seg.endsWith(")")) continue;
    // @modal is a parallel route slot; also not a URL segment.
    if (seg.startsWith("@")) continue;
    let opt = seg.match(/^\[\[\.\.\.(.+)\]\]$/);
    if (opt) { segments.push(`*${opt[1]}?`); continue; }
    let cat = seg.match(/^\[\.\.\.(.+)\]$/);
    if (cat) { segments.push(`*${cat[1]}`); continue; }
    const dyn = seg.match(/^\[(.+)\]$/);
    segments.push(dyn ? `:${dyn[1]}` : seg);
  }
  return "/" + segments.join("/");
}

function nextEntryPoints(rel, ir, topLevelFns) {
  const url = nextUrlPath(rel);
  if (url === null) return [];
  const out = [];
  const isRoute = NEXT_ROUTE_FILE.test(rel);
  const isPage = NEXT_PAGE_FILE.test(rel);
  if (!isRoute && !isPage) return [];
  for (const fn of topLevelFns) {
    // EXPORTED is the contract, not merely "named like a verb": a local
    // helper called `GET` is not a handler. The IR gained `isExported` for
    // this rule (M-CMD.1), so the evidence is read rather than assumed.
    if (!fn.isExported) continue;
    if (isRoute && NEXT_VERBS.has(fn.name)) {
      out.push({
        id: `${rel}:${fn.name}`,
        kind: "route",
        file: rel,
        irNodeId: fn.id,
        qualifiedName: `${ir.modulePath ?? rel}:${fn.name}`,
        label: `${fn.name} ${url}`,
        summary: firstLine(fn.docstring) ?? `${fn.name} ${url} → ${fn.name}`,
        framework: "next",
        metadata: { route: url, method: fn.name, next: "route-handler" },
      });
    } else if (isPage && fn.isDefaultExport) {
      out.push({
        id: `${rel}:${fn.name}`,
        kind: "route",
        file: rel,
        irNodeId: fn.id,
        qualifiedName: `${ir.modulePath ?? rel}:${fn.name}`,
        label: `PAGE ${url}`,
        // A page is reached by a GET, which is why it rides `route` rather
        // than inventing an enum member: it is a URL the outside world hits.
        summary: firstLine(fn.docstring) ?? `the page served at ${url}`,
        framework: "next",
        metadata: { route: url, method: "GET", next: "page" },
      });
    }
  }
  return out;
}

// M-FLOW.1 — a SCRIPT: `#!/usr/bin/env node` on the first line (the parser
// stamps `shebang`, as bash's does). Seeded on `main` when the file defines
// one at top level and calls it there (`main()`, `main().catch(...)` — the
// nested call is minted, so either spelling has a top-level call named
// main); otherwise on the MODULE, the extractor's pseudo node for the
// statements that run when the file does. Same rule as discover_bash.
function scriptEntryPoint(rel, ir, nodes, topLevelFns) {
  if (typeof ir.shebang !== "string" || !ir.shebang) return null;
  const interp = ir.shebang.replace(/^#!\s*/, "").split(/\s+/).filter((w) => !w.startsWith("-") && w !== "env").pop()?.split("/").pop() ?? "node";
  const mainFn = topLevelFns.find((n) => n.name === "main");
  const calledAtTop = !!mainFn && nodes.some((n) => (n.type === "call" && n.funcName === "main" || n.type === "assignment" && n.callTarget === "main") && (n.parentId === null || nodes.find((p) => p.id === n.parentId)?.parentId === null && nodes.find((p) => p.id === n.parentId)?.type !== "function_def"));
  if (mainFn && calledAtTop) {
    return {
      id: `${rel}:main`, kind: "cli", file: rel, irNodeId: mainFn.id,
      qualifiedName: `${ir.modulePath ?? rel}:main`, label: rel.split("/").pop(),
      summary: firstLine(mainFn.docstring) ?? `${ir.shebang} — main() entry`,
      framework: interp, metadata: { seed: "main" },
    };
  }
  const executes = nodes.some((n) => n.parentId === null && n.type !== "function_def" && n.type !== "class_def" && n.type !== "import_from" && n.type !== "import");
  if (!executes) return null;
  return {
    id: `${rel}:module`, kind: "cli", file: rel, irNodeId: "module",
    qualifiedName: `${ir.modulePath ?? rel}:module`, label: rel.split("/").pop(),
    summary: `${ir.shebang} — a script whose body is its main (no main function)`,
    framework: interp, metadata: { seed: "module" },
  };
}

function discover(files) {
  const entryPoints = [];
  for (const [rel, ir] of Object.entries(files)) {
    if (ir.language !== "jsts") continue;
    const nodes = ir.nodes ?? [];
    const fns = new Map(
      nodes.filter((n) => n.type === "function_def" && n.parentId === null)
        .map((n) => [n.name, n]),
    );
    const isTestFile = TEST_FILE_RE.test(rel);

    // M-CMD.1 — the App Router's files are named for their role, so this is
    // decided by path + export name, not by a call the file makes.
    const topLevel = nodes.filter((n) => n.type === "function_def" && n.parentId === null);
    entryPoints.push(...nextEntryPoints(rel, ir, topLevel));
    const script = scriptEntryPoint(rel, ir, nodes, topLevel);
    if (script) entryPoints.push(script);

    for (const n of nodes) {
      if (n.type !== "call" || !n.funcName) continue;

      const routeMatch = n.funcName.match(ROUTE_RE);
      if (routeMatch && !isTestFile) {
        const route = (n.args?.[0] ?? "").replace(/^["'`]|["'`]$/g, "");
        const handlerName = (n.args?.[1] ?? "").trim();
        const fn = fns.get(handlerName);
        if (!fn || !route.startsWith("/")) continue;
        entryPoints.push({
          id: `${rel}:${fn.name}`,
          kind: "route",
          file: rel,
          irNodeId: fn.id,
          qualifiedName: `${ir.modulePath ?? rel}:${fn.name}`,
          label: `${routeMatch[1].toUpperCase()} ${route}`,
          // PARITY — authored doc line first, synthetic route line as
          // the fallback (Python's docstring-derived summaries).
          summary: fn.docstring?.split("\n")[0]
            ?? `${routeMatch[1].toUpperCase()} ${route} → ${fn.name}`,
          framework: frameworkFromImports(ir, ["express", "fastify"]),
          metadata: { route, method: routeMatch[1].toUpperCase() },
        });
        continue;
      }

      // M-FLOW.3 — a tool REGISTERED UNDER A NAME is an entry point: the
      // protocol dispatches to it by that string as a router dispatches by
      // path, so it rides `route` with framework "mcp" and `metadata.tool`.
      // The handler is the function the builder minted for the inline arrow
      // (`mcpTool` set on both the call and the function), or a named one.
      if (n.mcpTool) {
        const handler = nodes.find((f) => f.type === "function_def" && f.mcpTool === n.mcpTool && (f.parentId ?? null) === (n.parentId ?? null))
          ?? fns.get((n.args ?? []).map((a) => a.trim()).find((a) => fns.has(a)) ?? "");
        if (!handler) continue;
        entryPoints.push({
          id: `${rel}:${n.mcpTool}`,
          kind: "route",
          file: rel,
          irNodeId: handler.id,
          qualifiedName: `${ir.modulePath ?? rel}:${n.mcpTool}`,
          label: `TOOL ${n.mcpTool}`,
          summary: firstLine(handler.docstring) ?? `MCP tool "${n.mcpTool}" → ${handler.name}`,
          framework: mcpFramework(ir),
          metadata: { tool: n.mcpTool, protocol: "mcp" },
        });
        continue;
      }

      if (isTestFile && TEST_CALLEES.has(n.funcName)) {
        const cbName = (n.args?.[1] ?? "").trim();
        const fn = fns.get(cbName);
        if (!fn) continue;
        const title = (n.args?.[0] ?? "").replace(/^["'`]|["'`]$/g, "");
        entryPoints.push({
          id: `${rel}:${fn.name}`,
          kind: "test",
          file: rel,
          irNodeId: fn.id,
          qualifiedName: `${ir.modulePath ?? rel}:${fn.name}`,
          label: fn.name,
          summary: fn.docstring?.split("\n")[0] ?? (title || `test → ${fn.name}`),
          framework: frameworkFromImports(ir, ["test", "vitest", "jest", "mocha"]),
        });
      }
    }
  }
  return entryPoints;
}

let raw = "";
process.stdin.setEncoding("utf-8");
for await (const chunk of process.stdin) raw += chunk;
const { files } = JSON.parse(raw);
process.stdout.write(JSON.stringify({ entryPoints: discover(files ?? {}) }));
