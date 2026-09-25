#!/usr/bin/env node
/**
 * M-AGENT3 — a SCRIPTED claude stand-in for worker-session tests
 * (VG_CLAUDE_BIN; automated tests never spawn real claude — M10R.7).
 * Unlike the chat stubs, this one exercises the REAL tool path: it
 * reads the vibegraph MCP URL from its own --mcp-config argv (exactly
 * what a real claude session receives), speaks streamable-HTTP MCP,
 * and lands an edit through vibegraph_rewrite_node — so the server's
 * evidence collection (snapshot diffs, IR delta) sees genuine
 * chokepoint-confined work.
 *
 * Behaviour (env-driven):
 *   FAKE_WORKER_MODE=escalate → no tools; prints an escalate block
 *     with FAKE_ESCALATE_REASON.
 *   default (edit) → if the packet prompt's "Files reached" line names
 *     FAKE_EDIT_FILE, fetch FAKE_EDIT_NODE's source, insert a UNIQUE
 *     marker comment after its first line, rewrite through the
 *     chokepoint, report done; otherwise report a no-op done.
 */

import { appendFileSync } from "node:fs";

const argv = process.argv.slice(2);
const prompt = argv[argv.length - 1] ?? "";
// M-SKILLS.2 — the injection e2e asserts on the PROMPT a worker actually
// received (the chat stub does the same for its turns): append it verbatim
// when asked. Every role's prompt lands, tagged, so a test can tell a
// worker prompt from the brief's.
if (process.env.FAKE_PROMPT_LOG) {
  appendFileSync(process.env.FAKE_PROMPT_LOG, `--- spawn ${process.pid} ---\n${prompt}\n`);
}
const mcpIdx = argv.indexOf("--mcp-config");
const mcpUrl = mcpIdx >= 0
  ? Object.values(JSON.parse(argv[mcpIdx + 1]).mcpServers ?? {})[0]?.url ?? null
  : null;

const MODE = process.env.FAKE_WORKER_MODE ?? "edit";
const FILE = process.env.FAKE_EDIT_FILE ?? "models.py";
const NODE = process.env.FAKE_EDIT_NODE ?? "module/list_users.fn";

// M-ORCH.4 — FAKE_WORKER_DELAY_MS holds EVERY worker exit (edit, no-op, or
// refusal alike) so the parallel e2e can OBSERVE two packets running at
// once on the board; the orchestrator roles (brief / review) never wait.
const WORKER_DELAY_MS = Number(process.env.FAKE_WORKER_DELAY_MS ?? "0");
const isOrchestratorRole = prompt.includes("```vg-orchestration") || prompt.includes("```vg-review-verdict");
function emit(resultText) {
  if (WORKER_DELAY_MS > 0 && !isOrchestratorRole) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, WORKER_DELAY_MS);
  }
  // M-BATCH - model a real session id: a RESUMED run reports back the id it
  // was given, a cold one mints a fresh one. That is what lets a test tell
  // "two packets shared a session" from "two packets each spawned cold".
  const resumeIdx = argv.indexOf("--resume");
  const sessionId = resumeIdx >= 0 && argv[resumeIdx + 1]
    ? argv[resumeIdx + 1]
    : "fake-" + process.pid + "-" + Date.now();
  // FAKE_COST_USD (optional): the real CLI puts `total_cost_usd` in every
  // result envelope, and the server's spend ledger (src/server/spend.ts)
  // reads it from there. Emitting one lets an e2e prove a run's cost is
  // captured without a billed spawn; leaving it unset keeps the stub's
  // default behaviour, which the ledger correctly counts as UNPRICED.
  const cost = process.env.FAKE_COST_USD;
  process.stdout.write(JSON.stringify({
    result: resultText, is_error: false, session_id: sessionId,
    ...(cost === undefined ? {} : { total_cost_usd: Number(cost) }),
  }));
  process.exit(0);
}

function block(outcome, summary, reason) {
  const payload = { outcome, summary, ...(reason ? { reason } : {}) };
  return "```vg-packet-result\n" + JSON.stringify(payload) + "\n```";
}

