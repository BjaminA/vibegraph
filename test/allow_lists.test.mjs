// Allow-lists that do not go stale (2026-10-01, item 2 of the hooks-feedback
// brief): `import-only` / `callers-only` `files` take a folder (trailing /)
// or a glob, and `allowTests` adds every test file; an exact list behaves as
// it always did; a single-test-file list is warned about at promote time.
//
//   npm run test:allow-lists
import { test } from "node:test";
import assert from "node:assert/strict";
import { globRegExp, pathAllowed, isTestFile, singleTestFileList } from "../src/shared/path_match.ts";
import { checkConstraint, isConstraintCheck, describeCheck } from "../src/server/constraint_grammar.ts";
import { narrowAllowList } from "../src/server/plan_promote.ts";

test("globs: * stays in a folder, ** crosses folders, a trailing / is a folder", () => {
  assert.ok(globRegExp("src/transport/**").test("src/transport/a.ts"));
  assert.ok(globRegExp("src/transport/**").test("src/transport/deep/b.ts"));
  assert.ok(!globRegExp("src/transport/*").test("src/transport/deep/b.ts"));
  assert.ok(globRegExp("src/**/client.ts").test("src/client.ts"), "**/ may be zero folders");
  assert.ok(globRegExp("src/**/client.ts").test("src/a/b/client.ts"));
  assert.ok(!globRegExp("src/*.ts").test("srcXa.ts") && !globRegExp("src/a.ts").test("src/aXts"), "dots are literal");
  assert.ok(pathAllowed("src/transport/x.ts", ["src/transport/"]));
  assert.ok(!pathAllowed("src/transportx.ts", ["src/transport/"]));
  assert.ok(pathAllowed("ts/test/guarded-write.test.ts", [], { allowTests: true }));
  assert.ok(isTestFile("pkg/__tests__/a.ts") && isTestFile("a_test.py") && !isTestFile("src/testing.ts"));
});

const facts = (importsByFile) => ({ importsByFile, defined: [], calls: [], unresolved: [], externalCalls: [] });
const IMPORTS = {
  "src/transport/ws.ts": ["yjs"], "src/transport/deep/doc.ts": ["yjs"],
  "test/transport.test.ts": ["yjs"], "src/app.ts": ["yjs"],
};

test("import-only with a glob and allowTests: a new module in the funnel and the tests pass; only the stray file is violated", () => {
  const check = { rule: "import-only", tool: "yjs", files: ["src/transport/**"], allowTests: true };
  assert.ok(isConstraintCheck(check));
  const r = checkConstraint(facts(IMPORTS), check);
  assert.equal(r.verdict, "violated");
  assert.deepEqual(r.offenders, ["src/app.ts"]);
  assert.match(r.reason, /outside src\/transport\/\*\*, any test file/);
  assert.equal(describeCheck(check), "`yjs` imported only in src/transport/**, any test file");
  assert.equal(checkConstraint(facts({ ...IMPORTS, "src/app.ts": [] }), check).verdict, "pass");
});

test("an exact list is unchanged: the new module still reads as a violation (the reason a glob exists)", () => {
  const r = checkConstraint(facts(IMPORTS), { rule: "import-only", tool: "yjs", files: ["src/transport/ws.ts"] });
  assert.deepEqual(r.offenders.sort(), ["src/app.ts", "src/transport/deep/doc.ts", "test/transport.test.ts"]);
});

test("allowTests is a boolean or the check is refused, never coerced; callers-only takes it too", () => {
  assert.equal(isConstraintCheck({ rule: "import-only", tool: "yjs", files: ["a"], allowTests: "yes" }), false);
  assert.ok(isConstraintCheck({ rule: "callers-only", target: "write", files: ["src/store/**"], allowTests: true }));
  assert.ok(isConstraintCheck({ rule: "callers-only", target: "write", allowTests: true }), "tests only is a place");
});

test("promote warns when the allow-list is a single test file", () => {
  assert.ok(singleTestFileList(["ts/test/guarded-write.test.ts"]));
  assert.ok(!singleTestFileList(["src/transport/**"]) && !singleTestFileList(["a.ts", "b.test.ts"]));
  assert.match(narrowAllowList({ rule: "import-only", tool: "yjs", files: ["ts/test/guarded-write.test.ts"] }, "c1"), /single test file .*"allowTests": true.*constraint edit c1/);
  assert.equal(narrowAllowList({ rule: "import-only", tool: "yjs", files: ["src/transport/**"], allowTests: true }, "c1"), null);
});
