// Reads an item's parts, each with its label.
import { itemPath, labelPath } from "./paths";

export interface Source { read(path: string): Promise<unknown> }

/** The parts of an item. */
const PARTS: Array<[string, string]> = [["core", "core"], ["notes", "notes"], ["tags", "tags"]];

export class Reader {
  constructor(private readonly src: Source) {}

  async #parts(id: string): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const [key, part] of PARTS) {
      const path = itemPath(id, part);
      out.push({ key, value: await this.src.read(path), label: await this.src.read(labelPath(path)) });
    }
    return out;
  }

  async item(id: string): Promise<unknown[]> {
    return this.#parts(id);
  }
}
