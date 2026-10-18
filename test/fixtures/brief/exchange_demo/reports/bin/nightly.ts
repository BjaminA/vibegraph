#!/usr/bin/env node
// Nightly reports: counts of decisions by phase, per day and per week.
import { readDoc, writeDoc } from "../../lib/store";

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  const byPhase: Record<string, number> = {};
  for (const id of ids) {
    const d = await readDoc("status", id);
    const phase = d?.body?.phase ?? "unknown";
    byPhase[phase] = (byPhase[phase] ?? 0) + 1;
    await writeDoc("metrics", `${id}-seen`, { at: Date.now() });
  }
  for (const period of ["daily", "weekly"]) {
    await writeDoc("reports", period, byPhase);
    await writeDoc("metrics", `${period}-count`, { n: ids.length });
  }
}

main();
