/**
 * Example 4 — fleet-telemetry, pinned against its README (2026-09-07).
 *
 * The four-language codebase the constraint drill runs on. Pins the
 * things the README claims: every file parses, entry points per
 * language, threads deep enough for assignment to matter (the ingest
 * route walks 8 files), the honest unresolved overload, and — the point
 * of the example — that the five HUMAN-STATED constraints route by file
 * scope exactly as intended: c1/c3 to every Python thread, c2 only to
 * the export/app/cli/gateway threads, c4 only to the gateway, c5 only to
 * the write path, and NOTHING to the codec. Read-only over the example.
 *
 * Run: npm run test:example-fleet
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { computeThreadContract, formatContractBlock, summarizeContract } from "../src/server/thread_contract.ts";
import { loadConstraints, routeConstraints } from "../src/server/constraint_store.ts";
import { buildStackIndex, contractStackForFile } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { languageForPath } from "../src/shared/languages.ts";
import { checkConstraint, describeCheck } from "../src/server/constraint_grammar.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXAMPLE = join(ROOT, "examples", "fleet-telemetry");
const built = buildPolyglotEnvelope(EXAMPLE);
const env = built.envelope;
const constraints = loadConstraints(EXAMPLE);
// M-STACK — the stack facts the stack-scoped constraint routes on.
const stack = buildStackIndex(env, EXAMPLE);
// M-XLANG.1 - where a thread leaves its own language over HTTP.
const crossings = buildCrossingIndex(env);
const nodeFor = (file, irNodeId) => {
  if (!irNodeId) return null;
  for (const ir of file ? [env.files[file]].filter(Boolean) : Object.values(env.files)) {
    const n = ir.nodes.find((x) => x.id === irNodeId);
    if (n) return n;
  }
  return null;
};
const thread = (ep) => {
  const t = env.threads.find((x) => x.entryPointId === ep);
  assert.ok(t, `thread ${ep} missing`);
  return t;
};
// M-BOUNDARY.1  the three injections the server makes in threadContractFor.
const fileOfNode = (irNodeId) =>
  Object.entries(env.files).find(([, ir]) => ir.nodes.some((n) => n.id === irNodeId))?.[0] ?? null;
const contractOf = (ep) => computeThreadContract(thread(ep), {
  nodeFor, reaches: [], reachedBy: [],
  stackFor: (f) => contractStackForFile(stack, f),
  fileOfNode,
  importsFor: (f) => stack.importsByFile?.[f] ?? [],
  localsFor: (f) => stack.localsByFile?.[f] ?? [],
  handlerFor: (f, irNodeId) => {
    const fnId = irNodeId.split("/").slice(0, 2).join("/");
    const ep = env.entryPoints.find((e) => e.kind === "route" && e.file === f && e.irNodeId === fnId);
    if (!ep) return null;
    const fn = (env.files[f]?.nodes ?? []).find((n) => n.id === fnId);
    return { framework: ep.framework ?? null, params: fn?.params ?? [] };
  },
  stackIndex: stack,
  crossingsFor: (id) => crossings.byThread[id] ?? [],
});
const routedTo = (ep) => {
  const c = contractOf(ep);
  return routeConstraints(constraints, {
    entryPointId: ep, filesReached: c.filesReached, stack: c.stack.map((x) => x.tool),
  }).map((x) => x.id);
};
/** Route with ONLY the stack half of each scope — proves the tool scope
 *  carries c1 on its own, not on the coincidence of the file prefix. */
const routedByStackOnly = (ep) => {
  const c = contractOf(ep);
  const stackOnly = constraints
    .filter((x) => x.scope.stack?.length)
    .map((x) => ({ ...x, scope: { stack: x.scope.stack } }));
  return routeConstraints(stackOnly, {
    entryPointId: ep, filesReached: c.filesReached, stack: c.stack.map((x) => x.tool),
  }).map((x) => x.id);
};

