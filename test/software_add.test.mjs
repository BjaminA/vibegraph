// SOFTWARE ADD, from the live setup run (2026-10-20, a public Next.js app):
//   - a reply whose JSON was sound was refused ("Unexpected token '*'"): the
//     parser took the first ``` fence, and the reply quoted the docs' own
//     (src/server/json_reply.ts);
//   - the refusal threw the reply away, so the same draft was paid for twice:
//     a refused reply is KEPT, with the command that re-runs it for nothing;
//   - a 3 KB README left 18 of 58 items with no quote, and nobody was told:
//     a thin draft says so where it is drafted and in the setup checklist.
// The stub Claude (fake_claude_json.mjs) answers; nothing real is spawned.
//
//   npm run test:software-add
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runSoftware } from "../scripts/cli/software.mjs";
import { loadSpec } from "../src/server/software_store.ts";
import { specCoverage } from "../src/server/software_draft.ts";
import { setupState } from "../src/server/setup_state.ts";

delete process.env.CLAUDECODE; // the tests act as a person
const FIXTURE = "test/fixtures/software/sw_demo";
const STUB = resolve("test/fixtures/run_effects/fake_claude_json.mjs");
const FENCE = "```";
const good = JSON.parse(readFileSync(join(FIXTURE, "docs/reply.json"), "utf-8").replace(/^[\s\S]*?```json\n/, "").replace(/```\s*$/, ""));
let tmp;
const copy = (name) => { const d = join(tmp, name); cpSync(FIXTURE, d, { recursive: true }); return d; };
const add = (root, reply, ...more) => {
  process.env.FAKE_SYNTH_RESPONSE = reply;
  return runSoftware(["add", "ledgerbox", "--from", join(root, "docs/ledgerbox.md"), ...more, "--root", root]);
};
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "vg-swadd-"));
  process.env.VG_CACHE_DIR = join(tmp, "cache");
  process.env.VG_CLAUDE_BIN = STUB;
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
  for (const k of ["VG_CACHE_DIR", "VG_CLAUDE_BIN", "FAKE_SYNTH_RESPONSE"]) delete process.env[k];
});

test("a reply that quotes the docs' own fences is read, not refused", async () => {
  const root = copy("fences");
  const reply = `The API table, as the docs give it:\n${FENCE}\n* | put_blob | get_blob\n${FENCE}\n${FENCE}json\n${JSON.stringify(good, null, 2)}\n${FENCE}`;
  const r = await add(root, reply);
  assert.equal(r.exitCode, 0, r.text);
  assert.equal(loadSpec(root, "ledgerbox").status, "draft");
});

test("a refused reply is kept, with the command that re-runs it for nothing", async () => {
  const root = copy("kept");
  const r = await add(root, "I could not draft it: the page is a marketing page.");
  assert.equal(r.exitCode, 1);
  const kept = /the reply is kept: (\S+)/.exec(r.text)?.[1];
  assert.ok(kept && existsSync(kept), r.text);
  assert.equal(readFileSync(kept, "utf-8"), "I could not draft it: the page is a marketing page.");
  assert.match(r.text, /re-run without spending: vibegraph-knowledge software add ledgerbox --from \S+ledgerbox\.md --reply \S+ledgerbox\.txt/);
  const again = await runSoftware(["add", "ledgerbox", "--from", join(root, "docs/ledgerbox.md"), "--reply", kept, "--root", root]);
  assert.equal(again.exitCode, 1);
  assert.doesNotMatch(again.text, /is kept/, "a reply given with --reply is the person's file already");
  assert.ok(!existsSync(join(root, ".vibegraph/software/ledgerbox.json")), "nothing saved");
});

test("a thin draft says so where it is drafted, and in the setup checklist", async () => {
  const root = copy("thin");
  const thin = structuredClone(good);
  for (const k of ["operations", "states", "permissions"]) for (const x of thin[k]) x.cite = null;
  const r = await add(root, JSON.stringify(thin));
  assert.equal(r.exitCode, 0, r.text);
  const spec = loadSpec(root, "ledgerbox");
  const cov = specCoverage(spec);
  assert.ok(cov.thin, JSON.stringify(cov));
  assert.match(r.text, new RegExp(`THIN SOURCE: ${cov.inferred} of ${cov.items} items in ledgerbox's spec have no quote in its documents`));
  const step = setupState(root, { stack: { tools: [] } }).steps.find((s) => s.id === "software");
  assert.ok(step.facts.some((f) => /ledgerbox's spec have no quote in its documents .* re-draft from a fuller page/.test(f)), step.facts.join("\n"));
  assert.ok(step.commands.some((c) => c.who === "claude" && c.spends && /^vibegraph-knowledge software add ledgerbox --from \S+ledgerbox\.md --from <the API reference page>$/.test(c.run)), step.commands.map((c) => c.run).join("\n"));
  // the fixture's own reply: one rule inferred of eleven items — not thin
  const fine = copy("fine");
  assert.equal((await add(fine, JSON.stringify(good))).exitCode, 0);
  assert.equal(specCoverage(loadSpec(fine, "ledgerbox")).thin, false);
});
