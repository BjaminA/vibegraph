// shop_demo gateway — the TypeScript half. Express routes call client.ts,
// which talks to the Python API over HTTP: a cross-language hop the IR
// sees only as an honest `http` external terminal. getOrders hydrates
// EACH order with a second fetch — the N+1 round-trip lever the thread
// contract should flag.
import express from "express";
import { fetchOrders, postOrder, fetchOrderDetail } from "./client";
import { validateOrderInput } from "./schema";

const app = express();
app.use(express.json());

/** GET /orders — proxy the newest orders, then hydrate EACH with its detail. */
export async function getOrders(req, res) {
  const orders = await fetchOrders(25);
  const hydrated = [];
  for (const order of orders) {
    const detail = await fetchOrderDetail(order.id);
    hydrated.push({ ...order, detail });
  }
  res.json(hydrated);
}

/** POST /orders — validate the gateway payload shape, forward to the API. */
export async function createOrder(req, res) {
  const problems = validateOrderInput(req.body);
  if (problems.length > 0) {
    res.status(400);
    res.json({ problems });
    return;
  }
  const created = await postOrder(req.body);
  console.log("order forwarded", created.id);
  res.status(201);
  res.json(created);
}

app.get("/orders", getOrders);
app.post("/orders", createOrder);
app.listen(3000);
