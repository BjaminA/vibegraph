// The clerks' app: a clerk files an order request and its records.
import { createServer } from "node:http";
import { writeDoc } from "../../lib/store";

const server = createServer(async (req, res) => {
  const id = new URL(req.url ?? "/", "http://localhost").searchParams.get("id") ?? "";
  await writeDoc("request_clerk", id, { by: "clerk" });
  await writeDoc("records_intake", id, { at: Date.now() });
  res.end("filed");
});

server.listen(3000);
