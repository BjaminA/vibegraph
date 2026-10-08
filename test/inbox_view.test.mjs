// The inbox as chips, and one reconcile per plan state (2026-10-08).
//
//   inbox_view   any inbox item → a subject chip read off its id and one
//                labelled bullet per detail line, its file paths and box ids
//                as chips; a new detail line needs no new renderer
//   memo         a second reconcile of the same plan, code and stated files
//                is the first one's answer; a change to any of them is not
//
//   npm run test:inbox-view
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inboxSubject, inboxFacts, chipifyLine } from "../src/shared/inbox_view.ts";

const item = (id, kind, detail, title = "t") => ({ id, kind, title, detail, decidable: true });

test("the subject is read off the item's id", () => {
  assert.deepEqual(inboxSubject(item("plan:processes:api", "plan", [])), { kind: "process", id: "api", label: "api" });
  assert.equal(inboxSubject(item("plan:stores:ledger", "plan", [])).kind, "store");
  assert.deepEqual(inboxSubject(item("rule-change:c4:p2", "rule-change", [])), { kind: "rule", id: "c4" });
  assert.deepEqual(inboxSubject(item("scope:zone:ledger/status", "scope", [])), { kind: "zone", id: "zone:ledger/status", label: "ledger/status" });
  assert.equal(inboxSubject(item("brief:spec", "brief", [])).kind, "type");
  assert.equal(inboxSubject(item("nonsense", "x", [])), null);
});

test("a line's file paths and box ids become chips; the words between stay words", () => {
  assert.deepEqual(chipifyLine("write status at decider/src/transitions.ts:11 through cluster:scripts:decider"), [
    "write status at", { kind: "path", id: "decider/src/transitions.ts", label: "decider/src/transitions.ts:11" },
    "through", { kind: "process", id: "cluster:scripts:decider", label: "scripts:decider" },
  ]);
  assert.deepEqual(chipifyLine("no references here"), ["no references here"]);
});

test("each detail line is a bullet labelled by its shape", () => {
  const f = inboxFacts(item("plan:processes:api", "plan", [
    'at: "api/" → "services/api/"', "effect: add process api", "entry point api/server.ts", "cites docs/ARCH.md:4", "re-scope: `vibegraph-knowledge scope <box>`",
  ]));
  assert.deepEqual(f.map((x) => x.label), ["changes", "effect", "says", "evidence", "do"]);
  assert.equal(f[0].parts[0], "at");
  assert.ok(f[2].parts.some((p) => typeof p !== "string" && p.kind === "path" && p.id === "api/server.ts"));
  assert.equal(f[4].text, "re-scope: vibegraph-knowledge scope <box>");
  const whole = inboxFacts(item("plan:processes:archiver", "plan", ['{"id":"archiver","kind":"backend","serves":"archives orders","at":"archiver/","status":"proposed"}']));
  assert.deepEqual(whole[0].parts, ["kind", "backend", "· serves", "archives orders", "· at", { kind: "path", id: "archiver/", label: "archiver/" }],
    "a proposed item sent whole reads as its fields, its folder a chip — not JSON");
});

test("one reconcile per plan state: the same inputs answer from memory, a changed plan, stated file or code does not", async () => {
  const { reconcilePlanMemo } = await import("../src/server/reconcile_memo.ts");
  const { buildPolyglotEnvelope } = await import("../scripts/regen_polyglot.mjs");
  const { buildStackIndex } = await import("../src/server/stack.ts");
  const { loadPlan } = await import("../src/server/plan_store.ts");
  const tmp = mkdtempSync(join(tmpdir(), "vg-memo-"));
  after(() => rmSync(tmp, { recursive: true, force: true }));
  const root = join(tmp, "p");
  cpSync(join(import.meta.dirname, "..", "test/fixtures/system/views_demo"), root, { recursive: true });
  const env = buildPolyglotEnvelope(root).envelope;
  const stack = buildStackIndex(env, root);
  const plan = loadPlan(root);
  const a = reconcilePlanMemo(plan, env, stack, root);
  assert.equal(reconcilePlanMemo(plan, env, stack, root), a, "same plan, code and stated files");
  const changed = { ...plan, objective: `${plan.objective} (edited)` };
  assert.notEqual(reconcilePlanMemo(changed, env, stack, root), a, "a changed plan");
  const b = reconcilePlanMemo(plan, env, stack, root);
  writeFileSync(join(root, ".vibegraph/constraints.json"), JSON.stringify({ version: "1", constraints: [] }));
  assert.notEqual(reconcilePlanMemo(plan, env, stack, root), b, "a stated file written");
  const c = reconcilePlanMemo(plan, env, stack, root);
  const topo = join(root, ".vibegraph/topology/ledger.json");
  const later = new Date(Date.now() + 5000);
  utimesSync(topo, later, later);
  assert.notEqual(reconcilePlanMemo(plan, env, stack, root), c, "a file inside a stated directory edited");
  const d = reconcilePlanMemo(plan, env, stack, root);
  assert.notEqual(reconcilePlanMemo(plan, { ...env, threads: [...env.threads] }, stack, root), d, "re-derived code");
});
