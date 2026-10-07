// Folders of old copies (2026-10-07, field report: 188 versioned copies in
// `_archive/` were parsed with the rest and listed as rule offenders).
//
//   npm run test:historical-copies
import { test } from "node:test";
import assert from "node:assert/strict";
import { historicalAdvice, historicalFolders, inHistorical } from "../src/server/historical_copies.ts";
import { formatCheckReport } from "../scripts/cli/check.mjs";

const live = ["tools/collect.py", "tools/archive.py", "tools/stamp.py", "tools/listing.py", "pkg/net/http.py", "README.md"];

test("versioned copies, mirrors and archive-named folders are found; live code is not", () => {
  const versioned = Array.from({ length: 12 }, (_, i) => `snapshots/tools/collect-V${i + 14}.py`);
  const mirrored = ["copies/tools/collect.py", "copies/tools/archive.py", "copies/tools/stamp.py", "copies/tools/listing.py", "copies/notes.py"];
  const found = historicalFolders([...live, ...versioned, ...mirrored, "_archive/x.py", "old/y.py"]);
  const dirs = Object.fromEntries(found.map((h) => [h.dir, h]));
  assert.ok(dirs.snapshots, JSON.stringify(found));
  assert.match(dirs.snapshots.why, /12 of 12 files are versioned copies/);
  assert.match(dirs.copies.why, /4 of 5 files mirror live files elsewhere/);
  assert.match(dirs._archive.why, /named "_archive"/);
  assert.ok(dirs.old);
  assert.ok(!found.some((h) => h.dir === "tools" || h.dir === "pkg" || h.dir.startsWith("snapshots/")), "the live tree, and no nested repeats");
  assert.equal(historicalFolders(live).length, 0);
  assert.match(historicalAdvice(found), /add to \.vibegraphignore: snapshots\/ copies\/ _archive\/ old\/|add to \.vibegraphignore: .*snapshots\//);
  assert.equal(inHistorical("snapshots/tools/collect-V20.py", found)?.dir, "snapshots");
  assert.equal(inHistorical("tools/collect.py", found), null);
});

test("check marks an offender in a folder of old copies, and says how to leave the folder out", () => {
  const historical = historicalFolders([...live, "_archive/tools/collect-V26.py"]);
  const text = formatCheckReport({
    constraints: 1, unchecked: [], parseErrors: {}, deltaNote: null, exitCode: 1, historical,
    summary: { checked: 1, violated: 1, unverifiable: 0, pass: 0 },
    results: [{ id: "c1", rule: "import-only", described: "x", verdict: "violated", reason: "r", notFollowed: [], offenders: ["tools/report.py", "_archive/tools/collect-V26.py"] }],
  });
  assert.match(text, /offender: tools\/report\.py\n/);
  assert.match(text, /offender: _archive\/tools\/collect-V26\.py \(historical copy — in a folder of old copies\)/);
  assert.match(text, /note: these folders look like old copies .*_archive\//);
});
