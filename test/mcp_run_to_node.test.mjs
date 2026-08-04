/**
 * B1 (PLAN-v6) — run-to-node as an MCP tool.
 *
 * Exposes the ephemeral run engine (runThreadToNodeCore) as
 * vibegraph_run_thread_to_node. Boots dist/server.js on a throwaway copy of
 * the run_demo fixture (directory mode) and drives the real streamable-HTTP
 * MCP wire — the exact path any Claude Code / chat session takes.
 *
 * What it pins (the reasons B1 beats the rewrite_node + run_block loop):
 *   1. Server DERIVES entryFn/exprN from the node id (don't-trust-client) —
 *      the tool takes only the value-of-interest assignment node.
 *   2. Honest-outcome taxonomy + provenance survive in the MCP envelope
 *      (ok / needs-inputs / value-ambiguous / unsupported-target /
 *      requires-confirmation), not stdout-scraping.
 *   3. The SM3 effect floor gates the agent surface too: an effectful path
 *      returns requires-confirmation + effects + a consent token; re-calling
 *      with the token runs; a STALE/garbage token re-refuses with a fresh
 *      token (the reboot-honesty case) — never a silent run.
 *   4. The real file is never written (ephemeral probe) — asserted byte-identical.
 *
 * Boot: node --test test/mcp_run_to_node.test.mjs   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4312;
const MCP = `http://localhost:${PORT}/mcp`;

let serverProc = null;
let tmpDir = null;
let sessionId = null;
let nextId = 1;

function sseJson(text) {
  const lines = text.split("\n").filter((l) => l.startsWith("data: "));
  assert.ok(lines.length > 0, `no SSE data frame in response: ${text.slice(0, 200)}`);
  return JSON.parse(lines[lines.length - 1].slice("data: ".length));
}

async function rpc(method, params) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  if (!sessionId) sessionId = res.headers.get("mcp-session-id");
  return sseJson(await res.text());
}

async function callTool(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  assert.ok(r.result, `tools/call ${name} returned no result: ${JSON.stringify(r)}`);
  return { text: r.result.content?.[0]?.text ?? "", isError: !!r.result.isError };
}

// The envelope is returned as a JSON text block — parse it back.
async function runToNode(args) {
  const { text } = await callTool("vibegraph_run_thread_to_node", args);
  return JSON.parse(text);
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-run-mcp-test-"));
  for (const f of ["calc.py", "effects.py", "broken.py"]) {
    fs.copyFileSync(
      path.join(ROOT, "test", "fixtures", "threads", "run_demo", f),
      path.join(tmpDir, f),
    );
  }
  // M-RUN2.1 — method targets run on a synthesized example instance.
  fs.copyFileSync(
    path.join(ROOT, "test", "fixtures", "threads", "instance_demo", "gauge.py"),
    path.join(tmpDir, "gauge.py"),
  );
  serverProc = spawn("node", [path.join(ROOT, "dist", "server.js"), tmpDir], {
    env: { ...process.env, PORT: String(PORT), PYTHONPATH: path.join(ROOT, ".pydeps") },
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (process.env.VG_MCP_DEBUG) {
    serverProc.stdout.on("data", (d) => process.stderr.write(`[srv] ${d}`));
    serverProc.stderr.on("data", (d) => process.stderr.write(`[srv!] ${d}`));
  }
  await new Promise((resolve, reject) => {
    serverProc.stdout.on("data", (d) => { if (d.toString().includes("VibeGraph is running!")) resolve(); });
    serverProc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error("server boot timeout")), 20_000);
  });

  const init = await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "mcp-run-to-node-test", version: "0.0.1" },
  });
  assert.equal(init.result.serverInfo.name, "vibegraph");
  await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  const deadline = Date.now() + 20_000;
  for (;;) {
    const { text } = await callTool("vibegraph_list_files", {});
    if (JSON.parse(text).length > 0) break;
    if (Date.now() > deadline) throw new Error("project parse never primed");
    await new Promise((r) => setTimeout(r, 250));
  }
});

after(() => {
  serverProc?.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("the tool is registered", async () => {
  const r = await rpc("tools/list", {});
  const names = (r.result.tools ?? []).map((t) => t.name);
  assert.ok(names.includes("vibegraph_run_thread_to_node"), `tool missing: ${names.join(", ")}`);
});

test("ok: pure no-arg path captures the real value (server-derived entryFn/exprN)", async () => {
  const before = fs.readFileSync(path.join(tmpDir, "calc.py"), "utf-8");
  const r = await runToNode({ nodeId: "module/happy.fn/result.assign", filePath: "calc.py" });
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.equal(r.value, "400", "happy() captures result = double(20) = 400");
  assert.equal(r.provenance, "real-input");
  assert.equal(r.nodeId, "module/happy.fn/result.assign", "envelope echoes the routing node id");
  // Ephemeral: the real file is untouched.
  assert.equal(fs.readFileSync(path.join(tmpDir, "calc.py"), "utf-8"), before, "run must not write the file");
});

test("needs-inputs: an arg-needing entry with no synthArgs declines honestly (no run)", async () => {
  const r = await runToNode({ nodeId: "module/scaled.fn/out.assign", filePath: "calc.py" });
  assert.equal(r.outcome, "needs-inputs", JSON.stringify(r));
  assert.equal(r.value, null);
});

test("synth round-trip: synthArgs run the path under a labelled premise", async () => {
  const r = await runToNode({ nodeId: "module/scaled.fn/out.assign", filePath: "calc.py", synthArgs: { n: "5" } });
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.equal(r.value, "25", "scaled(5) -> out = double(5) = 25");
  assert.equal(r.provenance, "synthesized-input");
  assert.match(r.synthArgs ?? "", /n=5/, "the validated call string travels with the value");
});

test("value-ambiguous: a valueless target declines (no plain-identifier value)", async () => {
  // Sitting-2 — return@0 no longer qualifies as the "ambiguous" example: a
  // return IS a value (capture_probe grabs it; see the method-return test).
  // An if-statement genuinely produces nothing.
  const r = await runToNode({ nodeId: "module/not_reached.fn/if@0", filePath: "calc.py" });
  assert.equal(r.outcome, "value-ambiguous", JSON.stringify(r));
});

test("Sitting-2 — a plain-function RETURN target captures the real returned value (MCP path)", async () => {
  const r = await runToNode({ nodeId: "module/happy.fn/return@0", filePath: "calc.py" });
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.equal(r.value, "400");
  assert.equal(r.provenance, "real-input");
});

test("unsupported-target: an unknown node id declines, never runs", async () => {
  const r = await runToNode({ nodeId: "module/nope.fn/x.assign", filePath: "calc.py" });
  assert.equal(r.outcome, "unsupported-target", JSON.stringify(r));
});

test("requires-confirmation: the SM3 floor refuses an effectful path and hands back a consent token", async () => {
  const r = await runToNode({ nodeId: "module/touched.fn/size.assign", filePath: "effects.py" });
  assert.equal(r.outcome, "requires-confirmation", JSON.stringify(r));
  assert.ok(Array.isArray(r.effects) && r.effects.length > 0, "must list the detected effect(s)");
  assert.ok(r.effects.some((e) => e.effectKind === "fs"), "the hidden fs effect (os.path.getsize) is reported");
  assert.ok(typeof r.effectConsentToken === "string" && r.effectConsentToken.length > 0, "a scope-bound token is minted");
});

test("consent round-trip: re-calling with the token authorises the run", async () => {
  const refused = await runToNode({ nodeId: "module/touched.fn/size.assign", filePath: "effects.py" });
  assert.equal(refused.outcome, "requires-confirmation");
  const ran = await runToNode({
    nodeId: "module/touched.fn/size.assign",
    filePath: "effects.py",
    effectConsent: refused.effectConsentToken,
  });
  // Valid consent must let it EXECUTE — the discriminator is that it is no
  // longer gated. (The program's own outcome may be ok or runtime-error
  // depending on the host fs; either proves the floor let it run.)
  assert.notEqual(ran.outcome, "requires-confirmation", `valid consent must run: ${JSON.stringify(ran)}`);
  assert.ok(["ok", "runtime-error"].includes(ran.outcome), JSON.stringify(ran));
});

test("stale/tampered token is rejected with a fresh token — never a silent run (reboot honesty)", async () => {
  const r = await runToNode({
    nodeId: "module/touched.fn/size.assign",
    filePath: "effects.py",
    effectConsent: "not-a-real-token",
  });
  assert.equal(r.outcome, "requires-confirmation", "a bogus token must re-refuse, not run");
  assert.ok(typeof r.effectConsentToken === "string" && r.effectConsentToken.length > 0, "a fresh token is handed back");
});

// ── M-RUN2.1 — method targets run on a synthesized example instance ────────

test("method without synthInstanceArgs → honest needs-inputs naming the constructor", async () => {
  const r = await runToNode({
    nodeId: "module/Gauge.class/reading.fn/value.assign",
    filePath: "gauge.py",
    synthArgs: { raw: "5" },
  });
  assert.equal(r.outcome, "needs-inputs", JSON.stringify(r));
  assert.match(r.error ?? "", /synthInstanceArgs/);
});

test("method run: default ctor + literal method args → captured value, instance provenance, file untouched", async () => {
  const before = fs.readFileSync(path.join(tmpDir, "gauge.py"), "utf-8");
  const r = await runToNode({
    nodeId: "module/Gauge.class/reading.fn/value.assign",
    filePath: "gauge.py",
    synthArgs: { raw: "5" },
    synthInstanceArgs: {},
  });
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.equal(r.value, "10"); // raw=5 * default scale=2
  assert.equal(r.provenance, "synthesized-input");
  assert.equal(r.synthInstance, "Gauge()");
  assert.equal(r.sandboxed, true, "a synthetic-instance run must execute in the throwaway copy");
  assert.equal(fs.readFileSync(path.join(tmpDir, "gauge.py"), "utf-8"), before, "real file was modified by the run");
});

test("method run: literal ctor args flow through — Gauge(scale=3), raw=5 → 15", async () => {
  const r = await runToNode({
    nodeId: "module/Gauge.class/reading.fn/value.assign",
    filePath: "gauge.py",
    synthArgs: { raw: "5" },
    synthInstanceArgs: { scale: "3" },
  });
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.equal(r.value, "15");
  assert.equal(r.synthInstance, "Gauge(scale=3)");
});

test("Sitting-2 — a method RETURN target keeps its class: instance scaffold + capture_probe compose", async () => {
  // resolveRunTarget predated M-RUN3 and declined return/call shapes, so a
  // method's return ran as a bare function (NameError) — the live
  // Standardizer.apply drill. The value is real; only the holder is synthetic.
  const r = await runToNode({
    nodeId: "module/Gauge.class/reading.fn/return@0",
    filePath: "gauge.py",
    synthArgs: { raw: "5" },
    synthInstanceArgs: {},
  });
  assert.equal(r.outcome, "ok", JSON.stringify(r));
  assert.equal(r.value, "10"); // raw=5 * default scale=2, captured at the return
  assert.equal(r.synthInstance, "Gauge()");
  assert.equal(r.sandboxed, true);
});

test("non-literal ctor arg is refused at the instance chokepoint — never injected", async () => {
  const r = await runToNode({
    nodeId: "module/Gauge.class/reading.fn/value.assign",
    filePath: "gauge.py",
    synthArgs: { raw: "5" },
    synthInstanceArgs: { scale: "os.environ['X']" },
  });
  assert.equal(r.outcome, "harness-error", JSON.stringify(r));
  assert.match(r.error ?? "", /instance failed validation|non-literal/);
});

test("constructor effects gate the run: Logger.__init__ opens a file → requires-confirmation; consent runs it", async () => {
  const refused = await runToNode({
    nodeId: "module/Logger.class/note.fn/text.assign",
    filePath: "gauge.py",
    synthArgs: { msg: "'hi'" },
    synthInstanceArgs: {},
  });
  assert.equal(refused.outcome, "requires-confirmation", JSON.stringify(refused));
  assert.ok(
    (refused.effects ?? []).some((e) => e.effectKind === "fs"),
    `the CONSTRUCTOR's fs effect must be in the consent list: ${JSON.stringify(refused.effects)}`,
  );
  const ran = await runToNode({
    nodeId: "module/Logger.class/note.fn/text.assign",
    filePath: "gauge.py",
    synthArgs: { msg: "'hi'" },
    synthInstanceArgs: {},
    effectConsent: refused.effectConsentToken,
  });
  assert.notEqual(ran.outcome, "requires-confirmation", `valid consent must run: ${JSON.stringify(ran)}`);
  assert.equal(ran.outcome, "ok", JSON.stringify(ran));
  assert.equal(ran.value, "'hi!'");
  // M-RUN2.2 — the consented ctor effect (open("gauge.log","w")) executed in
  // the SANDBOX copy: the real tree never sees the file. Consent means "run
  // it", never "run it on my real files".
  assert.equal(ran.sandboxed, true);
  assert.equal(fs.existsSync(path.join(tmpDir, "gauge.log")), false,
    "the constructor's file write leaked into the real project tree");
});
