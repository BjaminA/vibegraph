// Ingest body contract at the edge — mirrors telemetry/schema.py so a
// bad batch is rejected before it costs an upstream round trip.
export const REQUIRED = ["device_id", "ts", "metric", "value"];
export const MAX_BATCH = 500;

export function validateIngestBody(body): string[] {
  const problems = [];
  if (!body || !Array.isArray(body.readings)) {
    problems.push("payload must be {readings: [...]}");
    return problems;
  }
  if (body.readings.length === 0) {
    problems.push("readings must not be empty");
  }
  if (body.readings.length > MAX_BATCH) {
    problems.push(`readings must have at most ${MAX_BATCH} items`);
  }
  for (const [index, reading] of body.readings.entries()) {
    for (const key of REQUIRED) {
      if (!(key in reading)) {
        problems.push(`reading ${index}: missing ${key}`);
      }
    }
  }
  return problems;
}
