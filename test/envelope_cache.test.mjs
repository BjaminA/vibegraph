// The envelope cache (2026-09-28): check / affected / coverage / the hooks read
// the envelope through scripts/envelope_cache.mjs, which re-parses only what
// moved and re-extracts only the threads that walk it. The contract under
// test is that the answer never changes: after every kind of edit the cached
// envelope is deep-equal to a full build (system tier aside, which the cache
// does not build).
//
//   npm run test:envelope-cache
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEnvelopeCached } from "../scripts/envelope_cache.mjs";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";

let root, cacheDir;
before(() => {
  const base = mkdtempSync(join(tmpdir(), "vg-envcache-"));
  root = join(base, "fleet");
  cacheDir = join(base, "cache");
  cpSync("examples/fleet-telemetry", root, { recursive: true, filter: (p) => !p.includes("__pycache__") });
});
after(() => rmSync(join(root, ".."), { recursive: true, force: true }));

const cached = () => buildEnvelopeCached(root, { cacheDir });
const full = () => buildPolyglotEnvelope(root, { skipSystem: true }).envelope;
const edit = (rel, find, repl) => {
  const p = join(root, rel);
  const s = readFileSync(p, "utf-8");
  assert.ok(s.includes(find), `${rel} contains ${find}`);
  writeFileSync(p, s.replace(find, repl));
};

test("cold, then a hit that reads back the same envelope", () => {
  const a = cached();
  assert.equal(a.cache.mode, "cold");
  assert.deepStrictEqual(a.envelope, full());
  const b = cached();
  assert.equal(b.cache.mode, "hit");
  assert.equal(b.cache.parsed, 0);
  assert.deepStrictEqual(b.envelope, a.envelope);
  assert.equal("system" in b.envelope, false, "the cache never claims a system tier it did not build");
});

test("a body edit re-parses one file and re-extracts only the threads that walk it", () => {
  edit("telemetry/alerts.py", "def recent_events(limit: int) -> list:\n", "def recent_events(limit: int) -> list:\n    limit = max(limit, 1)\n");
  const r = cached();
  assert.equal(r.cache.mode, "incremental");
  assert.equal(r.cache.parsed, 1);
  assert.ok(r.cache.extracted > 0 && r.cache.extracted < r.envelope.threads.length,
    `re-extracted ${r.cache.extracted} of ${r.envelope.threads.length}`);
  assert.deepStrictEqual(r.envelope, full());
});

test("a same-size edit is still seen (content hashes, not mtimes)", () => {
  edit("telemetry/alerts.py", "limit = max(limit, 1)", "limit = max(limit, 2)");
  const r = cached();
  assert.equal(r.cache.mode, "incremental");
  assert.equal(r.cache.parsed, 1);
  assert.deepStrictEqual(r.envelope, full());
});

test("a new Class.method re-extracts EVERY thread (extraction reads methods project-wide)", () => {
  appendFileSync(join(root, "telemetry/metrics_math.py"), "\n\nclass Window:\n    def width(self):\n        return 1\n");
  const r = cached();
  assert.equal(r.cache.extracted, r.envelope.threads.length);
  assert.match(r.cache.reason, /method definition/);
  assert.deepStrictEqual(r.envelope, full());
});

test("a new file, a tsconfig and manual seeds each force a full rebuild", () => {
  writeFileSync(join(root, "telemetry/extra.py"), "def extra():\n    return 1\n");
  let r = cached();
  assert.equal(r.cache.mode, "full");
  assert.deepStrictEqual(r.envelope, full());

  writeFileSync(join(root, "gateway/tsconfig.json"), '{ "compilerOptions": { "baseUrl": "." } }\n');
  r = cached();
  assert.equal(r.cache.mode, "full");
  assert.deepStrictEqual(r.envelope, full());

  mkdirSync(join(root, ".vibegraph"), { recursive: true });
  writeFileSync(join(root, ".vibegraph/manual_seeds.json"), JSON.stringify({ seeds: [{ file: "telemetry/extra.py", irNodeId: "module/extra.fn" }] }));
  r = cached();
  assert.equal(r.cache.mode, "full");
  assert.ok(r.envelope.entryPoints.some((e) => e.file === "telemetry/extra.py"), "the named seed is an entry point");
  assert.deepStrictEqual(r.envelope, full());
  assert.equal(cached().cache.mode, "hit");
});

