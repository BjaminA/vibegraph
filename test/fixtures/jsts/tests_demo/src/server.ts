import express from "express";
import { checkout } from "./price";

const app = express();

function checkoutRoute(req: { body: { total: number } }, res: { json: (x: unknown) => void }): void {
  res.json(checkout(req.body.total));
}

app.post("/checkout", checkoutRoute);
