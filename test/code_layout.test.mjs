// The file view's CODE mode layout (2026-09-24, src/webview/layout/code_layout.ts):
// top-level statements as source blocks, grouped like the card view.
//
//   npm run test:code-layout
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCodeLayout, codeBlockSize } from "../src/webview/layout/code_layout.ts";

const SRC = [
  "import os",                      // 1
  "from json import dumps",         // 2
  "",                               // 3
  "LIMIT = 10",                     // 4
  "",                               // 5
  "def helper(x):",                 // 6
  "    return x + 1",               // 7
  "",                               // 8
  "@cached",                        // 9
  "def main():",                    // 10
  "    y = helper(LIMIT)",          // 11
  "    print(dumps(y))",            // 12
].join("\n");

const NODES = [
  { id: "module/os.import", type: "import", line: 1, endLine: 1, parentId: null },
  { id: "module/json.import_from", type: "import_from", line: 2, endLine: 2, parentId: null },
  { id: "module/LIMIT.assign", type: "assignment", name: "LIMIT", line: 4, endLine: 4, parentId: null },
  { id: "module/helper.fn", type: "function_def", name: "helper", line: 6, endLine: 7, parentId: null },
  { id: "module/helper.fn/return@0", type: "return_stmt", line: 7, endLine: 7, parentId: "module/helper.fn" },
  { id: "module/main.fn", type: "function_def", name: "main", line: 10, endLine: 12, decoratorLine: 9, parentId: null },
  { id: "module/main.fn/y.assign", type: "assignment", name: "y", line: 11, endLine: 11, parentId: "module/main.fn" },
];
const REF = [{ source: "module/main.fn/y.assign", target: "module/helper.fn" }];

test("top-level statements become source blocks: imports as one, state, then the definitions", () => {
  const { nodes } = buildCodeLayout(NODES, REF, SRC, "python");
  assert.deepEqual(nodes.map((n) => n.id).sort(), ["code:imports", "module/LIMIT.assign", "module/helper.fn", "module/main.fn"].sort());
  const by = new Map(nodes.map((n) => [n.id, n]));
  assert.equal(by.get("code:imports").data.code, "import os\nfrom json import dumps");
  assert.equal(by.get("module/main.fn").data.code, "@cached\ndef main():\n    y = helper(LIMIT)\n    print(dumps(y))", "a decorated def starts at its decorator");
  assert.equal(by.get("module/main.fn").data.firstLine, 9);
  assert.equal(by.get("module/main.fn").data.label, "main()");
  // Nested statements are not blocks of their own: the code shows them.
  assert.ok(!nodes.some((n) => n.id.includes("/return@") || n.id.endsWith("/y.assign")));
});

test("columns read imports, state, definitions; a callee sits right of its caller; nothing overlaps", () => {
  const { nodes } = buildCodeLayout(NODES, REF, SRC, "python");
  const at = (id) => nodes.find((n) => n.id === id);
  assert.ok(at("code:imports").position.x < at("module/LIMIT.assign").position.x);
  assert.ok(at("module/LIMIT.assign").position.x < at("module/main.fn").position.x);
  assert.ok(at("module/helper.fn").position.x > at("module/main.fn").position.x, "helper is called by main");
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    const hit = a.position.x < b.position.x + b.width && b.position.x < a.position.x + a.width
      && a.position.y < b.position.y + b.height && b.position.y < a.position.y + a.height;
    assert.ok(!hit, `${a.id} overlaps ${b.id}`);
  }
});

test("a block is sized from its text, so it is smaller than the card it replaces", () => {
  const { nodes } = buildCodeLayout(NODES, REF, SRC, "python");
  const main = nodes.find((n) => n.id === "module/main.fn");
  assert.equal(main.height, 30 + 4 * 18 + 20 + 2, "label row + four lines + padding + border");
  assert.ok(main.width < 300, `a 20-character line is not a 300px card (${main.width})`);
});

test("a block holds every line whole: no width cap, so nothing scrolls", () => {
  const long = "x = " + "a".repeat(236);
  const { w, h } = codeBlockSize(`def f():\n    ${long}\n    return x`, 120, "f()", 7.2);
  // border + gutter (3 digits) + 244 chars + right pad, with no cap.
  assert.ok(w >= 2 + 12 + 3 * 7.2 + 10 + 244 * 7.2 + 16, `wide enough for the longest line (${w})`);
  assert.equal(h, 30 + 20 + 3 * 18 + 2);
  // A long label on a one-line block widens the block rather than clipping.
  const narrow = codeBlockSize("X = 1", 1, "a_very_long_module_level_constant_name", 7.2);
  assert.ok(narrow.w >= 38 * 7.5 + 72, `label fits (${narrow.w})`);
});

test("an edge between statements is drawn between the blocks that hold them, once", () => {
  const { mapEdge } = buildCodeLayout(NODES, REF, SRC, "python");
  const e = { id: "e1", source: "module/main.fn/y.assign", target: "module/helper.fn", data: { family: "flow" } };
  const first = mapEdge(e);
  assert.equal(first?.source, "module/main.fn", "the call inside main is drawn from main's block");
  assert.equal(first?.target, "module/helper.fn");
  assert.equal(mapEdge({ ...e, id: "e2" }), null, "a second call between the same blocks is the same line");
  assert.equal(mapEdge({ id: "e3", source: "module/main.fn/y.assign", target: "module/main.fn", data: {} }), null, "inside one block: no line");
});

// The card view height contract (2026-09-25): a card reserves the lines its
// text WRAPS to at the card width, so no clamp has to cut it.
import { wrapCount } from "../src/webview/util/wrapCount.ts";

test("wrapCount wraps like pre-wrap: newlines kept, breaks between words, long words split", () => {
  assert.equal(wrapCount("", 10), 1);
  assert.equal(wrapCount("short", 10), 1);
  assert.equal(wrapCount("one two three four", 9), 3, "one two / three / four");
  assert.equal(wrapCount("a\nb\nc", 80), 3, "source newlines are lines");
  assert.equal(wrapCount("x".repeat(25), 10), 3, "a word longer than a line breaks anywhere");
  assert.equal(wrapCount("{\n    \"concept\": concept,\n    \"ctx\": ctx\n}", 80), 4);
});
