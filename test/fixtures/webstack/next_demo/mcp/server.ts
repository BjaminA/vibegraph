// The MCP SERVER half: a tool is REGISTERED here by name and dispatched by
// the protocol at runtime. A registration is not a round trip — which is
// why the `agent-protocol` role derives NO effect: from the role alone a
// `registerTool` and a `callTool` are indistinguishable, and stamping http
// on 75 registrations would fabricate 75 boundaries (measured on a real
// MCP server, an internal field review).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listOrders } from "@/lib/db";

export const server = new McpServer({ name: "orders", version: "1.0.0" });

/** Register the orders tool; the name is a string the protocol dispatches on. */
export function registerOrderTools() {
  server.registerTool("list_orders", { description: "orders by region" }, async (args) => {
    const rows = await listOrders(String(args?.region ?? "all"));
    return { content: [{ type: "text", text: JSON.stringify(rows) }] };
  });
}
