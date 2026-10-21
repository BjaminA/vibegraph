import { cn, fetcher } from "../lib/utils";

export async function items(): Promise<unknown> {
  cn("items");
  return fetcher("/api/items");
}
