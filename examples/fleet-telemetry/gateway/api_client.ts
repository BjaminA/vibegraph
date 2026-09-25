// HTTP client for the Python service (telemetry/app.py). Every function
// is a network round trip; the shapes are the contract between the two
// languages — the IR names the endpoints, it cannot link across.
const API_BASE = process.env.FLEET_API ?? "http://localhost:5000";

export interface Reading { metric: string; value: number; ts: number }
export interface DeviceSummary { device_id: string; latest: Reading[]; temp_hour_mean: number | null }
export interface IngestResult { accepted: number; errors: Array<{ index: number; problems: string[] }> }

/** Forward a validated ingest body with the caller's bearer token. */
export async function postIngest(body: unknown, token: string): Promise<IngestResult> {
  const res = await fetch(`${API_BASE}/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    throw new Error("upstream rejected the token");
  }
  return res.json();
}

/** One device's summary, or null when the service has never seen it. */
export async function fetchDevice(id: string): Promise<DeviceSummary | null> {
  const res = await fetch(`${API_BASE}/devices/${encodeURIComponent(id)}`);
  if (res.status === 404) {
    return null;
  }
  return res.json();
}

export async function fetchDeviceIds(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/devices`);
  const body = await res.json();
  return body.devices;
}

/** The CSV export as text. */
export async function fetchExport(since: number): Promise<string> {
  const res = await fetch(`${API_BASE}/export?since=${since}`);
  return res.text();
}
