// What the API hands its request handler.
export interface Ops {
  save(id: string, note: string): Promise<void>;
}
