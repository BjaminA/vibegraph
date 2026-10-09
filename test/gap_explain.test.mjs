// "Explain this gap" (2026-10-08): the one token-spending step of the run-time
// ladder, a person's command, estimate first. On a copy of
// test/fixtures/system/views_demo (its plan says the decider reads the requests
// zone; the code does not show it statically) with a SAVED reply — no model
// is called.
//
//   npm run test:gap-explain
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), "vg-gap-"));
const proj = join(tmp, "p");
cpSync(join(ROOT, "test/fixtures/system/views_demo"), proj, { recursive: true });
after(() => rmSync(tmp, { recursive: true, force: true }));
const cli = (args) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), ...args], { cwd: ROOT, encoding: "utf-8", env: { ...process.env, CLAUDECODE: "" } });
const reply = (o) => { const f = join(tmp, `r${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify(o)); return f; };
const CLAIM = { subject: "cluster:scripts:decider", verb: "reads", object: "zone:ledger/requests" };

test("the gaps are listed and an explanation is estimated before anything is spent", () => {
  const g = cli(["claim", "gaps", proj]);
  assert.match(g.stdout, /^1\. Scripts · decider reads ledger\/requests \(plan:flows:order-request\)/m);
  const e = cli(["claim", "explain", "1", "--estimate", proj]);
  assert.match(e.stdout, /explaining gap 1 \(Scripts · decider reads ledger\/requests[^)]*\)\): 1 call, ~\d+k input tokens, \d+ lines of code shown/);
  const p = cli(["claim", "explain", "1", "--dry-run", proj]);
  assert.match(p.stdout, /decider\/src\/transitions\.ts:8: const request = await readDoc\("request_clerk", id\);/, "the call site is shown, numbered");
});

test("a chain citing a line it was not shown, or a reply that finds nothing, stores nothing", () => {
  const bad = cli(["claim", "explain", "1", "--reply", reply({ claim: CLAIM, chain: [{ cite: "gateway/src/server.ts:11", says: "?" }] }), proj]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /the chain cites lines it was not shown: gateway\/src\/server\.ts:11/);
  const none = cli(["claim", "explain", "1", "--reply", reply({ none: "the shown code reads approver and status only" }), proj]);
  assert.match(none.stderr, /the model found no support in the code shown/);
  assert.match(cli(["claim", "list", proj]).stdout, /no claims yet/);
});

test("a cited chain becomes a PROPOSED inferred claim for a person to decide", () => {
  const ok = cli(["claim", "explain", "1", "--reply", reply({ claim: CLAIM, chain: [{ cite: "decider/src/transitions.ts:8", says: "reads the clerk's request" }] }), proj]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /claim k1 PROPOSED · inferred \(from saved reply\)[\s\S]*chain: decider\/src\/transitions\.ts:8/);
  const k = JSON.parse(readFileSync(join(proj, ".vibegraph/claims.json"), "utf-8")).claims[0];
  assert.deepEqual([k.by, k.status], ["agent", "proposed"]);
  assert.match(k.why, /^explained by a model: decider\/src\/transitions\.ts:8 reads the clerk's request/);
});
