/**
 * VG_BUILD_SESSION default-on (2026-08-02) — shared dual-protocol shim for
 * the greenfield builder stubs.
 *
 * The persistent builder session speaks the M27 stream-json dialect
 * (`--input-format stream-json`), while architecture/roadmap drafts remain
 * one-shot `claude -p --output-format json`. ONE stub binary serves a whole
 * e2e run, so it must speak both: call maybeServeStreamJson(replyFor) first
 * — if the argv is session-shaped it runs the NDJSON turn loop (init →
 * per-turn assistant + result envelopes, same shapes as
 * test/fixtures/chat/fake_claude_stdio.mjs) and returns true; otherwise the
 * caller falls through to its classic one-shot envelope. `replyFor(prompt)`
 * is the stub's existing prompt→canned-reply mapping, shared verbatim by
 * both protocols.
 */
export function maybeServeStreamJson(replyFor) {
  if (!process.argv.includes("--input-format")) return false;
  const resumeIx = process.argv.indexOf("--resume");
  const sessionId = resumeIx >= 0 ? process.argv[resumeIx + 1] : "fake-build-session";
  const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  out({ type: "system", subtype: "init", session_id: sessionId });
  let buf = "";
  process.stdin.on("data", (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const text = (msg.message?.content ?? []).map((c) => c.text ?? "").join("");
      // The real CLI re-emits init per turn; the backend tolerates both.
      out({ type: "system", subtype: "init", session_id: sessionId });
      out({ type: "assistant", message: { content: [{ type: "text", text: replyFor(text) }] } });
      out({ type: "result", is_error: false, result: "ok", session_id: sessionId });
    }
  });
  return true;
}
