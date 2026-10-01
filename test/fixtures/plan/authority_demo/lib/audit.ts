// The audit log: one event per decision.
import { writeDoc } from "./store";
import { eventId } from "./ids";

/** Append an audit event. */
export async function appendAudit(kind: string, subject: string): Promise<void> {
  await writeDoc("audit", "event", eventId(kind, subject), { kind, subject });
}
