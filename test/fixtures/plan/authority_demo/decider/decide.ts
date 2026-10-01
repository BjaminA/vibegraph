// The decider: the one place a verdict is written, always with its audit event.
import { writeDoc } from "../lib/store";
import { appendAudit } from "../lib/audit";
import { verdictId } from "../lib/ids";

/** Record the verdict on a request. */
export async function recordVerdict(requestId: string, verdict: string): Promise<void> {
  const id = verdictId(requestId);
  await writeDoc("verdicts", "verdict", id, { verdict });
  await appendAudit("verdict", id);
}

/** Record a review, auditing either way. */
export async function recordReview(requestId: string, approved: boolean): Promise<void> {
  if (approved) {
    await appendAudit("approved", requestId);
  } else {
    await appendAudit("rejected", requestId);
  }
}
