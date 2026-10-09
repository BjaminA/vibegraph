// The registry: which inboxes exist is decided at run time, by listing them.
export interface Channel {
  watch(field: string, index: string, on: (id: string) => void): () => void;
  read(field: string): Promise<string>;
}
export interface Client {
  list(): Promise<string[]>;
  open(name: string): Promise<Channel>;
}

const roleToken = (s: string) => s.toLowerCase();
const userToken = (s: string) => s.toLowerCase();

export class Registry {
  client: Client;
  constructor(client: Client) { this.client = client; }

  /** Every inbox visible to this identity: one per role and user. */
  async inboxes(): Promise<string[]> {
    const names = await this.client.list();
    return [...new Set(names.flatMap((n) => {
      const m = n.match(/^([a-z]+)--([a-z]+)$/);
      return m ? [`inbox_${roleToken(m[1])}__${userToken(m[2])}`] : [];
    }))].sort();
  }

  async meta(name: string): Promise<Channel> {
    return this.client.open(name);
  }
}
