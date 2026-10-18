// In-memory job registry. pm2 `instances: 1` is a correctness setting, not a
// performance one: a second instance would hold a second registry and the
// worker would lose half its jobs.
const jobs = new Map<string, { task: string; state: string }>();

export function registerJob(id: string, task: string): void {
  jobs.set(id, { task, state: "queued" });
}

export function jobState(id: string): string | null {
  return jobs.get(id)?.state ?? null;
}
