// The task skills (2026-09-29, scripts/cli/claude-skills/): /vibegraph-plan,
// -debug, -security, -review. A skill is a set of POINTERS — which knowledge
// file and which command to open for a task — so the test is that every
// pointer resolves: each file it names is one a real export writes, each
// command one the CLI answers, each contract line one a contract carries.
// A renamed file would otherwise leave a skill sending Claude to nothing.
//
//   npm run test:task-skills
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportKnowledge } from "../scripts/export_knowledge.mjs";
import { ALL_SKILLS, TASK_SKILLS, applySkills, skillSource, skillsFromList } from "../scripts/cli/init.mjs";

const FLEET = "examples/fleet-telemetry";
const loc = { mode: "dev", repoRoot: process.cwd() };
const body = (n) => readFileSync(skillSource(loc, n), "utf-8");
let out, tmp;
before(() => {
  out = mkdtempSync(join(tmpdir(), "vg-ts-exp-"));
  tmp = mkdtempSync(join(tmpdir(), "vg-ts-proj-"));
  exportKnowledge({ root: FLEET, out, task: "page on region changes in telemetry/alerts.py", commit: "t" });
});
after(() => { rmSync(out, { recursive: true, force: true }); rmSync(tmp, { recursive: true, force: true }); });

test("each task skill is a Claude Code skill, short enough to stay cheap", () => {
  for (const t of TASK_SKILLS) {
    const s = body(`vibegraph-${t}`);
    assert.match(s, new RegExp(`^---\\nname: vibegraph-${t}\\ndescription: .{80,600}\\n---\\n`), `${t}: frontmatter`);
    assert.ok(s.length < 3000, `${t}: ${s.length} chars — a pointer list, not a copy of the knowledge`);
  }
});

test("every knowledge file a skill names is one the export writes", () => {
  let seen = 0;
  for (const t of TASK_SKILLS) {
    for (const [, f] of body(`vibegraph-${t}`).matchAll(/`((?:threads\/)?[A-Za-z_]+\.md)`/g)) {
      assert.ok(existsSync(join(out, f)), `${t} points at ${f}, which the export does not write`);
      seen++;
    }
  }
  assert.ok(seen >= 12, `only ${seen} file pointers read — the pattern stopped matching`);
});

test("every command a skill names is one the CLI answers", () => {
  const main = readFileSync("scripts/cli/main.mjs", "utf-8");
  for (const t of TASK_SKILLS) {
    for (const [, cmd] of body(`vibegraph-${t}`).matchAll(/`vibegraph-knowledge ([a-z]+)/g)) {
      assert.ok(main.includes(`command === "${cmd}"`), `${t} names \`${cmd}\`, which the CLI does not answer`);
    }
  }
});

test("every contract line a skill quotes is one a contract carries", () => {
  const contracts = readdirSync(join(out, "threads")).map((f) => readFileSync(join(out, "threads", f), "utf-8")).join("\n");
  for (const t of TASK_SKILLS) {
    for (const [, line] of body(`vibegraph-${t}`).matchAll(/"((?:Leaves|Round|Where|Tested|Configured|Cross-thread)[^"]*)"/g)) {
      const head = line.replace(/\s+/g, " ");
      assert.ok(contracts.includes(head), `${t} quotes "${head}", which no contract carries`);
    }
  }
});

test("--skills chooses; the setup skill always comes along; unknown names are refused", () => {
  assert.deepEqual(skillsFromList("plan, security"), ["vibegraph", "vibegraph-plan", "vibegraph-security"]);
  assert.deepEqual(skillsFromList("vibegraph-debug"), ["vibegraph", "vibegraph-debug"]);
  assert.deepEqual(skillsFromList(undefined), ALL_SKILLS);
  assert.throws(() => skillsFromList("plan,deploy"), /unknown skill\(s\): deploy/);
  const r = applySkills({ names: skillsFromList("review"), root: tmp, loc });
  assert.deepEqual(r.map((x) => `${x.name} ${x.state}`), ["vibegraph installed", "vibegraph-review installed"]);
  assert.deepEqual(readdirSync(join(tmp, ".claude", "skills")).sort(), ["vibegraph", "vibegraph-review"]);
  applySkills({ names: ALL_SKILLS, root: tmp, loc, remove: true });
  assert.deepEqual(readdirSync(join(tmp, ".claude", "skills")), []);
});
