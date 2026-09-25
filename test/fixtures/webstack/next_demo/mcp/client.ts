// The MCP CLIENT half: a call here crosses to a tool server over stdio.
// Same package as mcp/server.ts, opposite direction — one role, two
// halves, and the role is honest about not telling them apart.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "dashboard", version: "1.0.0" });

/** Ask the tool server for orders. */
export async function ordersViaTools(region: string) {
  await client.connect(new StdioClientTransport({ command: "node", args: ["mcp/server.js"] }));
  return client.callTool({ name: "list_orders", arguments: { region } });
}
