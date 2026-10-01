// What the rules exist to catch.
import { writeDoc } from "../lib/store";
import { appendAudit } from "../lib/audit";

/** A second writer of verdicts, with an id built inline. */
export async function overrideVerdict(requestId: string): Promise<void> {
  await writeDoc("verdicts", "verdict", "verdict:" + requestId, { verdict: "approve" });
}

/** A decision that can skip its audit event. */
export async function quickDecide(requestId: string, urgent: boolean): Promise<void> {
  if (urgent) return;
  await appendAudit("quick", requestId);
}

/** A decision audited only on one branch. */
export async function reviewLater(requestId: string, needsReview: boolean): Promise<void> {
  if (needsReview) {
    await appendAudit("review", requestId);
  }
}

/** A request whose id comes from the caller. */
export async function submitRequest(requestId: string, amount: number): Promise<void> {
  await writeDoc("requests", "request", requestId, { amount });
}
