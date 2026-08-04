/**
 * M-RUN2.3 — example data files, end-to-end over the real WS wire.
 *
 * Boots dist/server.js on a throwaway copy of the reader fixture (a thread
 * that reads data/signals.csv, which does not exist) and drives the exact
 * webview protocol:
 *
 *   1. run-thread-to-node → requires-confirmation, and the refusal CARRIES
 *      the missing-data detection ("data/signals.csv doesn't exist").
 *   2. synth-thread-data → thread-data-proposal with the FULL drafted
 *      content (VG_CLAUDE_BIN stub) + a content-hash-bound consent token.
 *   3. run with synthData + effectConsent → ok, the value comes from the
 *      example file, sandboxed:true — and the REAL tree never gets the csv.
 *   4. Tampered content → the data consent refuses (never injected).
 *
 * Boot: npm run test:run-data   (needs dist/ built)
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
const PORT = 4313;
const CSV = "label,value\n0,7\n1,9";

let serverProc = null;
let tmpDir = null;
let ws = null;
const pending = new Map(); // type -> resolver queue

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

const RUN = {
  nodeId: "module/load_rows.fn/count.assign",
  irTargetId: "module/load_rows.fn/count.assign",
  filePath: "reader.py",
  entryFn: "load_rows",
  exprN: "count",
};

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-run-data-test-"));
  fs.copyFileSync(
    path.join(ROOT, "test", "fixtures", "threads", "instance_demo", "reader.py"),
    path.join(tmpDir, "reader.py"),
  );
  // Sitting-3 — a real sibling in the missing file's directory: its header
  // must reach the drafting prompt as schema evidence (test 5).
  fs.mkdirSync(path.join(tmpDir, "data"));
  fs.writeFileSync(path.join(tmpDir, "data", "readings.csv"), "sensor_a,sensor_b,label\n0.1,0.2,0\n0.3,0.4,1\n");
  serverProc = spawn("node", [path.join(ROOT, "dist", "server.js"), tmpDir], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PYTHONPATH: path.join(ROOT, ".pydeps"),
      VG_CLAUDE_BIN: `node ${path.join(ROOT, "test", "fixtures", "run_effects", "fake_claude_json.mjs")}`,
      FAKE_SYNTH_RESPONSE: CSV,
      FAKE_PROMPT_CAPTURE: path.join(tmpDir, "prompt-capture.txt"),
    },
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    serverProc.stdout.on("data", (d) => { if (d.toString().includes("VibeGraph is running!")) resolve(); });
    serverProc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error("server boot timeout")), 20_000);
  });
  ws = new WebSocket(`ws://localhost:${PORT}`);
  ws.on("message", onMessage);
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  // Wait for the parse to prime (first project-update).
  await waitFor("project-update");
});

after(() => {
  ws?.close();
  serverProc?.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

let effectToken = null;
let proposal = null;

test("1. the refused gate detects the missing data file", async () => {
  send("run-thread-to-node", RUN);
  const r = await waitFor("thread-run-result");
  assert.equal(r.outcome, "requires-confirmation", JSON.stringify(r));
  assert.ok((r.effects ?? []).some((e) => e.effectKind === "fs"), "the open() fs effect is listed");
  assert.deepEqual(
    (r.missingData ?? []).map((m) => m.path),
    ["data/signals.csv"],
    `missing-data detection rides the refusal: ${JSON.stringify(r.missingData)}`,
  );
  effectToken = r.effectConsentToken;
  assert.ok(effectToken, "an effect-consent token is minted");
});

test("2. the drafted example file arrives in full with a content-bound token", async () => {
  send("synth-thread-data", { nodeId: RUN.nodeId, irTargetId: RUN.irTargetId, filePath: RUN.filePath, path: "data/signals.csv" });
  proposal = await waitFor("thread-data-proposal");
  assert.equal(proposal.ok, true, JSON.stringify(proposal));
  assert.equal(proposal.path, "data/signals.csv");
  assert.equal(proposal.content, CSV + "\n", "the FULL content is what the user consents to");
  assert.ok(proposal.dataConsentToken, "content-hash-bound token minted");
});

test("3. consented run uses the example file in a sandbox; the real tree never sees it", async () => {
  send("run-thread-to-node", {
    ...RUN,
    effectConsent: effectToken,
    synthData: { path: proposal.path, content: proposal.content, consent: proposal.dataConsentToken },
  });
  const r = await waitFor("thread-run-result");
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.equal(r.value, "3", "count = the example file's 3 lines");
  assert.equal(r.provenance, "synthesized-input");
  assert.equal(r.sandboxed, true);
  assert.match(r.synthData ?? "", /data\/signals\.csv \(3 lines\)/);
  assert.equal(fs.existsSync(path.join(tmpDir, "data", "signals.csv")), false,
    "the example file leaked into the real project tree");
});

test("4. tampered content invalidates the data consent — never injected", async () => {
  send("run-thread-to-node", {
    ...RUN,
    effectConsent: effectToken,
    synthData: { path: proposal.path, content: proposal.content + "9,999\n", consent: proposal.dataConsentToken },
  });
  const r = await waitFor("thread-run-result");
  assert.equal(r.outcome, "requires-confirmation", JSON.stringify(r));
  assert.match(r.error ?? "", /example-file consent/);
});

test("5. the drafting prompt carried sibling + helper schema evidence (sitting-3)", () => {
  // Captured by the stub when test 2's draft ran. The reader (load_rows)
  // calls count_rows — a project helper — and data/readings.csv sits next to
  // the missing data/signals.csv: both must have reached the prompt.
  const prompt = fs.readFileSync(path.join(tmpDir, "prompt-capture.txt"), "utf-8");
  assert.match(prompt, /def load_rows/, "the reader source is still the core");
  assert.match(prompt, /def count_rows/, "one-hop project helper source included");
  assert.match(prompt, /data\/readings\.csv/, "sibling file named");
  assert.match(prompt, /sensor_a,sensor_b,label/, "sibling header lines included verbatim");
  assert.match(prompt, /REPLICATE its schema exactly/, "the schema rule rides with the evidence");
});
