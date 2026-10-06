// The order service: answers status queries.
import { createServer } from "node:http";
import { remoteStore } from "../lib/remote";

const user = process.env.SVC_USER ?? "svc";
const store = remoteStore("https://ledger.example");

const server = createServer(async (req, res) => {
  res.end(JSON.stringify(await store.read("status", req.url ?? "")));
});

server.listen(8080);
