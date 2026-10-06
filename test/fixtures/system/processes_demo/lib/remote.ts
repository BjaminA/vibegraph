// The real store, over HTTP.
export function remoteStore(base: string) {
  return {
    async write(zone: string, id: string, doc: unknown): Promise<void> { await fetch(`${base}/${zone}/${id}`, { method: "PUT", body: JSON.stringify(doc) }); },
    async read(zone: string, id: string): Promise<unknown> { return (await fetch(`${base}/${zone}/${id}`)).json(); },
  };
}
