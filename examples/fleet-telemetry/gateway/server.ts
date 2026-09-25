// fleet-telemetry gateway — the TypeScript edge in front of the Python
// service. Validates ingest bodies, forwards them with the gateway's
// bearer token, serves device and fleet views (the fleet view hydrates
// EACH device with its own upstream call), and proxies the CSV export.
import express from "express";
import { fetchDevice, fetchDeviceIds, fetchExport, postIngest } from "./api_client";
import { bearerToken } from "./auth";
import { cached } from "./cache";
import { csvToRows, formatReading } from "./format";
import { validateIngestBody } from "./schema";

const app = express();
app.use(express.json({ limit: "1mb" }));

/** POST /ingest — validate, then forward with the caller's bearer token. */
export async function postIngestRoute(req, res) {
  const token = bearerToken(req);
  if (!token) {
    res.status(401);
    res.json({ problems: ["missing bearer token"] });
    return;
  }
  const problems = validateIngestBody(req.body);
  if (problems.length > 0) {
    res.status(400);
    res.json({ problems });
    return;
  }
  const upstream = await postIngest(req.body, token);
  res.status(upstream.accepted > 0 ? 202 : 400);
  res.json(upstream);
}

/** GET /devices/:id — one device, formatted for the dashboard. */
export async function getDevice(req, res) {
  const summary = await cached(`device:${req.params.id}`, 15, () => fetchDevice(req.params.id));
  if (!summary) {
    res.status(404);
    res.json({ problems: ["unknown device"] });
    return;
  }
  res.json({ device_id: summary.device_id, latest: summary.latest.map(formatReading), tempHourMean: summary.temp_hour_mean });
}

/** GET /fleet — every device with its latest readings (one upstream call per device). */
export async function getFleet(req, res) {
  const ids = await fetchDeviceIds();
  const fleet = [];
  for (const id of ids) {
    const summary = await fetchDevice(id);
    if (summary) fleet.push({ device_id: id, latest: summary.latest.map(formatReading) });
  }
  res.json({ fleet });
}

/** GET /export — proxy the CSV, parsed to rows for the dashboard table. */
export async function getExport(req, res) {
  const since = Number(req.query.since ?? 0);
  const csv = await fetchExport(since);
  res.json({ rows: csvToRows(csv) });
}

/** GET /health — gateway liveness. */
export async function getHealth(req, res) {
  res.json({ gateway: true });
}

app.post("/ingest", postIngestRoute);
app.get("/devices/:id", getDevice);
app.get("/fleet", getFleet);
app.get("/export", getExport);
app.get("/health", getHealth);
app.listen(3000);
