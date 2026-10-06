// The item API: answers reads, and saves notes when it may.
import { createServer } from "node:http";
import { ItemStore } from "../src/store";
import { Reader } from "../src/reader";
import { handle } from "../src/handler";
import { itemPath } from "../src/paths";
import type { Ops } from "../src/ports";

const store = new ItemStore();
const reader = new Reader(store);
let ops: Ops | undefined;
if (process.env.ITEMS_WRITABLE) {
  ops = {
    save: async (id, note) => { await store.write(itemPath(id, "notes"), { note }); },
  };
}

createServer(async (req, res) => {
  res.end(await handle(reader, ops, req.url ?? "", req.headers["x-note"] as string | undefined));
}).listen(8080);
