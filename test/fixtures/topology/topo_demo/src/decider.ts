// The decider service: walks the verdict tree over the evidence.
import { readDocs, writeDoc } from "./store";
import { zoneFor } from "./router";

/** Is there a recent inspection? */
export async function hasRecentInspection(): Promise<boolean> {
  const inspections = await readDocs(zoneFor("inspection"), "inspection");
  return inspections.length > 0;
}

/** Are the readings within limits? */
export async function readingsWithinLimits(): Promise<boolean> {
  const readings = await readDocs(zoneFor("reading-pressure"), "reading-pressure");
  return readings.length > 0;
}

/** Decide a request and record the verdict. */
export async function decide(id: string): Promise<void> {
  const ok = (await hasRecentInspection()) && (await readingsWithinLimits());
  await writeDoc(zoneFor("verdict"), id, { family: "verdict", outcome: ok ? "approved" : "rejected" });
}

await decide(process.argv[2] ?? "r1");
