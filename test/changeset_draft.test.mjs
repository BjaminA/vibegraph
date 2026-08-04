// PLAN-v7 Stage 4b — the builder-draft contract.
//
// Drives the deterministic json-format Claude stub via VG_CLAUDE_BIN (project
// convention; never the real `claude`). The builder replies FENCE-FIRST
// (LABEL:/FILE:/CHECK: lines + ```python fences — the M18.5 lesson: never
// multi-line code inside JSON strings). Asserts draftChangeset:
//   - parses the fenced reply into a boundary-validated Changeset (drafted);
//   - honours the builder's honest DECLINE line — bounded agents escalate,
//     they don't invent;
//   - declines on malformed replies and shape violations (traversal path,
//     missing __vg_check__) — the drafted path gets no shortcut past
//     validateChangeset. Never throws.
// parseBuilderReply is also unit-tested directly (pure).
//
// Run: npm run test:changeset-draft

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { draftChangeset, parseBuilderReply } from "../src/server/changeset_draft.ts";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));
const STUB = join(ROOT, "test", "fixtures", "run_effects", "fake_claude_json.mjs");

const PLAN = {
  version: "1",
  description: "a flask API with a sqlite note store",
  subsystems: [
    { id: "backend", kind: "backend", label: "Flask API", groundedIn: "a flask API" },
    { id: "db", kind: "db", label: "SQLite store", groundedIn: "a sqlite note store" },
  ],
  edges: [],
  drafted: true,
  ratifiedAt: "2026-07-02T00:00:00.000Z",
};

const GOOD_REPLY = [
  "LABEL: the create-note flow",
  "FILE: db.py",
  "```python",
  "def validate_title(title):",
  "    return title",
  "```",
  "CHECK: validate_title round-trips a title",
  "```python",
  "from db import validate_title",
  "",
  "",
  "def __vg_check__():",
  "    assert validate_title('x') == 'x'",
  "```",
].join("\n");

async function withStub(response, fn) {
  const prevBin = process.env.VG_CLAUDE_BIN;
  const prevResp = process.env.FAKE_SYNTH_RESPONSE;
  process.env.VG_CLAUDE_BIN = `node ${STUB}`;
  process.env.FAKE_SYNTH_RESPONSE = response;
  try {
    return await fn();
  } finally {
    if (prevBin === undefined) delete process.env.VG_CLAUDE_BIN; else process.env.VG_CLAUDE_BIN = prevBin;
    if (prevResp === undefined) delete process.env.FAKE_SYNTH_RESPONSE; else process.env.FAKE_SYNTH_RESPONSE = prevResp;
  }
}

test("parseBuilderReply: happy fenced reply, multi-file", () => {
  const two = GOOD_REPLY.replace(
    "CHECK:",
    ["FILE: app.py", "```python", "import db", "```", "CHECK:"].join("\n"),
  );
  const p = parseBuilderReply(two);
  assert.ok(!("error" in p) && !("decline" in p));
  assert.equal(p.files.length, 2);
  assert.equal(p.files[0].path, "db.py");
  assert.equal(p.files[1].path, "app.py");
  assert.match(p.check.module, /__vg_check__/);
});

test("parseBuilderReply: decline line, missing LABEL, missing CHECK", () => {
  assert.deepEqual(parseBuilderReply("DECLINE: needs a queue subsystem"), { decline: "needs a queue subsystem" });
  assert.match(parseBuilderReply("FILE: x.py\n```python\nx = 1\n```").error, /no LABEL/);
  assert.match(parseBuilderReply("LABEL: x\nFILE: x.py\n```python\nx = 1\n```").error, /no CHECK/);
  assert.match(parseBuilderReply("LABEL: x\nCHECK: y\n```python\npass\n```").error, /no FILE/);
});

test("assembles a boundary-validated drafted changeset from the fenced reply", async () => {
  const r = await withStub(GOOD_REPLY, () => draftChangeset("create notes", PLAN, [], ROOT));
  assert.equal(r.error, undefined);
  assert.equal(r.changeset.drafted, true);
  assert.equal(r.changeset.label, "the create-note flow");
  assert.equal(r.changeset.files.length, 1);
  assert.match(r.changeset.files[0].content, /def validate_title/);
});

test("honours the builder's honest decline", async () => {
  const r = await withStub("DECLINE: needs a queue subsystem the plan does not ratify",
    () => draftChangeset("add background jobs", PLAN, [], ROOT));
  assert.equal(r.changeset, null);
  assert.match(r.error, /builder declined: needs a queue/);
});

test("drafted changesets get no shortcut past the boundary", async () => {
  const traversal = GOOD_REPLY.replace("FILE: db.py", "FILE: ../evil.py");
  const r1 = await withStub(traversal, () => draftChangeset("x", PLAN, [], ROOT));
  assert.equal(r1.changeset, null);
  assert.match(r1.error, /failed validation/);

  const noCheckFn = GOOD_REPLY.replace(/def __vg_check__\(\):\n    assert validate_title\('x'\) == 'x'/, "x = 1");
  const r2 = await withStub(noCheckFn, () => draftChangeset("x", PLAN, [], ROOT));
  assert.equal(r2.changeset, null);
  assert.match(r2.error, /__vg_check__/);

  const r3 = await withStub("sure, here's the code!", () => draftChangeset("x", PLAN, [], ROOT));
  assert.equal(r3.changeset, null);
  assert.match(r3.error, /no LABEL/);
});

