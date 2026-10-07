// Python layouts a thin-script tool set uses (2026-10-07, field report), on
// test/fixtures/python_layout/scripts_demo through the real CLI:
//
//   A1  tools/run.py only does `from pkg.cli import main; sys.exit(main())` —
//       one entry point, seeded at pkg/cli.py:main, run by tools/run.py
//   A2  tools/broken.py's main comes from a package that is not here — still
//       an entry (on the module), saying which name it could not find
//   A4  `import envfile` / `import fmt` in tools/ name the SIBLING files
//       (python puts the script's folder on the path) — linked, reached
//   A5  functions named only in a dispatch table are named, not dead
//   A6  HTMLParser's handle_* methods are framework callbacks, not dead
//   A7  a rule on `norm_name` (two files define one) is AMBIGUOUS, and a rule
//       pinned to one file's norm_name never counts the other file's calls
//   D1  `import-only` takes a module's plain name (`envfile`)
//   D2  `callers-only` takes `file.py:fn` and `pkg.module.fn`
//   D3  an `import-only` rule on a module nothing imports PASSES
//
//   npm run test:python-layouts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runConstraintChecks } from "../scripts/cli/check.mjs";
import { loadEnvelope } from "../scripts/quality_check.mjs";
delete process.env.CLAUDECODE;

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), "vg-pylayout-"));
const proj = join(tmp, "p");
cpSync(join(ROOT, "test/fixtures/python_layout/scripts_demo"), proj, { recursive: true });
after(() => rmSync(tmp, { recursive: true, force: true }));

const cli = (...args) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), ...args],
  { cwd: ROOT, encoding: "utf-8", env: { ...process.env, CLAUDECODE: "" } });
const exp = cli("export", proj);
const K = join(proj, ".vibegraph", "knowledge");
const read = (f) => readFileSync(join(K, f), "utf-8");

test("export runs", () => assert.equal(exp.status, 0, exp.stderr));

test("A1: a thin script seeds at the main it imports; A2: an unresolvable one says what it could not find", () => {
  const readme = read("README.md");
  assert.match(readme, /threads\/pkg_cli\.py_main\.md/, "pkg/cli.py:main is an entry point");
  const cliThread = read("threads/pkg_cli.py_main.md");
  assert.match(cliThread, /files reached: pkg\/cli\.py, pkg\/util\.py/);
  const broken = read("threads/tools_broken.py_module.md");
  assert.match(broken, /Entry point: `tools\/broken\.py:module`/);
  const ep = loadEnvelope(proj, undefined, {}).envelope.entryPoints;
  const run = ep.find((e) => e.file === "pkg/cli.py" && e.irNodeId.endsWith("main.fn"));
  assert.ok(run, JSON.stringify(ep.map((e) => e.id)));
  assert.deepEqual(run.metadata?.runBy, ["tools/run.py"]);
  assert.equal(run.label, "run.py");
  const b = ep.find((e) => e.id === "tools/broken.py:module");
  assert.match(b.summary, /entry calls 'main', not defined in this file and not linked; unresolved/);
  // no second, module-seeded entry for tools/run.py
  assert.equal(ep.filter((e) => e.file === "tools/run.py").length, 0);
});

test("A4: sibling modules imported by bare name are linked and reached", () => {
  const t = read("threads/tools_report.py_main.md");
  const reached = /files reached: ([^\n]+)/.exec(t)[1].split(", ");
  for (const f of ["tools/envfile.py", "tools/fmt.py", "tools/ids.py", "tools/paths.py"]) assert.ok(reached.includes(f), `${f} in ${reached}`);
  assert.doesNotMatch(t, /(envfile|fmt) \[project code, unlinked\]/);
});

test("A8: a pure helper in a loop is not charged with a same-named function's file-system effect", () => {
  const t = read("threads/tools_report.py_main.md");
  const loops = t.split("Round trips inside loops")[1].split("\n\n")[0];
  assert.match(loops, /where/, "the control loop (stamp_each → where → Path.cwd) IS a round trip");
  assert.doesNotMatch(loops, /host_of|is_primary/, "report.host_of and report.is_primary are pure");
});

