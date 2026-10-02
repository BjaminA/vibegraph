// The shared store's client.

/** Write a document into a zone. */
export async function writeDoc(zone: string, id: string, data: unknown): Promise<void> {
  await fetch(`https://store.example/${zone}/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

/** Read the documents of a family from a zone. */
export async function readDocs(zone: string, family: string): Promise<unknown[]> {
  const r = await fetch(`https://store.example/${zone}?family=${family}`);
  return (await r.json()) as unknown[];
}
