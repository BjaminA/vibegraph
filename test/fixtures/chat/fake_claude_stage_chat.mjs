#!/usr/bin/env node
/**
 * M-GF3.4 — stub `claude -p --input-format stream-json` for the stage-
 * dialogue e2e (test/e2e/m-gf3-stage-chat.spec.ts). Speaks the same
 * stream-json dialect as fake_claude_stdio.mjs, deterministically:
 *
 *  - a turn whose text contains "three conv" (the change request) replies
 *    with prose + a fenced ```vg-revise-stage block — the revision path;
 *  - any other turn replies with plain prose — the discussion path (the
 *    stage-prompt FRAMING mentions the protocol, so keying must be on the
 *    user's distinctive words, never on "revise").
 *
 * Automated tests never spawn the real `claude` (auth/cost — M10R.7).
 */
const sessionId = process.env.FAKE_SESSION_ID ?? "fake-stage-session";

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
out({ type: "system", subtype: "init", session_id: sessionId });

const REVISED =
  "a PyTorch nn.Module with three Conv1d layers and two Linear layers mapping (N, 1, 64) to (N, 3) logits";

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
    out({ type: "system", subtype: "init", session_id: sessionId });
    const reply = /three conv/i.test(text)
      ? [
          "Happy to widen the model.",
          "```vg-revise-stage",
          JSON.stringify({ capability: REVISED }),
          "```",
        ].join("\n")
      : "This stage builds the CNN model: a small convolutional network that maps a batch of signal windows to class logits.";
    out({ type: "assistant", message: { content: [{ type: "text", text: reply }] } });
    out({ type: "result", is_error: false, result: "ok", session_id: sessionId });
  }
});
