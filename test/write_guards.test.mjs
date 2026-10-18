// WHAT A WRITE RUNS BEHIND (2026-10-14, the brief-intent drill,
// reviews/brief-intent/BASELINE.md): the parsers stamp `exits` on an if whose
// then-arm always leaves its block, and write_guards.ts reads, from the IR alone,
// the checks a statement runs behind. The brief facts carry each guarded zone
// write as an [enforce] item — the evidence "publishes only what verifies" rests on.
//
//   npm run test:write-guards
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { guardsOf, guardedWrites, guardText, readGuard } from "../src/server/write_guards.ts";
import { buildBriefFacts } from "../src/server/brief_facts.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), "vg-guards-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

function parse(name, text) {
  const file = join(tmp, name);
  writeFileSync(file, text);
  const r = name.endsWith(".py")
    ? spawnSync("python3", [join(ROOT, "scripts/parse_cst.py"), file], { encoding: "utf8", env: { ...process.env, PYTHONPATH: join(ROOT, ".pydeps") } })
    : spawnSync(process.execPath, [join(ROOT, "scripts/frontends/jsts/parse_jsts.mjs"), file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).nodes;
}
const at = (nodes, line, fn = "write") => nodes.find((n) => n.type === "call" && n.line === line && n.funcName === fn);
const said = (nodes, line, fn) => guardsOf(nodes, at(nodes, line, fn).id).map((g) => `${g.check} ${g.when}`);

const TS = [
  "export async function publish(ids: string[]) {",          // 1
  "  for (const id of ids) {",                                 // 2
  "    const d = await read(id);",                             // 3
  "    if (!verify(d)) continue;",                             // 4
  "    await write(\"out\", d);",                              // 5
  "  }",                                                       // 6
  "}",                                                         // 7
  "export async function guard(z: string) {",                  // 8
  "  await watch(z, async (id, doc) => {",                     // 9
  "    if (verify(doc)) return;",                              // 10
  "    await write(\"quarantine\", doc);",                     // 11
  "  });",                                                     // 12
  "  await write(\"after\", z);",                              // 13
  "}",                                                         // 14
  "export async function admit(doc: any, user: any) {",        // 15
  "  if (!doc) return;",                                       // 16
  "  if (hasRole(user, \"admin\")) {",                         // 17
  "    if (verify(doc)) { await write(\"ok\", doc); }",        // 18
  "    else { await write(\"bad\", doc); }",                   // 19
  "  }",                                                       // 20
  "}",                                                         // 21
].join("\n");

test("TypeScript: early exits, arms, callbacks, and a test with no call", () => {
  const nodes = parse("ex.ts", TS);
  assert.deepEqual(nodes.filter((n) => n.type === "if_stmt").map((n) => n.exits ?? "-"), ["continue", "return", "return", "-", "-"]);
  assert.deepEqual(said(nodes, 5), ["verify(d) holds"], "`if (!verify(d)) continue;` — the write runs only when it verifies");
  assert.deepEqual(said(nodes, 11), ["verify(doc) fails"], "an exit inside the callback guards the rest of the callback");
  assert.deepEqual(said(nodes, 13), [], "…and nothing after the callback: that return left the callback, not guard()");
  assert.deepEqual(said(nodes, 18), ["verify(doc) holds", "hasRole(user, \"admin\") holds"], "innermost first; `if (!doc) return` calls nothing and is no check");
  assert.deepEqual(said(nodes, 19), ["verify(doc) fails", "hasRole(user, \"admin\") holds"], "the else-arm runs when the test fails");
});

test("Python: `if not ok(x): continue`, a one-line return, raise", () => {
  const nodes = parse("ex.py", [
    "def publish(ids):",                 // 1
    "    for i in ids:",                 // 2
    "        if not verify(i):",         // 3
    "            continue",              // 4
    "        write(i)",                  // 5
    "",                                  // 6
    "def guard(doc):",                   // 7
    "    if verify(doc): return",        // 8
    "    write(doc)",                    // 9
    "",                                  // 10
    "def strict(doc):",                  // 11
    "    if not signed(doc):",           // 12
    "        raise ValueError('unsigned')", // 13
    "    write(doc)",                    // 14
  ].join("\n") + "\n");
  assert.deepEqual(nodes.filter((n) => n.type === "if_stmt").map((n) => n.exits), ["continue", "return", "raise"]);
  assert.deepEqual(said(nodes, 5), ["verify(i) holds"]);
  assert.deepEqual(said(nodes, 9), ["verify(doc) fails"]);
  assert.deepEqual(said(nodes, 14), ["signed(doc) holds"]);
});

test("a negation is read only when it covers one call", () => {
  assert.deepEqual(readGuard("!verify(d)", "fails"), { check: "verify(d)", when: "holds" });
  assert.deepEqual(readGuard("not (a(x) and b(y))", "holds"), { check: "(a(x) and b(y))", when: "fails" });
  assert.deepEqual(readGuard("!a(x) && b(y)", "fails"), { check: "!a(x) && b(y)", when: "fails" }, "the ! is a(x)'s alone: not flipped");
});

test("the brief facts carry each guarded zone write as [enforce]", () => {
  const nodes = parse("pub.ts", TS);
  const w = at(nodes, 5), q = at(nodes, 11), late = at(nodes, 13);
  const model = { version: "1", groups: [], unplaced: [], notes: [], nodes: [
    { id: "cluster:x", kind: "cluster", label: "partner exchange", refs: [] },
    { id: "zone:s/out", kind: "tool", label: "out", refs: [] }, { id: "zone:s/quarantine", kind: "tool", label: "quarantine", refs: [] },
  ], edges: [
    { id: "e1", from: "cluster:x", to: "zone:s/out", kind: "uses", protocol: "write", refs: [{ file: "src/pub.ts", nodeId: w.id }, { file: "src/pub.ts", nodeId: late.id }] },
    { id: "e2", from: "cluster:x", to: "zone:s/quarantine", kind: "uses", protocol: "write", refs: [{ file: "src/pub.ts", nodeId: q.id }] },
  ] };
  const files = { "src/pub.ts": { nodes } };
  assert.deepEqual(guardedWrites(model, files).map((x) => `${x.line} ${x.zone} ${guardText(x.guards)}`), [
    "5 zone:s/out only when verify(d) holds", "11 zone:s/quarantine only when verify(doc) fails"]);
  const f = buildBriefFacts(model, { root: tmp, readLines: () => TS.split("\n"), source: { files, threads: [] } });
  assert.match(f.text, /src\/pub\.ts:5 \[enforce\]: partner exchange writes out only when verify\(d\) holds — in publish/);
  assert.match(f.text, /src\/pub\.ts:11 \[enforce\]: partner exchange writes quarantine only when verify\(doc\) fails — in guard/);
  assert.equal(f.roles.get("src/pub.ts:5"), "enforce");
});
