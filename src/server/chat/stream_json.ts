// Shared stream-json → ChatEvent mapping (M27.1).
//
// Extracted verbatim from claude_p_backend.ts so the persistent stdio
// backend and the parked per-send backend speak one dialect. The
// claude CLI's --output-format stream-json frames: assistant content
// blocks (text / tool_use), user tool_result blocks, and a result
// envelope per turn. system / hook_* / rate_limit_event and
// result(success) are intentionally not surfaced as events — turn
// boundaries are the CALLER's concern (the stdio session keys on
// result; the per-send backend keys on process exit).

import type { ChatEvent } from "./backend";

const MCP_TOOL_PREFIX = "mcp__vibegraph__";

export function unprefixToolName(name: string): string {
  return name.startsWith(MCP_TOOL_PREFIX) ? name.slice(MCP_TOOL_PREFIX.length) : name;
}

export function mapClaudeStreamMessage(msg: any, push: (ev: ChatEvent) => void): void {
  if (msg.type === "assistant" && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
        push({ type: "token", delta: block.text });
      } else if (block.type === "tool_use") {
        push({
          type: "tool-use-start",
          toolUseId: typeof block.id === "string" ? block.id : "",
          name: unprefixToolName(block.name ?? ""),
          args: block.input ?? {},
        });
      }
    }
  } else if (msg.type === "user" && Array.isArray(msg.message?.content)) {
    for (const block of msg.message.content) {
      if (block.type === "tool_result") {
        const content = Array.isArray(block.content)
          ? block.content.map((c: any) => (c.type === "text" ? c.text : "")).join("\n")
          : (typeof block.content === "string" ? block.content : "");
        push({
          type: "tool-use-end",
          toolUseId: typeof block.tool_use_id === "string" ? block.tool_use_id : "",
          result: content,
          isError: block.is_error === true,
        });
      }
    }
  } else if (msg.type === "result" && msg.is_error === true) {
    push({
      type: "error",
      message: msg.result || msg.error || "Claude returned an error",
    });
  }
}
