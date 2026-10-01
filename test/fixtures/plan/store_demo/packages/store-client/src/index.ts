// The one module that talks to the shared store: its SDK for transport, a
// CRDT library for the documents. Every process reaches the store through it.
import { connect } from "@acme/store-sdk";
import * as Y from "yjs";

const conn = connect(process.env.STORE_URL ?? "ws://localhost:1234");

/** Write one document of a family into a zone of the store. */
export async function writeDoc(zone: string, family: string, id: string, data: Record<string, unknown>): Promise<void> {
  const doc = new Y.Doc();
  doc.getMap(family).set(id, data);
  await conn.push(zone, Y.encodeStateAsUpdate(doc));
}

/** Watch a zone for documents of a family. */
export function watchDocs(zone: string, family: string, cb: (id: string, data: unknown) => void): void {
  conn.subscribe(zone, (update: Uint8Array) => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    doc.getMap(family).forEach((value, key) => cb(key, value));
  });
}
