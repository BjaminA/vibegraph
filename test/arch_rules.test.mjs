// Architecture groups that outlast the code they were drawn on (2026-10-05):
// membership by RULE (src/shared/arch_rules.ts), groups anchored to the PLAN,
// and DRIFT since ratification (src/server/arch_drift.ts) that asks for an
// UPDATE pass extending — never replacing — the ratified groups.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRule, resolveMembers } from "../src/shared/arch_rules.ts";
import { applyArchStore, emptyStore, ratifyProposal, proposalGate } from "../src/server/arch_store.ts";
import { archBaseline, archDrift } from "../src/server/arch_drift.ts";
import { buildProposePrompt, parseProposal } from "../src/server/arch_propose.ts";

const cluster = (root, family, entry) => ({
  id: `cluster:${family}:${root}`, kind: "cluster", label: `${family} ${root}`, sublabel: "", category: "process", source: "derived",
  family, root, entryPoints: [`${entry}:main`], threads: [], refs: [],
});
const tool = (name, role) => ({ id: `tool:${name}`, kind: "tool", label: name, sublabel: role, category: "database", source: "derived", tool: name, role, threads: [], refs: [] });
const model = (nodes) => ({ version: "1", nodes, edges: [], groups: [], notes: [] });

const API = cluster("services/api", "api", "services/api/server.ts");
const WORKER = cluster("services/worker", "scripts", "services/worker/run.ts");
const WEB = cluster("web", "web", "web/app/page.tsx");
const PG = tool("pg", "db");

const plan = {
  version: "1", revision: 3, objective: "Operators see every order within a minute",
  processes: [
    { id: "api", kind: "backend", label: "API", serves: "orders in", at: "services/api/", status: "agreed" },
    { id: "billing", kind: "backend", label: "Billing", serves: "invoices", at: "services/billing/", status: "proposed" },
  ],
  boundaries: [], stack: [], threads: [], policies: [], open: [], changelog: [],
};

test("a rule is validated as written: no empty rule, no unknown field, no project-wide framework, no ..", () => {
  assert.match(validateRule({}).error, /empty rule/);
  assert.match(validateRule({ folder: "x" }).error, /unknown rule field/);
  assert.match(validateRule({ framework: ["next"] }).error, /across the whole project/);
  assert.match(validateRule({ rootPrefix: "../etc" }).error, /relative path/);
  assert.deepEqual(validateRule({ kind: "cluster", rootPrefix: "services/" }).rule, { kind: "cluster", rootPrefix: "services/" });
});

test("membership: what a group names wins, exclude holds, the most specific rule takes a box", () => {
  const m = model([API, WORKER, WEB, PG]);
  const groups = [
    { id: "g-services", wraps: [], match: [{ rootPrefix: "services/" }], exclude: [] },
    { id: "g-worker", wraps: [], match: [{ rootPrefix: "services/worker" }] },
    { id: "g-web", wraps: [API.id], match: [{ family: ["web"] }] },
    { id: "g-data", wraps: [], match: [{ kind: "tool", role: ["db"] }], exclude: [PG.id] },
  ];
  const r = resolveMembers(groups, m);
  assert.deepEqual(r.get("g-web").members.sort(), [API.id, WEB.id].sort(), "named in wraps: the API stays where a person put it");
  assert.deepEqual(r.get("g-worker").members, [WORKER.id], "the longer prefix wins over services/");
  assert.deepEqual(r.get("g-services").members, []);
  assert.deepEqual(r.get("g-data").members, [], "excluded");
});

