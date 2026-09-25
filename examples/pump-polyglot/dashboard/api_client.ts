// HTTP client for the Python API (api.py). Every function here is a
// network round trip; the payload shapes are the contract between the
// two languages — {readings: number[8]} in, {wear: number} out.
const API_BASE = process.env.PUMP_API ?? "http://localhost:5000";

export interface Scored { wear: number }

/** Liveness of the Python API. */
export async function fetchHealth(): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}

/** Score one row of 8 sensor readings. */
export async function postToApi(readings: number[]): Promise<Scored> {
  const res = await fetch(`${API_BASE}/predict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ readings }),
  });
  if (!res.ok) {
    throw new Error(`api rejected reading: ${res.status}`);
  }
  return res.json();
}