// M-ORCH — the SAME stub plays the orchestrator's two roles, keyed on the
// prompt it receives (both are text-only spawns through the gen runner,
// so they arrive with an EMPTY mcp config — detect the role before the
// mcp check below):
//   * the BRIEF request (asks for a ```vg-orchestration block): answer
//     with one task + a HANDOFF per packet id named in the prompt, plus
//     one global constraint — so the e2e can prove the brief reached the
//     board, the handoff reached the worker, and the constraint landed
//     in constraints.json with source "orchestrator";
//   * the REVIEW request (asks for a ```vg-review-verdict block): answer
//     FAKE_REVIEW_VERDICT (default approve).
// FLOOR PIN (drill finding 2026-09-06): the brief and review spawns must
// arrive with the raw write tools DENIED (--disallowedTools). A spawn that
// could Write/Edit the project during a review is not a reviewer. The stub
// refuses the role (no fenced block → brief "unavailable" / no verdict),
// which the e2e turns into a loud failure.
const writesDenied = argv.includes("--disallowedTools")
  && /\bEdit\b/.test(argv[argv.indexOf("--disallowedTools") + 1] ?? "")
  && /\bWrite\b/.test(argv[argv.indexOf("--disallowedTools") + 1] ?? "");
if ((prompt.includes("```vg-orchestration") || prompt.includes("```vg-review-verdict")) && !writesDenied) {
  emit("STUB REFUSES: orchestrator spawn arrived without --disallowedTools Edit,Write — a reviewer that can write is not a reviewer.");
}
if (prompt.includes("```vg-orchestration")) {
  const ids = [...prompt.matchAll(/^### packet (p\d+) — (.+?) \(/gm)].map((m) => ({ id: m[1], name: m[2] }));
  // M-ORCH.2 — FAKE_NOCHANGE_PACKET=last marks the last-listed packet
  // "no change needed": the e2e proves no worker spawns for it and the
  // run still ends clean.
  const noChangeId = process.env.FAKE_NOCHANGE_PACKET === "last" && ids.length ? ids[ids.length - 1].id : null;
  // AUTONOMY e2e — FAKE_ESCALATE_PACKET=last marks the last-listed packet's
  // task with ESCALATE-MARKER; the worker that receives it escalates.
  const escalateId = process.env.FAKE_ESCALATE_PACKET === "last" && ids.length ? ids[ids.length - 1].id : null;
  // M-ORCH.4 — FAKE_SCOPE=alternate declares an EDIT SCOPE per packet: the
  // i-th packet gets the i-th file of its own `files:` line (mod length),
  // so neighbouring packets that share a thread file land on DIFFERENT
  // files and can run in parallel — while a packet whose scope excludes
  // FAKE_EDIT_FILE will have its edit refused by the chokepoint.
  const filesOf = (id) => (prompt.match(new RegExp(`^### packet ${id} — [\\s\\S]*?\\nfiles: ([^;\\n]+);`, "m"))?.[1] ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const scopeFor = (id, i) => {
    if (process.env.FAKE_SCOPE !== "alternate") return {};
    const files = filesOf(id);
    return files.length ? { files: [files[i % files.length]] } : {};
  };
  const brief = {
    objective: process.env.FAKE_OBJECTIVE ?? "Stub objective: tidy the matched threads without changing their data shapes.",
    packets: ids.map(({ id, name }, i) => (id === noChangeId
      ? { id, noChange: true, task: `Stub verified ${name} needs no edit for this objective.`, handoff: [] }
      : {
        id,
        task: `Stub task for ${name}: add a bookkeeping marker inside this thread's files only.${id === escalateId ? " ESCALATE-MARKER: this packet needs the billing service, which is outside the plan." : ""}`,
        handoff: ["HANDOFF-MARKER: keep the /users payload shape {id, name} exactly as the contract lists it"],
        ...scopeFor(id, i),
      })),
    globalConstraints: [{ kind: "perf-lever", text: "Batch db writes inside loops rather than one call per item (stub).", scope: { all: true } }],
    // M-ORCH.3 — FAKE_SYSTEM_PACKET=<relative .py path>: propose ONE system
    // packet that CREATES that module (work no thread owns), integrating
    // with the first plan packet's thread.
    ...(process.env.FAKE_SYSTEM_PACKET
      ? {
        extraPackets: [{
          id: "x1",
          title: "orchestrator notes module",
          task: `Create ${process.env.FAKE_SYSTEM_PACKET} holding a NOTE constant for the run.`,
          handoff: ["HANDOFF-MARKER: the module must expose NOTE as a string"],
          files: [process.env.FAKE_SYSTEM_PACKET],
          rationale: "no thread owns a brand-new module",
          integrates: ids.length ? [prompt.match(/^### packet p1 — .+? \((\S+?),/m)?.[1] ?? ""].filter(Boolean) : [],
          after: ids.length ? [ids[0].id] : [],
        }],
      }
      : {}),
    // M-STACK.4 — FAKE_STACK_PROPOSAL=<tool>: propose ONE new tool the
    // project stack does not have, with an alternative it rejected. The
    // human confirms it at the objective gate; it becomes a stack-policy
    // constraint and nothing is installed.
    ...(process.env.FAKE_STACK_PROPOSAL
      ? {
        stackProposals: [{
          tool: process.env.FAKE_STACK_PROPOSAL,
          role: "cache",
          why: "the objective needs a shared per-device counter across processes; nothing in the project stack keeps cross-process state (stub).",
          rule: "prefer",
          alternatives: [{ tool: "sqlite3", whyNot: "a write per request on the hot path (stub)" }],
          scope: { all: true },
        }],
      }
      : {}),
    note: "",
  };
  emit("Brief drafted by the stub.\n```vg-orchestration\n" + JSON.stringify(brief) + "\n```");
}
if (prompt.includes("```vg-review-verdict")) {
  // M-ORCH.3 — FAKE_REVIEW_SYSTEM_FIRST=reject: the FIRST review of a system
  // packet rejects (so the e2e proves a created file is DELETED on reject
  // and re-created on the bounded retry); the retry's review approves.
  const systemFirst = process.env.FAKE_REVIEW_SYSTEM_FIRST === "reject"
    && /SYSTEM PACKET/.test(prompt) && /attempt 1\b/.test(prompt);
  const verdict = systemFirst ? "reject" : (process.env.FAKE_REVIEW_VERDICT ?? "approve");
  emit("Reviewed by the stub.\n```vg-review-verdict\n"
    + JSON.stringify({ verdict, reason: `stub reviewer: ${verdict} — diffs confined to the packet's files` }) + "\n```");
}

if (MODE === "escalate") {
  emit("Cannot proceed inside this packet.\n"
    + block("escalate", "needs work outside this packet's thread",
      process.env.FAKE_ESCALATE_REASON ?? "needs the auth service outside this plan"));
}

// AUTONOMY e2e — the packet the brief marked escalates instead of editing.
//
// FAKE_ESCALATE_AFTER_EDIT=1 makes it EDIT FIRST and escalate after, which
// is the shape the 2026-09-22 local-worker drill produced for real: a
// worker landed a rewrite of three files through the chokepoint and then
// its session failed. Under autonomy that escalation resolves as FAILED —
// and FAILED is supposed to mean the work is UNDONE, which the summary
// states out loud. It did not, and the destructive rewrite stayed on disk.
// Escalating WITHOUT editing cannot catch that: there is nothing to
// restore, so the assertion passes either way.
if (prompt.includes("ESCALATE-MARKER") && process.env.FAKE_ESCALATE_AFTER_EDIT !== "1") {
  emit("Cannot proceed inside this packet.\n"
    + block("escalate", "needs work outside this packet's thread", "needs the billing service, which is outside the plan"));
}

if (!mcpUrl) emit("no mcp config found\n" + block("done", "no-op: no MCP url in argv"));

// M-ORCH e2e — prove the orchestrator's HANDOFF reached the worker: with
// FAKE_REQUIRE_HANDOFF set, the stub edits ONLY when its prompt carries
// the handoff block; a missing handoff is an honest no-op.
if (process.env.FAKE_REQUIRE_HANDOFF && !prompt.includes("HANDOFF from the orchestrator")) {
  emit("No orchestrator handoff in this prompt — refusing to edit.\n"
    + block("done", "no-op: handoff missing from the worker prompt"));
}

// The remit rule, honoured by the script: only edit when this packet's
// thread actually reaches the target file.
// M-ORCH.3 — a SYSTEM packet prompt has no thread ("Files in your remit:"
// instead of "Files reached by this thread:"); it is handled inside the
// MCP session below, where it CREATES its module through the chokepoint.
const isSystem = /SYSTEM PACKET/.test(prompt);
const systemFile = isSystem ? (prompt.match(/\(to create: ([^)]+)\)/)?.[1] ?? "").split(",")[0].trim() : "";
const reachesLine = prompt.split("\n").find((l) => l.startsWith("Files reached by this thread:")) ?? "";
if (!isSystem && !reachesLine.includes(FILE)) {
  emit("This packet's thread does not reach the target file — nothing to do here.\n"
    + block("done", `no-op: ${FILE} is outside this packet's files`));
}

let sessionId = null;
let nextId = 1;
async function rpc(method, params) {
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  if (!sessionId) sessionId = res.headers.get("mcp-session-id");
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.startsWith("data: "));
  return lines.length ? JSON.parse(lines[lines.length - 1].slice(6)) : {};
}

try {
  await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "fake-worker", version: "0.0.1" },
  });
  await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  if (isSystem) {
    // The system worker: CREATE the module named in its remit through the
    // chokepoint's create-file tool (never a raw write), then report.
    if (!systemFile) emit("system packet without a creatable file\n" + block("escalate", "no file to create", "the remit lists no new file"));
    const marker = `orchestrator-system-marker-${process.pid}-${Date.now()}`;
    const source = `"""Notes module created by a confirmed system packet."""\n\nNOTE = "${marker}"\n`;
    const cr = await rpc("tools/call", { name: "vibegraph_create_file", arguments: { path: systemFile, source } });
    const crText = cr.result?.content?.[0]?.text ?? "";
    if (cr.result?.isError) {
      emit(`create-file refused:\n${crText}\n` + block("escalate", "could not create the module", crText.slice(0, 160)));
    }
    emit(`created ${systemFile} with ${marker} via vibegraph_create_file.\n` + block("done", `created ${systemFile} (${marker})`));
  }

  const src = await rpc("tools/call", { name: "vibegraph_get_node_source", arguments: { nodeId: NODE, filePath: FILE } });
  const source = src.result?.content?.[0]?.text ?? "";
  if (!source || source.startsWith("Error:")) {
    emit(`could not read ${NODE}: ${source}\n` + block("done", "no-op: target source unavailable"));
  }

  const marker = `worker-marker-${process.pid}-${Date.now()}`;
  // Case-3 taskboard finding (2026-08-30): a python `#` comment spliced
  // into a .ts function was correctly REJECTED by rewrite_jsts's
  // parse-gate — the stub must speak the target file's comment syntax.
  const hashLang = /\.(py|sh|bash)$/.test(FILE);
  const lines = source.split("\n");
  // M-ORCH.4 (polyglot e2e finding): a DECORATED python function's source
  // starts with its decorators — a marker spliced between `@route` and
  // `def` escapes the node's head span and the chokepoint rejects it. Land
  // the marker as the first body line instead (after the `def …:` line).
  const defAt = hashLang ? lines.findIndex((l) => /^\s*(async\s+)?def\s/.test(l)) : -1;
  lines.splice(defAt >= 0 ? defAt + 1 : 1, 0, hashLang ? `    # ${marker}` : `  // ${marker}`);
  const edited = lines.join("\n");

  // M-STACK.5 — FAKE_ADD_IMPORT=<module>: reach for a tool through the
  // chokepoint, so the deterministic stack pre-check has a real IR delta
  // to catch. The worker believes it is doing the right thing; the policy
  // says otherwise, and the check — not a model — is what notices.
  if (process.env.FAKE_ADD_IMPORT) {
    const ci = await rpc("tools/call", {
      name: "vibegraph_compose_insert",
      arguments: { mode: "top-level", source: `import ${process.env.FAKE_ADD_IMPORT}\n`, filePath: FILE },
    });
    const ciText = ci.result?.content?.[0]?.text ?? "";
    if (ci.result?.isError) {
      emit(`chokepoint refused the import:\n${ciText}\n` + block("done", `import refused: ${ciText.slice(0, 160)}`));
    }
  }

  const rw = await rpc("tools/call", {
    name: "vibegraph_rewrite_node",
    arguments: { nodeId: NODE, op: "replace_node", payload: { source: edited }, filePath: FILE },
  });
  const rwText = rw.result?.content?.[0]?.text ?? "";
  if (rw.result?.isError) {
    emit(`chokepoint refused the edit:\n${rwText}\n` + block("done", `edit refused by the chokepoint: ${rwText.slice(0, 160)}`));
  }
  // The edit LANDED, and now the session escalates anyway — the real
  // drill's shape. The bytes are on disk; whether they survive is the
  // restore path's business, and that is what the e2e asserts.
  if (prompt.includes("ESCALATE-MARKER") && process.env.FAKE_ESCALATE_AFTER_EDIT === "1") {
    emit(`inserted ${marker} into ${NODE}, then hit something outside this packet.\n`
      + block("escalate", "needs work outside this packet's thread", "needs the billing service, which is outside the plan"));
  }
  emit(`inserted ${marker} into ${NODE} via the chokepoint.\n` + block("done", `inserted ${marker}`));
} catch (e) {
  emit(`fake worker error: ${e?.message ?? e}\n` + block("done", `no-op: ${e?.message ?? e}`));
}
