// Keeping the Brief current (2026-10-12, a field report of two lines STALE
// though nothing they said had changed). On a copy of
// test/fixtures/system/views_demo, through the real CLI, with saved replies:
//
//   - a `file:line` citation is ANCHORED to the function (or the line's text)
//     it points at: code moving above it, or the line leaving the facts pack,
//     is not a change; the function's code changing is
//   - a plan item's status (agreed ↔ proposed) does not stale a line; its
//     wording does
//   - "still true" (re-affirm) clears a stale line, zero tokens, a person's step
//   - a stale re-brief sends a SCOPED pack, smaller than the whole project's
//   - sync is a person's switch; due only with stale lines, nothing pending,
//     and the quiet period passed
//   - after an edit the hook names the Brief lines it touches
//
//   npm run test:brief-sync
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { syncDue } from "../src/server/brief_sync.ts";
import { anchorOf, anchorChange } from "../src/server/brief_anchor.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), "vg-bsync-"));
const proj = join(tmp, "p");
cpSync(join(ROOT, "test/fixtures/system/views_demo"), proj, { recursive: true });
for (const f of ["brief.json", "architecture.json"]) rmSync(join(proj, ".vibegraph", f), { force: true });
after(() => rmSync(tmp, { recursive: true, force: true }));
const cli = (args, env = {}) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), ...args],
  { cwd: ROOT, encoding: "utf-8", env: { ...process.env, CLAUDECODE: "", VG_PERSON_NO_TTY: "1", ...env } });
const saved = (o) => { const f = join(tmp, `r${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, "```json\n" + JSON.stringify(o) + "\n```"); return f; };
const brief = () => JSON.parse(readFileSync(join(proj, ".vibegraph/brief.json"), "utf-8"));
const show = () => cli(["brief", "codebase", "show", proj]).stdout;

// what the facts offer: a code file:line, a doc line, a plan process
const full = cli(["brief", "codebase", proj, "--skip-groups", "--dry-run"]).stdout;
const CODE = [...full.matchAll(/\b([\w./-]+\.(?:ts|py)):(\d+)\b/g)].map((m) => `${m[1]}:${m[2]}`).find((c) => !c.startsWith("test/")) ?? null;
const PLAN = /\b(plan:processes:[\w-]+)\b/.exec(full)?.[1] ?? null;

test("the facts offer a code line and a plan process to cite", () => {
  assert.ok(CODE && PLAN, `code ${CODE}, plan ${PLAN}`);
  const reply = { spec: { function: [
    { text: "Decides when an order is released, as the decider's code says.", words: ["decides"], cites: [CODE] },
    { text: "Decides releases as the plan places the process.", words: ["decides"], cites: [PLAN] },
  ], method: [], feature: [] }, omitted: [] };
  const r = cli(["brief", "codebase", proj, "--skip-groups", "--reply", saved(reply)]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(cli(["brief", "codebase", "ratify", "spec", proj]).status, 0);
  const a = brief().ratified.anchors;
  assert.ok(a?.[CODE], `anchors recorded: ${JSON.stringify(Object.keys(a ?? {}))}`);
  assert.equal(a[PLAN], undefined, "a plan citation is not a file:line");
  assert.doesNotMatch(show(), /STALE/);
});

test("code moving above a cited line is not a change; the cited function changing is", () => {
  const [file, line] = [CODE.slice(0, CODE.lastIndexOf(":")), Number(CODE.slice(CODE.lastIndexOf(":") + 1))];
  const abs = join(proj, file);
  const src = readFileSync(abs, "utf-8").split("\n");
  writeFileSync(abs, ["// a line added above", ...src].join("\n"));
  assert.doesNotMatch(show(), /STALE/, "the line moved; what it points at did not change");
  const anchor = brief().ratified.anchors[CODE];
  const now = readFileSync(abs, "utf-8").split("\n");
  if (anchor.id) now.splice(line + 1, 0, "  // a change inside the cited function");
  else now[line] = `${now[line]} // changed`;
  writeFileSync(abs, now.join("\n"));
  assert.match(show(), anchor.id ? /STALE[\s\S]*the code of/ : /STALE[\s\S]*no longer in the file/);
});

