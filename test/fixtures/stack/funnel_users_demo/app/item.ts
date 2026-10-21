import { loadItem } from "../lib/utils";

export function item(id: string): Promise<unknown> {
  return loadItem(id);
}
