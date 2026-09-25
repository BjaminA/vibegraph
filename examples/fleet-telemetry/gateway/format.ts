// Presentation helpers for the dashboard: readings to display rows,
// the CSV export to row objects (header-driven, so column order is
// whatever the service sends).
import type { Reading } from "./api_client";

const UNITS: Record<string, string> = { temp: "°C", vibration: "g", pressure: "kPa", battery: "%" };

export function formatReading(r: Reading): { metric: string; display: string; ts: number } {
  const unit = UNITS[r.metric] ?? "";
  return { metric: r.metric, display: `${r.value.toFixed(2)}${unit}`, ts: r.ts };
}

export function csvToRows(csv: string): Array<Record<string, string>> {
  const lines = csv.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) {
    return [];
  }
  const header = lines[0].split(",");
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    header.forEach((name, i) => { row[name] = cells[i] ?? ""; });
    rows.push(row);
  }
  return rows;
}
