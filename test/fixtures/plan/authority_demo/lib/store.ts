// The shared store's client: every write goes through writeDoc.

/** Write one document of a family into a zone of the store. */
export async function writeDoc(zone: string, family: string, id: string, data: unknown): Promise<void> {
  await fetch(`https://store.example/${zone}/${family}/${id}`, { method: "PUT", body: JSON.stringify(data) });
}