test("code added after ratification joins its group by rule — no model, said as a rule member", () => {
  const store = { ...emptyStore(), groups: [{ id: "g-services", kind: "host", label: "app host", wraps: [API.id], match: [{ kind: "cluster", rootPrefix: "services/" }] }], ratified: { at: "2026-10-01", model: "m" } };
  const before = applyArchStore(model([API, WEB]), store);
  assert.deepEqual(before.groups[0].wraps, [API.id]);
  const after = applyArchStore(model([API, WORKER, WEB]), store);
  assert.deepEqual(after.groups[0].wraps.sort(), [API.id, WORKER.id].sort());
  assert.deepEqual(after.groups[0].byRule, [WORKER.id]);
  assert.ok(after.nodes.find((n) => n.id === WORKER.id).group === "g-services", "the hierarchy places it");
});

test("a group anchored to a planned process waits for its code: said, not drawn — then drawn when it lands", () => {
  const store = { ...emptyStore(), groups: [{ id: "g-billing", kind: "process", label: "Billing", wraps: [], match: [{ kind: "cluster", pathPrefix: "services/billing/" }], planned: "plan:processes:billing" }] };
  const waiting = applyArchStore(model([API]), store);
  assert.equal(waiting.groups.length, 0);
  assert.ok(waiting.notes.some((n) => /"Billing" has no code yet \(planned: plan:processes:billing\)/.test(n)));
  const BILLING = cluster("services/billing", "api", "services/billing/index.ts");
  const landed = applyArchStore(model([API, BILLING]), store);
  assert.deepEqual(landed.groups.map((g) => [g.id, g.wraps]), [["g-billing", [BILLING.id]]]);
});

test("drift: measured from the baseline stored at ratification; rules absorb growth, new kinds of change are substantial", () => {
  const facts = [{ file: "docker-compose.yml", line: 2, kind: "service", name: "api" }];
  const store = { ...emptyStore(), groups: [{ id: "g-services", kind: "host", label: "app host", wraps: [], match: [{ kind: "cluster", rootPrefix: "services/" }] }], ratified: { at: "2026-10-01", model: "m" } };
  const m0 = applyArchStore(model([API, WEB]), store);
  store.baseline = archBaseline(m0, facts, plan, new Date("2026-10-01"));
  assert.deepEqual(store.baseline.ungrouped, [WEB.id], "a box left ungrouped AT ratification is the person's choice, not drift");
  assert.equal(archDrift(m0, store, facts, plan).level, "none");

  const grown = applyArchStore(model([API, WEB, WORKER]), store);
  const d1 = archDrift(grown, store, facts, plan);
  assert.equal(d1.level, "minor", "a new cluster its rule placed is counted, not asked about");
  assert.deepEqual(d1.added, [WORKER.id]);
  assert.deepEqual(d1.unplaced, []);

  const CLI = cluster("tools/cli", "cli", "tools/cli/main.ts");
  const MCP = cluster("tools/mcp", "mcp", "tools/mcp/index.ts");
  const d2 = archDrift(applyArchStore(model([API, WEB, CLI, MCP]), store), store, facts, plan);
  assert.equal(d2.level, "substantial", "two clusters no rule fits");
  assert.deepEqual(d2.unplaced.sort(), [CLI.id, MCP.id].sort());

  const d3 = archDrift(m0, store, [...facts, { file: "docker-compose.yml", line: 9, kind: "service", name: "billing" }], plan);
  assert.equal(d3.level, "substantial");
  assert.deepEqual(d3.deployAdded, ["service:billing"]);

  const plan2 = { ...plan, revision: 4, processes: [...plan.processes, { id: "audit", kind: "backend", label: "Audit", serves: "x", status: "proposed" }] };
  assert.deepEqual(archDrift(m0, store, facts, plan2).plannedAdded, ["processes:audit"]);

  assert.equal(proposalGate(store, { update: { drifted: false } }).allowed, false);
  assert.equal(proposalGate(store, { update: { drifted: true } }).allowed, true);
  assert.equal(proposalGate(emptyStore(), { update: { drifted: true } }).allowed, false, "nothing ratified to update");
});

