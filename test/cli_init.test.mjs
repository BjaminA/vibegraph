// M-CRYSTAL.4 — `init`, the pointer. Pins: the block carries the sentences
// h2h3 arm D's CLAUDE.md carried (reviews/h2h3/run.sh); it is appended
// once to an existing CLAUDE.md and REPLACED, not duplicated, on a re-run
// and when an older block is present; text outside the markers is
// untouched; the .gitignore line is added once and recognised in the
// spellings people use; --print writes nothing; and the CLI says what it
// did to each file.
//
//   npm run test:cli-init
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyInit, BEGIN, END, IGNORE_LINE, POINTER } from "../scripts/cli/init.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), "vgk-init-"));
const count = (text, needle) => text.split(needle).length - 1;

// The drill's own script is internal (reviews/ is not published): in a public
// checkout this comparison has nothing to compare against, and says so.
const ARM_D = join(ROOT, "reviews", "h2h3", "run.sh");
test("the pointer says what arm D's CLAUDE.md said, and adds the refresh and the check", { skip: existsSync(ARM_D) ? false : "reviews/h2h3/run.sh (the drill's script) is not in this checkout" }, () => {
  // Both texts are hard-wrapped at different columns: compare sentences, not lines.
  const flat = (s) => s.replace(/\s+/g, " ");
  const armD = flat(readFileSync(join(ROOT, "reviews", "h2h3", "run.sh"), "utf-8"));
  const pointer = flat(POINTER);
  for (const sentence of [
    "Read that index before changing anything",
    "Treat the stated rules as requirements from the people who run this service",
    "Do not edit anything under `.vibegraph/`",
  ]) {
    assert.ok(pointer.includes(sentence), `pointer carries: ${sentence}`);
    assert.ok(armD.includes(sentence), `arm D carried it too: ${sentence}`);
  }
  assert.ok(POINTER.includes("npx vibegraph-knowledge export") && POINTER.includes("npx vibegraph-knowledge check"));
  assert.ok(POINTER.startsWith(BEGIN) && POINTER.endsWith(END));
});

test("appended once to an existing CLAUDE.md, unchanged on a re-run, text outside the markers untouched", () => {
  const dir = join(tmp, "a"); mkdirSync(dir);
  writeFileSync(join(dir, "CLAUDE.md"), "# My project\n\nnotes the team wrote\n");
  const first = applyInit({ root: dir });
  assert.deepEqual([first.claudeMd, first.gitignore], ["updated", "created"]);
  const text = readFileSync(join(dir, "CLAUDE.md"), "utf-8");
  assert.ok(text.startsWith("# My project\n\nnotes the team wrote\n"));
  assert.equal(count(text, BEGIN), 1);
  assert.equal(count(text, END), 1);
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf-8").trim().split("\n").pop(), IGNORE_LINE);
  const second = applyInit({ root: dir });
  assert.deepEqual([second.claudeMd, second.gitignore], ["unchanged", "unchanged"]);
  assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf-8"), text, "byte-identical on the re-run");
  assert.equal(count(readFileSync(join(dir, ".gitignore"), "utf-8"), IGNORE_LINE), 1);
});

test("an older block between the markers is replaced in place, never duplicated", () => {
  const dir = join(tmp, "b"); mkdirSync(dir);
  writeFileSync(join(dir, "CLAUDE.md"), `# Top\n\n${BEGIN}\nold pointer text\n${END}\n\n## Below\nkept\n`);
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n**/.vibegraph/knowledge/\n");
  const r = applyInit({ root: dir });
  assert.deepEqual([r.claudeMd, r.gitignore], ["updated", "unchanged"]);
  const text = readFileSync(join(dir, "CLAUDE.md"), "utf-8");
  assert.equal(count(text, BEGIN), 1);
  assert.ok(!text.includes("old pointer text"));
  assert.ok(text.startsWith("# Top\n\n") && text.endsWith("\n\n## Below\nkept\n"));
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf-8"), "node_modules/\n**/.vibegraph/knowledge/\n", "the `**/` spelling already covers it");
});

test("no CLAUDE.md: created with the block alone; --print writes nothing", () => {
  const dir = join(tmp, "c"); mkdirSync(dir);
  const p = applyInit({ root: dir, print: true });
  assert.equal(p.claudeMd, "printed");
  assert.deepEqual(readdirSync(dir), [], "--print touches nothing");
  const r = applyInit({ root: dir });
  assert.deepEqual([r.claudeMd, r.gitignore], ["created", "created"]);
  assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf-8"), POINTER + "\n");
});

test("the CLI reports what it did to each file, and --print prints the block", () => {
  const dir = join(tmp, "d"); mkdirSync(dir);
  const cli = (...args) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts", "cli", "main.mjs"), "init", dir, ...args], { encoding: "utf-8" });
  const printed = cli("--print");
  assert.equal(printed.status, 0);
  assert.equal(printed.stdout, POINTER + "\n");
  assert.ok(!existsSync(join(dir, "CLAUDE.md")));
  const wrote = cli();
  assert.equal(wrote.status, 0, wrote.stderr);
  assert.match(wrote.stdout, /CLAUDE\.md: created/);
  assert.match(wrote.stdout, /\.gitignore: created/);
  assert.match(wrote.stdout, /next: vibegraph-knowledge export/);
  const again = cli();
  assert.match(again.stdout, /CLAUDE\.md: unchanged/);
  assert.ok(!again.stdout.includes("next:"), "nothing to do next when nothing changed");
});

after(() => rmSync(tmp, { recursive: true, force: true }));