test("A3: names bound at run time from a project module link, and coverage says the file binds names at runtime", () => {
  const t = read("threads/tools_test_fmt.py_test_render_jobs.md");
  assert.match(t, /files reached: [^\n]*tools\/fmt\.py/, "render() reached through globals().update(vars(fmt))");
  const m = read("threads/tools_test_fmt.py_test_mint.md");
  assert.match(m, /files reached: [^\n]*tools\/ids\.py/, "mint() reached through `from ids import *`");
  const cov = cli("coverage", proj, join(proj, "tools/test_fmt.py"));
  assert.equal(cov.status, 0, cov.stderr);
  assert.match(cov.stdout, /binds names at runtime: from ids import \*; globals\(\)\.update\(\{k: v for k, v in vars\(fmt\)/);
});

test("A1: coverage counts a thin script as run by the entry it imports", () => {
  const cov = cli("coverage", proj, join(proj, "tools/run.py"));
  assert.equal(cov.status, 0, cov.stderr);
  assert.match(cov.stdout, /threads: [^\n]*pkg\/cli\.py:main/);
});

test("A9: the project's own folder is never a third-party tool", () => {
  const t = read("threads/tools_report.py_main.md");
  assert.doesNotMatch(t, /^- tools \[unknown\]/m, "parser.feed on a project subclass is not a package called `tools`");
  assert.match(t, /tools\.page \[project code/);
  const arch = read("architecture.md");
  assert.doesNotMatch(arch, /\| `tools` \|.*third-party/);
});

test("A5/A6: dispatch-table functions are named; framework callbacks are not dead", () => {
  const r = read("reachability.md");
  const never = r.split("## Never named anywhere")[1].split("\n## ")[0];
  assert.match(never, /`old_title`/, "the one function nothing names");
  assert.doesNotMatch(never, /handle_starttag|_row_jobs|_row_people/);
  assert.match(r, /\| Framework callbacks \| 3 \|/);
});

function withRules(rules) {
  mkdirSync(join(proj, ".vibegraph"), { recursive: true });
  writeFileSync(join(proj, ".vibegraph", "constraints.json"), JSON.stringify({
    version: "1",
    constraints: rules.map(([id, check]) => ({ id, kind: "invariant", text: id, scope: { all: true }, source: "human", createdAt: "2026-10-07T00:00:00.000Z", check })),
  }, null, 2));
  const out = runConstraintChecks({ root: proj, commit: "test" });
  return Object.fromEntries(out.results.map((r) => [r.id, r]));
}

test("A7/D2: a rule names ONE definition; a bare name defined twice is ambiguous", () => {
  const r = withRules([
    ["bare", { rule: "callers-only", target: "norm_name", files: ["tools/report.py"] }],
    ["pinned", { rule: "callers-only", target: "tools/report.py:norm_name", files: ["tools/report.py"] }],
    ["other", { rule: "callers-only", target: "tools/ids.py:norm_name", files: ["tools/report.py"] }],
    // test_fmt.py calls mint through `from ids import *` (A3): a test, allowed
    ["dotted", { rule: "callers-only", target: "tools.ids.mint", files: ["tools/report.py"], allowTests: true }],
  ]);
  assert.equal(r.bare.verdict, "unverifiable");
  assert.match(r.bare.reason, /AMBIGUOUS: 2 files define it/);
  assert.match(r.bare.reason, /`tools\/report\.py:norm_name`/);
  assert.match(r.bare.reason, /`tools\/ids\.py:norm_name`/);
  assert.equal(r.pinned.verdict, "pass", r.pinned.reason);
  assert.equal(r.other.verdict, "violated", "ids.py's own calls to ITS norm_name are outside report.py");
  assert.ok(r.other.offenders.every((o) => o.startsWith("tools/ids.py:")), r.other.offenders.join());
  assert.equal(r.dotted.verdict, "pass", r.dotted.reason);
});

test("D4: `constraints add` runs the check first — unverifiable is refused unless forced; --dry-run stores nothing", () => {
  const p2 = join(tmp, "d4");
  cpSync(join(ROOT, "test/fixtures/python_layout/scripts_demo"), p2, { recursive: true });
  const add = (...extra) => cli("constraints", "add", p2, "--kind", "invariant", "--text", "only report.py calls its norm_name", "--all", ...extra);
  const bad = add("--check", JSON.stringify({ rule: "callers-only", target: "norm_name", files: ["tools/report.py"] }));
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /UNVERIFIABLE — .*AMBIGUOUS/);
  assert.match(bad.stderr, /refused: this check is UNVERIFIABLE .* --force/);
  const dry = add("--check", JSON.stringify({ rule: "callers-only", target: "tools/report.py:norm_name", files: ["tools/report.py"] }), "--dry-run");
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /dry run — nothing stored[\s\S]*PASS — /);
  assert.match(cli("constraints", "list", p2).stdout, /no stated constraints/);
  const forced = add("--check", JSON.stringify({ rule: "callers-only", target: "norm_name", files: ["tools/report.py"] }), "--force");
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /stated c1/);
});

test("D1/D3: import-only takes a plain module name, and a module nothing imports passes", () => {
  const r = withRules([
    ["plain", { rule: "import-only", tool: "envfile", files: ["tools/report.py"] }],
    ["nobody", { rule: "import-only", tool: "page", files: ["tools/page.py"] }],
    ["missing", { rule: "import-only", tool: "no_such_module", files: ["tools/report.py"] }],
  ]);
  assert.equal(r.plain.verdict, "pass", r.plain.reason);
  assert.match(r.plain.reason, /the project module tools\.envfile/);
  assert.equal(r.nobody.verdict, "pass", r.nobody.reason);
  assert.match(r.nobody.reason, /^satisfied: /);
  assert.equal(r.missing.verdict, "unverifiable");
});
