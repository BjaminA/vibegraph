import { getJson } from "./net/client";

export async function orders(): Promise<unknown> {
  return getJson("https://orders.example.com/open");
}
