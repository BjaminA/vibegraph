// The viewer on Windows, and from a Windows-side caller (2026-10-02 — both
// reported against 0.17/0.18, both worked around by hand):
//   1. a MISSING FILE: discover_project.mjs imports package_entries.mjs, which
//      the build never vendored, so `view` logged "project-level entry-point
//      discovery failed" on every start. The build now follows every vendored
//      script's relative imports and refuses to finish on a dangling one.
//   2. WINDOWS PATHS: under a native Windows Node the server keyed files
//      `packages\rules\src\index.ts`, so every manual seed (and rule, plan
//      folder, Python module identity) keyed by "/" missed; and a Linux-side
//      CLI handed `\\wsl.localhost\…` read it as a relative path.
//
//   npm run test:windows-paths
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as path from "node:path";
import { posixRel } from "../src/server/posix_rel.ts";
import { cliPath } from "../scripts/cli/winpath.mjs";
import { vendorImportClosure, NODE_SCRIPTS, APP_NODE_SCRIPTS } from "../scripts/cli/build.mjs";

const tmp = mkdtempSync(join(tmpdir(), "vg-winpaths-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("a project-relative key is spelled with / even under Windows' path rules", () => {
  assert.equal(path.win32.relative("C:\\p\\proj", "C:\\p\\proj\\packages\\rules\\src\\index.ts"), "packages\\rules\\src\\index.ts", "the bug: win32 answers with backslashes");
  assert.equal(posixRel("C:\\p\\proj", "C:\\p\\proj\\packages\\rules\\src\\index.ts", path.win32), "packages/rules/src/index.ts");
  assert.equal(posixRel("/p/proj", "/p/proj/a/b.ts"), "a/b.ts");
  // server.ts relativizes through it — never path.relative alone.
  const server = readFileSync("server.ts", "utf-8");
  assert.match(server, /return posixRel\(inputPath, absolute\)/);
  assert.doesNotMatch(server, /relIR\[path\.relative\(/);
});

test("a Windows-form project path is translated by a Linux-side CLI, and left alone on Windows", () => {
  for (const p of ["\\\\wsl.localhost\\Ubuntu\\home\\me\\proj", "//wsl.localhost/Ubuntu/home/me/proj", "\\\\wsl$\\Ubuntu\\home\\me\\proj"]) {
    assert.equal(cliPath(p, "linux"), "/home/me/proj", p);
    assert.equal(cliPath(p, "win32"), p, `${p} is a valid Windows path already`);
  }
  assert.equal(cliPath("C:\\Users\\me\\proj", "linux"), "/mnt/c/Users/me/proj");
  assert.equal(cliPath("relative/proj", "linux"), "relative/proj");
  // Every command that turns an argument into a project root goes through it.
  for (const f of ["view", "plan", "docs", "software", "brief", "coverage", "affected", "architecture", "classify", "lessons", "direction", "plan_draft"]) {
    assert.match(readFileSync(`scripts/cli/${f}.mjs`, "utf-8"), /resolve\(cliPath\(/, `${f}.mjs`);
  }
  assert.match(readFileSync("scripts/cli/main.mjs", "utf-8"), /resolve\(cliPath\(positional/);
});

test("the build vendors a script's missing sibling, ignores imports in comments, and refuses a dangling one", () => {
  const src = join(tmp, "src"), ven = join(tmp, "vendor");
  mkdirSync(join(src, "frontends"), { recursive: true });
  mkdirSync(ven, { recursive: true });
  writeFileSync(join(src, "helper.mjs"), 'import { x } from "./frontends/deep.mjs";\nexport const h = x;\n');
  writeFileSync(join(src, "frontends", "deep.mjs"), "export const x = 1;\n");
  writeFileSync(join(ven, "main.mjs"), '// a comment: `await import("./nope")`\nimport { h } from "./helper.mjs";\nconsole.log(h);\n');
  vendorImportClosure(ven, src);
  assert.ok(existsSync(join(ven, "helper.mjs")), "the forgotten sibling is copied");
  assert.ok(existsSync(join(ven, "frontends", "deep.mjs")), "and what it imports in turn");
  writeFileSync(join(ven, "broken.mjs"), 'import { y } from "./gone.mjs";\n');
  assert.throws(() => vendorImportClosure(ven, src), /broken\.mjs imports \.\/gone\.mjs/);
});

test("THE REGRESSION: every Node script the package spawns has its imports in the repo", () => {
  // The closure the build would vendor, checked from the real scripts/.
  const ven = join(tmp, "real");
  mkdirSync(ven, { recursive: true });
  for (const s of [...NODE_SCRIPTS, ...APP_NODE_SCRIPTS]) writeFileSync(join(ven, s), readFileSync(join("scripts", s)));
  vendorImportClosure(ven, "scripts");
  assert.ok(existsSync(join(ven, "package_entries.mjs")), "discover_project.mjs's import is vendored");
});
