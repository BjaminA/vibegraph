// The item store's client: every process reaches the shared store through here.
export class ItemStore {
  async read(path: string): Promise<unknown> { return (await fetch(`https://items.example${path}`)).json(); }
  async write(path: string, doc: unknown): Promise<void> { await fetch(`https://items.example${path}`, { method: "PUT", body: JSON.stringify(doc) }); }
  async watch(path: string, onChange: (doc: unknown) => void): Promise<void> { onChange(await this.read(path)); }
}