test("still true clears a stale line, and only a person may say so", () => {
  const agent = cli(["brief", "codebase", "reaffirm", proj], { CLAUDECODE: "1" });
  assert.notEqual(agent.status, 0);
  const r = cli(["brief", "codebase", "reaffirm", proj]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 line re-affirmed/);
  assert.doesNotMatch(show(), /STALE/);
});

test("a line outside any function (a doc, module level) follows its text: moved is fine, rewritten is stale", () => {
  const f = join(tmp, "NOTES.md");
  writeFileSync(f, "# Notes\nDecisions are kept for audit.\n");
  const read = (x) => { try { return readFileSync(join(tmp, x), "utf-8").split("\n"); } catch { return null; } };
  const a = anchorOf("NOTES.md:2", null, read);
  assert.deepEqual([a.id, a.text], [undefined, "Decisions are kept for audit."]);
  writeFileSync(f, "# Notes\nA new line above.\nDecisions are kept for audit.\n");
  assert.equal(anchorChange(a, null, read), null, "moved, unchanged");
  writeFileSync(f, "# Notes\nDecisions are thrown away.\n");
  assert.match(anchorChange(a, null, read), /no longer in the file/);
  rmSync(f);
  assert.equal(anchorChange(a, null, read), null, "a file that cannot be read is not known to have changed");
});

test("a plan item's status is not what a line says about it; its wording is", () => {
  const pf = join(proj, ".vibegraph/plan.json");
  const plan = JSON.parse(readFileSync(pf, "utf-8"));
  const id = PLAN.split(":")[2];
  const pr = plan.processes.find((x) => x.id === id);
  pr.status = pr.status === "agreed" ? "proposed" : "agreed";
  writeFileSync(pf, JSON.stringify(plan, null, 2));
  assert.doesNotMatch(show(), /STALE/, "agreed ↔ proposed changes nothing a line says");
  pr.label = `${pr.label} (renamed)`;
  writeFileSync(pf, JSON.stringify(plan, null, 2));
  assert.match(show(), new RegExp(`STALE[^\\n]*${PLAN}`));
});

test("a stale re-brief sends a scoped pack, smaller than the whole project's", () => {
  const scoped = cli(["brief", "codebase", proj, "--stale", "--dry-run"]).stdout;
  assert.match(scoped, /RE-BRIEF ONLY THESE LINES/);
  assert.ok(scoped.length < full.length, `scoped ${scoped.length} chars < full ${full.length}`);
  assert.equal(cli(["brief", "codebase", "reaffirm", proj]).status, 0);
});

test("sync is a person's switch, and due only when there is something to re-draft", () => {
  assert.notEqual(cli(["brief", "codebase", "sync", "on", proj], { CLAUDECODE: "1" }).status, 0, "an agent cannot switch spending on");
  const on = cli(["brief", "codebase", "sync", "on", proj]);
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /Brief sync ON/);
  const rec = brief();
  assert.equal(rec.sync.on, true);
  const t = Date.parse("2026-10-12T12:00:00Z");
  assert.equal(syncDue(rec, 1, t), true, "on, stale lines, nothing pending, never run");
  assert.equal(syncDue(rec, 0, t), false, "nothing stale");
  assert.equal(syncDue({ ...rec, proposed: { spec: {} } }, 1, t), false, "a proposal is already waiting");
  assert.equal(syncDue({ ...rec, sync: { ...rec.sync, lastRun: new Date(t - 60_000).toISOString() } }, 1, t), false, "inside the quiet period");
  assert.equal(syncDue({ ...rec, sync: { ...rec.sync, on: false } }, 1, t), false, "off");
  assert.match(cli(["brief", "codebase", "sync", "off", proj]).stdout, /Brief sync off/);
});

test("after an edit, the hook names the Brief lines it touches", () => {
  const file = CODE.slice(0, CODE.lastIndexOf(":"));
  const r = cli(["hook", "run", "post-edit", "--file", file, "--root", proj, "--session", "bsync"]);
  assert.match(r.stdout, /This edit touches the ratified Brief/);
  assert.match(r.stdout, /Decides when an order is released/);
});
