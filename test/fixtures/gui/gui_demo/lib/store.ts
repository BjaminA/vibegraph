// The shared document store's client: every process reaches it through here.
export async function writeDoc(zone: string, id: string, doc: unknown): Promise<void> {
  await fetch(`https://ledger.example/${zone}/${id}`, { method: "PUT", body: JSON.stringify(doc) });
}

export async function readDoc(zone: string, id: string): Promise<unknown> {
  const res = await fetch(`https://ledger.example/${zone}/${id}`);
  return res.json();
}

/** Records who the current approver is. Only the admin's tool may call it. */
export async function appoint(runId: string): Promise<void> {
  await writeDoc("approver", "current", { runId });
}
