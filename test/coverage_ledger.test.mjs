// The coverage ledger (2026-10-22, the root-cause handoff RC2: "the analysis
// does not say what it did not read"). A synthetic site in Python and
// JavaScript: a page whose app is one inline script, a Worker the wrangler
// config names, `.js` files that are source by evidence beside ones that are
// not (minified, compiled from a `.ts`, named by nothing), and code no
// frontend reads (SQL, a notebook, a Dockerfile, a workflow).
//
//   npm run test:coverage-ledger
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { walkSources, settleLedger } from "../src/server/source_walk.ts";
import { ledgerHeadline, ledgerInWords, ledgerUnread } from "../src/shared/coverage_ledger.ts";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { capabilitiesForPath, languageForOwnExtension, languageForPath, monacoLanguageOf } from "../src/shared/languages.ts";
import { languageForFile, mayBeSource } from "../src/server/languages.ts";
import { setupState } from "../src/server/setup_state.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SITE = "test/fixtures/coverage/site_demo";
let walk, built;
before(() => { walk = walkSources(SITE); built = buildPolyglotEnvelope(SITE); });
const tmp = mkdtempSync(join(tmpdir(), "vg-ledger-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("a .js file is read only on evidence, and each one says which", () => {
  const admitted = Object.fromEntries(walk.sources.filter((s) => s.admittedBy).map((s) => [s.rel, s.admittedBy]));
  assert.deepEqual(admitted, {
    "edge/worker.js": "named by the Cloudflare wrangler config (wrangler.toml)",
    "lib/format.js": "imported by scripts/app.mjs",
    "public/index.html": "1 inline script (lines 10-25)",
    "public/label.js": "imported by public/index.html",
    "scripts/release.js": "named by the workflow .github/workflows/release.yml",
    "scripts/seed.js": "a `#!` node script",
    "scripts/serve.js": "run by package.json \"scripts\"",
    "templates/report.html": "1 inline script (lines 6-12)",
  });
  const deferred = Object.fromEntries(walk.ledger.deferred.map((f) => [f.file, f.reason]));
  assert.equal(deferred["src/widget.js"], "compiled from src/widget.ts");
  assert.match(deferred["public/vendor.min.js"], /^minified or bundled \(by its name\); loaded by public\/index\.html$/, "output stays out whatever names it");
  assert.match(deferred["scripts/old_helper.js"], /^no evidence it is source/);
  assert.equal(deferred["public/plain.html"], "a page with no inline script");
});

test("the ledger accounts for every file: read, not read with why, code no frontend reads, the rest", () => {
  const l = walk.ledger;
  assert.deepEqual(Object.keys(l.parsed.byLanguage).sort(), ["jsts", "python"]);
  assert.equal(l.parsed.files, 12);
  assert.deepEqual(l.notRead.map((g) => g.kind).sort(), ["CI workflows", "Dockerfiles", "SQL", "notebooks"]);
  assert.equal(l.other, 3, "README, package.json, wrangler.toml");
  assert.deepEqual(ledgerUnread(l), { files: 8, lines: l.deferred.reduce((s, f) => s + f.lines, 0) + l.notRead.reduce((s, g) => s + g.lines, 0) });
  assert.match(ledgerHeadline(l), /^not analysed: 8 files, \d+ lines$/);
  const words = ledgerInWords(l).join("\n");
  for (const f of ["src/widget.js", "scripts/old_helper.js", "db/001_init.sql", "notebooks/explore.ipynb"]) assert.ok(words.includes(f), f);
  const settled = settleLedger(l, { "api/app.py": "boom" }, walk.sources);
  assert.equal(settled.parsed.files, 11);
  assert.deepEqual(settled.failed.map((f) => f.file), ["api/app.py"]);
});

test("a page's inline scripts are parsed with lines mapped to the page", () => {
  const ir = built.envelope.files["public/index.html"];
  assert.equal(ir.language, "jsts");
  assert.deepEqual(ir.embedded, { host: "html", scripts: [{ line: 10, endLine: 25, type: "module" }] });
  const res = ir.nodes.find((n) => n.type === "assignment" && n.name === "res");
  const page = readFileSync(join(SITE, "public/index.html"), "utf-8").split("\n");
  assert.match(page[res.line - 1], /const res = await fetch\("\/api\/items"\);/, "the node's line is the page's line");
  assert.ok(!ir.nodes.some((n) => /WebSite|vendor/.test(JSON.stringify(n))), "a JSON block and a script by src are not read as this page");
  assert.deepEqual(built.envelope.files["templates/report.html"].embedded.scripts, [{ line: 6, endLine: 12, type: "text/javascript" }]);
});