test("a TypeScript edit in a file several threads walk", () => {
  edit("gateway/format.ts", "export function", "// touched\nexport function");
  const r = cached();
  assert.equal(r.cache.mode, "incremental");
  assert.deepStrictEqual(r.envelope, full());
});

// ── the store (2026-10-20, scripts/envelope_store.mjs): one blob per parsed
// IR, linked IR and thread, named by the sha1 of its text, and a manifest ──
const blobs = () => new Set(readdirSync(join(cacheDir, "blobs")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)));
const manifest = () => JSON.parse(readFileSync(join(cacheDir, "meta.json"), "utf-8"));
const sha1 = (s) => createHash("sha1").update(s).digest("hex");
const same = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg ?? "byte for byte, key order included");

test("the stored envelope reads back byte for byte; every blob is named by its content and none is orphaned", () => {
  const r = cached();
  assert.equal(r.cache.mode, "hit");
  same(r.envelope, full());
  const m = manifest();
  const named = new Set([...Object.values(m.parsed).map((p) => p.blob), ...Object.values(m.files), ...m.threads, m.shell]);
  assert.deepEqual([...blobs()].sort(), [...named].sort(), "the folder holds exactly what the manifest names");
  for (const name of named) assert.equal(sha1(readFileSync(join(cacheDir, "blobs", `${name}.json`), "utf-8")), name);
});

test("an edit writes only what it changed: its parse, the linked files that moved, the threads re-extracted", () => {
  const before = blobs();
  const m0 = manifest();
  edit("telemetry/alerts.py", "limit = max(limit, 2)", "limit = max(limit, 3)");
  const r = cached();
  assert.equal(r.cache.mode, "incremental");
  same(r.envelope, full());
  const m1 = manifest();
  const newThreads = m1.threads.filter((b) => !m0.threads.includes(b));
  const allowed = new Set([
    m1.parsed["telemetry/alerts.py"].blob,
    ...Object.entries(m1.files).filter(([f, b]) => m0.files[f] !== b).map(([, b]) => b),
    ...newThreads,
    m1.shell,
  ]);
  for (const b of blobs()) if (!before.has(b)) assert.ok(allowed.has(b), `blob ${b} was written though nothing it holds changed`);
  assert.ok(newThreads.length <= r.cache.extracted, "a reused thread keeps its blob");
  assert.ok(newThreads.length < m1.threads.length, "the threads that do not walk the file are not written again");
});

test("a blob that is gone (pruned by a concurrent run, deleted by hand) costs a rebuild, never a partial envelope", () => {
  const m = manifest();
  rmSync(join(cacheDir, "blobs", `${m.threads[0]}.json`));
  rmSync(join(cacheDir, "blobs", `${Object.values(m.parsed)[0].blob}.json`), { force: true });
  const r = cached();
  same(r.envelope, full());
  assert.match(r.cache.reason, /could not be read/);
  assert.equal(cached().cache.mode, "hit", "and the store is whole again");
});

test("a version-1 cache (two whole-map files) is rebuilt and its files removed", () => {
  writeFileSync(join(cacheDir, "envelope.json"), "{}");
  writeFileSync(join(cacheDir, "parsed.json"), "{}");
  writeFileSync(join(cacheDir, "meta.json"), JSON.stringify({ ...manifest(), version: "1" }));
  const r = cached();
  assert.equal(r.cache.mode, "full");
  same(r.envelope, full());
  for (const f of ["envelope.json", "parsed.json"]) assert.equal(existsSync(join(cacheDir, f)), false, `${f} removed`);
});
