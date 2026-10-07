// THE SERVER'S PIPELINE CACHE (2026-10-07). `view` on a 58-file project ran
// the whole pipeline on every start and every external save — 24–41 s a pass,
// two passes before the first draw. Now only what moved is parsed or
// extracted again, and a restart starts from the last run. Pinned (src/server/
// pipeline_cache.ts): a file whose content is unchanged reuses its parse, a
// changed one is parsed again; a new path, a changed context file or a
// changed tool parses everything; a thread is kept unless its seed or a file
// it walks changed after linking, and every thread is extracted again when a
// module path or a Class.method moved; the cache survives a restart; the last
// project message is kept for the next start.
//
//   npm run test:pipeline-cache
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineCache, readLastMessage, writeLastMessage, serverCacheDir } from "../src/server/pipeline_cache.ts";

const tmp = mkdtempSync(join(tmpdir(), "vg-pcache-"));
process.env.VG_CACHE_DIR = join(tmp, "cache");
after(() => rmSync(tmp, { recursive: true, force: true }));
const root = join(tmp, "p");
mkdirSync(join(root, "app"), { recursive: true });
const A = join(root, "app", "a.py"), B = join(root, "app", "b.py");
writeFileSync(A, "def a():\n    return 1\n");
writeFileSync(B, "def b():\n    return 2\n");
const ir = (name, extra = []) => ({ modulePath: `app.${name}`, nodes: [{ id: `module/${name}.fn` }, ...extra.map((id) => ({ id }))], edges: [] });
const seeds = [{ id: "app/a.py:a", file: "app/a.py", irNodeId: "module/a.fn" }, { id: "app/b.py:b", file: "app/b.py", irNodeId: "module/b.fn" }];
const threads = [
  { entryPointId: "app/a.py:a", seed: { file: "app/a.py", irNodeId: "module/a.fn" }, filesReached: ["app/a.py"] },
  { entryPointId: "app/b.py:b", seed: { file: "app/b.py", irNodeId: "module/b.fn" }, filesReached: ["app/b.py", "app/a.py"] },
];

function pass(cache, irs) {
  const plan = cache.beginParse([A, B]);
  const fresh = Object.fromEntries(plan.toParse.map((f) => [f, irs[f]]));
  cache.storeParsed(fresh);
  const rel = { "app/a.py": irs[A], "app/b.py": irs[B] };
  const sel = cache.selectThreads(rel, seeds);
  const out = cache.mergeThreads(seeds, sel.cached, threads.filter((t) => sel.toExtract.some((s) => s.id === t.entryPointId)));
  cache.save();
  return { plan, sel, out };
}

test("cold, then nothing moved: no parse, no extraction — and it survives a restart", () => {
  const first = pass(new PipelineCache(root, ["tool-1"]), { [A]: ir("a"), [B]: ir("b") });
  assert.deepEqual(first.plan.toParse.sort(), [A, B].sort());
  assert.equal(first.sel.toExtract.length, 2);
  const again = pass(new PipelineCache(root, ["tool-1"]), { [A]: ir("a"), [B]: ir("b") });
  assert.deepEqual(again.plan.toParse, [], "a restart reuses every parse");
  assert.equal(again.sel.toExtract.length, 0, "and every thread");
  assert.deepEqual(Object.keys(again.plan.reuse).sort(), [A, B].sort());
  assert.equal(again.out.length, 2);
});

test("one file edited: only it is parsed, only the threads that walk it are extracted", () => {
  const cache = new PipelineCache(root, ["tool-1"]);
  writeFileSync(B, "def b():\n    return 3\n");
  const r = pass(cache, { [A]: ir("a"), [B]: { ...ir("b"), edges: [{ source: "x", target: "y", type: "call" }] } });
  assert.deepEqual(r.plan.toParse, [B]);
  assert.deepEqual(r.sel.toExtract.map((s) => s.id), ["app/b.py:b"], "a.py's thread does not walk b.py");
});

test("a moved method, a new tool, a new path: everything again", () => {
  const cache = new PipelineCache(root, ["tool-1"]);
  writeFileSync(A, "class K:\n    def m(self):\n        return 1\n");
  const r = pass(cache, { [A]: ir("a", ["module/K.class/m.fn"]), [B]: { ...ir("b"), edges: [{ source: "x", target: "y", type: "call" }] } });
  assert.match(r.sel.reason, /every thread: app\/a\.py changed a module path or a method/);
  assert.equal(r.sel.toExtract.length, 2);
  assert.match(new PipelineCache(root, ["tool-2"]).beginParse([A, B]).reason, /full/);
  writeFileSync(join(root, "app", "c.py"), "x = 1\n");
  assert.match(new PipelineCache(root, ["tool-1"]).beginParse([A, B, join(root, "app", "c.py")]).reason, /full/);
  writeFileSync(join(root, "tsconfig.json"), "{}");
  assert.match(new PipelineCache(root, ["tool-1"]).beginParse([A, B]).reason, /full/, "a parse-context file changed");
});

test("the last project message is kept for the next start, outside the project", async () => {
  writeLastMessage(root, '{"type":"project-update","payload":{}}');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(readLastMessage(root), '{"type":"project-update","payload":{}}');
  assert.ok(serverCacheDir(root).startsWith(process.env.VG_CACHE_DIR));
});
