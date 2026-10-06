// The request handler: reads through the reader, saves through the port it is given.
import { Reader } from "./reader";
import type { Ops } from "./ports";

export async function handle(reader: Reader, ops: Ops | undefined, id: string, note?: string): Promise<string> {
  if (note && ops) await ops.save(id, note);
  return JSON.stringify(await reader.item(id));
}
