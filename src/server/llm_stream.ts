// What a model is doing while it answers (2026-10-21). `claude -p
// --output-format stream-json --verbose --include-partial-messages` prints one
// JSON event per line; these turn them into the short steps the app shows
// ("thinking", "reading src/x.ts", "writing the reply: 2,400 characters") and
// find the final result that `--output-format json` used to print alone.
// Pure: no process, no clock but the one passed in.

export interface StreamState { thinking: number; text: number; lastLive: number }

export const newStreamState = (): StreamState => ({ thinking: 0, text: 0, lastLive: 0 });

/** How often a counter step may be reported, in ms. */
const LIVE_EVERY_MS = 1000;
const count = (n: number) => n.toLocaleString("en-GB");

/** What a tool call is doing, in the app's words. */
export function toolStep(name: string, input: Record<string, unknown> | undefined): string {
  const s = (k: string) => (typeof input?.[k] === "string" ? (input[k] as string) : "");
  if (name === "Read") return `reading ${s("file_path") || "a file"}`;
  if (name === "Grep") return `searching the code for ${s("pattern") || "a pattern"}`;
  if (name === "Glob") return `listing files ${s("pattern")}`.trim();
  if (name === "WebFetch") return `fetching ${s("url") || "a page"}`;
  return `using ${name}`;
}

/** One stream line → a step to show, or null. `live` steps are counters the next one replaces. */
export function streamStep(line: string, st: StreamState, now: number = Date.now()): { text: string; live: boolean } | null {
  let ev: any;
  try { ev = JSON.parse(line); } catch { return null; }
  if (!ev || typeof ev !== "object") return null;
  if (ev.type === "system" && ev.subtype === "init") return { text: `the model is ${typeof ev.model === "string" ? ev.model : "starting"}`, live: false };
  if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
    const tool = ev.message.content.find((c: any) => c?.type === "tool_use");
    return tool ? { text: toolStep(String(tool.name ?? "a tool"), tool.input), live: false } : null;
  }
  if (ev.type !== "stream_event" || !ev.event) return null;
  const e = ev.event;
  if (e.type === "content_block_start") {
    const kind = e.content_block?.type;
    if (kind === "thinking") return { text: "thinking", live: true };
    if (kind === "text") return { text: "writing the reply", live: true };
    return null;
  }
  if (e.type === "content_block_delta") {
    const d = e.delta ?? {};
    if (d.type === "text_delta" && typeof d.text === "string") st.text += d.text.length;
    else if (d.type === "thinking_delta" && typeof d.thinking === "string") st.thinking += d.thinking.length;
    else return null;
    // a model whose thinking arrives without its text (a real run, 2026-10-21)
    // stays "thinking": a counter at 0 says nothing
    if ((d.type === "text_delta" ? st.text : st.thinking) === 0) return null;
    if (now - st.lastLive < LIVE_EVERY_MS) return null;
    st.lastLive = now;
    return d.type === "text_delta"
      ? { text: `writing the reply: ${count(st.text)} characters`, live: true }
      : { text: `thinking: ${count(st.thinking)} characters`, live: true };
  }
  return null;
}

/** The final result: the last `{"type":"result"}` line, or the whole output
 *  parsed as one object (`--output-format json`, and every test stub). */
export function streamResult(out: string): { result?: unknown; is_error?: unknown; [k: string]: unknown } | null {
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const ev = JSON.parse(lines[i]);
      if (ev && typeof ev === "object" && ev.type === "result") return ev;
    } catch { /* not a JSON line */ }
  }
  try { const whole = JSON.parse(out); return whole && typeof whole === "object" ? whole : null; } catch { return null; }
}
