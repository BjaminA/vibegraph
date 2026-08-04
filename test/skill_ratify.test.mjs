/**
 * M-SKILL.3 — thread-skill lifecycle over the WS wire.
 *
 * Pins the ratification gate's server half: get-thread-skills lists every
 * entry point's state; ratify-thread-skill flips a DRAFT on disk (hash and
 * body untouched); re-ratifying and unknown entry points are boundary errors,
 * never silent no-ops. Redraft's generation path needs claude and is covered
 * by its unit-tested delegate (runGenerateThreadSkill) + the e2e stub run —
 * here we pin only its boundary validation.
 *
 * Boot: node --test test/skill_ratify.test.mjs   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4317;
const EP = "db.py:query";

let serverProc = null, tmpDir = null, ws = null;
const pending = new Map();

function onMessage(raw) {
  const msg = JSON.parse(raw.toString());
  const q = pending.get(msg.type);
  if (q?.length) q.shift()(msg.payload);
}
function waitFor(type, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const q = pending.get(type) ?? [];
    pending.set(type, q);
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
    q.push((p) => { clearTimeout(t); resolve(p); });
  });
}
const send = (type, payload) => ws.send(JSON.stringify({ type, payload }));

function skillFile() {
  return path.join(tmpDir, ".vibegraph", "thread-skills", "db.py_query".replace(/[^A-Za-z0-9._-]/g, "_") + ".md");
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-skill-ratify-"));
  for (const f of ["app.py", "cli.py", "db.py", "models.py", "test_flow.py"]) {
    fs.copyFileSync(path.join(ROOT, "test", "fixtures", "threads", "flask_demo", f), path.join(tmpDir, f));
  }
  // Seed a DRAFT skill (hash deliberately not the live one — ratify must
  // not care; it flips status only).
  fs.mkdirSync(path.dirname(skillFile()), { recursive: true });
  fs.writeFileSync(skillFile(), `---\nkey: thread:${EP}\nentryPointId: ${EP}\nstatus: draft\nsourceHash: sha256:SEEDED\ngeneratedAt: t0\n---\n\n## Purpose\nSeeded draft body.\n`);

  serverProc = spawn("node", [path.join(ROOT, "dist", "server.js"), tmpDir], {
    env: { ...process.env, PORT: String(PORT), PYTHONPATH: path.join(ROOT, ".pydeps") },
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    serverProc.stdout.on("data", (d) => { if (d.toString().includes("VibeGraph is running!")) resolve(); });
    serverProc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error("server boot timeout")), 20_000);
  });
  ws = new WebSocket(`ws://localhost:${PORT}`);
  ws.on("message", onMessage);
  await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });
  await waitFor("project-update");
});

after(() => {
  ws?.close();
  serverProc?.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("1. get-thread-skills lists every entry point; the seeded draft reads draft", async () => {
  send("get-thread-skills", {});
  const { skills } = await waitFor("thread-skills");
  assert.ok(skills.length > 1, "one record per entry point");
  const mine = skills.find((s) => s.entryPointId === EP);
  assert.equal(mine.exists, true);
  assert.equal(mine.status, "draft");
  assert.match(mine.body, /Seeded draft body/);
  const other = skills.find((s) => s.entryPointId !== EP);
  assert.equal(other.exists, false, "ungenerated threads read exists:false");
});

test("2. ratify flips the DISK file to ratified; body and hash untouched", async () => {
  send("ratify-thread-skill", { entryPointId: EP });
  const r = await waitFor("thread-skill-status");
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.equal(r.status, "ratified");
  const onDisk = fs.readFileSync(skillFile(), "utf-8");
  assert.match(onDisk, /^status: ratified$/m);
  assert.match(onDisk, /^sourceHash: sha256:SEEDED$/m, "hash must not be re-stamped");
  assert.match(onDisk, /Seeded draft body/, "body must not change");
});

test("3. re-ratifying is a validation error, not a silent no-op", async () => {
  send("ratify-thread-skill", { entryPointId: EP });
  const r = await waitFor("thread-skill-status");
  assert.match(r.error ?? "", /already ratified/);
});

test("4. unknown entry point and malformed payload are boundary errors", async () => {
  send("ratify-thread-skill", { entryPointId: "no/such:entry" });
  const r1 = await waitFor("thread-skill-status");
  assert.match(r1.error ?? "", /unknown entry point/);

  send("ratify-thread-skill", {});
  const r2 = await waitFor("thread-skill-status");
  assert.match(r2.error ?? "", /non-empty string/);

  send("ratify-thread-skill", { entryPointId: "app.py:create_user_route" });
  const r3 = await waitFor("thread-skill-status");
  assert.match(r3.error ?? "", /no skill exists/, "ratifying nothing is refused");
});

test("5. redraft boundary: unknown entry point refused without spawning anything", async () => {
  send("redraft-thread-skill", { entryPointId: "no/such:entry" });
  const r = await waitFor("thread-skill-status");
  assert.match(r.error ?? "", /unknown entry point/);
});

// ── M-SKILL.7 — re-affirm + diff + auto-reaffirm over the wire ──

test("6. diff: pre-snapshot skill reads unavailable, never a fake diff", async () => {
  send("get-thread-skill-diff", { entryPointId: EP });
  const r = await waitFor("thread-skill-diff");
  assert.equal(r.entryPointId, EP);
  assert.equal(r.unavailable, true, JSON.stringify(r)); // seeded file has no snapshot line
});

test("7. re-affirm: stale ratified re-stamps the DISK hash; fresh/draft/unknown refuse", async () => {
  // The seeded skill is ratified with hash sha256:SEEDED ≠ live hash → stale.
  send("reaffirm-thread-skill", { entryPointId: EP });
  const r = await waitFor("thread-skill-status");
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.equal(r.stale, false, "re-affirmed skill reads fresh");
  const onDisk = fs.readFileSync(skillFile(), "utf-8");
  assert.doesNotMatch(onDisk, /sha256:SEEDED/, "hash re-stamped");
  assert.match(onDisk, /^snapshot: \[/m, "snapshot stamped by re-affirm");
  assert.match(onDisk, /Seeded draft body/, "body untouched");

  send("reaffirm-thread-skill", { entryPointId: EP });
  assert.match((await waitFor("thread-skill-status")).error ?? "", /already fresh/);
  send("reaffirm-thread-skill", { entryPointId: "no/such:entry" });
  assert.match((await waitFor("thread-skill-status")).error ?? "", /unknown entry point/);
});

test("8. diff after re-affirm: snapshot exists and the thread is unchanged → empty diff", async () => {
  send("get-thread-skill-diff", { entryPointId: EP });
  const r = await waitFor("thread-skill-diff");
  assert.ok(r.diff, JSON.stringify(r));
  assert.deepEqual(r.diff, { added: [], removed: [], relabeled: [] });
});

test("9. auto-reaffirm toggle round-trips; boolean + ratified-only validated at the boundary", async () => {
  send("set-skill-auto-reaffirm", { entryPointId: EP, value: true });
  const on = await waitFor("thread-skill-status");
  assert.equal(on.autoReaffirm, true, JSON.stringify(on));
  assert.match(fs.readFileSync(skillFile(), "utf-8"), /^autoReaffirm: true$/m);
  send("set-skill-auto-reaffirm", { entryPointId: EP, value: false });
  assert.equal((await waitFor("thread-skill-status")).autoReaffirm, false);

  send("set-skill-auto-reaffirm", { entryPointId: EP, value: "yes" });
  assert.match((await waitFor("thread-skill-status")).error ?? "", /boolean/);
  send("set-skill-auto-reaffirm", { entryPointId: "app.py:create_user_route", value: true });
  assert.match((await waitFor("thread-skill-status")).error ?? "", /ratified skills only/);
});
