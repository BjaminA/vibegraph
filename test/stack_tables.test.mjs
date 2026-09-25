// M-TABLES — the standard-library tables are GENERATED, and this is what
// keeps them that way.
//
// The failure this exists to prevent is not "a name is missing". It is that
// `classifyTool` has no way to say "I do not know", so a missing name is
// reported as `origin: "third-party"` — a claim that the project depends on
// something it does not. The hand-written list held 87 of Python's 192
// stdlib roots, so 105 standard modules were reported as dependencies, into
// the system spec, the brief, the Stack panel and stack-policy routing.
//
// Two checks, and they answer different questions:
//   1. Has the committed file drifted from what THESE runtimes report?
//      (exact, and only meaningful on the runtimes that generated it)
//   2. Does the committed file COVER the local runtimes, whatever they are?
//      (weaker, always meaningful — a newer interpreter that added a module
//      is a real signal to regenerate)
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASH_KEYWORD_NAMES, BASH_SHELL_BUILTIN_NAMES, GENERATED_FROM,
  NODE_BUILTIN_NAMES, PYTHON_BUILTIN_NAMES, PYTHON_STDLIB_CURRENT,
  PYTHON_STDLIB_REMOVED,
} from "../src/shared/stack_stdlib.generated.ts";
import {
  BASH_BUILTINS, BASH_COREUTILS, BASH_KEYWORDS, BASH_SHELL_BUILTINS,
  NODE_BUILTINS, PYTHON_STDLIB, classifyTool,
} from "../src/shared/stack_taxonomy.ts";
import { PYTHON_BUILTINS } from "../src/shared/stack_attribution.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sh = (cmd) => execFileSync("bash", ["-c", cmd], { encoding: "utf8" }).trim().split("\n");

test("the committed tables have not drifted from what the runtimes report", () => {
  const localPython = execFileSync("python3", [
    "-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))",
  ], { encoding: "utf8" }).trim();
  if (localPython !== GENERATED_FROM.python || process.versions.node !== GENERATED_FROM.node) {
    // Not a failure: `sys.stdlib_module_names` describes ONE version, so an
    // exact match is only claimable on the runtimes that produced the file.
    // The coverage tests below still run, and they are the load-bearing ones.
    console.log(`  (skipped exact check: generated on python ${GENERATED_FROM.python} / node `
      + `${GENERATED_FROM.node}, running python ${localPython} / node ${process.versions.node})`);
    return;
  }
  execFileSync("node", [join(ROOT, "scripts", "gen_stack_tables.mjs"), "--check"], { encoding: "utf8" });
});

test("the committed tables COVER the local runtimes, whatever version they are", () => {
  const localStdlib = execFileSync("python3", [
    "-c", "import sys; print('\\n'.join(n for n in sys.stdlib_module_names if not n.startswith('_')))",
  ], { encoding: "utf8" }).trim().split("\n");
  const missing = localStdlib.filter((m) => !PYTHON_STDLIB.has(m));
  assert.deepEqual(missing, [],
    `these stdlib modules would be reported as third-party dependencies: ${missing.join(", ")}`
    + " — run: node scripts/gen_stack_tables.mjs");

  const localNode = builtinModules
    .filter((m) => !m.startsWith("_") && !m.includes("/"))
    .map((m) => (m.startsWith("node:") ? m.slice(5) : m));
  assert.deepEqual(localNode.filter((m) => !NODE_BUILTINS.has(m)), []);

  assert.deepEqual(sh("compgen -b").filter((b) => !BASH_SHELL_BUILTINS.has(b)), []);
  assert.deepEqual(sh("compgen -k").filter((k) => !BASH_KEYWORDS.has(k)), []);
});

test("the tables are non-trivially populated (a silent empty generation is drift too)", () => {
  assert.ok(PYTHON_STDLIB_CURRENT.length > 150, `python stdlib: ${PYTHON_STDLIB_CURRENT.length}`);
  assert.ok(PYTHON_BUILTIN_NAMES.length > 100, `python builtins: ${PYTHON_BUILTIN_NAMES.length}`);
  assert.ok(NODE_BUILTIN_NAMES.length > 30, `node builtins: ${NODE_BUILTIN_NAMES.length}`);
  assert.ok(BASH_SHELL_BUILTIN_NAMES.length > 40, `bash builtins: ${BASH_SHELL_BUILTIN_NAMES.length}`);
  assert.ok(BASH_KEYWORD_NAMES.length > 10, `bash keywords: ${BASH_KEYWORD_NAMES.length}`);
  assert.ok(PYTHON_STDLIB_REMOVED.length > 10, `removed modules: ${PYTHON_STDLIB_REMOVED.length}`);
});

test("the generated tables beat the hand-written ones they replaced", () => {
  // The exact sizes that made the old lists a liability, pinned so a
  // regression back to a curated subset is visible rather than quiet.
  assert.ok(PYTHON_STDLIB.size >= 190, `was 87 by hand, now ${PYTHON_STDLIB.size}`);
  assert.ok(PYTHON_BUILTINS.size >= 140, `was 60 by hand, now ${PYTHON_BUILTINS.size}`);
  assert.ok(BASH_SHELL_BUILTINS.size >= 55, `was 26 real builtins among 60, now ${BASH_SHELL_BUILTINS.size}`);
  // Every exception constructor, not the thirteen that happened to break a
  // fixture — the reason the generated set is qualitatively different.
  for (const exc of ["ValueError", "KeyError", "BrokenPipeError", "UnicodeDecodeError",
                     "RecursionError", "BaseExceptionGroup", "EncodingWarning"]) {
    assert.ok(PYTHON_BUILTINS.has(exc), `${exc} is a builtin`);
  }
});

test("bash: builtins, keywords and coreutils are DIFFERENT facts, kept apart", () => {
  // The hand-written list conflated them: 26 of its 60 entries were real
  // builtins, 34 were external binaries, and 35 real builtins were missing.
  const overlap = [...BASH_COREUTILS].filter((c) => BASH_SHELL_BUILTINS.has(c) || BASH_KEYWORDS.has(c));
  assert.deepEqual(overlap, [], `coreutils is a list of PROGRAMS; these are the shell: ${overlap.join(", ")}`);
  assert.ok(BASH_SHELL_BUILTINS.has("cd") && !BASH_COREUTILS.has("cd"), "cd is the shell");
  assert.ok(BASH_COREUTILS.has("sed") && !BASH_SHELL_BUILTINS.has("sed"), "sed is a program on PATH");
  assert.ok(BASH_KEYWORDS.has("[[") && !BASH_SHELL_BUILTINS.has("[["), "[[ is parsed, not run");
  assert.ok(BASH_SHELL_BUILTINS.has("["), "[ genuinely IS a builtin, unlike [[");
  // The union is what a stack reading skips, and it must not have shrunk.
  for (const w of ["cd", "echo", "sed", "grep", "[", "[[", "printf", "local"]) {
    assert.ok(BASH_BUILTINS.has(w), `${w} must still be skipped before the unknown fallback`);
  }
});

test("a generated table only matters because it makes the origin claim TRUE", () => {
  // The whole point, stated as the assertion it is.
  assert.equal(classifyTool("python", "tarfile").origin, "stdlib");
  assert.equal(classifyTool("python", "requests").origin, "third-party");
  assert.equal(classifyTool("bash", "wibblectl").origin, "unknown");
});
