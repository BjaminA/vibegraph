// The requester: writes a request into the store, watches for its verdict.
import { writeDoc, watchDocs } from "@acme/store-client";

/** Submit a request for a decision. */
export async function submit(id: string, amount: number): Promise<void> {
  await writeDoc("requests", "request", id, { amount });
}

watchDocs("verdicts", "verdict", (id, verdict) => {
  console.log(id, verdict);
});
await submit("r1", 42);
