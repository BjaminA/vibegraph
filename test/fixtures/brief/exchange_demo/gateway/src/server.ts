// The clerks' gateway: clerks file order requests and read an order's status.
import { createServer } from "node:http";
import { readDoc, writeDoc } from "../../lib/store";

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const id = url.searchParams.get("id") ?? "";
  if (url.pathname === "/status") { res.end(JSON.stringify(await readDoc("status", id))); return; }
  if (url.pathname === "/request") { await writeDoc("requests", id, { by: "clerk", at: Date.now() }); res.end("filed"); return; }
  if (url.pathname === "/evidence") { await writeDoc("evidence", id, { by: "clerk", confirmed: false }); res.end("filed"); return; }
  if (url.pathname === "/history") { for (const v of ["v1", "v2", "v3"]) await writeDoc("history", `${id}-${v}`, { id, v }); res.end("ok"); return; }
  res.statusCode = 404;
  res.end();
});

server.listen(8080);