// ── PLAN-v7 6c — mixed create+edit stanzas (APPEND / REPLACE) ──

import { validateChangeset } from "../src/server/changeset.ts";

const MIXED_REPLY = [
  "LABEL: register the notes route",
  "FILE: routes.py",
  "```python",
  "def notes_route():",
  "    return []",
  "```",
  "APPEND: app.py",
  "```python",
  "from routes import notes_route",
  "```",
  "REPLACE: db.py @ module/insert_note.fn",
  "```python",
  "def insert_note(title):",
  "    return {'title': title}",
  "```",
  "CHECK: the route function exists",
  "```python",
  "from routes import notes_route",
  "",
  "",
  "def __vg_check__():",
  "    assert notes_route() == []",
  "```",
].join("\n");

test("6c: parseBuilderReply reads FILE/APPEND/REPLACE stanzas with ops in reply order", () => {
  const parsed = parseBuilderReply(MIXED_REPLY);
  assert.ok("files" in parsed, `expected files, got ${JSON.stringify(parsed)}`);
  assert.deepEqual(parsed.files.map((f) => [f.path, f.op ?? "create_file", f.nodeId ?? null]), [
    ["routes.py", "create_file", null],
    ["app.py", "append_end", null],
    ["db.py", "replace_node", "module/insert_note.fn"],
  ]);
  // ...and the whole thing crosses the boundary as a valid mixed changeset.
  const cs = { label: parsed.label, files: parsed.files, check: parsed.check, drafted: true };
  assert.equal(validateChangeset(cs), null);
});

// ── duplicate-path stanzas fold into one (the live "duplicate path
//    data.py" stage failure: the model split one module across two fences) ──

test("duplicate FILE stanzas for one path fold into a single create", () => {
  const dup = GOOD_REPLY.replace(
    "CHECK:",
    ["FILE: db.py", "```python", "def target_stats(rows):", "    return rows", "```", "CHECK:"].join("\n"),
  );
  const p = parseBuilderReply(dup);
  assert.ok("files" in p, `expected files, got ${JSON.stringify(p)}`);
  assert.equal(p.files.length, 1);
  assert.equal(p.files[0].path, "db.py");
  assert.equal(p.files[0].op, undefined); // still a create
  // Both fences present, PEP 8 top-level spacing between them.
  assert.match(p.files[0].content, /def validate_title[\s\S]*\n\n\ndef target_stats/);
  // ...and the folded result crosses the boundary (no duplicate-path refusal).
  const cs = { label: p.label, files: p.files, check: p.check, drafted: true };
  assert.equal(validateChangeset(cs), null);
});

test("FILE + APPEND to the same new path fold into the create; APPEND+APPEND fold too", () => {
  const createThenAppend = GOOD_REPLY.replace(
    "CHECK:",
    ["APPEND: db.py", "```python", "def extra():", "    return 1", "```", "CHECK:"].join("\n"),
  );
  const p1 = parseBuilderReply(createThenAppend);
  assert.equal(p1.files.length, 1);
  assert.equal(p1.files[0].op, undefined);
  assert.match(p1.files[0].content, /def extra/);

  const doubleAppend = MIXED_REPLY.replace(
    "CHECK:",
    ["APPEND: app.py", "```python", "from routes import other", "```", "CHECK:"].join("\n"),
  );
  const p2 = parseBuilderReply(doubleAppend);
  assert.deepEqual(p2.files.map((f) => f.path), ["routes.py", "app.py", "db.py"]);
  assert.match(p2.files[1].content, /notes_route[\s\S]*\n\n\nfrom routes import other/);
  assert.equal(p2.files[1].op, "append_end");
});

test("REPLACE never folds: duplicate REPLACE stanzas stay for the boundary to refuse", () => {
  const dupReplace = MIXED_REPLY.replace(
    "CHECK:",
    ["REPLACE: db.py @ module/insert_note.fn", "```python", "def insert_note(t):", "    return t", "```", "CHECK:"].join("\n"),
  );
  const p = parseBuilderReply(dupReplace);
  assert.equal(p.files.length, 4); // both replace stanzas kept
  const cs = { label: p.label, files: p.files, check: p.check, drafted: true };
  assert.match(validateChangeset(cs) ?? "", /duplicate path/);
});

test("6c: a malformed REPLACE header (no @ node-id) is an honest parse error", () => {
  const bad = MIXED_REPLY.replace("REPLACE: db.py @ module/insert_note.fn", "REPLACE: db.py");
  const parsed = parseBuilderReply(bad);
  assert.ok("error" in parsed);
  assert.match(parsed.error, /REPLACE header/);
});

test("6c: validateChangeset enforces the op whitelist + nodeId pairing", () => {
  const base = (files) => ({
    label: "x",
    files,
    check: { module: "def __vg_check__():\n    assert True\n", description: "ok" },
  });
  assert.match(validateChangeset(base([{ path: "a.py", content: "x = 1\n", op: "delete_node" }])) ?? "", /unknown op/);
  assert.match(validateChangeset(base([{ path: "a.py", content: "x = 1\n", op: "replace_node" }])) ?? "", /requires a structural nodeId/);
  assert.match(validateChangeset(base([{ path: "a.py", content: "x = 1\n", op: "append_end", nodeId: "module/x.assign" }])) ?? "", /only valid with replace_node/);
  assert.equal(validateChangeset(base([{ path: "a.py", content: "x = 1\n", op: "append_end" }])), null);
});
