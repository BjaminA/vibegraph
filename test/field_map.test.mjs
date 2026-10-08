// The map's facts, from a field review (2026-10-07), before any model writes
// on top of them:
//
//   1  a declared zone says which processes the code shows writing and reading
//      it (topology.md, the Resources lens); the start-here story walks a
//      process's store operations, writes first, a role-less call last
//   2  a starter is named by its path, every starter is listed, and a local
//      helper that spawns (`run(script)`) is a starter too; two process files
//      with one name are two boxes
//   3  a plan process names a box only when it IS the box (every entry point)
//   4  a ratified label the facts no longer support is drift
//   5  a `{Placeholder}` zone is a name pattern, not a zone
//   6  an ambiguous script path is settled by the call's `cwd`; a hop that
//      stays ambiguous carries no keys
//
//   npm run test:field-map
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvelope } from "../scripts/quality_check.mjs";
import { buildCrossingIndex, cwdDirOf } from "../src/server/crossings.ts";
import { buildStackIndex } from "../src/server/stack.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { codeOpsByZone, codeOpsText } from "../src/shared/topology_code_ops.ts";
import { formatTopologyMd } from "../src/server/topology_render.ts";
import { staleLabels } from "../src/server/arch_label_drift.ts";
import { storyBeats } from "../src/webview/system/arch_trace.ts";
import { enrichReal } from "../src/webview/system/arch_real.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIX = join(ROOT, "test/fixtures/system/starters_demo");
const { envelope } = loadEnvelope(FIX, undefined, {});
const cx = buildCrossingIndex(envelope);
const map = archModelForEnvelope(envelope, buildStackIndex(envelope, FIX), cx, FIX, undefined, { applyStore: false });
const box = (file) => map.nodes.find((n) => n.kind === "cluster" && (n.entryPoints ?? []).some((e) => e.startsWith(file)));

test("2: two process files with one name are two boxes; starters by path, a spawning helper included", () => {
  const api = box("api/src/server.ts"), worker = box("worker/src/server.ts");
  assert.ok(api && worker && api.id !== worker.id, `${api?.id} vs ${worker?.id}`);
  assert.match(worker.sublabel, /started by tools\/bin\/demo\.ts/);
  // through demo's own run() helper: a starter of a box that listens anyway…
  assert.match(api.sublabel, /listens · started by tools\/bin\/demo\.ts/);
  // …but a one-shot job it runs is not made a process box of its own
  assert.ok(!box("tools/bin/job.ts").id.startsWith("cluster:process:"), box("tools/bin/job.ts").id);
});

