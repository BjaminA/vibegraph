// Which box a planned process is (2026-10-08, the run-time unknowns review):
// its named entry points first (ANCHORED — only those boxes, whatever else its
// folder holds); its folder only when it names none (LOCATED, one box, a weaker
// match); several boxes in that folder is AMBIGUOUS — none is picked, the sheet
// says so. And a stated group label the facts no longer support is marked
// STALE in architecture.md instead of printed as true.
//
//   npm run test:plan-matching
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planProcessMatches, briefData } from "../src/server/brief_data.ts";
import { briefCoverage } from "../src/server/brief_checks.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const model = { nodes: [
  { id: "cluster:run", kind: "cluster", label: "service run", entryPoints: ["svc/bin/run.ts:module"] },
  { id: "cluster:cli", kind: "cluster", label: "offline CLIs", entryPoints: ["svc/src/bin/replay.ts:main", "svc/src/bin/check.ts:main"] },
], edges: [] };
const proc = (id, at, entryPoints) => ({ id, label: id, kind: "backend", serves: "x", at, ...(entryPoints ? { entryPoints } : {}), status: "agreed" });

test("entry points anchor a process; a folder alone locates one box; a folder holding several is ambiguous", () => {
  const plan = { processes: [proc("anchored", "svc/", ["svc/bin/run.ts"]), proc("located", "svc/src/"), proc("ambiguous", "svc/")], flows: [], stores: [] };
  const m = planProcessMatches(plan, model);
  assert.deepEqual(m.get("anchored"), { boxes: ["cluster:run"], how: "anchored" }, "its folder also holds the CLIs: the named entry point decides");
  assert.deepEqual(m.get("located"), { boxes: ["cluster:cli"], how: "located" });
  assert.deepEqual(m.get("ambiguous"), { boxes: ["cluster:run", "cluster:cli"], how: "ambiguous" });
});

test("an ambiguous process is charged no planned step, and the sheet says why", () => {
  const plan = { processes: [proc("svc", "svc/")], stores: [{ id: "st", kind: "document-store", reachedThrough: [], status: "agreed", zones: [{ id: "requests", holds: ["request"] }] }],
    flows: [{ id: "f1", steps: [{ process: "svc", op: "watch", zone: "st/requests" }], status: "agreed" }] };
  const data = briefData(model, { plan });
  assert.deepEqual(data.ops.filter((o) => o.source === "declared"), [], "neither box is guessed");
  const facts = { data, labels: new Map(model.nodes.map((n) => [n.id, n.label])), rules: [], salient: [], notes: [], code: new Map() };
  const gaps = briefCoverage({ function: [], method: [], feature: [] }, facts).gaps;
  assert.ok(gaps.some((g) => /plan:processes:svc is ambiguous: its folder holds 2 boxes \(service run; offline CLIs\)/.test(g)), gaps.join("\n"));
  const located = briefData(model, { plan: { ...plan, processes: [proc("svc", "svc/src/")] } });
  const g2 = briefCoverage({ function: [], method: [], feature: [] }, { ...facts, data: located }).gaps;
  assert.match(g2.join("\n"), /says offline CLIs watches st\/requests; .* the plan places this process by its folder only/);
});

test("a process anchored to several boxes does a step when ANY of its boxes does; missing it is one gap, not one per box", () => {
  const two = { nodes: [...model.nodes], edges: [{ id: "e1", from: "cluster:run", to: "zone:st/requests", protocol: "write" }] };
  const store = { id: "st", kind: "document-store", reachedThrough: [], status: "agreed", zones: [{ id: "requests", holds: ["request"] }, { id: "status", holds: ["status"] }] };
  const plan = { processes: [proc("gw", "svc/", ["svc/bin/run.ts", "svc/src/bin/replay.ts"])], stores: [store],
    flows: [{ id: "f1", steps: [{ process: "gw", op: "write", zone: "st/requests" }, { process: "gw", op: "read", zone: "st/status" }], status: "agreed" }] };
  const data = briefData(two, { plan });
  const declared = data.ops.filter((o) => o.source === "declared").map((o) => `${o.box} ${o.op} ${o.zone}`).sort();
  assert.deepEqual(declared, ["cluster:cli read zone:st/status", "cluster:run read zone:st/status", "cluster:run write zone:st/requests"],
    "the server box writes requests, so the CLI box is not charged with it");
  const facts = { data, labels: new Map(two.nodes.map((n) => [n.id, n.label])), rules: [], salient: [], notes: [], code: new Map() };
  const gaps = briefCoverage({ function: [], method: [], feature: [] }, facts).gaps;
  assert.deepEqual(gaps.filter((g) => /st\/(requests|status)/.test(g)).length, 1, `one gap for the status read, none for the write: ${gaps.join("\n")}`);
});

test("a stated group label the facts no longer support is marked STALE in architecture.md", () => {
  const tmp = mkdtempSync(join(tmpdir(), "vg-labels-"));
  after(() => rmSync(tmp, { recursive: true, force: true }));
  const proj = join(tmp, "p");
  cpSync(join(ROOT, "test/fixtures/system/views_demo"), proj, { recursive: true });
  writeFileSync(join(proj, ".vibegraph/architecture.json"), JSON.stringify({ version: "1", groups: [
    { id: "g-node", kind: "host", label: "Node processes (PORT 3000)", wraps: ["cluster:scripts:decider", "cluster:cli-package-script:app"] },
  ], names: {} }));
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), "export", proj], { encoding: "utf-8", env: { ...process.env, CLAUDECODE: "" } });
  assert.equal(r.status, 0, r.stderr);
  const md = readFileSync(join(proj, ".vibegraph/knowledge/architecture.md"), "utf-8");
  assert.match(md, /\*\*Node processes \(PORT 3000\)\*\* \(host\)[^\n]*\*\*\[LABEL STALE: the label names port 3000, and \d of its \d process box\(es\) show no such port/);
});