test("every file in all four languages parses; the shape the README describes", () => {
  assert.deepEqual(built.parseErrors, {});
  assert.equal(Object.keys(env.files).length, 32);
  const perLang = {};
  for (const e of env.entryPoints) { const l = languageForPath(e.file).id; perLang[l] = (perLang[l] ?? 0) + 1; }
  // 27, and every increment above the original 23 is a function whose only
  // callers sat in an expression position the parser did not walk:
  //
  //   require_token    `if not require_token(request):`          (condition-call fix)
  //   recent_events    `jsonify({"events": recent_events(50)})`  (M-SWEEP W1)
  //   list_device_ids  `jsonify({"devices": list_device_ids()})` (M-SWEEP W1)
  //   rolling_mean     `"temp_hour_mean": rolling_mean(t) if t else None`
  //
  // The last three are calls inside a DICT LITERAL passed as an argument —
  // which is the entire body of two of this example's Flask routes. The
  // routes were discovered; what they actually did was not.
  assert.deepEqual(perLang, { python: 27, jsts: 8, bash: 2, cpp: 3 });
  for (const id of ["telemetry/auth.py:require_token", "telemetry/alerts.py:recent_events",
                    "telemetry/devices.py:list_device_ids", "telemetry/metrics_math.py:rolling_mean"]) {
    assert.ok(env.entryPoints.some((e) => e.id === id),
      `${id} is reachable, and was invisible before the expression sweep`);
  }
  const kinds = Object.fromEntries(env.entryPoints.map((e) => [e.id, e.kind]));
  assert.equal(kinds["telemetry/app.py:ingest_route"], "route");
  assert.equal(kinds["telemetry/cli.py:main"], "cli");
  assert.equal(kinds["gateway/server.ts:getFleet"], "route");
  assert.equal(kinds["ops/deploy.sh:main"], "cli");
  assert.equal(kinds["codec/main.cpp:main"], "cli");
});

test("threads are deep enough for assignment to matter, and never cross a language", () => {
  const ingest = computeThreadContract(thread("telemetry/app.py:ingest_route"), { nodeFor, reaches: [], reachedBy: [] });
  // 9, not 8, since the condition-call fix (2026-09-10). The ninth is
  // `telemetry/auth.py`, and its absence was the bug: the route's FIRST
  // statement is `if not require_token(request):`, and a call written in an
  // `if` test emitted no IR node — so the thread a worker was handed showed
  // the ingest route WITHOUT its authentication gate, while c4 ("never
  // forwards /ingest without the caller's token") was routed to it.
  assert.equal(ingest.filesReached.length, 9, ingest.filesReached.join(","));
  assert.ok(ingest.filesReached.includes("telemetry/auth.py"),
    "the ingest route goes through the token check — the thread must say so");
  assert.ok(ingest.filesReached.includes("telemetry/alerts.py") && ingest.filesReached.includes("telemetry/storage.py"));
  for (const t of env.threads) {
    const lang = languageForPath(t.seed.file).id;
    for (const f of t.filesReached) assert.equal(languageForPath(f).id, lang, `${t.entryPointId} crossed into ${f}`);
  }
  const main = thread("codec/main.cpp:main");
  assert.ok(main.nodes.some((n) => n.kind === "unresolved" && n.label === "scale"), "the overloaded scale is unresolved");
  const fleet = computeThreadContract(thread("gateway/server.ts:getFleet"), { nodeFor, reaches: [], reachedBy: [] });
  assert.equal(fleet.roundTrips.length, 1, "the N+1 fleet view is flagged");
});

