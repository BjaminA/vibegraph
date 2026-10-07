// An open question a decision may already answer (2026-10-07, field report:
// promoting a rule that named a new top-level package settled "package at the
// repository root or tools/lib/?", and the question stayed open, unlinked).
//
//   npm run test:plan-answered
import { test } from "node:test";
import assert from "node:assert/strict";
import { possiblyAnswered } from "../src/server/plan_answered.ts";

const base = { objective: "x", processes: [], stack: [], boundaries: [], threads: [], policies: [], open: [] };

test("a promoted rule naming a new top-level folder answers 'repository root'", () => {
  const plan = {
    ...base,
    policies: [{ id: "one-http-funnel", text: "every HTTP call goes through pkgnet/net/", why: "one funnel", status: "promoted", constraintId: "c4" }],
    open: [
      { id: "q4", text: "package at the repository root or tools/lib/?" },
      { id: "q5", text: "which retry budget?" },
    ],
  };
  const a = possiblyAnswered(plan);
  assert.deepEqual(a.map((x) => x.question), ["q4"]);
  assert.match(a[0].how, /one-http-funnel \(promoted as c4\) names `pkgnet\/net\/`, at the repository root/);
});

test("an agreed module under one of the offered paths answers it; proposals answer nothing", () => {
  const q = { id: "q1", text: "put the parser in tools/lib/ or in pkg/?" };
  const agreed = possiblyAnswered({ ...base, modules: [{ id: "parser", at: "tools/lib/parse/", kind: "library", status: "agreed" }], open: [q] });
  assert.match(agreed[0].how, /parser names `tools\/lib\/parse\/`, under `tools\/lib\/`/);
  assert.deepEqual(possiblyAnswered({ ...base, modules: [{ id: "parser", at: "tools/lib/parse/", kind: "library", status: "proposed" }], open: [q] }), []);
});
