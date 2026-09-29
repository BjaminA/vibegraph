/**
 * The post-edit hook, IN-BAND (2026-09-29, src/server/edit_check.ts): an
 * edit through VibeGraph's own chokepoint — the GUI chat, an external MCP
 * session, a work-run worker — gets the stated rules re-checked in its own
 * tool result, and a violation THIS edit introduced is named there.
 *
 * Boots dist/server.js on a throwaway flask_demo copy that states one rule
 * (only models.py may call db.query) and speaks MCP over the real wire.
 *
 *   npm run test:mcp-edit-check   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { diffEditChecks, formatEditCheck } from "../src/server/edit_check.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4312;
const MCP = `http://localhost:${PORT}/mcp`;
let serverProc = null;
let tmpDir = null;
let sessionId = null;
let nextId = 1;

function sseJson(text) {
  const lines = text.split("\n").filter((l) => l.startsWith("data: "));
  assert.ok(lines.length > 0, `no SSE data frame: ${text.slice(0, 200)}`);
  return JSON.parse(lines[lines.length - 1].slice("data: ".length));
}
async function rpc(method, params) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  if (!sessionId) sessionId = res.headers.get("mcp-session-id");
  return sseJson(await res.text());
}
async function callTool(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  assert.ok(r.result, `tools/call ${name}: ${JSON.stringify(r)}`);
  return { text: r.result.content?.[0]?.text ?? "", isError: !!r.result.isError };
}

const RULE = {
  version: "1",
  constraints: [{
    id: "c1", kind: "invariant", source: "human", createdAt: "2026-09-29T09:00:00.000Z",
    text: "Only the model layer reads the database: every query goes through models.py.",
    scope: { all: true },
    check: { rule: "callers-only", target: "query", files: ["models.py"] },
  }],
};

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-mcp-check-"));
  for (const f of ["app.py", "cli.py", "db.py", "models.py", "test_flow.py"]) {
    fs.copyFileSync(path.join(ROOT, "test", "fixtures", "threads", "flask_demo", f), path.join(tmpDir, f));
  }
  fs.mkdirSync(path.join(tmpDir, ".vibegraph"));
  fs.writeFileSync(path.join(tmpDir, ".vibegraph", "constraints.json"), JSON.stringify(RULE, null, 2));
  serverProc = spawn("node", [path.join(ROOT, "dist", "server.js"), tmpDir], {
    env: { ...process.env, PORT: String(PORT), PYTHONPATH: path.join(ROOT, ".pydeps") },
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
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
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp-edit-check-test", version: "0.0.1" } });
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

test("the diff: new vs inherited vs fixed, and silence when no rule is stated", () => {
  const row = (id, verdict, offenders = []) => ({ id, source: "human", described: `${id} rule`, rule: "callers-only", verdict, reason: `${id} reason`, gates: true, offenders });
  assert.equal(formatEditCheck(diffEditChecks([], [])), null);
  const d = diffEditChecks(
    [row("a", "pass"), row("b", "violated", ["x.py:f"]), row("c", "violated", ["y.py:g"]), row("e", "violated", ["z.py:h"])],
    [row("a", "violated", ["cli.py:q"]), row("b", "violated", ["x.py:f"]), row("c", "violated", ["y.py:g", "w.py:k"]), row("e", "pass")],
  );
  assert.deepEqual(d.fresh.map((f) => [f.row.id, f.added]), [["a", ["cli.py:q"]], ["c", ["w.py:k"]]]);
  assert.equal(d.inherited, 1);
  assert.deepEqual(d.fixed.map((f) => f.id), ["e"]);
  const text = formatEditCheck(d);
  assert.match(text, /2 NEW violations — this edit introduced them/);
  assert.match(text, /- \[a · callers-only · gating: a work-run review would reject this\] a rule: a reason \(new: cli\.py:q\)/);
  assert.match(text, /Also: 1 already violated before this edit \(not introduced by it\); fixed by this edit: e\./);
});

test("an edit that keeps the rule says so in its own result", async () => {
  const r = await callTool("vibegraph_rewrite_node", {
    filePath: "cli.py", nodeId: "module/cmd_create.fn", op: "replace_node",
    payload: { source: 'def cmd_create(name, email):\n    user = create_user(name, email)\n    print(f"created user {user.uid}")\n' },
  });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Constraint check after this edit: 1 stated rule clause re-checked, no new violation\./);
});

test("an edit that breaks the rule is told so, in the same turn", async () => {
  const src = fs.readFileSync(path.join(tmpDir, "cli.py"), "utf-8")
    .replace("from models import list_users, create_user", "from models import list_users, create_user\nfrom db import query")
    .replace('def cmd_list():\n    for u in list_users():', 'def cmd_list():\n    print(query("SELECT count(*) FROM users", ()))\n    for u in list_users():');
  const r = await callTool("vibegraph_rewrite_node", { filePath: "cli.py", nodeId: "module", op: "replace_node", payload: { source: src } });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Constraint check after this edit: 1 NEW violation — this edit introduced it/);
  assert.match(r.text, /\[c1 · callers-only · gating/);
  assert.match(r.text, /cli\.py/);
});