test("the six human-stated constraints route by scope — the assignment the drill depends on", () => {
  assert.deepEqual(constraints.map((c) => c.id), ["c1", "c2", "c3", "c4", "c5", "c6"]);
  assert.ok(constraints.every((c) => c.source === "human"));
  // c6 (live installs predate every schema change → a migration module) reaches exactly the threads that touch storage.py.
  assert.deepEqual(routedTo("telemetry/app.py:ingest_route"), ["c1", "c2", "c3", "c5", "c6"], "ingest: proxy, export (app.py), dedup, batching, migration");
  assert.deepEqual(routedTo("telemetry/app.py:export_route"), ["c1", "c2", "c3", "c5", "c6"]);
  assert.deepEqual(routedTo("telemetry/alerts.py:evaluate"), ["c1", "c3"], "alerts: proxy + dedup only — no export contract, no batching, no storage");
  assert.deepEqual(routedTo("telemetry/storage.py:insert_readings"), ["c1", "c3", "c5", "c6"], "the write path gets the batching lever and the migration rule");
  assert.deepEqual(routedTo("telemetry/backfill.py:backfill_from_file"), ["c1", "c2", "c3", "c5", "c6"]);
  assert.deepEqual(routedTo("gateway/server.ts:getFleet"), ["c2", "c4"], "gateway: export positions + token forwarding only");
  assert.deepEqual(routedTo("gateway/server.ts:postIngestRoute"), ["c2", "c4"]);
  assert.deepEqual(routedTo("ops/deploy.sh:main"), [], "ops sees none");
  assert.deepEqual(routedTo("codec/main.cpp:main"), [], "the codec sees none — that is the point");
});

test("M-STACK: the stack facts, and c1's TOOL scope routing the proxy policy dynamically", () => {
  // The funnel is a fact, not a name: telemetry/http_client.py imports
  // requests and other project modules reach it.
  const wrapper = stack.tools.find((t) => t.tool === "telemetry.http_client");
  assert.equal(wrapper.origin, "project");
  assert.equal(wrapper.role, "http-client");
  assert.deepEqual(wrapper.wraps, ["requests"]);

  // c1 now carries the structured policy the deterministic checks read.
  const c1 = constraints.find((c) => c.id === "c1");
  assert.deepEqual(c1.policy, {
    tool: "requests", role: "http-client", rule: "replace-with", with: "telemetry.http_client",
    reason: "the egress proxy and the service token live in the wrapper; a bare call bypasses both",
  });
  assert.deepEqual(c1.scope.stack, ["requests", "httpx"]);

  // On the TOOL scope alone, c1 reaches exactly the threads whose stack
  // uses requests — including alerts/ingest, which reach it only THROUGH
  // the wrapper. The codec and the ops scripts still see nothing.
  assert.deepEqual(routedByStackOnly("telemetry/alerts.py:evaluate"), ["c1"], "reached only through the wrapper");
  assert.deepEqual(routedByStackOnly("telemetry/app.py:ingest_route"), ["c1"]);
  assert.deepEqual(routedByStackOnly("telemetry/storage.py:insert_readings"), [], "the write path never touches http");
  assert.deepEqual(routedByStackOnly("gateway/server.ts:getFleet"), []);
  assert.deepEqual(routedByStackOnly("codec/main.cpp:main"), []);
  assert.deepEqual(routedByStackOnly("ops/deploy.sh:main"), [], "curl is an http client, but it is not `requests`");

  // Adding the tool scope changed NO existing routing: file scopes stay.
  assert.deepEqual(routedTo("telemetry/alerts.py:evaluate"), ["c1", "c3"]);
  assert.deepEqual(routedTo("codec/main.cpp:main"), []);
});

// ── M-BOUNDARY.1 — the gap this milestone closed, on the drill example ──

test("M-BOUNDARY: ingest's db boundaries name sqlite3 THROUGH the storage funnel", () => {
  const c = contractOf("telemetry/app.py:ingest_route");
  const commit = c.externals.find((e) => e.label === "conn.commit");
  assert.ok(commit, "the commit boundary is in the contract");
  assert.equal(commit.tool.tool, "sqlite3");
  assert.equal(commit.tool.role, "db");
  assert.equal(commit.tool.via, "telemetry.storage", "it goes out through the project's db funnel");
  assert.equal(commit.tool.how, "qualified", "the linker resolved the receiver — not a guess");
  // It carries no parse-time effect; the tool's ROLE supplies one, labelled.
  assert.equal(commit.effectKind, null);
  assert.equal(commit.effectFromRole, "db");
  assert.equal(c.effectsByRole.db > 0, true);

  const block = formatContractBlock(c);
  assert.match(block, /sqlite3 \[db, stdlib\] via telemetry\.storage/);
  assert.match(block, /by tool role/);
  // flask reaches the route through an import binding.
  assert.ok(c.called.includes("flask"), `called: ${c.called.join(",")}`);
  assert.ok(c.called.includes("sqlite3") && c.called.includes("telemetry.storage"));
});

