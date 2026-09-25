/**
 * M-BOUNDARY.1 — boundary attribution, the pure rule.
 *
 * Every row of PLAN-M-BOUNDARY's rule table, including the two honest
 * limits it names: a `from x import y as z` alias (parse_cst.py drops the
 * asname, so the call is unattributed rather than guessed) and a C++ call
 * (no build graph, so nothing but the funnel/`std::` story applies).
 *
 * The floor under test: a boundary no rule REACHES returns null. Guessing
 * a tool from a receiver name is the M17.1 lie this refuses.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/stack_attribution.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attributeBoundary, importBindings, localBindings, effectFromRole, attributionLabel,
  JSTS_GLOBAL_TOOLS,
} from "../src/shared/stack_attribution.ts";

// A stack index shaped like the real one: two project funnels (with the
// `home` field that separates a funnel from its importers) and the
// third-party rows fleet-telemetry actually has.
const STACK = {
  tools: [
    {
      tool: "telemetry.storage", role: "db", origin: "project", wraps: ["sqlite3"],
      home: "telemetry/storage.py",
      files: ["telemetry/app.py", "telemetry/ingest.py", "telemetry/storage.py"],
      evidence: [{ file: "telemetry/storage.py", nodeId: "module/sqlite3.import", kind: "import" }],
    },
    {
      tool: "telemetry.http_client", role: "http-client", origin: "project", wraps: ["requests"],
      home: "telemetry/http_client.py",
      files: ["telemetry/alerts.py", "telemetry/http_client.py"],
      evidence: [{ file: "telemetry/http_client.py", nodeId: "module/requests.import", kind: "import" }],
    },
    {
      tool: "sqlite3", role: "db", origin: "stdlib", files: ["telemetry/storage.py"],
      evidence: [{ file: "telemetry/storage.py", nodeId: "module/sqlite3.import", kind: "import" }],
    },
    {
      tool: "requests", role: "http-client", origin: "third-party", files: ["telemetry/http_client.py"],
      evidence: [{ file: "telemetry/http_client.py", nodeId: "module/requests.import", kind: "import" }],
    },
    {
      tool: "flask", role: "web-framework", origin: "third-party", files: ["telemetry/app.py"],
      evidence: [{ file: "telemetry/app.py", nodeId: "module/flask.import_from", kind: "import" }],
    },
    {
      tool: "curl", role: "http-client", origin: "third-party", files: ["ops/deploy.sh"],
      evidence: [{ file: "ops/deploy.sh", nodeId: "module/smoke.fn/curl.call", kind: "call" }],
    },
  ],
};

const PY_APP_IMPORTS = [
  { binding: "request", spec: "flask" },
  { binding: "jsonify", spec: "flask" },
  { binding: "ingest_batch", spec: "telemetry.ingest", project: true },
];
const PY_STORAGE_IMPORTS = [{ binding: "sqlite3", spec: "sqlite3" }];

test("qualified: a linker-resolved receiver names its tool, and the funnel it lives in", () => {
  const a = attributeBoundary({
    language: "python", label: "conn.commit", kind: "external",
    qualifiedTarget: "sqlite3.Connection.commit",
    file: "telemetry/storage.py", imports: PY_STORAGE_IMPORTS, stack: STACK,
  });
  assert.equal(a?.tool, "sqlite3");
  assert.equal(a?.role, "db");
  assert.equal(a?.origin, "stdlib");
  assert.equal(a?.how, "qualified");
  assert.equal(a?.via, "telemetry.storage", "the call lives inside the storage funnel");
  assert.deepEqual(a?.wraps, ["sqlite3"]);
  assert.equal(attributionLabel(a), "sqlite3 [db, stdlib] via telemetry.storage");
});

test("binding: an imported name's receiver head names its tool", () => {
  const a = attributeBoundary({
    language: "python", label: "request.get_json", kind: "external",
    file: "telemetry/app.py", imports: PY_APP_IMPORTS, stack: STACK,
  });
  assert.equal(a?.tool, "flask");
  assert.equal(a?.role, "web-framework");
  assert.equal(a?.how, "binding");
  assert.equal(a?.via, undefined, "app.py imports the funnel, it is not inside it");
});

test("binding: an aliased module import resolves to the real tool", () => {
  const a = attributeBoundary({
    language: "python", label: "rq.post", kind: "external",
    file: "svc/client.py", imports: [{ binding: "rq", spec: "requests" }], stack: STACK,
  });
  assert.equal(a?.tool, "requests");
  assert.equal(a?.role, "http-client");
  assert.equal(a?.how, "binding");
});

test("binding: a call through PROJECT code is named as project code, never a tool", () => {
  const a = attributeBoundary({
    language: "python", label: "ingest_batch.run", kind: "unresolved",
    file: "telemetry/app.py", imports: PY_APP_IMPORTS, stack: STACK,
  });
  assert.equal(a?.origin, "project");
  assert.equal(a?.projectModule, "telemetry.ingest");
  assert.match(attributionLabel(a), /project code, unlinked/);
});

test("call-site: a bash command word joins on the very node the index keyed", () => {
  const a = attributeBoundary({
    language: "bash", label: "curl", kind: "external", effectKind: "http",
    file: "ops/deploy.sh", irNodeId: "module/smoke.fn/curl.call", stack: STACK,
  });
  assert.equal(a?.tool, "curl");
  assert.equal(a?.role, "http-client");
  assert.equal(a?.how, "call-site");
});

test("global: fetch is a boundary with a role, with no import to bind it", () => {
  const a = attributeBoundary({ language: "jsts", label: "fetch", kind: "external", effectKind: "http", stack: STACK });
  assert.equal(a?.tool, "fetch");
  assert.equal(a?.role, "http-client");
  assert.equal(a?.how, "global");
  assert.equal(JSTS_GLOBAL_TOOLS.fetch, "http-client");
});

test("funnel-file: an unresolved call INSIDE a funnel claims where it lives, not what it reaches", () => {
  const a = attributeBoundary({
    language: "python", label: "_session().post", kind: "external",
    file: "telemetry/http_client.py", imports: [{ binding: "requests", spec: "requests" }], stack: STACK,
  });
  assert.equal(a?.tool, "telemetry.http_client");
  assert.equal(a?.how, "funnel-file");
  assert.equal(a?.calleeUnresolved, true);
  assert.deepEqual(a?.wraps, ["requests"]);
  assert.equal(attributionLabel(a), "inside telemetry.http_client (project funnel wrapping requests)");
});

test("the funnel fallback is narrow: only a call that plausibly reaches OUT", () => {
  const inFunnel = (label, effectKind) => attributeBoundary({
    language: "python", label, kind: "external", effectKind,
    file: "telemetry/http_client.py", imports: [], stack: STACK,
  });
  // Regression: `raise ValueError(...)` inside a funnel was attributed to
  // the funnel and then given its role's effect — a fabricated round trip.
  assert.equal(inFunnel("ValueError")?.how, "builtin");
  assert.equal(inFunnel("_local_helper"), null, "a bare local name is not the funnel's outward path");
  assert.equal(inFunnel("_session().post")?.how, "funnel-file", "a method call on a receiver is");
  assert.equal(inFunnel("_write_audit", "fs")?.how, "funnel-file", "so is one the parser found effectful");
});

test("a funnel's IMPORTER is beside it, not inside it", () => {
  const a = attributeBoundary({
    language: "python", label: "mystery.call", kind: "unresolved",
    file: "telemetry/alerts.py", imports: [], stack: STACK,
  });
  assert.equal(a, null, "alerts.py imports the http_client funnel; a call there is not 'inside' it");
});

test("builtins are not boundaries — unless the call carries an effect", () => {
  const int = attributeBoundary({ language: "python", label: "int", kind: "external", stack: STACK });
  assert.equal(int?.how, "builtin");
  assert.equal(int?.role, "builtin");
  const open = attributeBoundary({ language: "python", label: "open", kind: "external", effectKind: "fs", stack: STACK });
  assert.notEqual(open?.how, "builtin", "an effectful bare name stays a boundary");
  const err = attributeBoundary({ language: "jsts", label: "Error", kind: "external", stack: STACK });
  assert.equal(err?.how, "builtin");
  const json = attributeBoundary({ language: "jsts", label: "JSON.parse", kind: "external", stack: STACK });
  assert.equal(json?.how, "builtin", "a builtin namespace head is still a builtin");
});

test("a runtime-bound receiver is unattributed, never guessed", () => {
  assert.equal(attributeBoundary({
    language: "jsts", label: "res.json", kind: "dynamic",
    file: "gateway/server.ts", imports: [{ binding: "express", spec: "express" }], stack: STACK,
  }), null);
  assert.equal(attributeBoundary({
    language: "python", label: "conn.executescript", kind: "dynamic",
    file: "svc/other.py", imports: [], stack: STACK,
  }), null, "`conn` LOOKS like sqlite3 — that is the M17.1 lie");
});

test("LIMIT: a from-import alias is dropped by the parser, so the call is unattributed", () => {
  // parse_cst.py's visit_ImportFrom keeps only `a.name`, never the asname:
  // `from flask import request as req` emits names ["request"].
  const bindings = importBindings(
    [{ id: "module/flask.import_from", type: "import_from", module: "flask", names: ["request"] }],
    "python",
  );
  assert.deepEqual(bindings.map((b) => b.binding), ["request"]);
  assert.equal(attributeBoundary({
    language: "python", label: "req.get_json", kind: "external",
    file: "telemetry/app.py", imports: bindings, stack: STACK,
  }), null);
});

test("LIMIT: a C++ call is unattributed — there is no build graph to say which header owns it", () => {
  assert.equal(attributeBoundary({
    language: "cpp", label: "printf", kind: "external", effectKind: "log",
    file: "codec/main.cpp", imports: [], stack: STACK,
  }), null);
});

test("importBindings reads every import shape the four frontends emit", () => {
  const py = importBindings([
    { id: "i1", type: "import", names: ["requests"] },
    { id: "i2", type: "import", names: ["requests as rq"] },
    { id: "i3", type: "import", names: ["os.path"] },
    { id: "i4", type: "import_from", module: "flask", names: ["Flask", "jsonify"] },
    { id: "i5", type: "import_from", module: "telemetry.ingest", names: ["ingest_batch"] },
  ], "python", (spec) => spec.startsWith("telemetry."));
  assert.deepEqual(py.map((b) => `${b.binding}<-${b.spec}${b.project ? ":project" : ""}`), [
    "requests<-requests", "rq<-requests", "os<-os.path",
    "Flask<-flask", "jsonify<-flask", "ingest_batch<-telemetry.ingest:project",
  ]);

  const ts = importBindings([
    { id: "j1", type: "import_from", module: "express", names: ["express"] },
    { id: "j2", type: "import_from", module: "node:fs", names: ["* as fs"] },
    { id: "j3", type: "import_from", module: "x", names: ["orig as alias"] },
    { id: "j4", type: "import_from", module: "./db", names: ["query"] },
  ], "jsts");
  assert.deepEqual(ts.map((b) => `${b.binding}<-${b.spec}${b.project ? ":project" : ""}`), [
    "express<-express", "fs<-node:fs", "alias<-x", "query<-./db:project",
  ]);

  // bash `source` and C++ `#include` bind no callable name.
  assert.deepEqual(importBindings([{ id: "b1", type: "import", names: ["lib/env.sh"] }], "bash"), []);
  assert.deepEqual(importBindings([{ id: "c1", type: "import", names: ["<gtest/gtest.h>"] }], "cpp"), []);
});

test("effectFromRole maps only the roles the effect vocabulary already has", () => {
  const at = (role) => ({ tool: "t", role, origin: "third-party", how: "binding" });
  assert.equal(effectFromRole(at("db")), "db");
  assert.equal(effectFromRole(at("http-client")), "http");
  assert.equal(effectFromRole(at("process")), "subprocess");
  assert.equal(effectFromRole(at("remote")), "subprocess");
  assert.equal(effectFromRole(at("queue")), null, "no invented effect vocabulary member");
  assert.equal(effectFromRole(at("cache")), null);
  assert.equal(effectFromRole(at("web-framework")), null);
  assert.equal(effectFromRole({ tool: "int", role: "builtin", origin: "language", how: "builtin" }), null);
  assert.equal(effectFromRole(null), null);
});

test("a funnel-file attribution never DERIVES an effect - it only says where the call lives", () => {
  // The derived effect drives the round-trip (N+1) warning, so it may only
  // rest on knowing WHAT is called. `res.json()` inside an HTTP funnel
  // parses a body; deriving http from the funnel invented an N+1.
  const inFunnel = attributeBoundary({
    language: "python", label: "_session().post", kind: "external",
    file: "telemetry/http_client.py", imports: [], stack: STACK,
  });
  assert.equal(inFunnel.how, "funnel-file");
  assert.equal(effectFromRole(inFunnel), null);

  // A RESOLVED callee is strong enough: this is what makes a commit inside
  // a loop a real round trip.
  const resolved = attributeBoundary({
    language: "python", label: "conn.commit", kind: "external",
    qualifiedTarget: "sqlite3.Connection.commit",
    file: "telemetry/storage.py", imports: PY_STORAGE_IMPORTS, stack: STACK,
  });
  assert.equal(effectFromRole(resolved), "db");
  // So is an import binding, and a project-code gap never derives one.
  assert.equal(effectFromRole(attributeBoundary({
    language: "python", label: "rq.post", kind: "external",
    file: "svc/client.py", imports: [{ binding: "rq", spec: "requests" }], stack: STACK,
  })), "http");
  assert.equal(effectFromRole({ tool: "x", role: "db", origin: "project", how: "binding", projectModule: "a.b" }), null);
});

// ── M-RESOLVE — the receiver bound three lines up ────────────────────
//
// A census of the three real fixtures said a THIRD of every unresolved
// receiver is bound to a literal in the same file. Those were being
// counted as unknowns, and the cheapest tool to resolve them - a
// deterministic read of the assignment - had never been built.

test("M-RESOLVE: a method on a local LITERAL is not a boundary at all", () => {
  const a = attributeBoundary({
    language: "jsts", label: "problems.push", kind: "dynamic",
    file: "gateway/schema.ts", stack: STACK,
    locals: [{ name: "problems", valueKind: "list" }],
  });
  assert.equal(a?.how, "local-literal");
  assert.equal(a?.tool, "list");
  assert.equal(a?.role, "builtin", "list work is not a tool the thread reaches");
  assert.match(attributionLabel(a), /local list literal/);
  // ...and it must never manufacture an effect.
  assert.equal(effectFromRole(a), null);
});

test("M-RESOLVE: a receiver bound from a resolvable CALL takes that tool", () => {
  const a = attributeBoundary({
    language: "python", label: "conn.executescript", kind: "dynamic",
    file: "telemetry/storage.py", stack: STACK,
    imports: [{ binding: "sqlite3", spec: "sqlite3" }],
    locals: [{ name: "conn", valueKind: "call", callTarget: "sqlite3.connect" }],
  });
  assert.equal(a?.tool, "sqlite3");
  assert.equal(a?.how, "local-binding");
  assert.equal(a?.via, "telemetry.storage", "and the funnel it lives in is still named");
  // Knowing WHAT the object is does not mean every method on it crosses a
  // boundary - `res.json()` parses a body. Same trap the funnel rule hit.
  assert.equal(effectFromRole(a), null);
});

test("M-RESOLVE: a name bound TWICE with different shapes is refused, not guessed", () => {
  const a = attributeBoundary({
    language: "python", label: "x.run", kind: "dynamic",
    file: "svc/thing.py", stack: STACK,
    locals: [
      { name: "x", valueKind: "list" },
      { name: "x", valueKind: "call", callTarget: "sqlite3.connect" },
    ],
  });
  assert.equal(a, null, "a rebind means the file does not say");
  // Two CALL bindings to different callees are equally ambiguous.
  assert.equal(attributeBoundary({
    language: "python", label: "conn.execute", kind: "dynamic",
    file: "svc/thing.py", stack: STACK,
    imports: [{ binding: "sqlite3", spec: "sqlite3" }],
    locals: [
      { name: "conn", valueKind: "call", callTarget: "sqlite3.connect" },
      { name: "conn", valueKind: "call", callTarget: "_get_conn" },
    ],
  }), null);
});

test("M-RESOLVE: one hop only, and a project callee stays a resolution gap", () => {
  // `conn = _get_conn()` where _get_conn is project code the linker did
  // not follow: the honest answer is still nothing, not "probably sqlite3".
  assert.equal(attributeBoundary({
    language: "python", label: "conn.execute", kind: "dynamic",
    file: "svc/thing.py", stack: STACK,
    imports: [{ binding: "_get_conn", spec: "svc.db", project: true }],
    locals: [{ name: "conn", valueKind: "call", callTarget: "_get_conn" }],
  }), null);
});

test("M-RESOLVE: an already-resolved receiver is untouched by the new rule", () => {
  // qualifiedTarget wins - the linker's own work outranks a local read.
  const a = attributeBoundary({
    language: "python", label: "conn.commit", kind: "external",
    qualifiedTarget: "sqlite3.Connection.commit",
    file: "telemetry/storage.py", stack: STACK,
    locals: [{ name: "conn", valueKind: "list" }],
  });
  assert.equal(a?.how, "qualified");
  assert.equal(a?.tool, "sqlite3");
});

test("localBindings reads assignments, and skips what is not a local name", () => {
  const b = localBindings([
    { type: "assignment", name: "problems", valueKind: "list" },
    { type: "assignment", name: "conn", valueKind: "call", callTarget: "sqlite3.connect" },
    { type: "assignment", name: "self.total", valueKind: "scalar" },
    { type: "call", name: "nope", valueKind: "list" },
    { type: "assignment", valueKind: "list" },
  ]);
  assert.deepEqual(b, [
    { name: "problems", valueKind: "list" },
    { name: "conn", valueKind: "call", callTarget: "sqlite3.connect" },
  ]);
});

// ── M-RESOLVE.2 — the language's own runtime, called by bare name ─────
//
// `open`, `fopen` and `echo` were the three largest remaining shapes.
// None is a mystery; there had simply never been a table.

test("M-RESOLVE.2: an effectful bare call into the runtime is attributed to it", () => {
  const py = attributeBoundary({
    language: "python", label: "open", kind: "external", effectKind: "fs",
    file: "svc/io.py", stack: STACK,
  });
  assert.equal(py?.tool, "builtins");
  assert.equal(py?.role, "runtime");
  assert.equal(py?.how, "runtime");
  // The effect stays the one the PARSER stamped; role runtime derives none.
  assert.equal(effectFromRole(py), null);

  const sh = attributeBoundary({
    language: "bash", label: "echo", kind: "external", effectKind: "log",
    file: "ops/log.sh", stack: STACK,
  });
  assert.equal(sh?.tool, "shell");
  assert.equal(sh?.how, "runtime");
});

test("M-RESOLVE.2: a PURE builtin stays out of it - the bucket is unchanged", () => {
  // No parse-time effect means it is not a boundary, so the runtime rule
  // must not drag it back in. `len` is still just `len`.
  // `print` is BOTH: a builtin when the parser found no effect, and the
  // runtime when it did. The effect decides, the same rule `open` follows.
  const a = attributeBoundary({ language: "python", label: "print", kind: "external", stack: STACK });
  assert.equal(a?.how, "builtin", "no effect, no boundary");
  assert.equal(attributeBoundary({
    language: "python", label: "print", kind: "external", effectKind: "log", stack: STACK,
  })?.how, "runtime");
  assert.equal(attributeBoundary({ language: "python", label: "len", kind: "external", stack: STACK })?.how, "builtin");
});

test("M-RESOLVE.2: C++ is EVIDENCE-GATED on the include, not a symbol table", () => {
  const withInclude = {
    tools: [...STACK.tools, {
      tool: "cstdio", role: "runtime", origin: "stdlib", files: ["codec/main.cpp"],
      evidence: [{ file: "codec/main.cpp", nodeId: "module/cstdio.import", kind: "include" }],
    }],
  };
  const hit = attributeBoundary({
    language: "cpp", label: "fopen", kind: "external", effectKind: "fs",
    file: "codec/main.cpp", stack: withInclude,
  });
  assert.equal(hit?.tool, "cstdio");
  assert.equal(hit?.how, "runtime");

  // The SAME call in a file that does not include <cstdio> stays unknown.
  // Guessing which translation unit owns a symbol is what a build graph
  // would answer, and M-LANG5a refuses to fake one.
  assert.equal(attributeBoundary({
    language: "cpp", label: "fopen", kind: "external", effectKind: "fs",
    file: "codec/other.cpp", stack: withInclude,
  }), null);
  // ...and an unknown C++ symbol is unknown even where headers are included.
  assert.equal(attributeBoundary({
    language: "cpp", label: "mystery_fn", kind: "external", effectKind: "fs",
    file: "codec/main.cpp", stack: withInclude,
  }), null);
});

// ── M-RESOLVE.3 — a route handler's parameters belong to its framework ──

test("M-RESOLVE.3: an express handler's leading params are express, by POSITION", () => {
  const inHandler = (label, params) => attributeBoundary({
    language: "jsts", label, kind: "dynamic", file: "gateway/server.ts", stack: STACK,
    handler: { framework: "express", params },
  });
  const res = inHandler("res.json", ["req", "res"]);
  assert.equal(res?.tool, "express");
  assert.equal(res?.role, "web-framework");
  assert.equal(res?.how, "handler-param");
  // Writing a response is not a round trip this project pays.
  assert.equal(effectFromRole(res), null);

  // POSITION, not name: an ignored first parameter still works...
  assert.equal(inHandler("res.status", ["_", "res"])?.tool, "express");
  // ...and a parameter BEYOND the framework's own is not its object.
  assert.equal(inHandler("opts.get", ["req", "res", "next", "opts"]), null);
});

test("M-RESOLVE.3: a local named `res` OUTSIDE a handler is still not express", () => {
  assert.equal(attributeBoundary({
    language: "jsts", label: "res.json", kind: "dynamic",
    file: "gateway/util.ts", stack: STACK, handler: null,
  }), null, "the handler is the evidence; without it there is none");
  // An unknown framework claims nothing either.
  assert.equal(attributeBoundary({
    language: "jsts", label: "res.json", kind: "dynamic", file: "x.ts", stack: STACK,
    handler: { framework: "some-framework", params: ["req", "res"] },
  }), null);
});

// ── M-RESOLVE.4 — the last cheap shapes, found by reading the 43 ──────

test("M-RESOLVE.4: `const store = new Map()` makes `store.get` local data, not a boundary", () => {
  const a = attributeBoundary({
    language: "jsts", label: "store.get", kind: "external", file: "gateway/cache.ts",
    stack: STACK, locals: [{ name: "store", valueKind: "call", callTarget: "Map" }],
  });
  assert.equal(a?.tool, "Map");
  assert.equal(a?.how, "local-literal", "a language container built in this file reads like a literal one");
  assert.equal(a?.origin, "language");
  // The floor every weak attribution obeys: it says what the object IS,
  // never that touching it costs the project anything.
  assert.equal(effectFromRole(a), null);
});

test("M-RESOLVE.4: a receiver built from something NOT the language claims nothing new", () => {
  // Bound to a project function -> still a resolution gap, not a Map.
  assert.equal(attributeBoundary({
    language: "jsts", label: "thing.get", kind: "external", file: "gateway/cache.ts",
    stack: STACK, locals: [{ name: "thing", valueKind: "call", callTarget: "makeThing" }],
  }), null);
  // Bound TWICE with different callees -> the file does not say.
  assert.equal(attributeBoundary({
    language: "jsts", label: "store.get", kind: "external", file: "gateway/cache.ts",
    stack: STACK,
    locals: [
      { name: "store", valueKind: "call", callTarget: "Map" },
      { name: "store", valueKind: "call", callTarget: "makeStore" },
    ],
  }), null, "a rebind with a different shape is refused, as everywhere else");
});

test("M-RESOLVE.4: `console.log` is a boundary, and now it says through what", () => {
  const a = attributeBoundary({
    language: "jsts", label: "console.log", kind: "external", effectKind: "log",
    file: "gateway/server.ts", stack: STACK,
  });
  assert.equal(a?.tool, "console");
  assert.equal(a?.role, "runtime");
  assert.equal(a?.how, "runtime");
  assert.equal(a?.origin, "stdlib");
  // Writing a line to stdout is not a round trip this project pays.
  assert.equal(effectFromRole(a), null);

  // Rule 1 still owns the PURE case: no effect, no boundary, no claim.
  const pure = attributeBoundary({
    language: "jsts", label: "Math.max", kind: "external", file: "gateway/server.ts", stack: STACK,
  });
  assert.equal(pure?.how, "builtin");

  // And a global nobody tabled is still exactly as unknown as it was.
  assert.equal(attributeBoundary({
    language: "jsts", label: "wibble.log", kind: "external", effectKind: "log",
    file: "gateway/server.ts", stack: STACK,
  }), null);
});
