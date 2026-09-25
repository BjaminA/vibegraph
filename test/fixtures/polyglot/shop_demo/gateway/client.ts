// HTTP client for the Python API (api/app.py). Every function here is a
// network round trip; the payload shapes are the contract between the
// two languages — the IR can name the endpoints, never link across.
const API_BASE = process.env.SHOP_API ?? "http://localhost:5000";

export interface OrderSummary { id: number; customer: string; total: number }
export interface OrderInput { customer: string; items: Array<{ sku: string; qty: number }> }

/** Fetch up to `limit` order summaries. */
export async function fetchOrders(limit: number): Promise<OrderSummary[]> {
  const res = await fetch(`${API_BASE}/orders?limit=${limit}`);
  return res.json();
}

/** One extra round trip per order — the N+1 the gateway route incurs. */
export async function fetchOrderDetail(id: number): Promise<unknown> {
  const res = await fetch(`${API_BASE}/orders/${id}`);
  return res.json();
}

export async function postOrder(input: OrderInput): Promise<OrderSummary> {
  const res = await fetch(`${API_BASE}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`api rejected order: ${res.status}`);
  }
  return res.json();
}
