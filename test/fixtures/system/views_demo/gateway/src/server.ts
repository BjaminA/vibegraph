// The partner gateway: partners read an order's status and file requests over HTTP.
import { createServer } from "node:http";
import { readDoc, writeDoc } from "../../lib/store";

// the partner identity this gateway acts as
const asUser = process.env.GATEWAY_USER ?? "gateway";

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/orders") {
    res.end(JSON.stringify(await readDoc("status", url.searchParams.get("id") ?? "")));
    return;
  }
  if (url.pathname === "/requests") {
    await writeDoc("request_partner", url.searchParams.get("id") ?? "", { from: "partner" });
    res.end("ok");
    return;
  }
  res.statusCode = 404;
  res.end();
});

server.listen(8080);