test("the Worker and the pages are entry points, and a page's thread reaches what it imports", () => {
  const ids = built.envelope.entryPoints.map((e) => e.id);
  for (const id of ["edge/worker.js:fetch", "public/index.html:module", "templates/report.html:module", "scripts/seed.js:module"]) assert.ok(ids.includes(id), id);
  const worker = built.envelope.entryPoints.find((e) => e.id === "edge/worker.js:fetch");
  assert.equal(worker.kind, "route");
  assert.equal(worker.framework, "worker");
  const t = built.envelope.threads.find((x) => x.entryPointId === "public/index.html:module");
  assert.ok(t.filesReached.includes("public/label.js"), JSON.stringify(t.filesReached));
  assert.ok(t.nodes.some((n) => /fetch/.test(n.label ?? n.callTarget ?? "")), "the page's fetch is on its thread");
  assert.ok(built.envelope.files["api/app.py"], "the Python half is read beside it");
  assert.deepEqual(built.parseErrors, {});
});

test("a page is read, never edited; an admitted .js is TypeScript's to edit", () => {
  assert.equal(capabilitiesForPath("public/index.html").edit, false);
  assert.equal(capabilitiesForPath("edge/worker.js").edit, true);
  assert.equal(monacoLanguageOf("public/index.html"), "html");
  assert.equal(monacoLanguageOf("edge/worker.js"), "javascript");
  assert.equal(monacoLanguageOf("scripts/app.mjs"), "typescript", "unchanged");
  assert.equal(languageForOwnExtension("edge/worker.js"), null, "never by extension alone");
  assert.equal(languageForPath("edge/worker.js")?.id, "jsts", "the frontend that reads it once admitted");
  assert.equal(languageForFile("worker.js"), null);
  assert.equal(mayBeSource("worker.js"), true, "a change to it is worth a re-check");
  assert.equal(mayBeSource("types.d.ts"), false);
});

test("the web frontend the system tier text-scans stays out: nothing names it", () => {
  const sys = walkSources("test/fixtures/system/system_demo");
  assert.ok(!sys.sources.some((s) => s.rel === "web/src/api.jsx"));
  assert.match(sys.ledger.deferred.find((f) => f.file === "web/src/api.jsx")?.reason ?? "", /^no evidence it is source/);
});

test("the setup says what was not read, as an optional step a person may set aside", () => {
  const s = setupState(SITE, { ledger: walk.ledger });
  const step = s.steps.find((x) => x.id === "coverage");
  assert.equal(step.status, "optional");
  assert.match(step.facts[0], /^not analysed: 8 files/);
  assert.ok(step.commands.some((c) => c.run === "vibegraph-knowledge coverage"));
  assert.notEqual(s.next?.id, "coverage", "it never blocks the next step");
});

test("`coverage` with no files prints the ledger; the export writes coverage.md and says it on architecture.md", () => {
  const proj = join(tmp, "site");
  cpSync(join(ROOT, SITE), proj, { recursive: true });
  const cli = (args) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), ...args],
    { cwd: ROOT, encoding: "utf-8", env: { ...process.env, CLAUDECODE: "", VG_NO_CACHE: "1" } });
  const c = cli(["coverage", proj]);
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /^# What VibeGraph read in site/);
  assert.match(c.stdout, /`src\/widget\.js` \(\d+ lines?\): compiled from src\/widget\.ts/);
  const e = cli(["export", proj]);
  assert.equal(e.status, 0, e.stderr);
  const out = join(proj, ".vibegraph", "knowledge");
  assert.match(readFileSync(join(out, "coverage.md"), "utf-8"), /Not read/);
  assert.match(readFileSync(join(out, "architecture.md"), "utf-8"), /> \*\*Not analysed: 8 files/);
  assert.match(readFileSync(join(out, "README.md"), "utf-8"), /\*\*Not analysed: 8 files/);
});