test("M-BOUNDARY: the alerts thread stops claiming purity — its webhook is a boundary", () => {
  const c = contractOf("telemetry/alerts.py:evaluate");
  const post = c.externals.find((e) => e.label === "_session().post");
  assert.ok(post, "the outbound HTTP call is in the contract");
  assert.equal(post.tool.tool, "telemetry.http_client");
  assert.equal(post.tool.how, "funnel-file", "the callee never resolved; where it LIVES is the honest claim");
  assert.equal(post.tool.calleeUnresolved, true);
  assert.deepEqual(post.tool.wraps, ["requests"]);
  // No DERIVED effect: where a call lives is too weak to claim an http
  // round trip (that rule invented an N+1 on `res.json()`). The boundary
  // is still reported - which is the thing that was missing.
  assert.equal(post.effectFromRole, undefined);

  const block = formatContractBlock(c);
  assert.match(block, /inside telemetry\.http_client \(project funnel wrapping requests\)/);
  assert.ok(!/pure as far as the IR sees/.test(block),
    "before M-BOUNDARY this thread reported itself pure while posting a webhook");
  assert.match(block, /boundary\/boundaries leave the project/);
});

test("M-BOUNDARY: called ⊆ present, and the difference is real on this example", () => {
  let sawDifference = false;
  for (const t of env.threads) {
    const c = contractOf(t.entryPointId);
    for (const name of c.called) {
      assert.ok(c.stack.some((s) => s.tool === name),
        `${t.entryPointId}: ${name} called but not present`);
    }
    if (c.called.length < c.stack.length) sawDifference = true;
  }
  assert.ok(sawDifference, "presence is a superset — some thread holds a tool it never calls");
  // The index agrees with the contracts.
  assert.ok(stack.byThreadCalled, "the index computed called-vs-present");
  const ingestCalled = stack.byThreadCalled["telemetry/app.py:ingest_route"];
  assert.ok(ingestCalled.includes("sqlite3") && ingestCalled.includes("telemetry.storage"));
  assert.ok(stack.byThread["telemetry/app.py:ingest_route"].includes("requests"),
    "requests is PRESENT (http_client.py is on the thread)");
});

test("M-BOUNDARY: a bash command word attributes by the call site the index already keyed", () => {
  const c = contractOf("ops/deploy.sh:main");
  const curl = c.externals.find((e) => e.label === "curl");
  assert.equal(curl.tool.tool, "curl");
  assert.equal(curl.tool.how, "call-site");
  const psql = c.externals.find((e) => e.label === "psql");
  assert.equal(psql.tool.role, "db");
  // The round trip inside the smoke loop now names the tool it pays.
  const rt = c.roundTrips.find((r) => r.calls.some((k) => k.label === "curl"));
  assert.ok(rt, "the per-host curl loop is still a round trip");
  assert.equal(rt.calls.find((k) => k.label === "curl").tool.tool, "curl");
});

test("M-BOUNDARY/M-RESOLVE.2: a C++ call is attributed only when the file INCLUDES the header", () => {
  const c = contractOf("codec/main.cpp:main");
  const printf = c.externals.find((e) => e.label === "printf");
  assert.ok(printf, "the call is still listed");
  // M-BOUNDARY's D5 said C++ stays unattributed because a symbol->header
  // map is what a build graph provides. M-RESOLVE.2 EXTENDS that rather
  // than breaking it: this fires only because main.cpp really does
  // `#include <cstdio>`, and an include is evidence in exactly the way an
  // import is elsewhere.
  assert.equal(printf.tool.tool, "cstdio");
  assert.equal(printf.tool.how, "runtime");
  const includesCstdio = (env.files["codec/main.cpp"].nodes ?? [])
    .some((n) => n.type === "import" && (n.names ?? []).some((x) => String(x).includes("cstdio")));
  assert.ok(includesCstdio, "the attribution rests on this include, not on a symbol table");
  // A call with no header behind it is still unknown, and still said to be.
  assert.ok(c.boundaries.unattributed > 0);
  assert.match(formatContractBlock(c), /Not attributed to a tool/);
});

