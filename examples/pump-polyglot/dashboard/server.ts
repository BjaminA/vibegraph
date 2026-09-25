// Pump-wear dashboard — the TypeScript half. Express routes validate
// the reading payload (schema.ts) and talk to the Python API over HTTP
// (api_client.ts): a cross-language hop VibeGraph shows as an honest
// `http` external on each side, never a guessed link. `postBatch`
// scores readings ONE call per row — the N+1 round trip the thread
// contract flags for the agent that works this thread.
import express from "express";
import { postToApi, fetchHealth } from "./api_client";
import { validateReading } from "./schema";

const app = express();
app.use(express.json());

/** GET /health — proxy the Python API's liveness. */
export async function getHealth(req, res) {
  const upstream = await fetchHealth();
  res.json({ dashboard: true, api: upstream.ok === true });
}

/** POST /reading — validate one reading, forward it, return the wear score. */
export async function postReading(req, res) {
  const problems = validateReading(req.body);
  if (problems.length > 0) {
    res.status(400);
    res.json({ problems });
    return;
  }
  const scored = await postToApi(req.body.readings);
  console.log("scored reading", scored.wear);
  res.json(scored);
}

/** POST /batch — score EVERY reading with its own round trip (the lever to pull is batching). */
export async function postBatch(req, res) {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const results = [];
  for (const row of rows) {
    const scored = await postToApi(row);
    results.push(scored.wear);
  }
  res.json({ wears: results });
}

app.get("/health", getHealth);
app.post("/reading", postReading);
app.post("/batch", postBatch);
app.listen(3000);
