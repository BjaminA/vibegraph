import { getJson } from "./net/client";

export async function users(): Promise<unknown> {
  return getJson("https://users.example.com/active");
}
