#!/usr/bin/env node
/**
 * Stub `claude -p --input-format stream-json` for the M27.1 backend
 * unit test (test/chat_stdio_backend.test.mjs). Speaks just enough of
 * the stream-json dialect, deterministically:
 *
 *  - emits system/init at startup (and again per turn — the real CLI
 *    re-emits it; the backend must tolerate both);
 *  - session_id: the --resume argv value when present (proving the
 *    backend resumed), else FAKE_SESSION_ID (default "fake-session-1");
 *  - replies to each user turn with one assistant text block
 *    "<resumed:>t<N>:echo:<text>" — the in-process turn counter N
 *    proves two turns hit the SAME process — then a result envelope;
 *  - "die" → exit(1) with no result (mid-turn crash);
 *  - "fail" → result with is_error:true;
 *  - "tooluse" in the text → a tool_use block (id tu-<N>) + matching
 *    tool_result before the reply (M-CHAT-POLISH.1 correlation);
 *  - "toolbash" in the text → same, but a Bash-shaped tool_use
 *    (command: "python train.py --epochs 3") for the tool-card e2e;
 *  - writes its pid to FAKE_PID_FILE so the test can assert reaping.
 *
 * Automated tests never spawn the real `claude` (auth/cost — M10R.7).
 */
import * as fs from "node:fs";

const resumeIx = process.argv.indexOf("--resume");
const resumed = resumeIx >= 0 ? process.argv[resumeIx + 1] : null;
const sessionId = resumed ?? process.env.FAKE_SESSION_ID ?? "fake-session-1";
if (process.env.FAKE_PID_FILE) fs.writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
// Lets a test assert the spawn flags (e.g. that the GUI chat denies the
// raw file-write tools) without reaching into the backend's internals.
if (process.env.FAKE_ARGV_FILE) fs.writeFileSync(process.env.FAKE_ARGV_FILE, process.argv.join("\n"));

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const init = () => out({ type: "system", subtype: "init", session_id: sessionId });
init();

let turn = 0;
let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    const text = (msg.message?.content ?? []).map((c) => c.text ?? "").join("");
    turn++;
    // M-SKILL.2 — the chat-routing test asserts on the PROMPT the backend
    // actually sent; append each received turn verbatim when asked.
    if (process.env.FAKE_PROMPT_LOG) {
      fs.appendFileSync(process.env.FAKE_PROMPT_LOG, `--- turn ${turn} ---\n${text}\n`);
    }
    if (text === "die") process.exit(1);
    init();
    if (text === "fail") {
      out({ type: "result", is_error: true, result: "fake failure", session_id: sessionId });
      continue;
    }
    // M-CHAT-POLISH.1 — deterministic tool_use/tool_result pair so tests
    // can pin the toolUseId correlation end-to-end.
    if (text.includes("tooluse") || text.includes("toolbash")) {
      const toolUseId = `tu-${turn}`;
      const toolUse = text.includes("toolbash")
        ? { type: "tool_use", id: toolUseId, name: "Bash", input: { command: "python train.py --epochs 3" } }
        : { type: "tool_use", id: toolUseId, name: "mcp__vibegraph__vibegraph_explain_node", input: { nodeId: "module/train.fn" } };
      out({ type: "assistant", message: { content: [toolUse] } });
      out({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content: [{ type: "text", text: "fake tool ok" }] }] },
      });
    }
    out({
      type: "assistant",
      message: { content: [{ type: "text", text: `${resumed ? "resumed:" : ""}t${turn}:echo:${text}` }] },
    });
    out({ type: "result", is_error: false, result: "ok", session_id: sessionId });
  }
});
