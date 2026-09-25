// The C++ and Rust edit floors (2026-09-25): rewrite_cpp.mjs and
// rewrite_rust.mjs over the shared span-splice core (span_rewriter.mjs), and
// the indentation fix every node-level rewriter now shares (fitToSpan).
//
// Driven through the real command lines, on copies of the fixtures:
//   - each op, both languages, with the rest of the file byte-identical;
//   - a NESTED node replaced with the source as the editor shows it (already
//     indented) keeps its indentation — in C++, Rust, TypeScript AND bash,
//     because the bug was in all of them;
//   - the refusals: a renamed function, a result that does not parse, an
//     unknown id, an empty payload — nothing written;
//   - the formatter ladder: a formatter that reaches outside the node, or
//     breaks the parse, is refused and the raw verified splice is written.
//
//   npm run test:cpp-rust-rewrite
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dedent, fitToSpan } from "../scripts/frontends/confinement.mjs";
import { changedRegion } from "../scripts/frontends/span_rewriter.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FE = join(ROOT, "scripts", "frontends");
let tmp;
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "vg-cpprust-"));
  cpSync(join(ROOT, "test/fixtures/cpp/geometry_demo"), join(tmp, "cpp"), { recursive: true });
  cpSync(join(ROOT, "test/fixtures/rust/router_demo"), join(tmp, "rust"), { recursive: true });
  cpSync(join(ROOT, "test/fixtures/jsts/api_demo"), join(tmp, "jsts"), { recursive: true });
  cpSync(join(ROOT, "test/fixtures/bash/deploy_demo"), join(tmp, "bash"), { recursive: true });
});
after(() => rmSync(tmp, { recursive: true, force: true }));

function rewrite(script, file, op, id, source) {
  const r = spawnSync(process.execPath, [join(FE, script), file, op, ...(id ? [id] : [])], { input: source ?? "", encoding: "utf-8" });
  return JSON.parse(r.stdout || "{}");
}
/** The lines of `post` that differ from `pre`, as [-old, +new] pairs. */
function changes(pre, post) {
  const a = pre.split("\n"), b = post.split("\n");
  let h = 0; while (h < a.length && h < b.length && a[h] === b[h]) h++;
  let t = 0; while (t < a.length - h && t < b.length - h && a[a.length - 1 - t] === b[b.length - 1 - t]) t++;
  return { removed: a.slice(h, a.length - t), added: b.slice(h, b.length - t) };
}

test("dedent / fitToSpan: an absolute payload and a relative one land identically", () => {
  const pre = "fn a() {\n    if x {\n        y();\n    }\n}\n";
  const at = pre.indexOf("if x");
  const absolute = "    if x {\n        z();\n    }\n";
  const relative = "if x {\n    z();\n}";
  assert.equal(dedent(absolute), "if x {\n    z();\n}");
  assert.equal(fitToSpan(pre, at, absolute), "if x {\n        z();\n    }");
  assert.equal(fitToSpan(pre, at, relative), fitToSpan(pre, at, absolute));
  assert.deepEqual(changedRegion("a\nb\nc", "a\nB\nB2\nc"), { first: 2, last: 3 });
});

test("C++: replace a function; only its line changes", () => {
  const f = join(tmp, "cpp", "geometry.cpp");
  const pre = readFileSync(f, "utf-8");
  const r = rewrite("cpp/rewrite_cpp.mjs", f, "replace_node", "module/scale.fn", "double scale(double v) {\n  return v * 3.0;\n}\n");
  assert.equal(r.success, true, JSON.stringify(r));
  const d = changes(pre, readFileSync(f, "utf-8"));
  assert.deepEqual(d, { removed: ["  return v * 2.0;"], added: ["  return v * 3.0;"] }, "the first scale overload only");
});

test("C++: a nested for-loop replaced with the editor's (indented) source keeps its indentation", () => {
  const f = join(tmp, "cpp", "geometry.cpp");
  const pre = readFileSync(f, "utf-8");
  const r = rewrite("cpp/rewrite_cpp.mjs", f, "replace_node", "module/area_sum.fn/for@0",
    "  for (int i = 0; i < count; i++) {\n    total += shapes[i].area() * 1.0;\n  }\n");
  assert.equal(r.success, true, JSON.stringify(r));
  assert.deepEqual(changes(pre, readFileSync(f, "utf-8")), {
    removed: ["    total += shapes[i].area();"], added: ["    total += shapes[i].area() * 1.0;"],
  });
});

test("C++: refusals write nothing — a renamed function, a broken result, an unknown id, an empty payload", () => {
  const f = join(tmp, "cpp", "geometry.cpp");
  const pre = readFileSync(f, "utf-8");
  assert.equal(rewrite("cpp/rewrite_cpp.mjs", f, "replace_function_body", "module/area_sum.fn", "double other(int x) {\n  return 0;\n}\n").errorKind, "wrong_node_kind");
  assert.equal(rewrite("cpp/rewrite_cpp.mjs", f, "replace_node", "module/scale.fn", "double scale(double v) {\n  return v * ;\n}\n").errorKind, "parse_error");
  assert.equal(rewrite("cpp/rewrite_cpp.mjs", f, "replace_node", "module/nope.fn", "int x;\n").errorKind, "target_not_found");
  assert.equal(rewrite("cpp/rewrite_cpp.mjs", f, "replace_node", "module/scale.fn", "   \n").errorKind, "empty_source");
  assert.equal(readFileSync(f, "utf-8"), pre);
});

