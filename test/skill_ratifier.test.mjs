// WHO ratified a thread skill, and why the injected text has to say so.
//
// Ratification was human-only and recorded nothing: the file said
// `status: ratified` and that was the whole claim. Ben delegated it on
// 2026-09-21 (the same shape as the calibration review he delegated on
// 2026-09-12), and a delegated ratification that looks identical to a
// human's would break the floor the whole layer rests on — nothing is
// authored by a model without provenance riding beside it.
//
//   npm run test:skill-ratifier
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getThreadSkill, injectableSkillText, modelRatifiedCaveat,
  ratifyThreadSkill, threadSkillPath, writeThreadSkill,
} from "../src/server/thread_skill_store.ts";

const EP = "db.py:query";
const HASH = "hash-1";
const BODY = "# db.py:query\n\n## Rules and why\n\n- Every read goes through the pool, because a per-request connection exhausted the server once.";
const DELEGATED = {
  kind: "model",
  model: "claude:claude-opus-5",
  delegatedBy: { source: "human", id: "ruling:2026-09-21:skill-ratification-delegated", at: "2026-09-21T00:00:00.000Z" },
};

function project() {
  const root = mkdtempSync(join(tmpdir(), "vg-ratifier-"));
  writeThreadSkill(root, EP, BODY, HASH, new Date().toISOString());
  return root;
}

test("a human's ratification is recorded as a human's, and injects with no caveat", () => {
  const root = project();
  const r = ratifyThreadSkill(root, EP);
  assert.deepEqual(r.ratifiedBy, { kind: "human" });
  const read = getThreadSkill(root, EP, HASH);
  assert.equal(read.status, "ratified");
  assert.deepEqual(read.ratifiedBy, { kind: "human" });
  assert.equal(injectableSkillText(read), BODY, "no caveat: a human read it");
  rmSync(root, { recursive: true, force: true });
});

test("a MODEL's ratification names the model and the ruling, on disk and in the injected text", () => {
  const root = project();
  ratifyThreadSkill(root, EP, DELEGATED);
  const onDisk = readFileSync(threadSkillPath(root, EP), "utf-8");
  assert.match(onDisk, /^ratifiedBy: /m, "the header carries it");
  assert.match(onDisk, /ruling:2026-09-21:skill-ratification-delegated/);
  const read = getThreadSkill(root, EP, HASH);
  assert.deepEqual(read.ratifiedBy, DELEGATED);
  const text = injectableSkillText(read);
  assert.ok(text.startsWith(BODY), "the body is untouched");
  assert.match(text, /ratified by a MODEL \(claude:claude-opus-5\)/);
  assert.match(text, /ruling:2026-09-21:skill-ratification-delegated/);
  assert.match(text, /not by a human reading it/);
  assert.match(text, /a stated constraint still overrides it/);
  rmSync(root, { recursive: true, force: true });
});

test("a file written before the field existed reads as a human's — the UI was the only writer then", () => {
  const root = project();
  ratifyThreadSkill(root, EP);
  const p = threadSkillPath(root, EP);
  writeFileSync(p, readFileSync(p, "utf-8").replace(/^ratifiedBy: .*\n/m, ""));
  const read = getThreadSkill(root, EP, HASH);
  assert.equal(read.status, "ratified");
  assert.deepEqual(read.ratifiedBy, { kind: "human" });
  assert.equal(modelRatifiedCaveat(read.ratifiedBy), null);
  rmSync(root, { recursive: true, force: true });
});

test("a mangled ratifier fails toward SAYING SO, never toward looking human", () => {
  const root = project();
  ratifyThreadSkill(root, EP, DELEGATED);
  const p = threadSkillPath(root, EP);
  for (const broken of ['ratifiedBy: {"kind":"model"}', "ratifiedBy: not json at all", 'ratifiedBy: {"kind":"human","sneaky":1}']) {
    writeFileSync(p, readFileSync(p, "utf-8").replace(/^ratifiedBy: .*$/m, broken));
    const read = getThreadSkill(root, EP, HASH);
    // The last one IS a valid human record (extra keys ignored); the other
    // two are unreadable and must degrade to a model's, with a caveat.
    if (broken.includes('"kind":"human"')) {
      assert.deepEqual(read.ratifiedBy, { kind: "human" }, broken);
    } else {
      assert.equal(read.ratifiedBy.kind, "model", broken);
      assert.match(injectableSkillText(read), /ratified by a MODEL/, broken);
    }
  }
  rmSync(root, { recursive: true, force: true });
});

test("a draft carries no ratifier at all, and still never injects", () => {
  const root = project();
  const read = getThreadSkill(root, EP, HASH);
  assert.equal(read.status, "draft");
  assert.equal(read.ratifiedBy, undefined);
  assert.equal(injectableSkillText(read), null);
  rmSync(root, { recursive: true, force: true });
});
