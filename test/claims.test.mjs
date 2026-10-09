// Rung 3 of the run-time ladder, in session (2026-10-08): a claim about what
// the code does at run time, cited, checked like a Brief claim, decided by a
// person. On a copy of test/fixtures/system/views_demo, whose plan says the
// decider reads the requests zone — the code shows no such call: a facts gap.
//
//   npm run test:claims
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evidenceKinds } from "../scripts/cli/brief_context.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), "vg-claims-"));
const proj = join(tmp, "p");
cpSync(join(ROOT, "test/fixtures/system/views_demo"), proj, { recursive: true });
after(() => rmSync(tmp, { recursive: true, force: true }));
const cli = (args, env = {}) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), ...args],
  { cwd: ROOT, encoding: "utf-8", env: { ...process.env, CLAUDECODE: "", ...env } });
const DECIDER = "cluster:scripts:decider";

test("the prompt hook names an open facts gap when the prompt touches its box, once a session", () => {
  const p = cli(["hook", "run", "prompt", "--prompt", "make decider/src/transitions.ts hold an order when no approver is set", "--root", proj, "--session", "g1"]);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /open facts gap: [^\n]*decider reads ledger\/requests \(plan:flows:order-request; the code shows no such call\)[^\n]*claim propose --subject cluster:scripts:decider --verb reads --object ledger\/requests/);
  const again = cli(["hook", "run", "prompt", "--prompt", "and in decider/src/transitions.ts log it", "--root", proj, "--session", "g1"]);
  assert.doesNotMatch(again.stdout, /open facts gap/, "once a session");
});

test("a bad claim is refused with the reason — a line that does not exist, off the subject's paths, contradicted by the map", () => {
  const no = (args, re) => { const r = cli(["claim", "propose", ...args, proj], { CLAUDECODE: "1" }); assert.equal(r.status, 1, r.stdout); assert.match(r.stderr, re); };
  no(["--subject", DECIDER, "--verb", "reads", "--object", "requests", "--cite", "decider/src/transitions.ts:400"], /transitions\.ts:400 does not exist \(decider\/src\/transitions\.ts has \d+ lines\)/);
  no(["--subject", DECIDER, "--verb", "reads", "--object", "requests", "--cite", "gateway/src/server.ts:11"], /is not on a path the code shows from cluster:scripts:decider/);
  no(["--subject", "cluster:cli-package-script:app", "--verb", "writes", "--object", "*", "--not", "--cite", "app/src/server.ts:7"], /the map contradicts it: the code shows [^\n]*app write ledger\//);
  no(["--subject", "nowhere", "--verb", "flies", "--object", "requests", "--cite", "x.ts:1"], /the verb "flies" is not one of[\s\S]*nowhere is not a box/);
});

test("a cited claim is PROPOSED by an agent; only a person agrees; agreed, it closes the gap and draws an inferred edge", () => {
  const r = cli(["claim", "propose", "--subject", DECIDER, "--verb", "reads", "--object", "requests", "--cite", "decider/src/transitions.ts:8", "--why", "applyTransition reads the clerk's request first", proj], { CLAUDECODE: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /claim k1 PROPOSED · inferred: k1: .*decider reads requests — 1 cited line\(s\) hashed/);
  const k = JSON.parse(readFileSync(join(proj, ".vibegraph/claims.json"), "utf-8")).claims[0];
  assert.deepEqual([k.by, k.status], ["agent", "proposed"]);
  assert.match(cli(["claim", "propose", "--subject", DECIDER, "--verb", "reads", "--object", "requests", "--cite", "decider/src/transitions.ts:8", proj]).stderr, /already claimed as k1/);
  assert.match(cli(["inbox", "--root", proj]).stdout, /claim:k1[\s\S]*a claim \(agent\)/);
  const refused = cli(["claim", "agree", "k1", proj], { CLAUDECODE: "1" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /refused: `claim agree`/);
  const agreed = cli(["claim", "agree", "k1", proj]);
  assert.equal(agreed.status, 0, agreed.stderr);
  assert.match(cli(["claim", "list", proj]).stdout, /k1: cluster:scripts:decider reads requests {2}\[ratified · inferred\]/);
  const md = (() => { cli(["export", proj]); return readFileSync(join(proj, ".vibegraph/knowledge/architecture.md"), "utf-8"); })();
  assert.match(md, /inferred · ratified — claim k1/, "the map carries it, said as inferred");
  const p = cli(["hook", "run", "prompt", "--prompt", "make decider/src/transitions.ts hold an order", "--root", proj, "--session", "g2"]);
  assert.doesNotMatch(p.stdout, /open facts gap: [^\n]*decider reads ledger\/requests/, "a ratified claim closes the gap");
});

test("a claim goes STALE when a line it cites changes, and stops counting", () => {
  const f = join(proj, "decider/src/transitions.ts");
  writeFileSync(f, readFileSync(f, "utf-8").replace('readDoc("request_clerk", id)', 'readDoc("request_clerk", id.trim())'));
  assert.match(cli(["claim", "list", proj]).stdout, /\[ratified · inferred · STALE\][\s\S]*STALE: decider\/src\/transitions\.ts:8 changed \(was: "const request = await readDoc\("request_clerk", id\);"\)/);
  assert.match(cli(["inbox", "--root", proj, "--sensors"]).stdout, /ratified claim k1: .* is STALE/);
  const p = cli(["hook", "run", "prompt", "--prompt", "make decider/src/transitions.ts hold an order", "--root", proj, "--session", "g3"]);
  assert.match(p.stdout, /open facts gap: [^\n]*decider reads ledger\/requests/, "the gap is open again");
});

test("a Brief line's evidence kinds come from its citations' ids", () => {
  assert.deepEqual(evidenceKinds(["rule:c1", "cluster:a->zone:b:uses:write", "docs/HANDOVER.md:3", "claim:k1", "note:1"]), ["declared", "derived", "doc", "inferred", "note"]);
});
