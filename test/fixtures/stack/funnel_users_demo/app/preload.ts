import { loader } from "../lib/utils";

export function preload(ids: string[]): Array<Promise<unknown>> {
  return ids.map((id) => loader(id));
}
