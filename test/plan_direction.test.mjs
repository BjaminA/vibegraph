// FORMING A DIRECTION WHERE NONE EXISTS (2026-10-06, direction review M2).
// A finished project had no plan, and the only way to start one was to write
// it from memory. Fixture: a copy of test/fixtures/system/processes_demo with
// its plan removed and a README its people wrote. Pinned: `plan observe`
// starts a plan for zero tokens from what the code does — its processes, who
// each runs as — every item PROPOSED and grounded in the fact it came from,
// the objective said to be unstated (and starting a plan stays a person's
// step); `plan draft --direction` hands the project's own prose to a model
// (here a saved reply) and its objective, principles and names pass the quote
// gate — a made-up quote is dropped, an unquoted line is INFERRED; the
// objective lands as a question a person adopts, without its citation; a
// principle keeps its checkable half for `plan promote`.
//
//   npm run test:plan-direction
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadPlan } from "../src/server/plan_store.ts";
import { buildInbox, decideInbox } from "../src/server/inbox.ts";
import { OBSERVED_OBJECTIVE } from "../src/server/plan_observe.ts";

let tmp, root;
const cli = (args, env = {}) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", ...args, "--root", root], { encoding: "utf-8", env: { ...process.env, CLAUDECODE: "", ...env } });
const README = `# Order ledger

Orders are released only by the runner, each run under an account made for that run.

- The runner is the only process that writes release status.
- The order service answers status queries and never writes.
`;
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "vg-direction-plan-"));
  root = join(tmp, "p");
  cpSync("test/fixtures/system/processes_demo", root, { recursive: true });
  rmSync(join(root, ".vibegraph/plan.json"));
  writeFileSync(join(root, "README.md"), README);
});
after(() => rmSync(tmp, { recursive: true, force: true }));

test("starting a plan from the code is a person's step", () => {
  const r = cli(["plan", "observe"], { CLAUDECODE: "1" });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /would START a plan/);
  assert.equal(loadPlan(root), null);
});

test("plan observe: the code's processes and identities, every item proposed and grounded", () => {
  const r = cli(["plan", "observe"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const plan = loadPlan(root);
  assert.equal(plan.objective, OBSERVED_OBJECTIVE);
  assert.deepEqual(plan.processes.map((p) => [p.id, p.runsAs ?? null, p.status]).sort(), [
    ["root-scripts", null, "proposed"], ["runner", "runner-run", "proposed"], ["server", "svc-user", "proposed"],
  ]);
  assert.deepEqual(plan.principals.map((p) => p.id).sort(), ["runner-run", "svc-user"]);
  assert.ok([...plan.processes, ...plan.principals].every((x) => /^observed: /.test(x.groundedIn)));
  assert.deepEqual(plan.processes.find((p) => p.id === "runner").entryPoints, ["svc/runner.ts:main"]);
  assert.ok(plan.open.some((q) => /What is this project for/.test(q.text)));
  assert.match(cli(["plan", "observe"]).stdout, /nothing new observed/);
});

test("plan draft --direction: the prose goes to the model; the gate keeps only what it can quote", () => {
  const dry = cli(["plan", "draft", "--direction", "--dry-run"]);
  assert.match(dry.stdout, /DIRECTION draft/);
  assert.match(dry.stdout, /=== DOCUMENT 1: README\.md ===/);
  const reply = join(tmp, "reply.json");
  writeFileSync(reply, JSON.stringify([
    { op: "objective", text: "Release orders only through the runner, under a per-run account", cite: "Orders are released only by the runner, each run under an account made for that run." },
    { op: "add", section: "policies", item: { text: "only the runner writes release status", why: "the README says so", check: { rule: "callers-only", target: "release", files: ["svc/runner.ts", "lib/logic.ts"] }, cite: "The runner is the only process that writes release status." } },
    { op: "add", section: "policies", item: { text: "the order service is read-only", why: "stated", cite: "The order service is strictly read-only by contract." } },
    { op: "add", section: "policies", item: { text: "one account per run", why: "inferred" } },
    { op: "name", id: "server", label: "order service", cite: "The order service answers status queries and never writes." },
  ]));
  const r = cli(["plan", "draft", "--direction", "--reply", reply]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /1 dropped/);
  assert.match(r.stdout, /inferred: policies one account per run/);
  const plan = loadPlan(root);
  const q = plan.open.find((x) => x.text.startsWith("Proposed objective:"));
  assert.match(q.text, /\(cited: "Orders are released only by the runner/);
  assert.equal(plan.processes.find((p) => p.id === "server").label, "order service");
  const pol = plan.policies.find((p) => p.text === "only the runner writes release status");
  assert.equal(pol.status, "proposed");
  assert.deepEqual(pol.check.rule, "callers-only");
  assert.ok(!plan.policies.some((p) => p.text === "the order service is read-only"), "a made-up quote is dropped");
});

test("a person adopts the objective from the inbox — without its citation", () => {
  const item = buildInbox(root).find((i) => i.kind === "objective");
  assert.ok(item);
  const r = decideInbox(root, item.id, "agree");
  assert.ok(r.ok, r.detail);
  assert.equal(loadPlan(root).objective, "Release orders only through the runner, under a per-run account");
});
