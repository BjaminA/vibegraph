// A server: its listen() is what runs.
import { createServer } from "node:http";
const server = createServer(() => {});
server.listen(3000);
