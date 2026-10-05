import { readDoc, writeDoc } from "../lib/store";

/** Decides an order on the recorded evidence. */
export async function decide(requestId: string): Promise<string> {
  const approver = await readDoc("approver", "current");
  const verdict = approver ? "approved" : "held";
  await writeDoc("status", requestId, { verdict });
  return verdict;
}
