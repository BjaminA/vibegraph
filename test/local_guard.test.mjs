// Localhost only, and only for this app (2026-09-29, src/server/local_guard.ts).
// Boots dist/server.js on a throwaway copy of a fixture and attacks it the
// way a web page in the same browser could:
//   - a WebSocket from another site's page      → refused (was: accepted)
//   - a DNS-rebinding Host header               → 403
//   - /mcp from another page, or as text/plain  → 403 / 415
//   - a path that climbs out of the bundle      → never served
// …while this app's own page, a non-browser client and MCP keep working.
//
//   npm run test:local-guard   (needs dist/ built)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { hostAllowed, originAllowed, staticPath, jsonContentType } from "../src/server/local_guard.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4313;
let proc = null;
let tmp = null;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vg-guard-"));
  fs.cpSync(path.join(ROOT, "test/fixtures/hooked_run/hooked_demo"), tmp, { recursive: true });
  const env = { ...process.env, PORT: String(PORT), PYTHONPATH: path.join(ROOT, ".pydeps") };
  delete env.VG_HOST;
  proc = spawn("node", [path.join(ROOT, "dist", "server.js"), tmp], { env, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    proc.stdout.on("data", (d) => { if (d.toString().includes("VibeGraph is running!")) resolve(); });
    proc.on("exit", (c) => reject(new Error(`server exited (${c})`)));
    setTimeout(() => reject(new Error("boot timeout")), 20_000);
  });
});
after(() => { proc?.kill(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

const request = (opts, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: "127.0.0.1", port: PORT, ...opts }, (res) => {
    let data = "";
    res.on("data", (c) => { data += c; });
    res.on("end", () => resolve({ status: res.statusCode, body: data }));
  });
  r.on("error", reject);
  if (body) r.write(body);
  r.end();
});
const ws = (headers) => new Promise((resolve) => {
  const s = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers });
  s.on("open", () => { s.close(); resolve("open"); });
  s.on("unexpected-response", (_, res) => resolve(`refused ${res.statusCode}`));
  s.on("error", () => resolve("refused"));
});

test("the rules, unit by unit", () => {
  const cfg = { port: 4200, exposedHost: null };
  assert.equal(hostAllowed("localhost:4200", cfg), true);
  assert.equal(hostAllowed("127.0.0.1:4200", cfg), true);
  assert.equal(hostAllowed("[::1]:4200", cfg), true);
  assert.equal(hostAllowed("evil.example:4200", cfg), false);
  assert.equal(hostAllowed(undefined, cfg), false);
  assert.equal(originAllowed(undefined, "localhost:4200", cfg), true, "no Origin = not a browser page");
  assert.equal(originAllowed("http://localhost:4200", "localhost:4200", cfg), true);
  assert.equal(originAllowed("https://evil.example", "localhost:4200", cfg), false);
  assert.equal(originAllowed("http://localhost:3000", "localhost:4200", cfg), false, "another local app's page");
  assert.equal(originAllowed("null", "localhost:4200", cfg), false);
  assert.equal(staticPath("/app/dist", "/webview.js"), "/app/dist/webview.js");
  assert.equal(staticPath("/app/dist", "/..%2f..%2fetc/passwd"), null);
  assert.equal(jsonContentType("application/json; charset=utf-8"), true);
  assert.equal(jsonContentType("text/plain"), false);
});

test("copies of code and runtime data under .vibegraph/ are git-ignored from inside it, a person's lines kept", async () => {
  const { ensurePrivateIgnore } = await import("../src/server/local_guard.ts");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vg-ign-"));
  fs.mkdirSync(path.join(d, ".vibegraph"));
  fs.writeFileSync(path.join(d, ".vibegraph", ".gitignore"), "mine.txt");
  ensurePrivateIgnore(d);
  ensurePrivateIgnore(d);
  const text = fs.readFileSync(path.join(d, ".vibegraph", ".gitignore"), "utf-8");
  // 2026-10-08: and the run recorder's runs and derived config (trace.json stays committable)
  assert.deepEqual(text.trim().split("\n"), ["mine.txt", "work-snapshots/", "hooked-run.json", "observations.json", "knowledge/", "traces/run-*.jsonl", "trace/"]);
  fs.rmSync(d, { recursive: true, force: true });
});

test("a WebSocket from another site's page is refused; this app's page and a local client connect", async () => {
  assert.match(await ws({ Origin: "https://evil.example" }), /^refused/);
  assert.match(await ws({ Origin: `http://localhost:${PORT + 1}` }), /^refused/);
  assert.equal(await ws({ Origin: `http://localhost:${PORT}` }), "open");
  assert.equal(await ws({}), "open");
  assert.match(await ws({ Host: `rebind.example:${PORT}` }), /^refused/);
});

test("a DNS-rebinding Host is refused; the app's own page is served", async () => {
  assert.equal((await request({ path: "/", headers: { Host: `rebind.example:${PORT}` } })).status, 403);
  const ok = await request({ path: "/", headers: { Host: `localhost:${PORT}` } });
  assert.equal(ok.status, 200);
  assert.match(ok.body, /<title>VibeGraph<\/title>/);
});

test("/mcp: not from another page, and never as a simple text/plain request", async () => {
  const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  const base = { method: "POST", path: "/mcp", headers: { Host: `localhost:${PORT}`, Accept: "application/json, text/event-stream" } };
  assert.equal((await request({ ...base, headers: { ...base.headers, "Content-Type": "text/plain" } }, init)).status, 415);
  assert.equal((await request({ ...base, headers: { ...base.headers, "Content-Type": "application/json", Origin: "https://evil.example" } }, init)).status, 403);
  assert.equal((await request({ ...base, headers: { ...base.headers, "Content-Type": "application/json" } }, init)).status, 200, "a real MCP client still connects");
});

test("a path that climbs out of the bundle is never served", async () => {
  for (const p of ["/../server.ts", "/..%2f..%2fserver.ts", "/%2e%2e/%2e%2e/package.json"]) {
    const r = await request({ path: p, headers: { Host: `localhost:${PORT}` } });
    assert.notEqual(r.status, 200, `${p} → ${r.status}`);
  }
  assert.equal((await request({ path: "/webview.js", headers: { Host: `localhost:${PORT}` } })).status, 200);
});
