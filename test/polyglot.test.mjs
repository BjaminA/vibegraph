/**
 * M-CONTRACT.1 — the POLYGLOT fixture (test/fixtures/polyglot/shop_demo):
 * one project, all four registered languages, driven through the SAME
 * per-language pipeline server.ts runs (scripts/regen_polyglot.mjs mirrors
 * it off the registry). Pins what the first mixed-language sweep found
 * and fixed (2026-09-06):
 *
 *   1. Python SCRIPT-DIRECTORY imports — `from orders import x` inside
 *      api/ names the sibling api/orders.py (sys.path[0] = the script's
 *      dir); the linker read it as a third-party module, so no cross-file
 *      edge landed and `orders.validate_order` rendered as a library call.
 *   2. C++ OVERLOAD HONESTY leaked through the extractor's same-file
 *      fallback: the frontend refuses to link an overloaded bare callee,
 *      but resolve_same_file picked the FIRST definition anyway.
 *   3. NESTED CALLS in tree-sitter frontends vanished: a call inside
 *      another call's arguments (gtest `EXPECT_*(line_total(item), …)`,
 *      TS `fetch(url, {body: JSON.stringify(x)})`, bash `echo "$(date)"`)
 *      was neither minted nor flagged — the thread claimed completeness
 *      while hiding the one call the statement exists to make.
 *
 * Plus the cross-language floor: threads never cross languages; every
 * hop between languages is an HONEST external terminal (http /
 * subprocess) each side names from its own IR.
 *
 * Snapshot regen: node --experimental-strip-types scripts/regen_polyglot.mjs
 * Boot: node --experimental-strip-types --no-warnings --test test/polyglot.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildPolyglotEnvelope, POLYGLOT_PROJECT, ROOT } from "../scripts/regen_polyglot.mjs";
import { languageForPath } from "../src/shared/languages.ts";

const built = buildPolyglotEnvelope();
const env = built.envelope;
const byEp = new Map(env.threads.map((t) => [t.entryPointId, t]));
const thread = (ep) => {
  const t = byEp.get(ep);
  assert.ok(t, `thread ${ep} missing — threads: ${[...byEp.keys()].join(", ")}`);
  return t;
};
const node = (t, id) => {
  const n = t.nodes.find((x) => x.id === id);
  assert.ok(n, `node ${id} missing from ${t.entryPointId} — have: ${t.nodes.map((x) => x.id).join(", ")}`);
  return n;
};

test("polyglot envelope matches shop_demo.project.json (snapshot) with zero parse errors", () => {
  assert.deepEqual(built.parseErrors, {}, "every file in all four languages must parse");
  assert.deepEqual(built.languages.sort(), ["bash", "cpp", "jsts", "python"]);
  const expected = JSON.parse(readFileSync(POLYGLOT_PROJECT, "utf-8"));
  assert.deepStrictEqual(env, expected,
    "polyglot envelope drifted — regen via scripts/regen_polyglot.mjs if intentional");
});

test("envelope + every per-file IR validate against the pinned schemas", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const envValidate = ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", "project_ir.schema.json"), "utf-8")));
  assert.equal(envValidate(env), true, JSON.stringify(envValidate.errors, null, 2));
  const fileValidate = ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", "ir.schema.json"), "utf-8")));
  for (const [f, ir] of Object.entries(env.files)) {
    assert.equal(fileValidate(ir), true, `${f}: ${JSON.stringify(fileValidate.errors, null, 2)}`);
    assert.equal(ir.language, languageForPath(f).id, `${f} carries its registry language`);
  }
});

test("all four languages discover entry points, each kind from its own frontend", () => {
  const kinds = Object.fromEntries(env.entryPoints.map((e) => [e.id, e.kind]));
  assert.equal(kinds["api/app.py:create_order"], "route");
  assert.equal(kinds["api/cli.py:main"], "cli", "sys.exit(main()) idiom (2026-08-30 discovery fix)");
  assert.equal(kinds["gateway/server.ts:getOrders"], "route");
  assert.equal(kinds["gateway/client.test.ts:checkRejectsEmpty"], "test");
  assert.equal(kinds["ops/deploy.sh:main"], "cli");
  assert.equal(kinds["worker/main.cpp:main"], "cli");
  assert.equal(kinds["worker/pricing_test.cpp:Pricing.DiscountApplied"], "test");
  const langs = new Set(env.entryPoints.map((e) => languageForPath(e.file).id));
  assert.deepEqual([...langs].sort(), ["bash", "cpp", "jsts", "python"]);
});

test("FLOOR: a thread never crosses languages — every file it reaches shares the seed's language", () => {
  for (const t of env.threads) {
    const seedLang = languageForPath(t.seed.file).id;
    for (const f of t.filesReached) {
      assert.equal(languageForPath(f).id, seedLang, `${t.entryPointId} reached ${f} across a language boundary`);
    }
  }
});

test("FLOOR: cross-language hops are honest external terminals, named from each side's own IR", () => {
  // python → TS gateway over HTTP; python → C++ worker via subprocess.
  const create = thread("api/app.py:create_order");
  assert.equal(node(create, "external:requests.post").kind, "external");
  assert.equal(node(create, "external:subprocess.run").kind, "external");
  assert.equal(env.files["api/app.py"].nodes.find((n) => n.id === "module/create_order.fn/for@0/requests_post.call")?.effectKind, "http");
  // TS gateway → python API over HTTP (fetch stamped http by the frontend).
  const getOrders = thread("gateway/server.ts:getOrders");
  assert.equal(node(getOrders, "external:fetch").effectKind, "http");
  // bash ops → gateway/api over curl (http), psql (db), ssh (subprocess).
  const deploy = thread("ops/deploy.sh:main");
  assert.equal(node(deploy, "external:curl").effectKind, "http");
  assert.equal(node(deploy, "external:psql").effectKind, "db");
  assert.equal(node(deploy, "external:ssh").effectKind, "subprocess");
  assert.equal(node(deploy, "external:make").effectKind, "subprocess");
  // C++ worker: fs + log effects on the path, no cross-language claim.
  const main = thread("worker/main.cpp:main");
  assert.equal(node(main, "external:fopen").effectKind, "fs");
  assert.equal(node(main, "external:printf").effectKind, "log");
});

test("FIX 1: python script-directory siblings link — api/app.py walks into orders.py and db.py", () => {
  const create = thread("api/app.py:create_order");
  assert.deepEqual([...create.filesReached].sort(), ["api/app.py", "api/db.py", "api/orders.py"]);
  assert.equal(node(create, "api/orders:validate_order").kind, "step");
  assert.equal(node(create, "api/db:insert_order").kind, "step");
  assert.ok(!create.nodes.some((n) => n.qualifiedTarget === "orders.validate_order"),
    "a sibling module must never render as a third-party external");
  const refs = env.files["api/app.py"].edges.filter((e) => e.type === "reference" && e.targetFile);
  assert.deepEqual(refs.map((e) => e.qualifiedTarget).sort(),
    ["api.db:insert_order", "api.db:list_orders", "api.orders:price_order", "api.orders:validate_order"]);
  // §5.5 return-type inference now reaches the sibling: conn.execute is sqlite3, honestly external.
  assert.equal(node(create, "external:sqlite3.Connection.execute").kind, "external");
  assert.ok(env.files["api/db.py"].edges.some((e) => e.viaReturnType && e.qualifiedTarget === "sqlite3:Connection.execute"));
});

test("FIX 2: C++ overload honesty holds through the extractor — `discount` is unresolved, never a guessed step", () => {
  for (const ep of ["worker/main.cpp:main", "worker/pricing_test.cpp:Pricing.DiscountApplied"]) {
    const t = thread(ep);
    assert.equal(node(t, "unresolved:discount").kind, "unresolved", ep);
    assert.ok(!t.nodes.some((n) => n.kind === "step" && n.label === "discount"), `${ep}: overloaded callee rendered as a step`);
  }
  assert.equal(env.files["worker/pricing.cpp"].nodes.filter((n) => n.type === "function_def" && n.name === "discount").length, 2,
    "the fixture's overload pair must stay (the case under test)");
});

test("FIX 3: nested calls in tree-sitter frontends are minted (M-NEST L1 parity) — gtest reaches line_total / price_total", () => {
  const lineTotal = thread("worker/pricing_test.cpp:Pricing.LineTotal");
  assert.equal(node(lineTotal, "worker/pricing.cpp:line_total").kind, "step");
  // A gtest assertion MACRO is not a function the linker could ever
  // resolve, so reporting it as a resolution GAP was a false claim about
  // our own completeness — C++'s `unresolved` marker exists for the
  // OVERLOAD gap and has to keep meaning that. It classifies `external`
  // from 2026-09-21, the same answer Rust gives `assert!`. What this
  // test is actually about — the nested call minted INSIDE it — is
  // unchanged below.
  const macro = node(lineTotal, "external:EXPECT_DOUBLE_EQ");
  assert.equal(macro.nestsInnerCalls, true);
  assert.equal(macro.nestExtracted, true);
  const nested = env.files["worker/pricing_test.cpp"].nodes.find(
    (n) => n.id === "module/Pricing_LineTotal.fn/EXPECT_DOUBLE_EQ.call/line_total.call");
  assert.ok(nested, "the nested call is a real IR node parented at the outer call");
  assert.equal(nested.nested, true);
  assert.equal(nested.nestedDepth, 1);
  assert.equal(nested.parentId, "module/Pricing_LineTotal.fn/EXPECT_DOUBLE_EQ.call");
  const applied = thread("worker/pricing_test.cpp:Pricing.DiscountApplied");
  assert.equal(node(applied, "worker/pricing.cpp:price_total").kind, "step");
});

test("FIX 3 (detected-but-not-extracted): a call inside an object-literal argument is FLAGGED, never silently dropped", () => {
  // TS: fetch(url, { body: JSON.stringify(input) }) — v1 mints only direct
  // call-valued args (python parity); the literal-embedded call is badged.
  const post = env.files["gateway/client.ts"].nodes.find((n) => n.id === "module/postOrder.fn/res.assign");
  assert.equal(post.nestsInnerCalls, true);
  assert.equal(post.nestExtracted, false);
  const create = thread("gateway/server.ts:createOrder");
  const fetchNode = create.nodes.find((n) => n.irNodeId === "module/postOrder.fn/res.assign");
  assert.equal(fetchNode.nestsInnerCalls, true, "the thread terminal carries the honesty flag");
  assert.equal(fetchNode.nestExtracted, false);
  // Python parity: json.dumps(list_orders(...)) minted nested (unchanged behaviour).
  const cli = thread("api/cli.py:main");
  assert.equal(node(cli, "external:json.dumps").nested, true);
});

test("round-trip levers are visible as loop containers holding http/db work, in three languages", () => {
  const inLoop = (t, containerId, childId) =>
    t.edges.some((e) => e.kind === "contains" && e.from === containerId && e.to === childId);
  const insert = thread("api/db.py:insert_order");
  assert.equal(node(insert, "api/db:insert_order.fn/for@0").containerKind, "for");
  assert.ok(inLoop(insert, "api/db:insert_order.fn/for@0", "external:sqlite3.Connection.execute@1"), "python: one db write per item");
  const getOrders = thread("gateway/server.ts:getOrders");
  assert.ok(inLoop(getOrders, "gateway/server.ts:getOrders.fn/for@0", "gateway/client.ts:fetchOrderDetail"), "TS: N+1 fetch via a step inside the loop");
  const deploy = thread("ops/deploy.sh:main");
  assert.ok(inLoop(deploy, "ops/deploy.sh:health_check.fn/for@0", "external:curl"), "bash: curl per host");
});

// M-XLANG (2026-09-09): this limit STILL HOLDS and is still the right
// behaviour - the system tier's own edges are a text-scan channel, and a
// text scan must not claim a call across a language boundary. What
// changed is that the claim is now made SOMEWHERE ELSE, on better
// evidence: src/server/crossings.ts matches the caller's parsed URL
// argument against the receiver's parsed route metadata, rides the
// envelope as `crossings`, and is drawn as its own dashed edge kind in
// the thread-interaction view (test:crossings, test:thread-interaction).
// So do not read this test as "VibeGraph cannot trace across languages".
test("NAMED LIMIT: the system tier lumps all four languages into one backend subsystem and claims NO cross-language call edge", () => {
  const ids = env.system.subsystems.map((s) => s.id).sort();
  // PLAN-v5 5.4 (2026-09-09) promoted fs / subprocess / log from
  // "intra-backend detail" to subsystems - an ops script IS subprocess
  // and remote work, and that was invisible here. The LANGUAGE lumping
  // this test names is unchanged: all four still share one `backend`.
  assert.deepEqual(ids, ["backend", "db", "external_http:unknown", "fs", "log", "subprocess"]);
  assert.equal(env.system.subsystems.filter((s) => s.kind === "backend").length, 1,
    "the named limit itself: four languages, one backend card");
  for (const e of env.system.edges) {
    assert.equal(e.kind, "effect", "only effect edges (db/http) — never a guessed call across languages");
  }
});

test("PLAN-v5 5.3: a thread surfaces in EVERY subsystem it touches, not just its own", () => {
  const byId = Object.fromEntries(env.system.subsystems.map((s) => [s.id, s]));
  // create_order is a backend route that also writes the db and shells
  // out. Reading it as "a backend thread" hid two thirds of what it does.
  const spans = env.system.subsystems
    .filter((s) => (s.threadRefs ?? []).includes("api/app.py:create_order"))
    .map((s) => s.id)
    .sort();
  assert.ok(spans.length > 1, `create_order should span several subsystems, got ${JSON.stringify(spans)}`);
  assert.ok(spans.includes("backend") && spans.includes("db"), JSON.stringify(spans));

  // threadRefs is DERIVED from the effect edges' viaThread handles - no
  // new evidence - so every ref must be a thread that really exists.
  const known = new Set(env.threads.map((t) => t.entryPointId));
  for (const s of env.system.subsystems) {
    for (const ref of s.threadRefs ?? []) {
      assert.ok(known.has(ref), `${s.id} references unknown thread ${ref}`);
    }
  }
  // A card nothing reaches claims nothing, rather than an empty list.
  for (const s of env.system.subsystems) {
    if ("threadRefs" in s) assert.ok(s.threadRefs.length > 0, `${s.id} has an empty threadRefs`);
  }
});

test("PLAN-v5 5.4: fs / subprocess / log are subsystems, on the same evidence db is", () => {
  const byId = Object.fromEntries(env.system.subsystems.map((s) => [s.id, s]));
  for (const kind of ["fs", "subprocess", "log"]) {
    assert.ok(byId[kind], `${kind} card missing`);
    assert.equal(byId[kind].kind, kind);
    assert.equal(byId[kind].evidence, `effectKind:${kind}`,
      "same evidence class as db - an effectKind the parser already stamped");
  }
  // Each card is emitted only because a thread REACHES it: every one has
  // at least one effect edge pointing at it, carrying a real thread.
  for (const kind of ["fs", "subprocess", "log"]) {
    const into = env.system.edges.filter((e) => e.to === kind);
    assert.ok(into.length > 0, `${kind} card with no edge into it`);
    for (const e of into) {
      assert.equal(e.kind, "effect");
      assert.equal(e.effectKind, kind);
      assert.ok(e.viaThread, `${kind} edge without a thread handle`);
    }
  }

  // THE Q6 FLOOR, unchanged: the classification lives at the aggregation
  // layer. No per-file IR node may carry a subsystem name as its effect;
  // fs/subprocess/log on an IR node are the PARSER's vocabulary, and
  // `cache` (an aggregation-only classification) must still appear nowhere.
  for (const [file, ir] of Object.entries(env.files)) {
    for (const n of ir.nodes ?? []) {
      assert.notEqual(n.effectKind, "cache", `${file} ${n.id} carries an aggregation-layer classification`);
    }
  }
});
