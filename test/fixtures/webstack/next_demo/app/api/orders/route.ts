// A Next.js App Router handler: two exported HTTP verbs, one file.
import { listOrders, insertOrder } from "@/lib/db";
import { chargeCard } from "@/lib/volt";
import { postEntry } from "@/lib/ledger";
import { summarize } from "@/lib/llm";

/** Every order for the caller's region, with a model-written summary. */
export async function GET(req: Request): Promise<Response> {
  const region = new URL(req.url).searchParams.get("region") ?? "all";
  const rows = await listOrders(region);
  const summary = await summarize(JSON.stringify(rows));
  return Response.json({ orders: rows, summary });
}

/** Take an order and charge for it. */
export async function POST(req: Request): Promise<Response> {
  const body = await req.json();
  const charged = await chargeCard(body.token, body.amount);
  await postEntry(charged.reference, body.amount);
  const id = await insertOrder(body.region, charged.reference);
  return Response.json({ id });
}
