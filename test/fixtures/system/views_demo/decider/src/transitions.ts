import { readDoc, writeDoc } from "../../lib/store";

/** Moves an order to its next phase, if the request allows it. */
export async function applyTransition(id: string): Promise<string> {
  const request = await readDoc("request_clerk", id);
  const approver = await checkApprover();
  const phase = request && approver ? "released" : "held";
  await writeDoc("status", id, { phase });
  return phase;
}

/** The release tree's first gate: is an approver appointed? */
export async function checkApprover(): Promise<boolean> {
  return !!(await readDoc("approver", "current"));
}
