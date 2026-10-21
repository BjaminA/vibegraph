// JSON IN A REPLY (2026-10-20, src/server/json_reply.ts): one string-aware
// reader for every parser of a model's reply. The live setup run's
// `software add` was refused with "Unexpected token '*'" on a sound reply:
// the parser took the FIRST ``` fence, and a spec reply quotes documentation,
// which is full of fences, braces and brackets.
//
//   npm run test:json-reply
import { test } from "node:test";
import assert from "node:assert/strict";
import { jsonInReply, replyObject } from "../src/server/json_reply.ts";
import { parseSpecReply } from "../src/server/software_draft.ts";
import { parsePlanDraftReply } from "../src/server/plan_draft.ts";
import { extractJson } from "../src/server/brief_validate.ts";
import { replyJson } from "../src/server/rule_draft_gate.ts";
import { parseClassifyResponse } from "../src/server/stack_classify.ts";

const FENCE = "```";
const spec = { definition: "A query builder", operations: [{ name: "insert", cite: `db.insert(users).values({ id: 1 }) — see ${FENCE}ts db.insert()${FENCE}` }], rules: [{ id: "s1", text: "await every query", cite: "Queries are [lazy] promises {until awaited}" }] };
const reply = [
  "I read the README. Its API table, for reference:",
  FENCE,
  "* | insert | update | delete",
  "{ where } narrows the rows",
  FENCE,
  "An item looks like {\"name\": \"x\"}. Here is the spec:",
  `${FENCE}json`,
  JSON.stringify(spec, null, 2),
  FENCE,
  "Let me know if you want more.",
].join("\n");

test("a docs fence in the prose, and fences and brackets inside quoted strings", () => {
  assert.deepEqual(jsonInReply(reply).value, spec);
  assert.deepEqual(parseSpecReply(reply).value, spec, "software add");
  assert.deepEqual(extractJson(reply), spec, "the Brief and gap explain");
  assert.deepEqual(replyJson(reply), spec, "rule drafting");
  assert.deepEqual(replyObject(reply), spec);
});

test("the largest top-level value is the reply; a broken one is an error, never a fragment of it", () => {
  const broken = `Example: {"id": "x"}\n${FENCE}json\n{"rules": [{"id": "s1", "text": "a"},]}\n${FENCE}`;
  assert.match(jsonInReply(broken).error, /^the reply's JSON does not parse/);
  assert.throws(() => replyObject(broken), /does not parse/);
  assert.equal(jsonInReply("no json here").error, "the reply holds no JSON object");
  assert.equal(jsonInReply("prose with an { unclosed brace").error, "the reply holds no JSON object");
});

test("arrays: an array nested in an object is not an array reply", () => {
  const ops = [{ op: "add", section: "stack", item: { tool: "redis", cite: "[1] the cache" } }];
  assert.deepEqual(parsePlanDraftReply(`Ops:\n${FENCE}json\n${JSON.stringify(ops)}\n${FENCE}`).ops, ops);
  assert.equal(parsePlanDraftReply(JSON.stringify({ ops })).error, "the reply holds no JSON array");
});

test("classify reads the same way", () => {
  const dossiers = [{ tool: "acme-sdk" }];
  const body = { classifications: [{ tool: "acme-sdk", role: "platform", definition: "Acme's client: `acme.put()` writes a blob", evidence: ["acme.put"] }] };
  const r = parseClassifyResponse(`${FENCE}\nacme.put({ key })\n${FENCE}\n${JSON.stringify(body)}`, dossiers);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.missing, []);
});
