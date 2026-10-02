// A store client with a write and a delete.

/** Write a document. */
export async function writeDoc(owner: string, sid: string, doc: string): Promise<void> {
  await fetch(`https://store.example/${owner}/${sid}/${doc}`, { method: "PUT" });
}

/** Delete a document. */
export async function deleteDoc(owner: string, id: string): Promise<void> {
  await fetch(`https://store.example/${owner}/${id}`, { method: "DELETE" });
}
