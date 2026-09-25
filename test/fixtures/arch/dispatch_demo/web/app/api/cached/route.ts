import { readFile } from "node:fs/promises";
import path from "node:path";

// Serves a report the dispatcher already wrote, straight from the cache.
export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("script") ?? "daily";
  const root = process.env.CACHE_ROOT ?? "";
  const body = await readFile(path.join(root, `${name}.json`), "utf-8");
  return new Response(body, { headers: { "content-type": "application/json" } });
}