test("the prompt carries the plan and asks for rules; an update shows the ratified groups as FIXED with what changed", () => {
  const m = model([API, WEB]);
  const p = buildProposePrompt(m, [], [], undefined, { plan });
  assert.match(p, /GROUPS MUST OUTLAST THE CODE/);
  assert.match(p, /Objective: Operators see every order within a minute/);
  assert.match(p, /plan:processes:billing: process billing "Billing" — code at services\/billing\//);
  const u = buildProposePrompt(m, [], [], undefined, {
    plan, update: { groups: [{ id: "g-services", kind: "host", label: "app host", wraps: [API.id], match: [{ rootPrefix: "services/" }] }], drift: { level: "substantial", unplaced: [WEB.id], added: [], removed: [], deployAdded: [], plannedAdded: [], emptied: [], reasons: ["1 cluster in no group: cluster:web:web"], since: "x" } },
  });
  assert.match(u, /These groups are FIXED/);
  assert.match(u, /g-services \(host\) "app host": names cluster:api:services\/api; rules: under services\//);
  assert.match(u, /Clusters in no group: cluster:web:web/);
});

test("a reply's rules and plan anchors are grounded like everything else; an UPDATE extends a ratified group and ratifying merges it", () => {
  const m = model([API, WEB]);
  const reply = JSON.stringify({ groups: [
    { id: "g-svc", kind: "host", label: "services", match: [{ kind: "cluster", rootPrefix: "services/" }], evidence: ["plan:processes:api"] },
    { id: "g-billing", kind: "process", label: "Billing", match: [{ pathPrefix: "services/billing/" }], planned: "plan:processes:billing", evidence: ["plan:processes:billing"] },
    { id: "g-bad", kind: "host", label: "bad", match: [{ framework: ["next"] }] },
    { id: "g-none", kind: "host", label: "none", match: [{ rootPrefix: "nowhere/" }] },
    { id: "g-fake", kind: "host", label: "fake plan", match: [{ rootPrefix: "x/" }], planned: "plan:processes:ghost" },
  ] });
  const r = parseProposal(reply, m, [], [], { model: "t", plan });
  const ids = r.proposal.groups.map((g) => g.id);
  assert.deepEqual(ids, ["g-svc", "g-billing"]);
  assert.deepEqual(r.proposal.groups[0].evidence, ["plan:processes:api"], "a plan item is citable");
  assert.ok(r.proposal.refused.some((x) => x.item === "group g-bad" && /rule refused/.test(x.reason)));
  assert.ok(r.proposal.refused.some((x) => x.item === "group g-none" && /match nothing in the map and it anchors to no planned item/.test(x.reason)));
  assert.ok(r.proposal.refused.some((x) => x.item === "group g-fake" && /not a plan item that was shown/.test(x.reason)));

  // UPDATE: the ratified g-svc is extended with a rule for the web app.
  const ratified = [{ id: "g-svc", kind: "host", label: "app host", wraps: [], match: [{ kind: "cluster", rootPrefix: "services/" }] }];
  const up = parseProposal(JSON.stringify({ groups: [{ id: "g-svc", kind: "host", label: "renamed?", match: [{ kind: "cluster", rootPrefix: "web" }], evidence: [] }] }), m, [], [], { model: "t", plan, update: { groups: ratified } });
  assert.equal(up.proposal.mode, "update");
  const store = { ...emptyStore(), groups: ratified, ratified: { at: "x", model: "m" }, proposal: up.proposal };
  const preview = applyArchStore(m, store);
  assert.deepEqual(preview.groups[0].wraps.sort(), [API.id, WEB.id].sort(), "the extension is previewed on the ratified group");
  const after = ratifyProposal(store);
  assert.equal(after.groups.length, 1);
  assert.equal(after.groups[0].label, "app host", "a ratified label stands; an update only adds");
  assert.deepEqual(after.groups[0].match, [{ kind: "cluster", rootPrefix: "services/" }, { kind: "cluster", rootPrefix: "web" }]);
});
