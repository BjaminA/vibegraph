// The release rule, shared: the runner gives it the remote store, the offline
// tool an in-memory one.
export async function release(
  store: { write(zone: string, id: string, doc: unknown): Promise<void>; read(zone: string, id: string): Promise<unknown> },
  id: string,
): Promise<void> {
  const req = await store.read("requests", id);
  if (req) await store.write("status", id, { phase: "released" });
}
