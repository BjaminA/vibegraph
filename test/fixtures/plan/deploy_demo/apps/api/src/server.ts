// The API: serves the same scoring logic over HTTP.
import express from "express";
import { classify } from "@acme/rules";

const app = express();

/** GET /classify?x=… */
function classifyRoute(req: express.Request, res: express.Response): void {
  res.json({ result: classify(Number(req.query.x)) });
}

app.get("/classify", classifyRoute);
app.listen(3000);
