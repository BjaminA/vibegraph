/**
 * M-CHAT-POLISH.3 — minimal markdown parser (src/webview/util/markdown_parse.ts).
 *
 * Pins the exact construct set (##/### headings, - bullets, fences,
 * paragraphs; inline `code` / **bold** / *italic*) and the STREAMING
 * TOLERANCE contract: partial constructs render stably as literal text
 * (dangling ** / `) or an open code block (unclosed fence) — a chunk
 * boundary must never toggle emphasis on and off.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/markdown_parse.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, parseInline } from "../src/webview/util/markdown_parse.ts";

test("headings: ## and ### parse, # and #### stay paragraphs", () => {
  const blocks = parseMarkdown("## Purpose\n### Detail\n# nope");
  assert.equal(blocks[0].kind, "heading");
  assert.equal(blocks[0].level, 2);
  assert.deepEqual(blocks[0].children, [{ kind: "text", text: "Purpose" }]);
  assert.equal(blocks[1].kind, "heading");
  assert.equal(blocks[1].level, 3);
  assert.equal(blocks[2].kind, "paragraph");
  assert.deepEqual(blocks[2].children, [{ kind: "text", text: "# nope" }]);
});

test("inline: bold, italic, code chip, and a node path stays whole", () => {
  const inline = parseInline("**Verified by running it** on `module/train_model.fn/for@0/if@3` *only*");
  assert.deepEqual(inline, [
    { kind: "bold", children: [{ kind: "text", text: "Verified by running it" }] },
    { kind: "text", text: " on " },
    { kind: "code", text: "module/train_model.fn/for@0/if@3" },
    { kind: "text", text: " " },
    { kind: "italic", children: [{ kind: "text", text: "only" }] },
  ]);
});

test("code spans protect their contents from emphasis", () => {
  const inline = parseInline("`a ** b` and `x * y`");
  assert.equal(inline[0].kind, "code");
  assert.equal(inline[0].text, "a ** b");
  assert.equal(inline[2].kind, "code");
  assert.equal(inline[2].text, "x * y");
});

test("bare asterisks in prose stay literal", () => {
  assert.deepEqual(parseInline("5 * 3 * 2"), [{ kind: "text", text: "5 * 3 * 2" }]);
});

test("bullets group into one list; blank line splits paragraphs", () => {
  const blocks = parseMarkdown("intro\n\n- one `a`\n- two\n\noutro");
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].kind, "paragraph");
  assert.equal(blocks[1].kind, "bullets");
  assert.equal(blocks[1].items.length, 2);
  assert.deepEqual(blocks[1].items[0][1], { kind: "code", text: "a" });
  assert.equal(blocks[2].kind, "paragraph");
});

test("closed fence: code block with lang, contents untouched", () => {
  const blocks = parseMarkdown("```python\nx = 1\n**not bold**\n```\nafter");
  assert.equal(blocks[0].kind, "codeblock");
  assert.equal(blocks[0].lang, "python");
  assert.equal(blocks[0].open, false);
  assert.equal(blocks[0].text, "x = 1\n**not bold**");
  assert.equal(blocks[1].kind, "paragraph");
});

test("STREAMING: unclosed fence renders as an OPEN code block", () => {
  const blocks = parseMarkdown("before\n```\npartial line");
  assert.equal(blocks[1].kind, "codeblock");
  assert.equal(blocks[1].open, true);
  assert.equal(blocks[1].text, "partial line");
});

test("STREAMING: dangling ** and ` render literally, then upgrade once closed", () => {
  // Mid-chunk: no closing marker yet — literal, never half-bold.
  assert.deepEqual(parseInline("**Verified by run"), [{ kind: "text", text: "**Verified by run" }]);
  assert.deepEqual(parseInline("see `module/tra"), [{ kind: "text", text: "see `module/tra" }]);
  // Next chunk closes it: same prefix now parses as emphasis/chip.
  assert.equal(parseInline("**Verified by run**")[0].kind, "bold");
  assert.equal(parseInline("see `module/tra`")[1].kind, "code");
});

test("paragraph keeps interior newlines (pre-wrap contract)", () => {
  const blocks = parseMarkdown("line one\nline two");
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].children, [{ kind: "text", text: "line one\nline two" }]);
});