test("C++: insert_after, delete_node and replace_module_body", () => {
  const f = join(tmp, "cpp", "main.cpp");
  let pre = readFileSync(f, "utf-8");
  let r = rewrite("cpp/rewrite_cpp.mjs", f, "insert_after", "module/report.fn", "static int helper() {\n  return 1;\n}\n");
  assert.equal(r.success, true, JSON.stringify(r));
  assert.deepEqual(changes(pre, readFileSync(f, "utf-8")).added, ["static int helper() {", "  return 1;", "}"]);
  pre = readFileSync(f, "utf-8");
  r = rewrite("cpp/rewrite_cpp.mjs", f, "delete_node", "module/helper.fn");
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(readFileSync(f, "utf-8").includes("helper()"), false);
  r = rewrite("cpp/rewrite_cpp.mjs", f, "replace_module_body", null, "int main() {\n  return 0;\n}\n");
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(readFileSync(f, "utf-8"), "int main() {\n  return 0;\n}\n");
});

test("Rust: a method inside an impl, replaced with the editor's indented source, keeps its indentation", () => {
  const f = join(tmp, "rust", "src", "router.rs");
  const pre = readFileSync(f, "utf-8");
  const r = rewrite("rust/rewrite_rust.mjs", f, "replace_node", "module/Router.class/add.fn",
    "    pub fn add(&mut self, name: &str, sink: Box<dyn Sink>) {\n        self.sinks.insert(name.to_owned(), sink);\n    }\n");
  assert.equal(r.success, true, JSON.stringify(r));
  assert.deepEqual(changes(pre, readFileSync(f, "utf-8")), {
    removed: ["        self.sinks.insert(name.to_string(), sink);"],
    added: ["        self.sinks.insert(name.to_owned(), sink);"],
  });
});

test("Rust: the same method from an UNINDENTED payload lands at the same indentation", () => {
  const f = join(tmp, "rust", "src", "router.rs");
  const pre = readFileSync(f, "utf-8");
  const r = rewrite("rust/rewrite_rust.mjs", f, "replace_function_body", "module/Router.class/add.fn",
    "pub fn add(&mut self, name: &str, sink: Box<dyn Sink>) {\n    self.sinks.insert(name.into(), sink);\n}\n");
  assert.equal(r.success, true, JSON.stringify(r));
  assert.deepEqual(changes(pre, readFileSync(f, "utf-8")).added, ["        self.sinks.insert(name.into(), sink);"]);
});

test("Rust: refusals — a renamed fn, a broken result", () => {
  const f = join(tmp, "rust", "src", "router.rs");
  const pre = readFileSync(f, "utf-8");
  assert.equal(rewrite("rust/rewrite_rust.mjs", f, "replace_function_body", "module/parse_line.fn", "fn other() {}\n").errorKind, "wrong_node_kind");
  assert.equal(rewrite("rust/rewrite_rust.mjs", f, "replace_node", "module/unknown_sink.fn", "pub fn unknown_sink(name: &str) -> String {\n    format!(\n}\n").errorKind, "parse_error");
  assert.equal(readFileSync(f, "utf-8"), pre);
});

test("the indentation fix reaches TypeScript and bash: a nested node from the editor's indented source", () => {
  const ts = join(tmp, "jsts", "db.ts");
  let pre = readFileSync(ts, "utf-8");
  let r = rewrite("jsts/rewrite_jsts.mjs", ts, "replace_node", "module/insertUser.fn/if@0",
    "  if (!result.rows[0]) {\n    throw new Error(\"insert returned no row\");\n  }\n");
  assert.equal(r.success, true, JSON.stringify(r));
  assert.deepEqual(changes(pre, readFileSync(ts, "utf-8")), {
    removed: ["    throw new Error(\"insert returned nothing\");"], added: ["    throw new Error(\"insert returned no row\");"],
  });
  const sh = join(tmp, "bash", "deploy.sh");
  pre = readFileSync(sh, "utf-8");
  const block = pre.split("\n").slice(23, 30).join("\n").replace("staging.example.com", "staging2.example.com");
  r = rewrite("bash/rewrite_bash.mjs", sh, "replace_node", "module/upload.fn/if@0", block + "\n");
  assert.equal(r.success, true, JSON.stringify(r));
  const d = changes(pre, readFileSync(sh, "utf-8"));
  assert.equal(d.removed.length, 1);
  assert.equal(d.added[0], d.removed[0].replace("staging.example.com", "staging2.example.com"), "same indentation, one word changed");
});

test("the ladder: a formatter that reaches outside the node, or breaks the parse, is refused; the raw splice is written", async () => {
  // A fake language: the C++ builder, and formatters that misbehave.
  const script = join(tmp, "fake_rewrite.mjs");
  writeFileSync(script, `
import { buildFromSource, sourceHasParseErrors } from ${JSON.stringify(join(FE, "cpp", "parse_cpp.mjs"))};
import { runSpanRewriter } from ${JSON.stringify(join(FE, "span_rewriter.mjs"))};
await runSpanRewriter({
  script: "fake",
  build: (s) => buildFromSource(s),
  hasErrors: (s) => sourceHasParseErrors(s),
  async *formatCandidates(out) {
    yield { text: "// reformatted header\\n" + out, formatted: true };   // outside the node
    yield { text: out.replace("return", "return (("), formatted: true }; // does not parse
  },
});
`);
  const f = join(tmp, "cpp", "geometry.cpp");
  const pre = readFileSync(f, "utf-8");
  const r = spawnSync(process.execPath, [script, f, "replace_node", "module/Circle_area.fn"], {
    input: pre.split("\n").slice(8, 11).join("\n").replace("PI * r_", "3.14159 * r_"), encoding: "utf-8",
  });
  const out = JSON.parse(r.stdout);
  assert.equal(out.success, true, r.stdout);
  assert.equal(out.formatted, false, "both formatter candidates refused; the verified raw splice was written");
  const post = readFileSync(f, "utf-8");
  assert.ok(!post.includes("reformatted header"));
  assert.ok(!post.includes("return (("));
});
