// The clerks' app: files a request (a real write).
import { createServer } from "node:http";
import { writeDoc } from "../lib/store";

const server = createServer(async (req, res) => {
  const id = new URL(req.url ?? "/", "http://localhost").searchParams.get("id") ?? "";
  await writeDoc("requests", id, { by: "clerk" });
  res.end("filed");
});

server.listen(3000);
