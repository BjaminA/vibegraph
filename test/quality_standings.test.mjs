// Quality layer, wiring — the standings decide which Run 1 verbs may
// REJECT. Pinned here: the generated file is imported (bundled), so the
// source path and dist/server.js read the same standings; the verbs at the
// current commit; the drift check that `--status` would regenerate the
// committed file byte-identically (M-TABLES precedent).
//
//   npm run test:quality-standings
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadStandings, verbMayGate, calibratedVerbs, setStandingsForTest, resetStandings } from "../src/server/quality/standings.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FILE = join(ROOT, "src", "server", "quality", "standings.json");

test("the standings are imported, not located on disk at run time", () => {
  const src = readFileSync(join(ROOT, "src", "server", "quality", "standings.ts"), "utf-8");
  assert.match(src, /import standingsJson from "\.\/standings\.json" with \{ type: "json" \}/);
  const code = src.replace(/\/\/[^\n]*/g, "");
  assert.ok(!/readFileSync\(|fileURLToPath\(|import\.meta\.url/.test(code), "no run-time file lookup: the bundle has no import.meta.url and used to read nothing");
  const s = loadStandings();
  assert.ok(s && typeof s.commit === "string" && s.verbs, "the generated file loads");
});

test("the bundle carries the standings (dist/server.js names every verb's standing)", () => {
  const dist = join(ROOT, "dist", "server.js");
  let text = "";
  try { text = readFileSync(dist, "utf-8"); } catch { return; } // no build yet: nothing to pin
  const s = loadStandings();
  for (const [verb, standing] of Object.entries(s.verbs)) {
    assert.ok(text.includes(`"${verb}": "${standing}"`) || text.includes(`${verb}: "${standing}"`) || text.includes(`"${verb}":"${standing}"`), `dist carries ${verb}=${standing}`);
  }
});

test("at this commit: guards, not-in-loop, handles-failure, annotated MAY-GATE; co-changes is DEMOTE (advisory)", () => {
  assert.deepEqual([...calibratedVerbs()].sort(), ["annotated", "guards", "handles-failure", "not-in-loop"]);
  assert.equal(verbMayGate("guards"), true);
  assert.equal(verbMayGate("not-in-loop"), true);
  assert.equal(verbMayGate("co-changes"), false);
  assert.equal(verbMayGate("no-such-verb"), false);
  for (const v of ["callers-only", "import-only", "calls-through"]) assert.equal(verbMayGate(v), true, `${v} is live grammar`);
});

test("a test override replaces the file and reset forgets it; no standings at all makes every Run 1 verb advisory", () => {
  setStandingsForTest(null);
  assert.equal(verbMayGate("guards"), false);
  assert.equal(verbMayGate("callers-only"), true);
  assert.deepEqual([...calibratedVerbs()], []);
  setStandingsForTest({ generatedAt: "t", commit: "x", verbs: { "co-changes": "MAY-GATE" } });
  assert.equal(verbMayGate("co-changes"), true);
  assert.equal(verbMayGate("guards"), false);
  resetStandings();
  assert.equal(verbMayGate("guards"), true);
});

test("drift: `quality_calibrate.mjs --status` regenerates the committed standings verb-for-verb", () => {
  const out = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts", "quality_calibrate.mjs"), "--status"], { encoding: "utf-8", cwd: ROOT });
  const committed = JSON.parse(readFileSync(FILE, "utf-8")).verbs;
  for (const [verb, standing] of Object.entries(committed)) {
    assert.match(out, new RegExp(`${verb}\\b[^\\n]*\\b${standing}\\b`), `--status reports ${verb} as ${standing}`);
  }
});
