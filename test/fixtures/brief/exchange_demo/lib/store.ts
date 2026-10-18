// The shared ledger's client: every process reaches the document store through here.
export async function writeDoc(zone: string, id: string, doc: unknown): Promise<void> {
  await fetch(`https://ledger.example/${zone}/${id}`, { method: "PUT", body: JSON.stringify(doc) });
}

export async function readDoc(zone: string, id: string): Promise<any> {
  const res = await fetch(`https://ledger.example/${zone}/${id}`);
  return res.json();
}

/** Calls `onChange` for every document that changes in the zone. */
export async function watchDoc(zone: string, onChange: (id: string, doc: any) => Promise<void>): Promise<void> {
  const res = await fetch(`https://ledger.example/${zone}?watch=1`);
  for (const change of (await res.json()) as Array<{ id: string; doc: any }>) await onChange(change.id, change.doc);
}
