// The intake service: records a request.
import { writeDoc } from "./store";
import { zoneFor } from "./router";

/** Submit a request. */
export async function submit(id: string, amount: number): Promise<void> {
  await writeDoc(zoneFor("request"), id, { family: "request", amount });
}

await submit(process.argv[2] ?? "r1", 42);
