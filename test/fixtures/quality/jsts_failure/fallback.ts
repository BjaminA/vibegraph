// Only a fallback assignment: whether it is read later needs data-flow.
export async function fallback(store: { put(v: number): Promise<void> }) {
  let ok = true;
  try { await store.put(9); } catch (e) { ok = false; }
  return ok;
}