// ── M-XLANG.1 - the fork PLAN-v5 called HEAVY, on the example it needed ──

test("M-XLANG: the gateway thread's contract names the Python route it calls", () => {
  const c = contractOf("gateway/server.ts:postIngestRoute");
  assert.equal(c.language, "jsts");
  assert.equal(c.crossings.length, 1);
  const x = c.crossings[0];
  assert.equal(x.path, "/ingest");
  assert.equal(x.method, "POST");
  assert.deepEqual(x.targets.map((t) => t.entryPointId), ["telemetry/app.py:ingest_route"]);
  assert.equal(x.confidence, "path+method");

  const block = formatContractBlock(c);
  assert.match(block, /Crosses into \(hops that leave this thread's language or process/);
  assert.match(block, /POST \/ingest -> telemetry\/app\.py:ingest_route \[POST, flask\] \(path\+method\)/);
  assert.match(block, /what this match could not establish:.*base URL is not resolved/);
});

test("M-XLANG: the crossing does NOT widen the thread - filesReached stays one language", () => {
  const c = contractOf("gateway/server.ts:postIngestRoute");
  for (const f of c.filesReached) assert.equal(languageForPath(f).id, "jsts", f);
  assert.ok(!c.filesReached.some((f) => f.startsWith("telemetry/")),
    "the Python route is a hop this thread WEIGHS, not a file it walks");
  assert.deepEqual(summarizeContract(c).crossesInto, ["telemetry/app.py:ingest_route"]);
});

test("M-XLANG: a bash script's curl crosses too, and stays ambiguous when two services serve it", () => {
  const c = contractOf("ops/deploy.sh:main");
  const health = c.crossings.find((x) => x.path === "/health");
  assert.equal(health.confidence, "ambiguous");
  assert.match(formatContractBlock(c), /GET \/health -> AMBIGUOUS: /);
  assert.deepEqual(summarizeContract(c).crossesInto,
    ["gateway/server.ts:getHealth", "telemetry/app.py:health"]);
});

test("M-XLANG: a thread with no HTTP hop has no crossings, and says nothing about them", () => {
  const c = contractOf("telemetry/storage.py:insert_readings");
  assert.deepEqual(c.crossings, []);
  assert.ok(!/Crosses into/.test(formatContractBlock(c)));
});

test("M-RESOLVE: a third of this example's unknown receivers resolve for FREE", () => {
  // The census that motivated the rule: across fleet/shop/pump, 34% of
  // unresolved receivers were bound to a literal in the same file. This
  // pins the effect on the example the drills run on - no tokens, no run.
  let localData = 0;
  let unattributed = 0;
  for (const t of env.threads) {
    const c = contractOf(t.entryPointId);
    localData += c.boundaries.localData;
    unattributed += c.boundaries.unattributed;
  }
  assert.ok(localData > 20, `expected a real population of local-data calls, got ${localData}`);
  assert.ok(localData > unattributed / 3, "the free rule pays for a meaningful share of the fog");

  // The gateway's schema check is the clearest case: `problems = []`.
  const c = contractOf("gateway/server.ts:postIngestRoute");
  const push = c.externals.find((e) => e.label === "problems.push");
  assert.equal(push.tool.how, "local-literal");
  assert.equal(push.tool.tool, "list");
  const block = formatContractBlock(c);
  assert.match(block, /Local data operations \(not boundaries/);
  // ...and it is NOT in the boundary list, which is the point.
  assert.ok(!/Leaves the project through[^]*problems\.push/.test(block.split("Local data operations")[0]));
});

test("M-RESOLVE.3: an express handler's `res` is express, by POSITION not by name", () => {
  const c = contractOf("gateway/server.ts:postIngestRoute");
  const res = c.externals.find((e) => e.label.startsWith("res."));
  assert.ok(res, "the handler writes its response");
  assert.equal(res.tool.tool, "express");
  assert.equal(res.tool.how, "handler-param");
  assert.equal(res.tool.role, "web-framework");
  // ...and writing a response is not a round trip this project pays.
  assert.equal(res.effectFromRole, undefined);
  assert.ok(c.called.includes("express"));
});

// ── M-GRAMMAR / W6 — the drill's rules are CHECKABLE, not just prose ──
//
// The h2h2 finding this closes: a model reviewer read "routed through
// should_notify then notify", agreed with the words, and approved — while
// the checker said `notifyCallers = [telemetry/ingest.py]`. c3 is two
// clauses in one sentence, and until W6 a constraint could carry only one.

/** The project facts a check is evaluated against, built the way the
 *  server's buildCheckFacts does — reference edges for callers, the stack
 *  index for imports, and every unresolved call as something not followed. */
function checkFacts() {
  const references = [], unresolved = [], defined = new Set();
  for (const [file, ir] of Object.entries(env.files)) {
    const resolved = new Set();
    for (const e of ir.edges ?? []) {
      if (e?.type !== "reference" || typeof e.source !== "string") continue;
      resolved.add(e.source);
      const q = typeof e.qualifiedTarget === "string" ? e.qualifiedTarget : "";
      const fromQ = q.includes(":") ? q.slice(q.lastIndexOf(":") + 1) : "";
      const seg = String(e.target ?? "").split("/").filter((x) => x.endsWith(".fn")).pop() ?? "";
      const toName = fromQ || (seg ? seg.slice(0, -3) : "");
      if (toName) references.push({ fromFile: file, fromNodeId: e.source, toFile: e.targetFile ?? null, toName });
    }
    for (const n of ir.nodes ?? []) {
      if (n?.type === "function_def" && typeof n.name === "string") defined.add(n.name);
      if (n?.type === "call" && !resolved.has(n.id) && typeof n.funcName === "string") {
        unresolved.push({ file, label: n.funcName });
      }
    }
  }
  return {
    references, unresolved, definedNames: [...defined],
    importsByFile: Object.fromEntries(Object.entries(stack.byFile ?? {}).map(([f, t]) => [f, [...t]])),
  };
}

test("M-GRAMMAR: c1 and c3 carry machine-checkable clauses, and the clean example passes them", () => {
  const byId = Object.fromEntries(constraints.map((c) => [c.id, c]));
  // c1 — the proxy rule IS an import-only rule.
  assert.equal(byId.c1.check?.rule, "import-only");
  // c3 — TWO clauses, which is exactly what W6 exists for.
  assert.equal(byId.c3.checks?.length, 2, "c3 says two checkable things in one sentence");

  const facts = checkFacts();
  for (const c of [byId.c1, byId.c3]) {
    for (const clause of [...(c.checks ?? []), ...(c.check ? [c.check] : [])]) {
      const r = checkConstraint(facts, clause);
      assert.equal(r.verdict, "pass",
        `${c.id} (${describeCheck(clause)}) should hold on the clean example: ${r.reason}`);
    }
  }
});

test("M-GRAMMAR: the h2h2 violation is caught deterministically, with the node named", () => {
  // Sample 3 paged region changes through should_notify → notify but FROM
  // ingest.py. The dedup half of c3 held; the module-boundary half did not,
  // and the reviewer approved it as compliant. Injected back in, the check
  // rejects it before any model reads a diff.
  const byId = Object.fromEntries(constraints.map((c) => [c.id, c]));
  const facts = checkFacts();
  const withViolation = {
    ...facts,
    references: [...facts.references, {
      fromFile: "telemetry/ingest.py",
      fromNodeId: "module/ingest_batch.fn/notify.call",
      toFile: "telemetry/alerts.py",
      toName: "notify",
    }],
  };
  const verdicts = byId.c3.checks.map((clause) => checkConstraint(withViolation, clause));
  assert.deepEqual(verdicts.map((v) => v.verdict), ["violated", "violated"]);
  assert.ok(verdicts[0].offenders.includes("telemetry/ingest.py:module/ingest_batch.fn/notify.call"),
    `the reject names the offending call node: ${JSON.stringify(verdicts[0].offenders)}`);
});
