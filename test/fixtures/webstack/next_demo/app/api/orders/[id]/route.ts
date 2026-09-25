// A DYNAMIC segment: "[id]" is a parameter, not a literal path.
import { listOrders } from "@/lib/db";

/** One order by id. */
export async function GET(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const rows = await listOrders("all");
  return Response.json({ id: ctx.params.id, found: rows.length });
}

// NOT exported: a helper that happens to be named like a verb must not be
// read as a handler.
function POST() {
  return null;
}
