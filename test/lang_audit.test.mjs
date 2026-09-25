// M-LANG6 (PLAN-M-LANG.md) — the language-seam grep audit. Pins the
// arc's structural invariant: language routing lives ONLY in the
// registry (src/shared/languages.ts + src/server/languages.ts).
// A stray hardcoded extension check or Monaco language re-introduces
// exactly the coupling M-LANG1 removed — this test makes that a red
// suite instead of a silent regression.
//
// Deliberately NARROW: python-only feature floors (run/synthesis/
// greenfield/changeset) legitimately say "python" all over — auditing
// them would be a giant brittle allowlist claiming coverage it doesn't
// have. The assertions below are the load-bearing seams only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function* walk(dir, exts) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full, exts);
    else if (exts.some((e) => entry.endsWith(e))) yield full;
  }
}

function offenders(dir, exts, needle, allowlist = []) {
  const hits = [];
  for (const f of walk(join(ROOT, dir), exts)) {
    const rel = relative(ROOT, f).replace(/\\/g, "/");
    if (allowlist.includes(rel)) continue;
    const src = readFileSync(f, "utf-8");
    if (src.includes(needle)) hits.push(rel);
  }
  return hits;
}

test("webview: no hardcoded Monaco language=\"python\" (M-LANG1's five sites stay fixed)", () => {
  assert.deepEqual(
    offenders("src/webview", [".ts", ".tsx"], 'language="python"'),
    [],
    "derive Monaco language via monacoLanguageForPath (src/shared/languages.ts)",
  );
});

test("webview: no hardcoded .py extension routing", () => {
  assert.deepEqual(
    offenders("src/webview", [".ts", ".tsx"], 'endsWith(".py")'),
    [],
  );
});

test("server.ts: file discovery/watching/dispatch carries no .py extension checks", () => {
  const src = readFileSync(join(ROOT, "server.ts"), "utf-8");
  assert.ok(!src.includes('endsWith(".py")'),
    "extension routing belongs to the registry (isSourceFile/languageForPath)");
  assert.ok(!src.includes("function findPyFiles"),
    "findSourceFiles (registry-driven) replaced findPyFiles in M-LANG1");
});

test("src/server: .py extension checks only where the floor is genuinely python-only", () => {
  const hits = offenders("src/server", [".ts"], 'endsWith(".py")', [
    // The registry itself — the ONE home of the python module-identity rule.
    "src/server/languages.ts",
    // The greenfield changeset floor is python-only BY DESIGN (create_file
    // exists only in cst_rewrite.py); its .py gate is the honest message.
    "src/server/changeset.ts",
  ]);
  assert.deepEqual(hits, [], "either route via the registry or add an explicit design-note allowlist entry here");
});

test("language-reachable prompts carry no hardcoded python fence", () => {
  for (const f of ["src/server/explain.ts", "src/server/chat/prompt.ts"]) {
    const src = readFileSync(join(ROOT, f), "utf-8");
    assert.ok(!src.includes("```python"),
      `${f}: fence must derive from the node's file (fenceTag)`);
  }
});