test("6: the call's cwd settles an ambiguous script path; only that edge carries the call's keys", () => {
  const hop = cx.all.find((h) => h.file === "tools/bin/demo.ts" && h.callee === "spawn" && h.path.includes("server.ts"));
  assert.deepEqual(hop.targets.map((t) => t.entryPointId), ["worker/src/server.ts:module"]);
  assert.match(hop.note, /the call's cwd \(`WORKER` = \.\.\/\.\.\/worker\/\) names worker\/src\/server\.ts/);
  const keys = map.edges.filter((e) => e.kind === "command").flatMap((e) => (e.payloads ?? []).flatMap((p) => p.keys ?? []).map((k) => `${e.to}:${k}`));
  assert.ok(keys.some((k) => k.startsWith(`${box("worker/src/server.ts").id}:env.PORT`)));
  assert.ok(!keys.some((k) => k.startsWith(`${box("api/src/server.ts").id}:env.`)), "the worker's env keys never reach the api");
  assert.deepEqual(cwdDirOf({ args: ['["x"]', '{ cwd: "svc/a" }'] }, [], "bin/x.ts"), { path: "svc/a", said: '"svc/a"' });
  assert.equal(cwdDirOf({ args: ['["x"]'] }, [], "bin/x.ts"), null);
});

// A small derived map and declared topology for 1, 4 and 5.
const derived = {
  version: "1", groups: [], unplaced: { tests: 0, unmatchedHops: 0, toolsPresentNotCalled: [], unattributedBoundaries: 0 },
  nodes: [
    { id: "cluster:process:app:service", kind: "cluster", label: "Service run", entryPoints: ["app/bin/service.ts:module"], threads: [], refs: [] },
    { id: "cluster:scripts:app", kind: "cluster", label: "App scripts", entryPoints: ["app/bin/a.ts:module", "app/bin/b.ts:module", "app/bin/c.ts:module"], threads: [], refs: [] },
    { id: "zone:store/status", kind: "tool", label: "status", zoneOf: { store: "store", holds: ["status"] }, threads: [], refs: [] },
    { id: "zone:store/requests", kind: "tool", label: "requests", zoneOf: { store: "store", holds: ["request_{Role}__{Person}"] }, threads: [], refs: [] },
    { id: "tool:node", kind: "tool", label: "node", threads: [], refs: [] },
  ],
  edges: [
    { id: "s->status:write", from: "cluster:process:app:service", to: "zone:store/status", kind: "uses", protocol: "write", threads: ["app/bin/service.ts:module"] },
    { id: "a->status:read", from: "cluster:scripts:app", to: "zone:store/status", kind: "uses", protocol: "read", threads: [] },
    { id: "s->req:write", from: "cluster:process:app:service", to: "zone:store/requests", kind: "uses", protocol: "write", threads: [] },
  ],
};
const topology = {
  version: "1",
  stores: [{ id: "store" }],
  zones: [
    { id: "status", store: "store", holds: ["status"] },
    { id: "request_admin", store: "store", holds: ["request_admin__alice"] },
    { id: "request_{Role}__{Person}", store: "store", holds: ["request_{Role}__{Person}"] },
    { id: "record_a", store: "store", holds: ["record_a"] },
  ],
  principals: [{ id: "admin" }, { id: "service" }, { id: "partner" }, { id: "analyst" }],
  grants: [{ who: "service", access: "write", zone: "status" }],
};

test("1: a declared zone says what the code does to it — the per-person zone through its pattern", () => {
  const ops = codeOpsByZone(topology, derived);
  assert.equal(codeOpsText(ops.get("status")), "written by Service run; read by App scripts");
  assert.equal(codeOpsText(ops.get("request_admin")), "written by Service run");
  assert.equal(ops.get("record_a"), undefined);
  const md = formatTopologyMd({ topology, status: [{ source: { id: "gen", generator: "g", inputs: [] }, state: "fresh", detail: "ok" }], conflicts: [] }, [], {}, derived);
  assert.match(md, /zone \*\*status\*\*.*write: service;.*the code: written by Service run; read by App scripts/);
  assert.match(md, /zone \*\*record_a\*\*.*the code: no operation seen/);
});

test("1: the start-here story walks a process's store operations, writes first, a role-less call last", () => {
  const edges = [
    { id: "a:node", from: "P", to: "node", protocol: "unknown", protocolBasis: "no role", threads: ["ep"] },
    { id: "b:read", from: "P", to: "Z1", protocol: "read", protocolBasis: "reads", threads: ["ep"] },
    { id: "c:write", from: "P", to: "Z2", protocol: "write", protocolBasis: "writes", threads: ["ep"] },
    { id: "d:grpc", from: "P", to: "SDK", protocol: "gRPC", protocolBasis: "sdk", threads: ["ep"] },
  ];
  const beats = storyBeats([{ id: "P", label: "P", entryPoints: ["ep"] }, { id: "Z1", label: "Z1" }, { id: "Z2", label: "Z2" }, { id: "SDK", label: "SDK" }, { id: "node", label: "node" }], edges, ["ep"]);
  assert.deepEqual(beats.slice(1).map((b) => b.edges[0]), ["c:write", "b:read", "d:grpc", "a:node"]);
});

test("4: a ratified label the facts no longer support is drift", () => {
  const applied = { ...derived, groups: [{ id: "g-host", kind: "process", label: "App processes (PORT 3000)", wraps: ["cluster:process:app:service", "cluster:scripts:app"], source: "stated" }, { id: "g-ids", kind: "trust", label: "Client identities (admin/service)", wraps: ["g-host"], source: "stated" }] };
  const store = { version: "1", groups: applied.groups };
  const stale = staleLabels(applied, store, { topology, identities: [] });
  assert.match(stale.find((s) => s.group === "g-host").why, /names port 3000, and 2 of its 2 process box\(es\) show no such port/);
  assert.match(stale.find((s) => s.group === "g-ids").why, /names 2 of the 4 principals the declared topology lists \(admin, service\)/);
  assert.equal(staleLabels(applied, store, null).filter((s) => s.group === "g-ids").length, 0, "nothing to check the names against");
});

test("3 and 5: a plan process names a box only when it is the box; a name pattern is not a zone", () => {
  const plan = {
    revision: 1, objective: "x", stack: [], boundaries: [], threads: [], policies: [], open: [],
    processes: [
      { id: "prov", label: "provisioning", status: "agreed", entryPoints: ["app/bin/a.ts"] },
      { id: "svc", label: "the service", status: "agreed", entryPoints: ["app/bin/service.ts:module"] },
    ],
  };
  const rec = { findings: [] };
  const real = enrichReal(derived, { plan, rec, topology });
  const scripts = real.nodes.find((n) => n.id === "cluster:scripts:app");
  assert.equal(scripts.label, "App scripts", "1 of its 3 entry points is the plan's: the box keeps its name");
  assert.match(scripts.sublabel, /^contains the plan's provisioning/);
  assert.equal(real.nodes.find((n) => n.id === "cluster:process:app:service").label, "the service");
  const card = real.nodes.find((n) => n.id === "store:store");
  assert.match(card.sublabel, /^3 zones \+ 1 name pattern/);
  assert.ok(card.notes.some((t) => /3 declared zones: 1 request_\*, 1 record_\*, 1 named singly; plus 1 name pattern \(request_\{Role\}__\{Person\}\)/.test(t)), card.notes.join("\n"));
});
