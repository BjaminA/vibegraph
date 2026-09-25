/**
 * M-STACK.1 (PLAN-M-STACK.md) — stack FACTS over three real projects.
 *
 * The floor under test is honesty, not coverage: every tool here is
 * backed by a parse site (or a manifest line labelled `config`), an
 * unclassifiable tool is listed as `unknown` rather than guessed, and the
 * project FUNNEL (`telemetry/http_client.py` wrapping `requests` — the
 * milestone's named acceptance case) falls out of the import graph, not
 * out of a name.
 *
 * Fixtures: the committed polyglot envelope (four languages), and
 * examples/fleet-telemetry + examples/pump-wear built through the same
 * per-language pipeline server.ts runs.
 *
 * Run: npm run test:stack
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex, stackForFile, stackForThread, stackCalledOnThread, contractStackForFile, toolsAddedByDelta } from "../src/server/stack.ts";
import { formatSystemSpec, stackSummaryLine, packetStackLine, stackConflicts, policiesForTool } from "../src/server/stack_spec.ts";
import { loadConstraints } from "../src/server/constraint_store.ts";
import { computeThreadContract, formatContractBlock } from "../src/server/thread_contract.ts";
import { classifyTool, isSafeToolName, ROLE_ORDER } from "../src/shared/stack_taxonomy.ts";
import { importBindings, localBindings, attributeBoundary, isOwnCrateSpec } from "../src/shared/stack_attribution.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHOP = join(ROOT, "test", "fixtures", "polyglot", "shop_demo");
const FLEET = join(ROOT, "examples", "fleet-telemetry");
const PUMP = join(ROOT, "examples", "pump-wear");

const shopEnv = JSON.parse(readFileSync(join(SHOP, "shop_demo.project.json"), "utf-8"));
const shop = buildStackIndex(shopEnv, SHOP);
const fleetEnv = buildPolyglotEnvelope(FLEET).envelope;
const fleet = buildStackIndex(fleetEnv, FLEET);
const pump = buildStackIndex(buildPolyglotEnvelope(PUMP).envelope, PUMP);
// M-TABLES — the four projects above import only modules the hand-written
// list already had, so NONE of them could catch a stdlib module being
// reported as a dependency. This one is built to.
const STDLIB_DEMO = join(ROOT, "test", "fixtures", "stack", "stdlib_demo");
const stdlibDemo = buildStackIndex(buildPolyglotEnvelope(STDLIB_DEMO).envelope, STDLIB_DEMO);

const tool = (idx, name) => idx.tools.find((t) => t.tool === name);
const names = (idx) => idx.tools.map((t) => t.tool);

test("shop_demo: one index over four languages, each tool from its own frontend's evidence", () => {
  // python imports
  assert.equal(tool(shop, "flask").role, "web-framework");
  assert.equal(tool(shop, "requests").role, "http-client");
  assert.equal(tool(shop, "sqlite3").origin, "stdlib");
  assert.equal(tool(shop, "sqlite3").role, "db");
  // TS import specifier
  assert.equal(tool(shop, "express").role, "web-framework");
  assert.equal(tool(shop, "express").evidence[0].kind, "import");
  // bash command words on call nodes
  assert.equal(tool(shop, "curl").role, "http-client");
  assert.equal(tool(shop, "psql").role, "db");
  assert.equal(tool(shop, "ssh").role, "remote");
  assert.equal(tool(shop, "make").role, "build");
  assert.equal(tool(shop, "curl").evidence[0].kind, "call");
  // C++ include
  assert.equal(tool(shop, "gtest/gtest.h").role, "test");
  assert.equal(tool(shop, "gtest/gtest.h").evidence[0].kind, "include");
  // shell builtins and project bash functions are NOT tools
  for (const n of ["echo", "log_step", "load_env", "main", "logger"]) {
    assert.equal(tool(shop, n), undefined, `${n} must not be a tool`);
  }
});

test("every tool is backed by evidence in a file that exists; roles come from the closed set", () => {
  for (const idx of [shop, fleet, pump]) {
    for (const t of idx.tools) {
      assert.ok(isSafeToolName(t.tool), `unsafe tool name ${t.tool}`);
      assert.ok(ROLE_ORDER.includes(t.role), `role ${t.role} outside the taxonomy`);
      assert.ok(t.evidence.length > 0, `${t.tool} has no evidence`);
      for (const e of t.evidence) {
        assert.ok(t.files.includes(e.file), `${t.tool}: evidence file ${e.file} not in files`);
      }
      // Versions are manifest-only: none of these three projects ships one.
      assert.equal(t.version, undefined, `${t.tool} claimed a version with no manifest`);
    }
  }
});

test("fleet-telemetry: telemetry/http_client.py is a PROJECT funnel wrapping requests", () => {
  const w = tool(fleet, "telemetry.http_client");
  assert.ok(w, `no funnel detected; tools: ${names(fleet).join(", ")}`);
  assert.equal(w.origin, "project");
  assert.equal(w.role, "http-client");
  assert.deepEqual(w.wraps, ["requests"]);
  // Its evidence is the import graph: the wrapper's own `import requests`
  // plus every project file that reaches it.
  assert.ok(w.files.includes("telemetry/http_client.py"));
  assert.ok(w.files.includes("telemetry/alerts.py"), "the module that reaches it is part of the funnel's evidence");
  // requests itself is still listed as third-party, at its one real site.
  const req = tool(fleet, "requests");
  assert.equal(req.origin, "third-party");
  assert.deepEqual(req.files, ["telemetry/http_client.py"]);
});

test("fleet-telemetry: storage is the db funnel; the four languages' tools do not bleed across threads", () => {
  const storage = tool(fleet, "telemetry.storage");
  assert.equal(storage.origin, "project");
  assert.equal(storage.role, "db");
  assert.deepEqual(storage.wraps, ["sqlite3"]);

  // byThread: a thread's stack is the union over the files it reaches.
  const ingest = fleet.byThread["telemetry/app.py:ingest_route"];
  assert.ok(ingest.includes("flask") && ingest.includes("telemetry.storage"));
  assert.ok(ingest.includes("telemetry.http_client") && ingest.includes("requests"),
    "the ingest thread reaches requests only THROUGH the wrapper — the fact follows the graph");
  const alerts = fleet.byThread["telemetry/alerts.py:evaluate"];
  assert.ok(alerts.includes("telemetry.http_client") && alerts.includes("requests"));
  assert.ok(!alerts.includes("flask") && !alerts.includes("telemetry.storage"));
  // M-BOUNDARY.1: `fetch` is a GLOBAL, so no import declares it and the
  // index used to miss the gateway's HTTP client entirely. Observing the
  // call makes it a fact, and makes api_client.ts the funnel it is.
  assert.deepEqual(fleet.byThread["gateway/server.ts:getFleet"].sort(),
    ["express", "fetch", "gateway.api_client"]);
  const apiClient = tool(fleet, "gateway.api_client");
  assert.equal(apiClient.origin, "project");
  assert.deepEqual(apiClient.wraps, ["fetch"]);
  assert.equal(apiClient.home, "gateway/api_client.ts", "the funnel itself, not its importers");
  assert.ok(apiClient.files.includes("gateway/server.ts"), "importers ride `files`");
  assert.deepEqual(fleet.byThread["ops/deploy.sh:main"].sort(), ["curl", "make", "psql", "ssh"]);
  for (const t of fleet.byThread["codec/main.cpp:main"]) {
    assert.ok(t.startsWith("c"), `C++ thread picked up ${t}`);
  }
});

test("pump-wear: torch is the tensor program, and the modules that funnel it are named", () => {
  const torch = tool(pump, "torch");
  assert.equal(torch.role, "tensor");
  assert.equal(torch.origin, "third-party");
  assert.ok(torch.files.length >= 3, `torch should appear in several files: ${torch.files.join(", ")}`);
  const funnels = pump.tools.filter((t) => t.origin === "project" && t.role === "tensor");
  assert.ok(funnels.length > 0, "the modules other modules import torch through are project funnels");
  for (const f of funnels) assert.deepEqual(f.wraps, ["torch"]);
});

test("an unclassifiable tool is LISTED as unknown, never guessed", () => {
  // Python's stdlib list is COMPLETE (generated from sys.stdlib_module_names),
  // so absence from it is evidence: this really is a third-party package.
  assert.deepEqual(classifyTool("python", "some_vendor_sdk"), { role: "unknown", origin: "third-party" });
  // stdlib with no more specific role is `runtime`, not `unknown`.
  assert.deepEqual(classifyTool("python", "os"), { role: "runtime", origin: "stdlib" });
  assert.deepEqual(classifyTool("jsts", "fs"), { role: "runtime", origin: "stdlib" });
  assert.deepEqual(classifyTool("cpp", "cstdio"), { role: "runtime", origin: "stdlib" });
});

// ── M-TABLES — the origin claim has to be TRUE, or it is not a fact ──

test("M-TABLES: a bash command word nobody can enumerate has origin `unknown`", () => {
  // No list can enumerate PATH. `wibblectl` might be coreutils on the deploy
  // host, a third-party CLI, or a script the project ships — and `command -v`
  // would answer for the machine doing the PARSING, not the one running it.
  // This used to claim `third-party`, inventing a dependency out of ignorance.
  assert.deepEqual(classifyTool("bash", "wibblectl"), { role: "unknown", origin: "unknown" });
  // M-CMD.3 — a GNU coreutils program is ambient plumbing (role runtime, and
  // its origin is the shell environment's); a third-party CLI is not.
  assert.deepEqual(classifyTool("bash", "base64"), { role: "runtime", origin: "stdlib" });
  assert.deepEqual(classifyTool("bash", "md5sum"), { role: "runtime", origin: "stdlib" });
  assert.deepEqual(classifyTool("bash", "jq"), { role: "data", origin: "third-party" }, "jq is a real dependency, and a table names it now");
  // A NAMED bash tool is a real external dependency — it must be installed.
  assert.deepEqual(classifyTool("bash", "curl"), { role: "http-client", origin: "third-party" });
  // The shell's own builtins are the shell, not a dependency.
  assert.deepEqual(classifyTool("bash", "cd"), { role: "runtime", origin: "stdlib" });
  // A language with no evidence table at all claims nothing. This used
  // to be demonstrated with `rust`, which acquired one in M-RUST.4 — so
  // the example moved to a language that genuinely has none rather than
  // the assertion being dropped. `serde` is now data/third-party, and
  // that is the point of having the table.
  assert.deepEqual(classifyTool("go", "gin"), { role: "unknown", origin: "unknown" });
  assert.deepEqual(classifyTool("rust", "serde"), { role: "data", origin: "third-party" });
});

test("M-TABLES: the 105 stdlib modules the hand-written list missed are stdlib now", () => {
  // Every one of these is standard, and every one was reported as a
  // third-party dependency before the table was generated.
  for (const mod of ["tarfile", "zoneinfo", "sysconfig", "socketserver", "array",
                     "codecs", "contextvars", "doctest", "fcntl", "lzma"]) {
    assert.deepEqual(classifyTool("python", mod), { role: "runtime", origin: "stdlib" },
      `${mod} is the Python standard library, not a dependency`);
  }
  // A module REMOVED from the stdlib is still not a dependency of a project
  // written against the interpreter that had it.
  assert.equal(classifyTool("python", "distutils").origin, "stdlib");
  assert.equal(classifyTool("python", "telnetlib").origin, "stdlib");
  // The roles the taxonomy states explicitly still outrank "it is stdlib".
  assert.equal(classifyTool("python", "sqlite3").role, "db");
  assert.equal(classifyTool("python", "subprocess").role, "process");
});

test("M-TABLES: through the real pipeline, a stdlib import is not a dependency", () => {
  // The end-to-end version of the claim. `classifyTool` unit assertions
  // cannot show this: the fact has to survive the index that the system
  // spec, the brief and the Stack panel all read from.
  for (const mod of ["tarfile", "zoneinfo", "sysconfig"]) {
    const t = tool(stdlibDemo, mod);
    assert.ok(t, `${mod} should be in the index`);
    assert.equal(t.origin, "stdlib", `${mod} is standard — it was called third-party before M-TABLES`);
    assert.ok(t.evidence.length > 0, "and it is still backed by a parse site");
  }
  // Beside them, a REAL dependency, so the two are visibly different facts.
  const requests = tool(stdlibDemo, "requests");
  assert.equal(requests.origin, "third-party");
  assert.equal(requests.role, "http-client");
});

test("M-TABLES: a bash script's three kinds of word are three different facts", () => {
  const curl = tool(stdlibDemo, "curl");
  assert.equal(curl?.origin, "third-party", "curl must be installed — a real dependency");
  assert.equal(curl?.role, "http-client");

  const wibble = tool(stdlibDemo, "wibblectl");
  assert.ok(wibble, "an unrecognised command is still LISTED — the floor is honesty, not silence");
  assert.equal(wibble.origin, "unknown", "it used to claim third-party, which invented a dependency");
  assert.equal(wibble.role, "unknown");

  // The shell itself is not a tool the project depends on.
  for (const builtin of ["cd", "echo", "local", "set"]) {
    assert.equal(tool(stdlibDemo, builtin), undefined, `${builtin} is the shell, not a dependency`);
  }
});

test("M-TABLES: the system spec SAYS the origin is unknown rather than omitting it", () => {
  const spec = formatSystemSpec(stdlibDemo, []);
  assert.match(spec, /wibblectl/, "an unknown-origin tool still appears in the spec");
  assert.match(spec, /origin unknown/,
    "and the spec states the gap — a reader must not have to infer it from silence");
  assert.match(spec, /tarfile/);
  assert.doesNotMatch(spec, /tarfile[^\n]*third-party/,
    "the standard library is never presented as a dependency");
});

test("config-only evidence is labelled as such (the M-LANG3 unparsed-frontend limit)", () => {
  const env = { files: {}, threads: [] };
  const withPkg = buildStackIndex(env, join(ROOT, "test", "fixtures", "stack", "web_manifest"));
  const next = withPkg.tools.find((t) => t.tool === "next");
  assert.ok(next, `expected next from the manifest; got ${withPkg.tools.map((t) => t.tool).join(", ")}`);
  assert.equal(next.role, "frontend");
  assert.equal(next.version, "14.2.3", "the version comes from the manifest, never from a guess");
  assert.ok(next.evidence.every((e) => e.kind === "config"));
  assert.ok(withPkg.tools.some((t) => t.tool === "vite" && t.evidence.some((e) => e.file === "vite.config.ts")));
  // A declared dependency no table knows says nothing — it is not invented into the spec.
  assert.equal(withPkg.tools.find((t) => t.tool === "left-pad"), undefined);
});

test("the thread contract carries the stack, and formatContractBlock renders it as IR fact", () => {
  const nodeFor = (file, irNodeId) => {
    if (!irNodeId) return null;
    for (const ir of file ? [fleetEnv.files[file]].filter(Boolean) : Object.values(fleetEnv.files)) {
      const n = ir.nodes.find((x) => x.id === irNodeId);
      if (n) return n;
    }
    return null;
  };
  const th = fleetEnv.threads.find((t) => t.entryPointId === "telemetry/alerts.py:evaluate");
  const c = computeThreadContract(th, {
    nodeFor, reaches: [], reachedBy: [],
    stackFor: (f) => contractStackForFile(fleet, f),
  });
  const first = c.stack[0];
  assert.equal(first.tool, "telemetry.http_client", "project funnels come first");
  assert.equal(first.origin, "project");
  assert.ok(c.stack.some((s) => s.tool === "requests"));
  assert.ok(c.stack.every((s) => s.evidence > 0));

  const block = formatContractBlock(c);
  assert.match(block, /Stack \(tools this thread's files use — IR fact, project funnels first\)/);
  assert.match(block, /telemetry\.http_client \[http-client, project funnel wrapping requests, \d+ site/);
  // The stack line is IR fact and says so; it never carries a source label
  // (that is what a stated constraint does).
  assert.ok(!/human-stated/.test(block));

  // Without an injected index the contract is the pre-M-STACK shape.
  const bare = computeThreadContract(th, { nodeFor, reaches: [], reachedBy: [] });
  assert.deepEqual(bare.stack, []);
  assert.ok(!/^Stack \(/m.test(formatContractBlock(bare)));
});

test("the envelope's `stack` sibling is ADDITIVE — a live envelope still validates", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", "project_ir.schema.json"), "utf-8")));
  // Stack-less: byte-identical to the committed fixture — the pre-M-STACK shape.
  assert.ok(validate(shopEnv), JSON.stringify(validate.errors));
  // With the sibling attached, exactly as the server ships it (plus the
  // `constraints` sibling M-CONTRACT.3 had been shipping undeclared).
  const live = {
    ...shopEnv,
    stack: shop,
    constraints: [{ id: "c1", kind: "proxy", text: "x", scope: { all: true }, source: "human", createdAt: "" }],
  };
  assert.ok(validate(live), JSON.stringify(validate.errors));
});

test("slices are consistent: stackForFile / stackForThread agree with byFile / byThread", () => {
  for (const [idx, file] of [[fleet, "telemetry/alerts.py"], [shop, "api/app.py"]]) {
    assert.deepEqual(
      stackForFile(idx, file).map((t) => t.tool).sort(),
      [...(idx.byFile[file] ?? [])].sort(),
    );
  }
  const ep = "telemetry/app.py:ingest_route";
  assert.deepEqual(
    stackForThread(fleet, ep).map((t) => t.tool).sort(),
    [...fleet.byThread[ep]].sort(),
  );
  // Every tool's `threads` is the inverse of byThread.
  for (const t of fleet.tools) {
    for (const ep2 of t.threads) assert.ok(fleet.byThread[ep2].includes(t.tool));
  }
});

// ── M-STACK.3 — the system spec: facts and policies together, apart ──

const fleetConstraints = loadConstraints(FLEET);

test("the system spec renders FACTS with evidence and POLICIES with provenance, and never merges them", () => {
  const spec = formatSystemSpec(fleet, fleetConstraints);
  assert.match(spec, /^## Project stack \(IR fact/);
  assert.match(spec, /telemetry\.http_client \(project funnel wrapping requests; \d+ site\(s\) in \d+ file\(s\)\)/);
  assert.match(spec, /HTTP client: /);
  assert.match(spec, /Stated policies about these tools \(NOT IR fact — the source of each is named\):/);
  assert.match(spec, /\[c1 · proxy · human-stated\] replace requests with telemetry\.http_client/);
  // A fact line never carries a source label; a policy line always does.
  const factLines = spec.split("\n").filter((l) => l.startsWith("- ") && !/stated/.test(l));
  assert.ok(factLines.length > 0);
  for (const l of factLines) assert.doesNotMatch(l, /human|orchestrator|agent/);
  // Ambient plumbing is collapsed to names so the head stays readable.
  assert.match(spec, /standard library \/ build \/ test \/ in-process utility:/);
  // An unclassifiable tool is still NAMED in its own group — the spec says
  // what it cannot classify rather than dropping it.
  const withUnknown = formatSystemSpec({
    tools: [{ tool: "acme_sdk", role: "unknown", origin: "third-party", files: ["a.py"], threads: [], evidence: [{ file: "a.py", line: 2, kind: "import" }] }],
    byFile: { "a.py": ["acme_sdk"] }, byThread: {},
  }, []);
  assert.match(withUnknown, /unclassified \(no taxonomy entry — named, never guessed\): acme_sdk/);
  assert.match(withUnknown, /Stated policies about these tools: none\./);
});

test("a policy that disagrees with the facts is SHOWN as a disagreement, never reconciled", () => {
  // The wrapper's own import of requests is exempt: replacing requests WITH
  // telemetry.http_client cannot mean the wrapper may not import it.
  assert.deepEqual(stackConflicts(fleet, fleetConstraints), []);

  // A bare requests import outside the funnel is the incident c1 describes.
  const rogue = {
    ...fleet,
    tools: fleet.tools.map((t) => (t.tool === "requests"
      ? { ...t, files: [...t.files, "telemetry/rogue.py"], evidence: [...t.evidence, { file: "telemetry/rogue.py", line: 3, kind: "import" }] }
      : t)),
  };
  const found = stackConflicts(rogue, fleetConstraints);
  assert.equal(found.length, 1);
  assert.match(found[0], /\[c1 · human-stated\] replace requests with telemetry\.http_client — but requests appears at telemetry\/rogue\.py:3\./);
  assert.match(formatSystemSpec(rogue, fleetConstraints), /WHERE THE FACTS AND A STATED POLICY DISAGREE/);

  // A "require" rule fires the other way: it names a tool nothing uses.
  const requireTf = [{ id: "c9", kind: "stack-policy", text: "training runs on tensorflow", scope: { all: true }, source: "human", createdAt: "", policy: { tool: "tensorflow", rule: "require" } }];
  assert.match(stackConflicts(fleet, requireTf)[0], /but no evidence of tensorflow anywhere/);
});

test("the thread slice, the packet line and the one-line summary read from the same index", () => {
  const thread = formatSystemSpec(fleet, fleetConstraints, { entryPointId: "telemetry/alerts.py:evaluate" });
  assert.match(thread, /^## Stack for this thread \(IR fact/);
  assert.match(thread, /telemetry\.http_client/);
  assert.doesNotMatch(thread, /flask/, "the alerts thread never touches flask");
  assert.match(thread, /\[c1 · proxy · human-stated\]/, "the policy about its tool rides its slice");

  // A thread with no tools says so rather than rendering an empty heading.
  const bare = formatSystemSpec({ tools: [], byFile: {}, byThread: { e: [] } }, [], { entryPointId: "e" });
  assert.match(bare, /No third-party or project-funnel tools/);
  assert.equal(formatSystemSpec({ tools: [], byFile: {}, byThread: {} }, []), null);

  assert.match(packetStackLine(fleet, "telemetry/alerts.py:evaluate"), /telemetry\.http_client \[http-client, project funnel wrapping requests\]/);
  assert.match(packetStackLine(fleet, "nope"), /no third-party or project-funnel tools/);

  const line = stackSummaryLine(fleet);
  assert.match(line, /^Stack \(IR fact, from imports\/calls\/manifests\)/);
  assert.match(line, /telemetry\.http_client\(wraps requests\)/);
  assert.doesNotMatch(line, /cstdio/, "ambient plumbing stays out of the one-liner");
  assert.equal(stackSummaryLine({ tools: [], byFile: {}, byThread: {} }), null);

  assert.deepEqual(policiesForTool(fleetConstraints, "requests").map((c) => c.id), ["c1"]);
  assert.deepEqual(policiesForTool(fleetConstraints, "telemetry.http_client").map((c) => c.id), ["c1"], "the tool a policy points AT is bound too");
  assert.deepEqual(policiesForTool(fleetConstraints, "flask"), []);
});

// ── M-STACK.5 — what an edit ADDED, resolved from the IR delta ──────

test("toolsAddedByDelta resolves new import/call/include nodes against the settled index", () => {
  // The exact site the fleet index already knows: http_client.py's
  // `import requests`. A packet whose delta adds that node introduced the
  // tool — and requests lives NOWHERE else, so it is new to the project.
  const site = tool(fleet, "requests").evidence[0];
  const added = toolsAddedByDelta(
    fleet,
    [{ file: site.file, delta: { nodesAdded: [{ id: site.nodeId, type: "import" }] } }],
    [site.file],
  );
  assert.equal(added.length, 1);
  assert.equal(added[0].tool, "requests");
  assert.equal(added[0].role, "http-client");
  assert.equal(added[0].origin, "third-party");
  assert.equal(added[0].alsoElsewhere, false, "requests has evidence only in the file this packet changed");

  // The same tool when the packet changed a DIFFERENT file: already used
  // elsewhere, so not a dependency decision.
  const elsewhere = toolsAddedByDelta(
    fleet,
    [{ file: site.file, delta: { nodesAdded: [{ id: site.nodeId, type: "import" }] } }],
    [site.file, "telemetry/other.py"],
  );
  assert.equal(elsewhere[0].alsoElsewhere, false);
  const shared = toolsAddedByDelta(
    fleet,
    [{ file: "telemetry/alerts.py", delta: { nodesAdded: [{ id: tool(fleet, "time").evidence.find((e) => e.file === "telemetry/alerts.py").nodeId, type: "import" }] } }],
    ["telemetry/alerts.py"],
  );
  assert.equal(shared[0].tool, "time");
  assert.equal(shared[0].alsoElsewhere, true, "time is imported in several files");

  // A bash command word is a tool site too (the check is not python-only).
  const curl = tool(shop, "curl").evidence[0];
  const bash = toolsAddedByDelta(shop, [{ file: curl.file, delta: { nodesAdded: [{ id: curl.nodeId, type: "call" }] } }], [curl.file]);
  assert.deepEqual(bash.map((a) => a.tool), ["curl"]);

  // Nodes that are not tool sites, unknown ids, and PROJECT funnels are
  // not "tools added": a funnel is the project's own code.
  assert.deepEqual(toolsAddedByDelta(fleet, [{ file: site.file, delta: { nodesAdded: [{ id: "module/f.fn", type: "function_def" }] } }], [site.file]), []);
  assert.deepEqual(toolsAddedByDelta(fleet, [{ file: site.file, delta: { nodesAdded: [{ id: "module/nope.import", type: "import" }] } }], [site.file]), []);
  assert.deepEqual(toolsAddedByDelta(fleet, [], []), []);
  const funnelSite = tool(fleet, "telemetry.storage").evidence[0];
  assert.deepEqual(
    toolsAddedByDelta(fleet, [{ file: funnelSite.file, delta: { nodesAdded: [{ id: funnelSite.nodeId, type: "import" }] } }], [funnelSite.file])
      .filter((a) => a.tool === "telemetry.storage"),
    [],
  );
});

// ── M-BOUNDARY.2 — called vs present ─────────────────────────────────

test("M-BOUNDARY: `called` is USE, `byThread` is PRESENCE, and the difference is real", () => {
  const alerts = "telemetry/alerts.py:evaluate";
  // alerts.py imports the wrapper, so `requests` is PRESENT on the thread
  // (that is what carries the c1 policy to it). But the thread's only
  // outbound boundary is `_session().post` INSIDE the wrapper: it reaches
  // telemetry.http_client, and the IR never proves it reaches requests.
  assert.ok(fleet.byThread[alerts].includes("requests"), "present: routing still sees it");
  // time.time() is an import binding on this thread too: a runtime tool,
  // but a call the IR really did follow, so it belongs in `called`.
  assert.deepEqual(fleet.byThreadCalled[alerts], ["telemetry.http_client", "time"]);
  assert.ok(!fleet.byThreadCalled[alerts].includes("requests"),
    "called must not claim what the IR could not follow");

  // Per tool, the same split.
  const requests = tool(fleet, "requests");
  assert.ok(requests.threads.includes(alerts));
  assert.ok(!requests.calledOn.includes(alerts));
  const storage = tool(fleet, "telemetry.storage");
  assert.ok(storage.calledOn.length > 0 && storage.calledOn.length <= storage.threads.length);

  // The helpers agree with the maps.
  assert.deepEqual(stackCalledOnThread(fleet, alerts).map((t) => t.tool), ["telemetry.http_client", "time"]);
  const present = stackForThread(fleet, alerts).map((t) => t.tool);
  for (const c of stackCalledOnThread(fleet, alerts)) assert.ok(present.includes(c.tool), "called is a subset of present");

  // Every tool: calledOn is a subset of threads, everywhere.
  for (const t of fleet.tools) {
    for (const ep of t.calledOn ?? []) {
      assert.ok(t.threads.includes(ep), `${t.tool}: called on ${ep} but not present there`);
    }
  }
});

test("M-BOUNDARY: the packet line and the thread spec say which tools are actually reached", () => {
  const line = packetStackLine(fleet, "telemetry/app.py:ingest_route");
  assert.match(line, /sqlite3 \[db\] CALLED/);
  assert.match(line, /telemetry\.storage \[db, project funnel wrapping sqlite3\] CALLED/);
  assert.match(line, /requests \[http-client\] present in the files, not called on this thread/);

  const spec = formatSystemSpec(fleet, fleetConstraints, { entryPointId: "telemetry/alerts.py:evaluate" });
  assert.match(spec, /telemetry\.http_client[^\n]*CALLED here/);
  assert.match(spec, /requests \([^\n]*present, not called on this thread/);

  // The PROJECT-level spec stays a presence list: "called" is only
  // meaningful against one thread's boundaries.
  assert.ok(!/CALLED here/.test(formatSystemSpec(fleet, fleetConstraints)));
});

test("M-BOUNDARY: an index built without thread nodes says nothing about called, rather than 'none'", () => {
  const noNodes = buildStackIndex({
    files: fleetEnv.files,
    threads: fleetEnv.threads.map((t) => ({ entryPointId: t.entryPointId, filesReached: t.filesReached })),
  }, FLEET);
  assert.equal(noNodes.byThreadCalled, undefined);
  assert.equal(tool(noNodes, "requests").calledOn, undefined);
  // ... and the renders stay silent about it instead of reporting every
  // tool as uncalled.
  const line = packetStackLine(noNodes, "telemetry/app.py:ingest_route");
  assert.ok(!/CALLED|not called/.test(line), line);
});

// ── M-BOUNDARY.3 — the pre-check names the CALL, not just the file ────

test("M-BOUNDARY: a CALL added to a file that already imports the tool is caught", () => {
  // The case the import-only reading could never see. models-style edit:
  // telemetry/http_client.py already imports requests, so adding
  // `requests.get(url)` introduces NO import node at all — and the old
  // check therefore found nothing while the policy was plainly broken.
  const FILE = "telemetry/http_client.py";
  const callNode = {
    id: "module/post_json.fn/requests_get.call", type: "call",
    funcName: "requests.get", effectKind: "http", preview: 'requests.get(url, timeout=2)',
  };
  const afterFiles = {
    [FILE]: { ...fleetEnv.files[FILE], nodes: [...fleetEnv.files[FILE].nodes, callNode] },
  };
  const added = toolsAddedByDelta(
    fleet,
    [{ file: FILE, delta: { nodesAdded: [{ id: callNode.id, type: "call" }] } }],
    [FILE],
    afterFiles,
  );
  const requests = added.find((a) => a.tool === "requests");
  assert.ok(requests, `requests not caught: ${JSON.stringify(added)}`);
  assert.equal(requests.site, "call");
  assert.equal(requests.nodeId, callNode.id);
  assert.equal(requests.preview, "requests.get(url, timeout=2)");
  assert.equal(requests.alsoElsewhere, false, "http_client.py is the only file that has it");

  // Without the post-edit IR the check falls back to imports alone and
  // finds nothing — which is exactly the gap M-BOUNDARY.3 closed.
  assert.deepEqual(
    toolsAddedByDelta(fleet, [{ file: FILE, delta: { nodesAdded: [{ id: callNode.id, type: "call" }] } }], [FILE]),
    [],
  );
});

test("M-BOUNDARY: an IMPORT with no call through it yet is reported as the smaller thing", () => {
  const FILE = "telemetry/http_client.py";
  const added = toolsAddedByDelta(
    fleet,
    [{ file: FILE, delta: { nodesAdded: [{ id: "module/requests.import", type: "import" }] } }],
    [FILE],
    { [FILE]: fleetEnv.files[FILE] },
  );
  const requests = added.find((a) => a.tool === "requests");
  assert.equal(requests.site, "import");
  assert.equal(requests.preview, undefined);
});

test("M-BOUNDARY: a builtin, project code or a funnel is never 'a tool this edit reached for'", () => {
  const FILE = "telemetry/storage.py";
  const nodes = [
    { id: "n1", type: "call", funcName: "len" },                       // builtin
    { id: "n2", type: "call", funcName: "_row_to_dict" },              // local helper
    { id: "n3", type: "assignment", valueKind: "call", callTarget: "sqlite3.connect", effectKind: "db", preview: "sqlite3.connect(DB)" },
  ];
  const afterFiles = { [FILE]: { ...fleetEnv.files[FILE], nodes: [...fleetEnv.files[FILE].nodes, ...nodes] } };
  const added = toolsAddedByDelta(
    fleet,
    [{ file: FILE, delta: { nodesAdded: nodes.map((n) => ({ id: n.id, type: n.type })) } }],
    [FILE],
    afterFiles,
  );
  assert.deepEqual(added.map((a) => a.tool), ["sqlite3"], JSON.stringify(added));
  assert.equal(added[0].site, "call");
  assert.equal(added[0].via, "telemetry.storage", "the funnel it happened inside is named");
});

// ── M-RUST.4 — Rust stack facts ──────────────────────────────────────
//
// The fifth language joins the index. What is specific to Rust, and what
// each case is guarding:
//   * the CRATE ROOT is the tool (`use reqwest::blocking::Client` is
//     reqwest, not `reqwest::blocking`);
//   * `std`/`core`/`alloc` is the COMPLETE standard library, so
//     `third-party` for anything else is a sound claim rather than the
//     shrug bash needs;
//   * Cargo.toml supplies versions, and a package written `actix-web` is
//     imported `actix_web` — both spellings have to resolve;
//   * this crate's OWN name in a use path is project code, not a
//     dependency, and only the manifest says so.
const RUST_FIX = join(ROOT, "test", "fixtures", "rust", "router_demo");
const rustFiles = JSON.parse(readFileSync(join(RUST_FIX, "router_demo.ir.json"), "utf-8"));
const rustThreadPayload = JSON.parse(readFileSync(join(RUST_FIX, "router_demo.thread.json"), "utf-8"));
const rustThreads = Array.isArray(rustThreadPayload)
  ? rustThreadPayload
  : (rustThreadPayload.threads ?? [rustThreadPayload]);
const rust = buildStackIndex({ files: rustFiles, threads: rustThreads }, RUST_FIX);
const rustTool = (name) => rust.tools.find((t) => t.tool === name);

test("M-RUST.4: a declared crate is third-party WITH its Cargo.toml version", () => {
  const sj = rustTool("serde_json");
  assert.ok(sj, `serde_json missing: ${rust.tools.map((t) => t.tool).join(", ")}`);
  assert.equal(sj.origin, "third-party");
  assert.equal(sj.role, "data");
  assert.equal(sj.version, "1.0", "the version comes from Cargo.toml, never from the import");
  assert.ok((sj.evidence ?? []).length > 0, "and it is backed by a parse site");
});

test("M-RUST.4: std is the standard library, and never a dependency", () => {
  const std = rustTool("std");
  assert.ok(std, "std must appear — `use std::fs` is a real fact about this code");
  assert.equal(std.origin, "stdlib");
  assert.equal(std.role, "runtime");
  assert.equal(std.version, undefined, "a stdlib root has no manifest line to take a version from");
});

test("M-RUST.4: the crate's OWN modules are project code, not tools", () => {
  // `use router_demo::router::{…}` in main.rs and in tests/ names THIS
  // crate. Only Cargo.toml says so, which is why the parser reads it.
  for (const t of rust.tools) {
    assert.notEqual(t.tool, "router_demo",
      "the crate's own name must never be listed as a dependency");
    assert.notEqual(t.tool, "crate");
  }
});

test("M-RUST.4: a project module that wraps a crate is a FUNNEL", () => {
  const funnel = rust.tools.find((t) => t.origin === "project" && (t.wraps ?? []).length);
  assert.ok(funnel, `no funnel found: ${JSON.stringify(rust.tools.map((t) => [t.tool, t.origin]))}`);
  assert.deepEqual(funnel.wraps, ["serde_json"],
    "src/store.rs is the one path to serde_json, so it is the funnel");
});

test("M-RUST.4: the crate root is the tool, not the module path it was reached through", () => {
  const { role, origin } = classifyTool("rust", "reqwest");
  assert.equal(role, "http-client");
  assert.equal(origin, "third-party");
  // A package is written with dashes and imported with underscores.
  assert.equal(classifyTool("rust", "actix_web").role, "web-framework");
  // An unrecognised root is UNKNOWN, not third-party: a table entry is
  // evidence the crate exists off-tree, an unknown root is not (M-TABLES).
  assert.deepEqual(classifyTool("rust", "some_private_crate"),
    { role: "unknown", origin: "unknown" });
  // std/core/alloc is complete by definition, unlike C++'s convention.
  for (const root of ["std", "core", "alloc"]) {
    assert.deepEqual(classifyTool("rust", root), { role: "runtime", origin: "stdlib" });
  }
});

test("M-RUST.4: boundaries attribute through the `use` binding, and `::` is the separator", () => {
  const storeIr = rustFiles["src/store.rs"];
  const bindings = importBindings(storeIr.nodes, "rust",
    (spec) => isOwnCrateSpec("rust", spec, storeIr.crateName));
  const attribute = (file, label) => {
    const ir = rustFiles[file];
    const node = (ir.nodes ?? []).find((n) => (n.callTarget ?? n.funcName) === label);
    assert.ok(node, `${label} missing from ${file}`);
    return attributeBoundary({
      language: "rust", label, file, effectKind: node.effectKind, irNodeId: node.id,
      stack: rust,
      imports: importBindings(ir.nodes, "rust", (s) => isOwnCrateSpec("rust", s, ir.crateName)),
      locals: localBindings(ir.nodes, "rust"),
    });
  };

  // `use std::fs` binds `fs`; the call is `fs::read_to_string`. Splitting
  // a head on `.` alone left this unattributed — Rust qualifies with `::`.
  assert.deepEqual(bindings.find((b) => b.binding === "fs")?.spec, "std");
  const read = attribute("src/store.rs", "fs::read_to_string");
  assert.equal(read?.tool, "std");
  assert.equal(read?.origin, "stdlib");
  assert.equal(read?.via, "src.store", "and it is named as going through the funnel");

  // A std MACRO is a boundary without being a dependency.
  const mainIr = rustFiles["src/main.rs"];
  const println = (mainIr.nodes ?? []).find((n) => n.funcName === "println!");
  const logged = attributeBoundary({
    language: "rust", label: "println!", file: "src/main.rs",
    effectKind: println.effectKind, irNodeId: println.id, stack: rust,
    imports: importBindings(mainIr.nodes, "rust"), locals: [],
  });
  assert.deepEqual(
    [logged?.tool, logged?.origin, logged?.how],
    ["std", "stdlib", "runtime"],
  );

  // A call into the crate's own module is PROJECT — never a third-party
  // tool invented out of the crate's name.
  const own = attribute("src/main.rs", "Store::open");
  assert.equal(own?.origin, "project", JSON.stringify(own));
});

test("M-RUST.4: a `use` of the OWN crate is not a new dependency to a pre-check", () => {
  // The pre-check that reports a new dependency reads a FRESH post-edit
  // IR, which is not in the index — so project knowledge has to come off
  // the IR's own crateName. Without it, adding `use router_demo::store`
  // would read as a third-party arrival: a false alarm, in a gate.
  assert.equal(isOwnCrateSpec("rust", "router_demo::store", "router_demo"), true);
  assert.equal(isOwnCrateSpec("rust", "crate::router", "router_demo"), true);
  assert.equal(isOwnCrateSpec("rust", "super::helpers", "router_demo"), true);
  assert.equal(isOwnCrateSpec("rust", "serde_json", "router_demo"), false);
  assert.equal(isOwnCrateSpec("rust", "std::fs", "router_demo"), false);
  // With no manifest found the parser stamps no crateName, and the rule
  // declines rather than guessing the spec is ours.
  assert.equal(isOwnCrateSpec("rust", "router_demo::store", null), false);
  // Other languages are untouched by it.
  assert.equal(isOwnCrateSpec("python", "os.path", "router_demo"), false);
});

test("an ALIASED import of the project's own module is project code, never a tool (import cache as cachelib)", () => {
  // The IR records the name as "cache as cachelib"; read whole it matched no
  // module and became a third-party tool called `cache` on the architecture
  // map (a private production codebase: `import discover_large as dl`, `compare as cmp`, `patch_fact_scale2 as pfs`).
  const root = join(ROOT, "test", "fixtures", "system", "system_demo");
  const env = buildPolyglotEnvelope(root).envelope;
  const index = buildStackIndex(env, root);
  const b = index.importsByFile["app.py"].find((x) => x.binding === "cachelib");
  assert.equal(b.spec, "cache");
  assert.equal(b.project, true);
  const a = attributeBoundary({ label: "cachelib.cache.get", language: "python", file: "app.py", imports: index.importsByFile["app.py"], stack: index });
  assert.equal(a?.origin, "project", "a call through the alias is project code");
});
