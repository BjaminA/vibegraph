import worker from "./worker.js";

export async function testServesAssets() {
  const env = { ASSETS: { fetch: async () => new Response("page") }, ORIGIN: "http://origin" };
  const res = await worker.fetch(new Request("http://site/"), env);
  return (await res.text()) === "page";
}
