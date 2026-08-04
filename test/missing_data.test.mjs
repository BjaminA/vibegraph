// M-RUN2.3 — the missing-data detector contract.
//
// detectMissingDataFiles: literal-path heuristic over the offending SOURCE
//   LINE — present file → no offer; missing → offered once; non-literal /
//   non-data / project-escaping paths → never a false offer.
// missingPathFromStderr: post-run FileNotFoundError paths, project-bounded.
//
// Run: npm run test:missing-data

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectMissingDataFiles, missingPathFromStderr, safeRelPath } from "../src/server/run/missing_data.ts";

const offense = (line, file = "reader.py") => [{ kind: "effect", effectKind: "fs", target: "open", file, line }];

function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "vg-missing-data-"));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("a missing literal data path on the offending line is offered (once)", () => {
  withRoot((root) => {
    const lines = { 3: 'with open("data/signals.csv") as f:' };
    const out = detectMissingDataFiles(
      [...offense(3), ...offense(3)], root, (_f, l) => lines[l] ?? null,
    );
    assert.deepEqual(out, [{ path: "data/signals.csv", file: "reader.py", line: 3 }]);
  });
});

test("a present file is never offered", () => {
  withRoot((root) => {
    mkdirSync(join(root, "data"));
    writeFileSync(join(root, "data", "signals.csv"), "x\n");
    const out = detectMissingDataFiles(offense(3), root, () => 'open("data/signals.csv")');
    assert.deepEqual(out, []);
  });
});

test("non-literal paths, non-data extensions, and escapes are never offered", () => {
  withRoot((root) => {
    assert.deepEqual(detectMissingDataFiles(offense(1), root, () => "open(path)"), []);
    assert.deepEqual(detectMissingDataFiles(offense(1), root, () => 'open("script.py")'), []);
    assert.deepEqual(detectMissingDataFiles(offense(1), root, () => 'open("../../etc/passwd.txt")'), []);
    // non-fs offenses are ignored entirely
    assert.deepEqual(
      detectMissingDataFiles([{ kind: "dynamic", target: "model", file: "m.py", line: 1 }], root, () => 'open("a.csv")'),
      [],
    );
  });
});

test("stderr FileNotFoundError yields the missing project path; present/escaping paths do not", () => {
  withRoot((root) => {
    const err = "Traceback...\nFileNotFoundError: [Errno 2] No such file or directory: 'data/signals.csv'";
    assert.equal(missingPathFromStderr(err, root), "data/signals.csv");
    mkdirSync(join(root, "data"));
    writeFileSync(join(root, "data", "signals.csv"), "x\n");
    assert.equal(missingPathFromStderr(err, root), null); // exists now
    assert.equal(missingPathFromStderr("FileNotFoundError: '/etc/shadow'", root), null);
    assert.equal(missingPathFromStderr("ValueError: nope", root), null);
  });
});

test("safeRelPath bounds every path to the project", () => {
  withRoot((root) => {
    assert.equal(safeRelPath(root, "data/x.csv"), "data/x.csv");
    assert.equal(safeRelPath(root, "../outside.csv"), null);
    assert.equal(safeRelPath(root, "/abs/elsewhere.csv"), null);
  });
});
