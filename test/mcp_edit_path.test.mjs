/**
 * M10R — MCP edit-path integration test.
 *
 * Post chat-removal, `claude mcp add vibegraph` is the only
 * conversational path, so the MCP rewrite loop IS the product's edit
 * story for external Claude sessions. This test boots dist/server.js on
 * a throwaway copy of the flask_demo fixture (directory mode) and
 * speaks streamable-HTTP MCP over the real wire — the exact path any
 * Claude Code session takes.
 *
 * Pinned regressions (all found live driving the user's running GUI):
 *   1. rewrite_node with the documented payload `{ source }` used to
 *      SILENTLY DELETE the target (newSource undefined → empty stdin →
 *      zero statements → in-span deletion → success reported).
 *   2. Empty source must be a structured rejection, not an edit.
 *   3. filePath may be project-relative (the keys list_files returns);
 *      rewrite/compose used to ENOENT on them while read tools accepted
 *      them.
 *
 * Boot: node --test test/mcp_edit_path.test.mjs   (needs dist/ built)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4311;
const MCP = `http://localhost:${PORT}/mcp`;

let serverProc = null;
let tmpDir = null;
let sessionId = null;
let nextId = 1;

function sseJson(text) {
  // Streamable-HTTP frames JSON-RPC replies as SSE `data:` lines.
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

const dbPath = () => path.join(tmpDir, "db.py");
const QUERY_ORIG = `def query(sql, params=()):
    conn = _get_conn()
    try:
        cursor = conn.execute(sql, params)
        return cursor.fetchall()
    finally:
        conn.close()
`;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-mcp-test-"));
  for (const f of ["app.py", "cli.py", "db.py", "models.py", "test_flow.py"]) {
    fs.copyFileSync(
      path.join(ROOT, "test", "fixtures", "threads", "flask_demo", f),
      path.join(tmpDir, f),
    );
  }
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
    const onData = (d) => {
      if (d.toString().includes("VibeGraph is running!")) resolve();
    };
    serverProc.stdout.on("data", onData);
    serverProc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
    setTimeout(() => reject(new Error("server boot timeout")), 20_000);
  });

  const init = await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "mcp-edit-path-test", version: "0.0.1" },
  });
  assert.equal(init.result.serverInfo.name, "vibegraph");
  await fetch(MCP, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  // The boot-time parse is eager but async ("VibeGraph is running!" beats
  // it); poll until the project IR is primed so tests see real files.
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

test("list_files returns project-relative keys", async () => {
  const { text } = await callTool("vibegraph_list_files", {});
  assert.deepEqual(JSON.parse(text).sort(), ["app.py", "cli.py", "db.py", "models.py", "test_flow.py"]);
});

test("extract_thread: compact projection (default) and expandNests both return a valid thread", async () => {
  // M-NEST L3 wiring smoke: flask_demo has no extracted nests, so the projection
  // is a no-op here — but this guards that the new args are accepted and the
  // common non-nested path passes through cleanly (full ⊇ compact, same seed).
  const def = await callTool("vibegraph_extract_thread", { seedNodeId: "module/insert.fn", filePath: "db.py" });
  const full = await callTool("vibegraph_extract_thread", { seedNodeId: "module/insert.fn", filePath: "db.py", expandNests: true });
  assert.equal(def.isError, false, def.text);
  assert.equal(full.isError, false, full.text);
  const dThread = JSON.parse(def.text);
  const fThread = JSON.parse(full.text);
  assert.equal(dThread.seed.irNodeId, "module/insert.fn");
  // Full is never smaller than the compact projection.
  assert.ok(fThread.nodes.length >= dThread.nodes.length, "expandNests must not drop nodes");
});

test("rewrite_node accepts the documented { source } payload and a RELATIVE filePath", async () => {
  const withDocstring = QUERY_ORIG.replace(
    "def query(sql, params=()):\n",
    'def query(sql, params=()):\n    """Run a read-only SQL statement."""\n',
  );
  const { text, isError } = await callTool("vibegraph_rewrite_node", {
    nodeId: "module/query.fn",
    op: "replace_node",
    filePath: "db.py",
    payload: { source: withDocstring },
  });
  assert.equal(isError, false, text);
  const onDisk = fs.readFileSync(dbPath(), "utf-8");
  assert.ok(onDisk.includes('"""Run a read-only SQL statement."""'), "docstring not written");
  assert.ok(onDisk.includes("def insert(sql, params):"), "neighbour function lost");
});

test("rewrite_node still accepts the legacy { newSource } key", async () => {
  const { isError, text } = await callTool("vibegraph_rewrite_node", {
    nodeId: "module/query.fn",
    op: "replace_node",
    filePath: "db.py",
    payload: { newSource: QUERY_ORIG },
  });
  assert.equal(isError, false, text);
  const onDisk = fs.readFileSync(dbPath(), "utf-8");
  assert.ok(!onDisk.includes('"""Run a read-only SQL statement."""'), "revert did not apply");
});

test("rewrite_node with EMPTY source is rejected and the node survives", async () => {
  const beforeEdit = fs.readFileSync(dbPath(), "utf-8");
  const { isError, text } = await callTool("vibegraph_rewrite_node", {
    nodeId: "module/query.fn",
    op: "replace_node",
    filePath: "db.py",
    payload: { source: "   \n" },
  });
  assert.equal(isError, true, "empty source must be a structured rejection");
  assert.match(text, /non-empty/);
  assert.equal(fs.readFileSync(dbPath(), "utf-8"), beforeEdit, "file must be untouched");
});

test("rewrite_node with NO source key is rejected (the old silent-delete shape)", async () => {
  const beforeEdit = fs.readFileSync(dbPath(), "utf-8");
  const { isError } = await callTool("vibegraph_rewrite_node", {
    nodeId: "module/query.fn",
    op: "replace_node",
    filePath: "db.py",
    payload: {},
  });
  assert.equal(isError, true, "missing source must be rejected, never a delete");
  assert.equal(fs.readFileSync(dbPath(), "utf-8"), beforeEdit, "file must be untouched");
  assert.ok(fs.readFileSync(dbPath(), "utf-8").includes("def query"), "query must survive");
});

test("M26.1: threads are fresh seconds after MCP edits — no watcher wait", async () => {
  // The fs-watcher now SKIPS self-edits (noteSelfEdit, 2s window), so a
  // project-update whose threads include the new function can only come
  // from the incremental refreshDerived() pipeline — pre-M26.1 the
  // immediate broadcast shipped STALE latestThreads and fresh threads
  // waited on the watcher's full parseAllFiles. Best case the two edits
  // coalesce into one debounce window (~300ms observed); worst case the
  // second edit lands while the first edit's refresh is already running
  // and the queued follow-up runs a second full incremental pipeline
  // (~4-5s). The bound below covers the worst case; the discriminator is
  // arrival at all — with refreshDerived broken, the suppressed watcher
  // means fresh threads NEVER arrive.
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const envelopes = [];
  let notify = null;
  let refreshesInFlight = 0;
  let lastActivity = Date.now();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    lastActivity = Date.now();
    if (msg.type === "graph-refresh") {
      refreshesInFlight = Math.max(0, refreshesInFlight + (msg.payload.state === "started" ? 1 : -1));
    }
    if (msg.type === "project-update") {
      envelopes.push(msg.payload);
      if (process.env.VG_MCP_DEBUG) {
        const t = (msg.payload.threads ?? []).find((t) => t.seed?.qualifiedName === "db:query");
        process.stderr.write(`[debug] envelope: threads=${(msg.payload.threads ?? []).length} db:query=${!!t} vg_audit-in-db:query=${t ? JSON.stringify(t).includes("vg_audit") : "n/a"} vg_audit-in-files=${JSON.stringify(msg.payload.files?.["db.py"] ?? {}).includes("vg_audit")}\n`);
      }
      notify?.();
    }
  });
  const waitForEnvelope = (pred, timeoutMs, label) =>
    new Promise((resolve, reject) => {
      const check = () => {
        const hit = envelopes.find(pred);
        if (hit) resolve(hit);
        return !!hit;
      };
      if (check()) return;
      const timer = setTimeout(() => {
        notify = null;
        reject(new Error(`timed out waiting for ${label}`));
      }, timeoutMs);
      notify = () => {
        if (check()) {
          clearTimeout(timer);
          notify = null;
        }
      };
    });

  try {
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", () => reject(new Error("ws connect failed")));
    });
    // Connection triggers a full sendParse, and refreshes scheduled by
    // EARLIER tests' edits may still be in flight. Wait for genuine
    // quiescence — at least one envelope, no refresh running, ~750ms of
    // wire silence — so the timed window below measures only OUR edits.
    {
      const deadline = Date.now() + 30_000;
      for (;;) {
        if (envelopes.length > 0 && refreshesInFlight === 0 && Date.now() - lastActivity > 750) break;
        if (Date.now() > deadline) throw new Error("server never went quiescent after WS connect");
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    envelopes.length = 0;

    // A realistic chat turn: define a helper, then make a thread-reachable
    // function (query — app routes hit it via models.py) call it. Both
    // edits land inside one 250ms debounce window and must coalesce.
    const ins = await callTool("vibegraph_compose_insert", {
      mode: "before",
      anchorNodeId: "module/insert.fn",
      filePath: "db.py",
      source: "def vg_audit(sql):\n    return len(sql)\n",
    });
    assert.equal(ins.isError, false, ins.text);
    const rw = await callTool("vibegraph_rewrite_node", {
      nodeId: "module/query.fn",
      op: "replace_node",
      filePath: "db.py",
      payload: {
        source: QUERY_ORIG.replace(
          "    conn = _get_conn()\n",
          "    vg_audit(sql)\n    conn = _get_conn()\n",
        ),
      },
    });
    assert.equal(rw.isError, false, rw.text);

    // vg_audit must show up inside the db:query THREAD — not merely get a
    // thread of its own from the insert — proving link + extraction reran
    // after the SECOND edit.
    const t0 = Date.now();
    const fresh = await waitForEnvelope(
      (env) =>
        (env.threads ?? []).some(
          (t) =>
            t.seed?.qualifiedName === "db:query" && JSON.stringify(t).includes("vg_audit"),
        ),
      Number(process.env.VG_FRESH_TIMEOUT ?? 6_000),
      "a project-update whose db:query thread reaches vg_audit (refreshDerived)",
    );
    if (process.env.VG_MCP_DEBUG) {
      process.stderr.write(`[debug] fresh threads after ${Date.now() - t0}ms\n`);
    }
    assert.ok(
      JSON.stringify(fresh.files?.["db.py"] ?? {}).includes("vg_audit"),
      "fresh envelope must also carry the new node's file IR",
    );
  } finally {
    ws.close();
    // Restore the fixture for any later test: revert query, drop the helper.
    const revert = await callTool("vibegraph_rewrite_node", {
      nodeId: "module/query.fn",
      op: "replace_node",
      filePath: "db.py",
      payload: { source: QUERY_ORIG },
    });
    assert.equal(revert.isError, false, revert.text);
    const del = await callTool("vibegraph_rewrite_node", {
      nodeId: "module/vg_audit.fn",
      op: "delete_node",
      filePath: "db.py",
      payload: {},
    });
    assert.equal(del.isError, false, del.text);
  }
});

test("compose_insert round-trip with a relative filePath", async () => {
  // mode='before' an existing anchor (not top-level append): deleting a
  // file's LAST node legitimately trips diff confinement — its trailing
  // blank lines fold out of span — so the round-trip uses a mid-file
  // position, the representative case.
  const ins = await callTool("vibegraph_compose_insert", {
    mode: "before",
    anchorNodeId: "module/insert.fn",
    filePath: "db.py",
    source: "def vg_mcp_probe():\n    return 42\n",
  });
  assert.equal(ins.isError, false, ins.text);
  assert.ok(fs.readFileSync(dbPath(), "utf-8").includes("def vg_mcp_probe"), "insert not written");
  const del = await callTool("vibegraph_rewrite_node", {
    nodeId: "module/vg_mcp_probe.fn",
    op: "delete_node",
    filePath: "db.py",
    payload: {},
  });
  assert.equal(del.isError, false, del.text);
  assert.ok(!fs.readFileSync(dbPath(), "utf-8").includes("vg_mcp_probe"), "explicit delete failed");
});
