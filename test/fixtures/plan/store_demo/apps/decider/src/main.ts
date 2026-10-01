// The decider: reacts to requests in the store and writes a verdict back.
import { writeDoc, watchDocs } from "@acme/store-client";
import { decide, type Request } from "@acme/decisions";

/** Decide one request and record the verdict. */
export async function onRequest(id: string, req: Request): Promise<void> {
  const verdict = decide(req);
  await writeDoc("verdicts", "verdict", id, { verdict });
}

watchDocs("requests", "request", (id, req) => {
  void onRequest(id, req as Request);
});
