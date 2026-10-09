// Rung 2 of the run-time ladder (2026-10-08): the project DECLARES what a
// process reaches at run time where the code cannot show it. On a copy of
// test/fixtures/system/views_demo, whose plan says the decider reads the
// requests zone (a facts gap): a topology feed declares it, the zone and the
// map show it as declared, the gap closes — and renaming the function the feed
// names makes the declaration STALE.
//
//   npm run test:feeds
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { briefInputs } from "../src/server/brief_inputs.ts";
import { briefCoverage } from "../src/server/brief_checks.ts";
import { validateTopology } from "../src/server/topology_store.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), "vg-feeds-"));
const proj = join(tmp, "p");
cpSync(join(ROOT, "test/fixtures/system/views_demo"), proj, { recursive: true });
after(() => rmSync(tmp, { recursive: true, force: true }));
const topo = join(proj, ".vibegraph/topology/ledger.json");
const doc = JSON.parse(readFileSync(topo, "utf-8"));
doc.topology.feeds = [{ process: "decider", reads: "requests", via: "applyTransition" }];
writeFileSync(topo, JSON.stringify(doc, null, 2));
const facts = () => {
  const env = buildPolyglotEnvelope(proj).envelope;
  const model = archModelForEnvelope(env, buildStackIndex(env, proj), buildCrossingIndex(env), proj);
  return { model, facts: briefInputs(proj, model).facts };
};
const GAP = /decider reads ledger\/requests; the code shows no such call/;

test("a feed is validated: exactly one of watches / reads / writes", () => {
  assert.equal(validateTopology({ version: "1", feeds: [{ process: "decider", reads: "requests", via: ["applyTransition"] }] }), null);
  assert.match(validateTopology({ version: "1", feeds: [{ process: "decider", reads: "a", writes: "b" }] }), /feeds\[0\] needs process, exactly one of watches \/ reads \/ writes/);
});

test("a declared feed shows as declared, on the zone and the map, and closes the plan's gap", () => {
  const { model, facts: f } = facts();
  assert.match(f.text, /zone:ledger\/requests: [^\n]*reads by Scripts · decider \(declared by the project's topology, not seen in the code\)/);
  const edge = model.edges.find((e) => e.id === "cluster:scripts:decider->zone:ledger/requests:feed:0");
  assert.ok(edge, model.edges.map((e) => e.id).join("\n"));
  assert.deepEqual([edge.evidence, edge.protocol], ["declared", "read"]);
  assert.doesNotMatch(briefCoverage({ function: [], method: [], feature: [] }, f).gaps.join("\n"), GAP, "the project declared it: no longer a gap");
});

test("renaming the function a feed names makes it STALE — on the sheet, in the inbox — and it stops counting", () => {
  for (const file of ["decider/src/transitions.ts", "decider/bin/decider.ts"]) {
    const p = join(proj, file);
    writeFileSync(p, readFileSync(p, "utf-8").replaceAll("applyTransition", "advanceOrder"));
  }
  const { model, facts: f } = facts();
  const gaps = briefCoverage({ function: [], method: [], feature: [] }, f).gaps.join("\n");
  assert.match(gaps, /topology:feed:0 \(a feed the project declares for decider\) is STALE: it names applyTransition, which the code no longer defines/);
  assert.match(gaps, GAP, "a stale declaration answers nothing: the plan's gap is open again");
  assert.ok(!model.edges.some((e) => e.id.includes(":feed:")), "nor is it drawn");
  const inbox = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), "inbox", "--root", proj, "--sensors"], { encoding: "utf-8", env: { ...process.env, CLAUDECODE: "" } });
  assert.match(inbox.stdout, /declared feed 0 \(decider reads requests\) is STALE: it names applyTransition, which the code no longer defines/);
});
