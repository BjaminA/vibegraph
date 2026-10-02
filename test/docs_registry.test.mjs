// Derived documents go stale visibly (2026-10-01, Module 10 of the plan-
// architecture brief). On a git copy of test/fixtures/plan/deploy_demo, a
// generated document docs/RULES.md is registered as derived from
// packages/rules/. Pinned: fresh while no input changed after its commit;
// STALE SINCE the first later commit that changed an input (named, with the
// generator to run); stale from the working tree when an input changed
// uncommitted; unknown — never fresh — when git cannot say; `docs check`
// exits 1; the session-start hook lists the stale ones.
//
//   npm run test:docs-registry
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { docStatus, docsStatus, validateDoc } from "../src/server/docs_registry.ts";
import { runDocs } from "../scripts/cli/docs.mjs";
import { runHook } from "../scripts/cli/hooks.mjs";

let base, root;
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf-8" }).trim();
const commit = (msg) => { git("add", "-A"); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", msg); return git("log", "-1", "--format=%h"); };
before(() => {
  base = mkdtempSync(join(tmpdir(), "vg-docs-"));
  root = join(base, "deploy");
  process.env.VG_CACHE_DIR = join(base, "cache");
  cpSync("test/fixtures/plan/deploy_demo", root, { recursive: true });
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs/RULES.md"), "# Rules\n\nscore, classify\n");
  git("init", "-q");
  commit("base, with the generated doc");
  const r = runDocs(["add", "docs/RULES.md", "--generator", "node scripts/gen-rules-doc.mjs", "--inputs", "packages/rules/", "--root", root]);
  assert.equal(r.exitCode, 0, r.text);
  commit("register the doc");
});
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

test("fresh while no input changed after the document's commit", () => {
  const [s] = docsStatus(root);
  assert.equal(s.state, "fresh");
  assert.match(s.detail, /no input changed since/);
  assert.equal(runDocs(["check", "--root", root]).exitCode, 0);
});

test("ACCEPTANCE: stale since the first later commit that changed an input — named, with the generator", () => {
  appendFileSync(join(root, "packages/rules/src/index.ts"), "\nexport const VERSION = 2;\n");
  const changedAt = commit("change the rules");
  appendFileSync(join(root, "packages/rules/src/index.ts"), "\nexport const PATCH = 1;\n");
  commit("and again");
  const [s] = docsStatus(root);
  assert.equal(s.state, "stale");
  assert.equal(s.since, changedAt, "the FIRST commit after the doc that changed an input");
  assert.deepEqual(s.changed, ["packages/rules/src/index.ts"]);
  assert.match(s.detail, /regenerate: node scripts\/gen-rules-doc\.mjs/);
  const r = runDocs(["check", "--root", root]);
  assert.equal(r.exitCode, 1);
  assert.match(r.text, new RegExp(`STALE  docs/RULES\\.md — stale since ${changedAt}`));
});

test("ACCEPTANCE: the session-start hook lists the stale documents", () => {
  const out = runHook("session-start", { session_id: "s", source: "startup" }, { absRoot: root, pipeline: {} });
  const ctx = out?.json?.hookSpecificOutput?.additionalContext ?? "";
  assert.match(ctx, /Stale generated documents \(1\) — do not trust them as current: docs\/RULES\.md \(since [0-9a-f]+; regenerate: node scripts\/gen-rules-doc\.mjs\)/);
});

test("regenerated (committed) is fresh again; an uncommitted input change is stale from the working tree", () => {
  writeFileSync(join(root, "docs/RULES.md"), "# Rules\n\nscore, classify, VERSION, PATCH\n");
  commit("regenerate the doc");
  assert.equal(docsStatus(root)[0].state, "fresh");
  appendFileSync(join(root, "packages/rules/src/index.ts"), "\nexport const DRAFT = true;\n");
  const [s] = docsStatus(root);
  assert.equal(s.state, "stale");
  assert.equal(s.since, "the working tree");
});

test("unknown — never fresh — when git cannot say; a malformed registration is refused", () => {
  const nogit = mkdtempSync(join(tmpdir(), "vg-docs-nogit-"));
  try {
    assert.equal(docStatus(nogit, { path: "A.md", generator: "x", inputs: ["src/"] }).state, "unknown");
  } finally { rmSync(nogit, { recursive: true, force: true }); }
  assert.equal(docStatus(root, { path: "never-committed.md", generator: "x", inputs: ["src/"] }).state, "unknown");
  assert.match(validateDoc({ path: "../outside.md", generator: "x", inputs: ["a"] }), /path must be/);
  assert.match(validateDoc({ path: "A.md", generator: "x", inputs: [] }), /inputs must list/);
});

test("a byte-identical regeneration: stale by the history, fresh once stamped — and stale again when an input changes after the stamp", () => {
  commit("commit the draft input");
  appendFileSync(join(root, "packages/rules/src/index.ts"), "// a comment the generated document does not show\n");
  commit("an input change that does not change the output");
  // the generator runs and writes exactly the same bytes: git has nothing to record
  assert.equal(docsStatus(root)[0].state, "stale", "by commits, it stays stale for ever");
  const r = runDocs(["stamp", "docs/RULES.md", "--root", root]);
  assert.equal(r.exitCode, 0, r.text);
  const [s] = docsStatus(root);
  assert.equal(s.state, "fresh");
  assert.match(s.detail, /by content/);
  appendFileSync(join(root, "packages/rules/src/index.ts"), "\nexport const MORE = 1;\n");
  const [t] = docsStatus(root);
  assert.equal(t.state, "stale");
  assert.match(t.detail, /inputs changed since it was stamped/);
});
