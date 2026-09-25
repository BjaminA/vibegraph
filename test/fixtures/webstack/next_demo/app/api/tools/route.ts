// The route that reaches BOTH halves of the agent protocol: it registers
// the server's tools and asks a tool server through the client.
import { registerOrderTools } from "@/mcp/server";
import { ordersViaTools } from "@/mcp/client";

/** Orders, but through the tool server. */
export async function GET(req: Request): Promise<Response> {
  registerOrderTools();
  const region = new URL(req.url).searchParams.get("region") ?? "all";
  const result = await ordersViaTools(region);
  return Response.json(result);
}
