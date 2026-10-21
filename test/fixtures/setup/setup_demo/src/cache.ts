import { createClient } from "redis";

export async function remember(key: string, value: string) {
  const client = createClient();
  await client.connect();
  return client.set(key, value);
}
