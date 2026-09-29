// The investigation board (2026-09-29, src/server/investigations.ts): pins
// are ADDRESSES validated at the boundary, the store round-trips, and the
// handoff reads each pin's code now — saying so when a node is gone. The
// export bundle carries every saved investigation as its handoff.
//
//   npm run test:investigations
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseInvestigation, writeInvestigation, readInvestigation, listInvestigations, deleteInvestigation,
  renderHandoff, handleInvestigation, readRel,
} from "../src/server/investigations.ts";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { exportKnowledge } from "../scripts/export_knowledge.mjs";

const tmp = mkdtempSync(join(tmpdir(), "vg-inv-"));
const root = join(tmp, "flask_demo");
cpSync("test/fixtures/threads/flask_demo", root, { recursive: true });
after(() => rmSync(tmp, { recursive: true, force: true }));
const env = buildPolyglotEnvelope(root, { skipSystem: true }).envelope;

const insertDef = env.files["db.py"].nodes.find((n) => n.type === "function_def" && n.name === "insert");
const aCall = env.files["cli.py"].nodes.find((n) => n.type === "call" || (n.type === "assignment" && n.callTarget));
const INV = {
  name: "dup-rows", question: "Why does create insert twice?",
  pins: [
    { file: "db.py", irNodeId: insertDef.id, label: "insert", kind: "step", entryPointId: "cli.py:main", note: "no unique key\nsecond line" },
    { file: "cli.py", irNodeId: aCall.id, label: "the call", entryPointId: "cli.py:main", note: "" },
    { file: "cli.py", irNodeId: "module/gone.fn", label: "gone", entryPointId: null, note: "was here yesterday" },
  ],
};

test("the boundary refuses what it cannot trust, never coerces it", () => {
  assert.equal(parseInvestigation({ ...INV, name: "Bad Name" }).ok, false);
  assert.equal(parseInvestigation({ ...INV, name: "../x" }).ok, false);
  assert.match(parseInvestigation({ ...INV, pins: [{ ...INV.pins[0], file: "../etc/passwd" }] }).error, /project-relative/);
  assert.match(parseInvestigation({ ...INV, pins: [{ ...INV.pins[0], file: "/etc/passwd" }] }).error, /project-relative/);
  assert.match(parseInvestigation({ ...INV, pins: [{ ...INV.pins[0], irNodeId: "" }] }).error, /irNodeId/);
  assert.match(parseInvestigation({ ...INV, pins: Array(65).fill(INV.pins[0]) }).error, /at most 64/);
  assert.equal(parseInvestigation(INV).ok, true);
  assert.equal(readRel(root, "../x"), null, "the source reader refuses to leave the project");
});

test("the store round-trips, lists newest first, keeps createdAt, deletes", () => {
  const a = writeInvestigation(root, INV);
  assert.equal(a.ok, true);
  const first = readInvestigation(root, "dup-rows");
  assert.equal(first.pins.length, 3);
  assert.equal(first.pins[1].kind, undefined);
  writeInvestigation(root, { ...INV, name: "other", question: "" });
  const again = writeInvestigation(root, { ...INV, question: "edited" });
  assert.equal(again.value.createdAt, first.createdAt);
  assert.deepEqual(listInvestigations(root).map((l) => l.name), ["dup-rows", "other"]);
  assert.equal(deleteInvestigation(root, "other"), true);
  assert.equal(deleteInvestigation(root, "other"), false);
  assert.equal(readInvestigation(root, "nope"), null);
});

test("the handoff: question, pins with notes, code read now, a gone node said", () => {
  const inv = readInvestigation(root, "dup-rows");
  const text = renderHandoff({ inv, files: env.files, readSource: (f) => readRel(root, f), threadLabel: () => "main" });
  assert.match(text, /^# Investigation: dup-rows/);
  assert.match(text, /## The question\n\nedited/);
  assert.match(text, /3 pins across 1 thread: `cli\.py:main`/);
  assert.match(text, new RegExp(`## 1\\. \`insert\` — db\\.py:${insertDef.line}`));
  assert.match(text, /pinned on the thread `cli\.py:main` \(main\)/);
  assert.match(text, /> no unique key\n> second line/);
  assert.match(text, /def insert\(/, "a definition shows its own span");
  assert.match(text, /\n> +\d+ {2}/, "a call's own line is marked");
  assert.match(text, /## 3\. `gone`[\s\S]*not in the current IR/);
});

test("the WS surface: save, get, handoff writes the .md beside the .json", () => {
  const ctx = { files: env.files };
  assert.match(handleInvestigation(root, { type: "investigation-save", payload: { investigation: { name: "x y" } } }, ctx).error, /name must be/);
  const got = handleInvestigation(root, { type: "investigation-get", payload: { name: "dup-rows" } }, ctx);
  assert.equal(got.current.name, "dup-rows");
  const h = handleInvestigation(root, { type: "investigation-handoff", payload: { name: "dup-rows" } }, ctx);
  assert.equal(h.handoff.path, join(".vibegraph", "investigations", "dup-rows.md"));
  assert.equal(readFileSync(join(root, h.handoff.path), "utf-8"), h.handoff.text);
  assert.match(handleInvestigation(root, { type: "investigation-bogus" }, ctx).error, /unknown message/);
});

test("the export bundle carries each investigation as its handoff, and the README names it", () => {
  const out = join(tmp, "knowledge");
  exportKnowledge({ root, out, commit: "test" });
  assert.ok(existsSync(join(out, "investigations", "dup-rows.md")));
  assert.match(readFileSync(join(out, "investigations", "dup-rows.md"), "utf-8"), /Why does create insert twice\?|edited/);
  assert.match(readFileSync(join(out, "README.md"), "utf-8"), /\*\*Investigations a person saved:\*\* `investigations\/dup-rows\.md`/);
});
