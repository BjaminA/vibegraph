// REFUSED ATTEMPTS ARE NOT WRITES, KEYS ONLY FROM THE PAYLOAD (2026-10-06,
// direction review M5 + M7). Fixture test/fixtures/system/attempts_demo: a
// live check whose writes sit inside `attempt(() => writeDoc(…))` beside an
// `expect: "REFUSED"` (and one control expected ALLOWED), a probe file the
// project declares negative, and an app's real write. Pinned: the refused
// attempt and the declared-negative write are drawn as ATTEMPTS, never as
// writes, while the ALLOWED control stays a write; a wrapper is recognised by
// name or by SHAPE (`try { param() } catch { return }`), through the write's
// enclosing function at every call site; keys come from the store call
// itself — never from the `results.push({ check, expect, got })` around it,
// and never from a constructor's options.
//
//   npm run test:attempts
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { AttemptFinder } from "../src/server/attempts.ts";
import { callerPayload } from "../src/server/arch_payloads.ts";
import { nodeIO } from "../src/shared/node_io.ts";

const ROOT = "test/fixtures/system/attempts_demo";
let model;
before(() => {
  const env = buildPolyglotEnvelope(ROOT, { skipSystem: true }).envelope;
  model = archModelForEnvelope(env, buildStackIndex(env, ROOT), buildCrossingIndex(env), ROOT, undefined, { applyStore: false });
});
const into = (zone) => model.edges.filter((e) => e.to === `zone:ledger/${zone}`);

test("a refused attempt and a declared-negative write are ATTEMPTS; the ALLOWED control and the app's write stay writes", () => {
  assert.deepEqual(into("status").map((e) => e.protocol), ["attempt"]);
  assert.match(into("status")[0].protocolBasis, /refused ATTEMPT, not a write.*expects it REFUSED.*inside attempt/);
  assert.deepEqual(into("approver").map((e) => e.protocol), ["attempt"]);
  assert.match(into("approver")[0].protocolBasis, /bin\/rogue\.ts is declared negative/);
  // the app server (its own process: it listens) and the check's ALLOWED control
  assert.deepEqual([...new Set(into("requests").map((e) => e.protocol))], ["write"]);
  // In → Process → Out: the status zone takes no write, only an attempt
  const io = nodeIO(model, "zone:ledger/status");
  assert.deepEqual(io.in.map((r) => r.op), ["attempt"]);
});

test("keys come from the store call, never from the results.push around it", () => {
  const keys = (zone) => [...new Set(into(zone).flatMap((e) => (e.payloads ?? []).flatMap((p) => p.keys ?? [])))].sort();
  assert.deepEqual(keys("status"), ["phase"]);
  assert.deepEqual(keys("requests"), ["by"]);
  assert.deepEqual(keys("approver"), ["who"]);
  for (const e of model.edges) for (const p of e.payloads ?? []) assert.ok(!(p.keys ?? []).some((k) => ["check", "expect", "got"].includes(k)), `${e.id}: ${p.text}`);
});

test("a constructor's options are not a payload", () => {
  const p = callerPayload({ callTarget: "Client", args: ["{ readOnly: true }"], argKeys: [["readOnly"]], preview: "new Client({ readOnly: true })" }, { file: "a.ts" });
  assert.equal(p.keys, undefined);
  assert.match(p.note, /constructor/);
});

test("a wrapper by SHAPE, through the write's enclosing function at every call site; one ALLOWED site keeps it a write", () => {
  // `run` is not named like a wrapper, but its try calls its parameter and its catch returns
  const files = (expects) => ({ "a.ts": { nodes: [
    { id: "module/run.fn", type: "function_def", name: "run", params: ["what"], line: 1, parentId: null },
    { id: "module/run.fn/try@0/what.call", type: "call", callTarget: "what", line: 1, parentId: "module/run.fn/try@0" },
    { id: "module/run.fn/except@0/return@0", type: "return_stmt", line: 1, parentId: "module/run.fn/except@0" },
    { id: "module/save.fn", type: "function_def", name: "save", params: ["doc"], line: 2, parentId: null },
    { id: "module/save.fn/db_put.call", type: "call", callTarget: "db.put", line: 2, parentId: "module/save.fn" },
    ...expects.map((x, i) => [
      { id: `module/main.fn/log.call@${i}`, type: "call", callTarget: "log.push", args: [`{ expect: "${x}", got: await run(save(d)) }`], line: 10 + i, parentId: "module/main.fn" },
      { id: `module/main.fn/log.call@${i}/run.call`, type: "call", callTarget: "run", args: ["save(d)"], line: 10 + i, parentId: `module/main.fn/log.call@${i}` },
      { id: `module/main.fn/log.call@${i}/run.call/save.call`, type: "call", callTarget: "save", args: ["d"], line: 10 + i, parentId: `module/main.fn/log.call@${i}/run.call` },
    ]).flat(),
    { id: "module/main.fn", type: "function_def", name: "main", line: 9, parentId: null },
  ] } });
  const refused = new AttemptFinder(files(["REFUSED", "DENIED"])).of("a.ts", "module/save.fn/db_put.call");
  assert.equal(refused.expect, "refused");
  assert.match(refused.via, /inside run\(…\)/);
  assert.equal(new AttemptFinder(files(["REFUSED", "ALLOWED"])).of("a.ts", "module/save.fn/db_put.call"), null, "a control site keeps it a write");
});
