// Payload contract for POST /reading — what the dashboard accepts before
// forwarding to the Python API. Pure: no effects, no external calls.
export const FEATURES = 8;

export function validateReading(body): string[] {
  const problems = [];
  if (!Array.isArray(body?.readings)) {
    problems.push("readings must be an array");
    return problems;
  }
  if (body.readings.length !== FEATURES) {
    problems.push(`readings must have exactly ${FEATURES} values`);
  }
  for (const v of body.readings) {
    if (typeof v !== "number" || Number.isNaN(v)) {
      problems.push("every reading must be a finite number");
      break;
    }
  }
  return problems;
}
