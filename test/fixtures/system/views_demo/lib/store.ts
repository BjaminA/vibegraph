// The order ledger's client: every process reaches the shared store through here.
export async function writeDoc(zone: string, id: string, doc: unknown): Promise<void> {
  await fetch(`https://ledger.example/${zone}/${id}`, { method: "PUT", body: JSON.stringify(doc) });
}

export async function readDoc(zone: string, id: string): Promise<unknown> {
  const res = await fetch(`https://ledger.example/${zone}/${id}`);
  return res.json();
}
