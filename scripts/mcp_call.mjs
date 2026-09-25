#!/usr/bin/env node
// Call ONE vibegraph MCP tool from the command line (streamable HTTP):
//   node scripts/mcp_call.mjs http://localhost:4200/mcp vibegraph_generate_readme '{"scope":"thread","id":"api/app.py:create_order"}'
// Prints the tool's text content. Used by the M-PROVIDER drills to drive a
// routine-tier spawn without the board; handy for any manual MCP poke.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [url, name, argsJson] = process.argv.slice(2);
if (!url || !name) { console.error("usage: mcp_call.mjs <mcp-url> <tool> [json-args]"); process.exit(2); }
const client = new Client({ name: "vg-mcp-call", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
const t0 = Date.now();
const r = await client.callTool({ name, arguments: argsJson ? JSON.parse(argsJson) : {} });
const text = (r.content ?? []).map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
process.stdout.write(text + "\n");
process.stderr.write(`[mcp_call] ${name} ${r.isError ? "ERROR" : "ok"} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
await client.close();
process.exit(r.isError ? 1 : 0);
