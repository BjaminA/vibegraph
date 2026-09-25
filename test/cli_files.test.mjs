// The files that shape what `export` writes, each from a node command
// (2026-09-25): `constraints`, `seeds`, `skills` — driven through the real
// CLI on a copy of the fleet example, and ended by what matters: the next
// export carries what the commands wrote.
//
//   npm run test:cli-files
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let tmp, proj;
const cli = (...args) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), ...args], { encoding: "utf-8", cwd: ROOT });

before(() => {
  tmp = mkdtempSync(join(tmpdir(), "vg-cli-files-"));
  proj = join(tmp, "fleet");
  cpSync(join(ROOT, "examples/fleet-telemetry"), proj, { recursive: true, filter: (p) => !p.includes(`${join(".vibegraph", "knowledge")}`) });
});
after(() => rmSync(tmp, { recursive: true, force: true }));

test("constraints: add (human), a restatement refused, a bad scope refused, ratify an agent rule, remove", () => {
  const text = "Device ids are never logged in plain text: the fleet operator treats them as personal data.";
  let r = cli("constraints", "add", proj, "--kind", "invariant", "--text", text, "--files", "telemetry/ingest.py");
  assert.equal(r.status, 0, r.stderr);
  const id = /stated (c\d+) \(human\)/.exec(r.stdout)?.[1];
  assert.ok(id, r.stdout);
  r = cli("constraints", "add", proj, "--kind", "invariant", "--text", text, "--all");
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(`restates ${id}`));
  r = cli("constraints", "add", proj, "--kind", "invariant", "--text", "no scope given");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /scope must name/);
  r = cli("constraints", "add", proj, "--kind", "invariant", "--text", "checked", "--all", "--check", '{"rule":"nonsense"}');
  assert.equal(r.status, 2, "a malformed check is refused, never stored");

  // An agent-stated rule (what classify --apply writes) becomes human-stated.
  const file = join(proj, ".vibegraph", "constraints.json");
  const stored = JSON.parse(readFileSync(file, "utf-8"));
  stored.constraints.push({ id: "c99", kind: "stack-policy", text: "zip is classified as utility", scope: { stack: ["zip"] }, source: "agent", createdAt: "", policy: { tool: "zip", rule: "describe", role: "utility" } });
  writeFileSync(file, JSON.stringify(stored, null, 2));
  r = cli("constraints", "list", proj);
  assert.match(r.stdout, /c99 {2}\[agent · NOT human-reviewed\]/);
  r = cli("constraints", "ratify", "c99", proj);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /c99 is now human-stated \(was agent-stated\)/);
  r = cli("constraints", "list", proj, "--json");
  assert.equal(JSON.parse(r.stdout).find((c) => c.id === "c99").source, "human");
  r = cli("constraints", "remove", "c99", proj);
  assert.equal(r.status, 0);
  assert.ok(!JSON.parse(readFileSync(file, "utf-8")).constraints.some((c) => c.id === "c99"));
});

test("seeds: a function resolved before it is written; a missing name or file refused; remove", () => {
  let r = cli("seeds", "add", "telemetry/storage.py:_get_conn", proj, "--note", "the connection lifecycle");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /named telemetry\/storage.py:_get_conn/);
  r = cli("seeds", "add", "telemetry/storage.py:no_such_fn", proj);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no function or class named no_such_fn/);
  r = cli("seeds", "add", "telemetry/nope.py", proj);
  assert.equal(r.status, 1);
  r = cli("seeds", "list", proj);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /telemetry\/storage.py:_get_conn {2}→ a thread/);
  r = cli("seeds", "remove", "telemetry/storage.py:_get_conn", proj);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(proj, ".vibegraph", "manual_seeds.json"), "utf-8")).seeds, []);
});

test("skills: draft through the gates (a saved reply), ratify, and the next export copies it; an ungrounded draft is not written", () => {
  const ep = "telemetry/storage.py:list_devices";
  let r = cli("skills", "list", proj);
  assert.match(r.stdout, new RegExp(`none\\s+${ep.replace(/[.:/]/g, "\\$&")}`));
  // The prompt, without a spawn.
  r = cli("skills", "draft", ep, proj, "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Write a THREAD SKILL/);
  const node = /`(module\/list_devices\.fn)`/.exec(r.stdout)?.[1];
  assert.ok(node, "the prompt names the thread's steps by IR node id");

  // An invented id: refused by the grounding gate, nothing written.
  const bad = join(tmp, "bad.md");
  writeFileSync(bad, "## Purpose\nx\n## Architecture\ny\n## Steps\n- `module/invented.fn`\n## Gotchas\nz\n");
  r = cli("skills", "draft", ep, proj, "--reply", bad);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /NOT written — generation not grounded/);
  assert.ok(!existsSync(join(proj, ".vibegraph", "thread-skills")) || !cli("skills", "list", proj).stdout.includes("draft"));

  const good = join(tmp, "good.md");
  writeFileSync(good, `## Purpose\nLists every device.\n## Architecture\nOne sqlite read through the storage funnel.\n## Steps\n- \`${node}\` reads the devices table.\n## Gotchas\nKeep the query in the funnel.\n`);
  r = cli("skills", "draft", ep, proj, "--reply", good);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /drafted by saved reply — a DRAFT/);
  assert.match(cli("skills", "list", proj).stdout, new RegExp(`draft \\(not injected until ratified\\)\\s+${ep.replace(/[.:/]/g, "\\$&")}`));

  // A draft is withheld from the export; ratified, it travels.
  const out = join(tmp, "k1");
  spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/export_knowledge.mjs"), proj, "--out", out, "--commit", "t"], { encoding: "utf-8" });
  assert.ok(!existsSync(join(out, "skills")), "a draft is not exported");
  r = cli("skills", "ratify", ep, proj);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ratified by whoever ran this — ratified · fresh/);
  const out2 = join(tmp, "k2");
  spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/export_knowledge.mjs"), proj, "--out", out2, "--commit", "t"], { encoding: "utf-8" });
  const exported = readFileSync(join(out2, "skills", "telemetry_storage.py_list_devices.md"), "utf-8");
  assert.match(exported, /ratified by a human · generated .* · fresh/, "the CLI's fresh is the export's fresh (one stamp)");
  assert.match(exported, /Lists every device/);

  r = cli("skills", "reaffirm", ep, proj);
  assert.equal(r.status, 1, "a fresh skill has nothing to re-affirm");
  r = cli("skills", "auto-reaffirm", ep, "on", proj);
  assert.equal(r.status, 0);
});
